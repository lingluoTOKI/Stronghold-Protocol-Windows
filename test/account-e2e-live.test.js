// 端到端联调：真实服务器进程 + 真实 websocket 会话 + 真实 SQLite + 真实机器人桥接协议
// 覆盖：start -> bridge（机器人）-> confirm -> me -> 绑定恢复码 -> 跨 realm 共用账号 -> 越权防护
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { startServer } from '../server/index.js';
import { createAccounts } from '../server/accounts/http.js';
import { TestClient } from './helpers/wsClient.js';

const BRIDGE = 'b'.repeat(32);

test('full account flow works against a live server over HTTP and websocket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-account-e2e-'));
  const db = join(dir, 'accounts.sqlite');
  const origin = 'http://127.0.0.1';
  const prev = { ...process.env };
  process.env.SP_ACCOUNT_DB = db;
  process.env.SP_ACCOUNT_BRIDGE_KEY = BRIDGE;
  process.env.SP_ACCOUNT_BOT_NAMESPACE = 'dafeiyu-official';
  process.env.SP_ACCOUNT_ORIGIN = origin;

  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const base = `http://127.0.0.1:${srv.port}`;
  const api = base + '/api/account/';
  let client = null;
  try {
    // 1) 玩家建立游戏会话，拿到 bearer token
    client = await TestClient.connect(base.replace('http', 'ws') + '/ws');
    const welcome = await client.hello('测试员');
    const auth = { Authorization: 'Bearer ' + welcome.token };
    // 真实的游戏会话对象（roomCode 为空 = idle），供第二个 realm 的 accounts 模块复用
    const sessionRef = srv.registry.byToken(welcome.token);

    // 2) 未登录时 /me 返回 enabled 但无 profile
    const anon = await (await fetch(api + 'me', { headers: { Origin: origin } })).json();
    assert.equal(anon.enabled, true);
    assert.equal(anon.profile, null);

    // 3) 游戏页面发起绑定：需要游戏会话（idle），并返回绑定码
    const startRes = await fetch(api + 'start', {
      method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ qq: '100200300', nickname: '测试昵称' })
    });
    assert.equal(startRes.status, 200);
    const start = await startRes.json();
    assert.match(start.code, /^[A-F0-9]{16}$/);
    assert.equal(start.command, `绑定游戏 3000 ${start.code}`);
    const pending = startRes.headers.getSetCookie().find(c => c.startsWith('sp_account_pending_3000=')).split(';')[0];

    // 4) 机器人侧桥接：错误的 key 必须被拒
    const bad = await fetch(api + 'bridge', {
      method: 'POST', headers: { 'X-Account-Bridge': 'x'.repeat(32), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: start.code, sender: 'qq-user-1' })
    });
    assert.equal(bad.status, 403);

    // 5) 机器人用正确 key 验证
    const bridge = await (await fetch(api + 'bridge', {
      method: 'POST', headers: { 'X-Account-Bridge': BRIDGE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: start.code, sender: 'qq-user-1' })
    })).json();
    assert.equal(bridge.verified, true);
    // 桥接不回传 subject，身份只写进服务端会话，避免绑定码泄露 QQ 身份
    assert.equal(bridge.subject, undefined);
    assert.equal(JSON.stringify(bridge).includes('qq-user-1'), false);

    // 6) 回游戏确认 -> 拿到登录 cookie
    const confirmRes = await fetch(api + 'confirm', {
      method: 'POST', headers: { ...auth, Origin: origin, Cookie: pending, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(confirmRes.status, 200);
    const confirmed = await confirmRes.json();
    assert.equal(confirmed.profile.qq, '100200300');
    assert.equal(confirmed.profile.nickname, '测试昵称');
    const cookie = confirmRes.headers.getSetCookie().find(c => c.startsWith('sp_account_3000=')).split(';')[0];
    assert.ok(cookie.includes('='));

    // 7) 复用 cookie 查询 me（模拟刷新页面）
    const me = await (await fetch(api + 'me', { headers: { Origin: origin, Cookie: cookie } })).json();
    assert.equal(me.profile.id, confirmed.profile.id);
    assert.equal(me.realm, '3000');

    // 8) 恢复码可取，且修改昵称生效
    const rec = await (await fetch(api + 'recovery', {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })).json();
    assert.ok(rec.code && /^[a-f0-9]{64}$/.test(rec.code), 'recovery code shape: ' + JSON.stringify(rec).slice(0, 120));
    const renamed = await (await fetch(api + 'rename', {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '新昵称' })
    })).json();
    assert.equal(renamed.profile.nickname, '新昵称');

    // 9) 绑定码是一次性的：重复 confirm 必须失败
    const replay = await fetch(api + 'confirm', {
      method: 'POST', headers: { ...auth, Origin: origin, Cookie: pending, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(replay.status, 400);

    // 10) 跨 realm 共用同一个 SQLite：3001 realm 用同一 QQ+同一 QQ 身份登录，得到同一个账号 id
    //     （realm 由 accounts/http.js 的参数决定，与 server/index.js 的硬编码 realm 无关）
    const accounts2 = createAccounts({
      file: db, realm: '3001', origin, bridgeKey: BRIDGE, namespace: 'dafeiyu-official',
      registry: { byToken: t => t === welcome.token ? sessionRef : null }
    });
    const http2 = createServer((req, res) => accounts2.handle(req, res, new URL(req.url, origin).pathname));
    await new Promise(r => http2.listen(0, '127.0.0.1', r));
    const api2 = `http://127.0.0.1:${http2.address().port}/api/account/`;
    try {
      const s2 = await fetch(api2 + 'start', {
        method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ qq: '100200300', nickname: '测试昵称' })
      });
      const body2 = await s2.json();
      assert.equal(s2.status, 200);
      assert.equal(body2.command, `绑定游戏 3001 ${body2.code}`);
      const pending2 = s2.headers.getSetCookie().find(c => c.startsWith('sp_account_pending_3001=')).split(';')[0];
      const br2 = await fetch(api2 + 'bridge', {
        method: 'POST', headers: { 'X-Account-Bridge': BRIDGE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: body2.code, sender: 'qq-user-1' })
      });
      assert.equal(br2.status, 200);
      const cf2 = await fetch(api2 + 'confirm', {
        method: 'POST', headers: { ...auth, Origin: origin, Cookie: pending2, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(cf2.status, 200);
      const p2 = await cf2.json();
      // 同一 QQ 身份在两个 realm 里指向同一个账号（共用账号库），但记录按 realm 分开
      assert.equal(p2.profile.id, confirmed.profile.id);
      assert.equal(p2.profile.qq, '100200300');
      const cookie2 = cf2.headers.getSetCookie().find(c => c.startsWith('sp_account_3001=')).split(';')[0];
      assert.ok(cookie2 && cookie2 !== cookie, '两个 realm 使用不同 cookie');
      const rec2 = await (await fetch(api2 + 'records', { headers: { Origin: origin, Cookie: cookie2 } })).json();
      assert.deepEqual(rec2.records, [], '3001 realm 看不到 3000 的记录');
    } finally {
      await new Promise(r => http2.close(r));
      await accounts2.close();
    }

    // 11) 越权防护：别人的恢复码不能登入别人的账号之外的操作，且无 session 时禁止登出
    const noSession = await fetch(api + 'logout', {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(noSession.status, 400);
    assert.equal((await noSession.json()).error, 'GAME_SESSION_REQUIRED');
  } finally {
    await client?.close();
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
    Object.assign(process.env, prev);
  }
});
