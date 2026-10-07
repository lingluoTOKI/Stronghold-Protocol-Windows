// test/proxy.test.js — 反向代理模式（server/index.js 的 opts.proxyTo / SP_PROXY_TO）。
//
// 便携包与安卓包用**本机磁盘**上的客户端与素材起服务，只把 /ws 与 /api/* 转发给中心服务器，于是
// 「本机素材 + 在线联机」成立，而客户端代码一行都不用改。这里验证的就是这条分工线：
//   静态文件 → 本机（上游挂掉也照样能开）
//   /healthz → 本机（buildGuard 要比对本机这一份代码）
//   /api/*   → 上游
//   /ws      → 上游（含关闭码透传：4001 决定客户端要不要自动重连）
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer, parseProxyOrigin } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';

const quiet = () => ({ info() {}, warn() {}, debug() {}, error() {} });
const getJson = async (url) => {
  const res = await fetch(url);
  let body = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body };
};
const wsUrl = (base) => `${base.replace(/^http/, 'ws')}/ws`;

describe('parseProxyOrigin', () => {
  test('接受完整 origin、裸主机名与带端口的 http', () => {
    assert.equal(parseProxyOrigin('https://game.example.com').origin, 'https://game.example.com');
    // 裸主机名按 https 处理：公网服务器几乎都是 https
    assert.equal(parseProxyOrigin('game.example.com').origin, 'https://game.example.com');
    // 局域网/本机必须是 http，端口要保住
    assert.equal(parseProxyOrigin('http://192.168.1.5:3000').origin, 'http://192.168.1.5:3000');
  });

  test('去掉路径、查询串与首尾空白', () => {
    assert.equal(parseProxyOrigin('  https://a.example.com/x/y?z=1#f  ').origin, 'https://a.example.com');
  });

  test('空值与不支持的协议一律当作「没开代理」', () => {
    for (const raw of ['', '   ', null, undefined, 'ftp://x.example.com', 'javascript:alert(1)']) {
      assert.equal(parseProxyOrigin(raw), null, String(raw));
    }
  });
});

describe('反向代理模式', () => {
  /** @type {any} */ let central;
  /** @type {any} */ let proxy;
  /** @type {string} */ let emptyDir;

  before(async () => {
    // 中心服务器故意用一个空的 publicDir：这样"这个文件从哪来"就有了唯一的答案
    emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-proxy-'));
    central = await startServer({ port: 0, host: '127.0.0.1', quiet: true, log: quiet(), publicDir: emptyDir, MatchClass: StubMatch });
    proxy = await startServer({ port: 0, host: '127.0.0.1', quiet: true, log: quiet(), proxyTo: central.url, MatchClass: StubMatch });
  });

  after(async () => {
    await proxy?.close();
    await central?.close();
    try { fs.rmSync(emptyDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('静态文件由本机提供：中心服务器没有这个文件，代理这边仍是 200', async () => {
    const onCentral = await fetch(`${central.url}/manifest.json`);
    assert.equal(onCentral.status, 404, '中心服务器的 publicDir 是空的，不该有这个文件');
    const onProxy = await fetch(`${proxy.url}/manifest.json`);
    assert.equal(onProxy.status, 200, '代理必须从本机磁盘拿这个文件');
    assert.match(onProxy.headers.get('content-type') || '', /json/);
  });

  test('/healthz 保持本机（buildGuard 要比对本机这一份代码）', async () => {
    const r = await getJson(`${proxy.url}/healthz`);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.build, '本机 /healthz 仍要给出 build 标记');
  });

  test('/api/* 转发到中心服务器', async () => {
    // 代理这边从不处理 WebSocket，所以它自己的 online 恒为 0；中心那边连着 1 条，正好用来判定"这条响应来自上游"
    const c = await TestClient.connect(wsUrl(proxy.url));
    await c.hello('代理玩家');
    try {
      const onCentral = await getJson(`${central.url}/api/online`);
      assert.equal(onCentral.body.online, 1, '中心服务器应当看到这条连接');
      const onProxy = await getJson(`${proxy.url}/api/online`);
      assert.equal(onProxy.status, 200);
      assert.equal(onProxy.body.online, 1, '/api/online 应当来自中心服务器，而不是本机那个恒为 0 的计数');
    } finally {
      await c.terminate();
    }
  });

  test('/ws 转发：经代理能完成 hello/welcome，并真的进入中心的房间系统', async () => {
    const c = await TestClient.connect(wsUrl(proxy.url));
    try {
      const welcome = await c.hello('联机玩家');
      assert.equal(welcome.t, 'welcome');
      assert.ok(welcome.playerId, 'welcome 必须带有中心服务器分配的 playerId');
      // 房号由中心服务器的 lobby 生成：能建出房间就证明这条连接真的在中心那套状态里
      const reply = await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
      assert.equal(reply.t, 'ok', JSON.stringify(reply));
      const state = await c.waitFor('room.state', (s) => s.hostId === welcome.playerId);
      assert.match(state.code, /^[A-Z0-9]{4}$/);
    } finally {
      await c.terminate();
    }
  });

  test('关闭码透传：会话被顶掉时客户端仍看到 4001（决定它要不要自动重连）', async () => {
    const first = await TestClient.connect(wsUrl(proxy.url));
    const w = await first.hello('顶号玩家');
    const second = await TestClient.connect(wsUrl(proxy.url));
    try {
      await second.hello('顶号玩家', w.token);
      const closed = await first.closed;
      assert.equal(closed.code, 4001, `期望 4001（会话被替换），实际 ${closed.code}（换成 1006 会让重连策略走错分支）`);
    } finally {
      await first.terminate().catch(() => {});
      await second.terminate();
    }
  });

  test('上游不可达时：静态照常可用，/api/* 报 502', async () => {
    // 指向一个没人监听的端口：这正是"服务器没开/断网"时便携包的样子
    const dead = await startServer({ port: 0, host: '127.0.0.1', quiet: true, log: quiet(),
      proxyTo: 'http://127.0.0.1:9', MatchClass: StubMatch });
    try {
      const page = await fetch(`${dead.url}/manifest.json`);
      assert.equal(page.status, 200, '素材在本地，上游挂掉不该影响静态加载');
      const health = await getJson(`${dead.url}/healthz`);
      assert.equal(health.status, 200, '/healthz 是本机的，永远不该依赖上游');
      const api = await getJson(`${dead.url}/api/online`);
      assert.equal(api.status, 502, '/api/* 要转发，上游不可达就该是 502');
    } finally {
      await dead.close();
    }
  });
});
