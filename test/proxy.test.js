// test/proxy.test.js — 联机（本机客户端）模式：server/http/proxy.js，以及两条接线
// （routes.js 转发 /api/*、websocket.js 转发 /ws 的 upgrade）。
//
// 起一个「假上游」（http + ws 同一个端口），再用 startServer({ proxyTo }) 起本机那一份，然后断言：
//   * /api/* 转发给上游，状态码 / 响应头 / body 原样带回；本机的运维接口不受影响（/healthz 仍由本机回答）；
//   * 静态页面与素材由**本机磁盘**回答，一次都不走上游（上游的请求计数证明）；
//   * /ws 的升级整条交给上游，且关闭码 4001 原样透传（客户端靠它决定不自动重连）；
//   * 上游不可达时 /api/* 回 502（不是 500），/ws 用 1011 收尾；
//   * parseProxyOrigin 的接受形式与无效输入。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

import { startServer, parseProxyOrigin } from '../server/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/** 假上游：/api/* 与 /healthz 由它回答（带一个只有上游才有的响应头），/ws 回显并演示关闭码透传。 */
function startUpstream() {
  const seen = { http: 0, ws: 0, paths: [] };
  const server = http.createServer((req, res) => {
    seen.http++;
    seen.paths.push(req.url);
    if (req.url === '/api/ping') {
      res.writeHead(200, { 'content-type': 'application/json', 'x-upstream': 'yes' });
      res.end(JSON.stringify({ from: 'upstream' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('upstream has no such route');
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    seen.ws++;
    ws.on('message', (data) => {
      const s = String(data);
      if (s === 'bye') { ws.close(4001, 'replaced'); return; }   // 客户端必须原样看到 4001
      ws.send(`upstream:${s}`);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        seen,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => { for (const c of wss.clients) c.terminate(); wss.close(() => server.close(() => done())); }),
      });
    });
  });
}

/** 连一条 WebSocket，按顺序收帧；返回 { ws, next(), closed }。 */
function connect(url) {
  const ws = new WebSocket(url);
  const frames = [];
  const waiters = [];
  ws.on('message', (d) => {
    const w = waiters.shift();
    if (w) w(String(d)); else frames.push(String(d));
  });
  let closedInfo = null;
  const closeWaiters = [];
  const settleClose = (info) => {
    closedInfo = info;
    for (const w of closeWaiters.splice(0)) w(info);
  };
  ws.on('close', (code, reason) => settleClose({ code, reason: String(reason || '') }));
  // 握手被拒（404/429/503）时 ws 发的是 error 而不是 close：当作一次「已拒绝」结算，reason 里带状态码
  ws.on('error', (e) => { if (!closedInfo) settleClose({ code: 0, reason: String(e?.message || e) }); });
  return {
    ws,
    next: () => new Promise((resolve, reject) => {
      if (frames.length) { resolve(frames.shift()); return; }
      const timer = setTimeout(() => reject(new Error('timed out waiting for a frame')), 5000);
      waiters.push((v) => { clearTimeout(timer); resolve(v); });
    }),
    closed: () => new Promise((resolve) => {
      if (closedInfo) { resolve(closedInfo); return; }
      const timer = setTimeout(() => resolve(null), 5000);
      closeWaiters.push((v) => { clearTimeout(timer); resolve(v); });
    }),
  };
}

describe('联机（本机客户端）模式：SP_PROXY_TO', () => {
  let upstream;
  let srv;

  before(async () => {
    upstream = await startUpstream();
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, proxyTo: upstream.url });
  });
  after(async () => {
    await srv?.close();
    await upstream?.close();
  });

  test('parseProxyOrigin：接受 host[:port] 与完整 origin，其余一律 null', () => {
    assert.equal(parseProxyOrigin(undefined), null);
    assert.equal(parseProxyOrigin(''), null);
    assert.equal(parseProxyOrigin('   '), null);
    assert.equal(parseProxyOrigin('ftp://game.example.com'), null);
    assert.equal(parseProxyOrigin('http://1.2.3.4:3000/some/path?q=1#frag').origin, 'http://1.2.3.4:3000');
    assert.equal(parseProxyOrigin('https://game.example.com/').origin, 'https://game.example.com');
    // 没写协议：按 https 处理（公网默认；本机/内网的 http 由启动器探活后写成显式 URL）
    assert.equal(parseProxyOrigin('game.example.com:3001').origin, 'https://game.example.com:3001');
  });

  test('/api/* 转发给上游：状态码、响应头与 body 原样带回', async () => {
    const res = await fetch(`${srv.url}/api/ping`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-upstream'), 'yes');
    assert.deepEqual(await res.json(), { from: 'upstream' });
    // 上游没有的路由：404 也是上游的 404，不是本机静态的 404 页面
    const nf = await fetch(`${srv.url}/api/nope`);
    assert.equal(nf.status, 404);
    assert.equal(await nf.text(), 'upstream has no such route');
  });

  test('页面与素材由本机磁盘回答，一次都不走上游', async () => {
    const before = upstream.seen.http;
    const page = await fetch(`${srv.url}/index.html`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/i);
    const shared = await fetch(`${srv.url}/shared/constants.js`);
    assert.equal(shared.status, 200);
    assert.equal(upstream.seen.http, before, '静态请求不得转发给上游');
    assert.ok(!upstream.seen.paths.includes('/index.html'));
  });

  test('/healthz 由本机回答（客户端的 buildGuard 要拿它与本机页面比对）', async () => {
    const res = await fetch(`${srv.url}/healthz`);
    assert.equal(res.status, 200);
    const h = await res.json();
    assert.equal(h.ok, true);
    assert.equal(h.app, JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
    assert.ok(!upstream.seen.paths.includes('/healthz'), '/healthz 不得转发');
  });

  test('/ws 整条交给上游，且关闭码 4001 原样透传', async () => {
    const c = connect(`${srv.url.replace(/^http/, 'ws')}/ws`);
    await new Promise((resolve, reject) => {
      c.ws.on('open', resolve);
      c.ws.on('error', reject);
    });
    c.ws.send('hello');
    assert.equal(await c.next(), 'upstream:hello');
    assert.equal(upstream.seen.ws, 1);
    c.ws.send('bye');
    const info = await c.closed();
    assert.ok(info, 'socket closed');
    assert.equal(info.code, 4001, '关闭码必须原样透传（客户端靠它决定不自动重连）');
  });

  test('非 /ws 的 upgrade 仍然 404（不把整台服务器变成开放代理）', async () => {
    const c = connect(`${srv.url.replace(/^http/, 'ws')}/other`);
    const info = await c.closed();
    assert.ok(info, 'refused');
    assert.match(info.reason, /404/, '拒绝理由里是 404，而不是被转发到上游');
    assert.equal(upstream.seen.ws, 1, '上游只收到过那条真正 /ws（这次不得到达上游）');
  });
});

describe('上游不可达', () => {
  test('/api/* 回 502、/ws 以 1011 收尾（而不是 500 或挂住）', async () => {
    // 先占一个端口再关掉，保证这个地址上确实没有人听
    const dead = await new Promise((resolve) => {
      const s = http.createServer();
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address();
        s.close(() => resolve(`http://127.0.0.1:${port}`));
      });
    });
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, proxyTo: dead });
    try {
      const res = await fetch(`${srv.url}/api/ping`);
      assert.equal(res.status, 502);
      const c = connect(`${srv.url.replace(/^http/, 'ws')}/ws`);
      const info = await c.closed();
      assert.ok(info, 'socket closed');
      assert.equal(info.code, 1011);
    } finally {
      await srv.close();
    }
  });
});

describe('scripts/launch.mjs：端口上已经有服务器时', () => {
  test('联机模式不复用它（否则页面像在联机、实际全打本机）；本机开服照旧只开浏览器', async () => {
    const { existingServerAction } = await mod('scripts/launch.mjs');
    assert.equal(existingServerAction({ SP_PROXY_TO: 'http://101.132.104.41:3000' }), 'refuse');
    assert.equal(existingServerAction({ SP_PROXY_TO: '  ' }), 'open');
    assert.equal(existingServerAction({}), 'open');
  });
});

describe('scripts/launcher.mjs：菜单项', () => {
  test('配了上游时第 2 项是「联机」，没配时是「连接服务器」（且不出现「未配置地址」那一行）', async () => {
    const { menuItems } = await mod('scripts/launcher.mjs');
    const on = menuItems({ upstream: 'http://101.132.104.41:3000' });
    assert.deepEqual(on.map((i) => i.mode), ['local', 'proxy', 'settings', 'status']);
    assert.equal(on[1].name, '联机');
    assert.match(on[1].hint, /101\.132\.104\.41:3000/);
    const off = menuItems({ upstream: '' });
    assert.deepEqual(off.map((i) => i.mode), ['local', 'connect', 'settings', 'status']);
    assert.ok(!JSON.stringify(off).includes('联机'), '没有上游就不列联机');
    assert.ok(!JSON.stringify(off).includes('未配置'), '也不该出现「本包未配置地址」这种对玩家无意义的一行');
  });
});

describe('scripts/launcher.mjs：联机模式的上游地址只来自配置', () => {
  test('配置里没有 upstream / 地址非法时拒绝启动', async () => {
    const { runProxy } = await mod('scripts/launcher.mjs');
    assert.equal(await runProxy({ port: 3000, host: '0.0.0.0', upstream: '' }, { open: false, yes: true }), 1);
    assert.equal(await runProxy({ port: 3000, upstream: 'http://' }, { open: false, yes: true }), 1);
  });

  test('不接受调用方传入的服务器地址（凭证按 origin 存，地址必须写死在包里）', () => {
    const src = readFileSync(path.join(ROOT, 'scripts', 'launcher.mjs'), 'utf8');
    assert.match(src, /runProxy\(cfg, \{ open: o\.open, yes: o\.yes \}\)/);
    assert.ok(!/runProxy\([^)]*o\.server/.test(src), '联机模式不得把 --server 吃进去');
    assert.match(src, /上游地址\*\*只\*\*从 launcher\.config\.json 读/);
  });
});
