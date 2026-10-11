// test/admin-rooms.test.js — 监控大屏的运维接口：
//   * GET /api/admin/rooms 现在同时报 humanCount（未离开的座位）与 connectedHumans / audience / awaySec，
//     让大屏能区分「有人正在玩」和「只是等人回来的空房」（后者踢整房无效 —— 那个接口只列在线玩家）；
//   * GET /api/admin/room/close 收掉一个房间：无人在线时直接关，有人在线时必须显式 force=1（否则 409）；
//   * 关房走的是「最后一人离开」同一条路径：房间从 lobby 消失、座位释放、客户端收到 room.closed{admin}。
//
// 起真服务器（startServer({port:0})）走真 socket，和 test/lobby.test.js 同一套做法。

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const TOKEN = 'test-admin-token';

async function get(port, path) {
  return await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch { /* 非 JSON 就留 null */ }
        resolve({ status: res.statusCode, json, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('监控大屏：房间列表与关房', () => {
  let srv;
  const clients = [];

  before(async () => {
    process.env.SP_ADMIN_TOKEN = TOKEN;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: (await import('../server/match/StubMatch.js')).StubMatch });
  });
  after(async () => {
    for (const c of clients) await c.terminate().catch(() => {});
    await srv?.close();
    delete process.env.SP_ADMIN_TOKEN;
  });

  async function player(name) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    const w = await c.hello(name);
    c.id = w.playerId;
    clients.push(c);
    return c;
  }

  test('无 token / 错 token 一律 403（关房也不例外）', async () => {
    assert.equal((await get(srv.port, '/api/admin/rooms')).status, 403);
    assert.equal((await get(srv.port, `/api/admin/rooms?token=nope`)).status, 403);
    assert.equal((await get(srv.port, `/api/admin/room/close?token=nope&code=ABCD`)).status, 403);
  });

  test('在线的房间：connectedHumans > 0、audience=live；掉线后 audience=away 且 awaySec 开始走', async () => {
    const host = await player('Host');
    const r = await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    assert.equal(r.t, 'ok');
    const state = await host.waitFor('room.state', (s) => s.hostId === host.id);
    const code = state.code;

    let j = (await get(srv.port, `/api/admin/rooms?token=${TOKEN}`)).json;
    let room = j.rooms.find((x) => x.code === code);
    assert.ok(room, 'room listed');
    assert.equal(room.connectedHumans, 1);
    assert.equal(room.humanCount, 1);
    assert.equal(room.audience, 'live');
    assert.equal(room.awaySec, 0);

    // 掉线（还没到宽限）：座位仍在（humanCount 不变），但没有人在线了
    await host.terminate();
    await new Promise((r2) => setTimeout(r2, 120));
    j = (await get(srv.port, `/api/admin/rooms?token=${TOKEN}`)).json;
    room = j.rooms.find((x) => x.code === code);
    assert.ok(room, 'the room survives while the seat waits for its human');
    assert.equal(room.humanCount, 1, '座位还留着');
    assert.equal(room.connectedHumans, 0, '但没人在线');
    assert.equal(room.audience, 'away');
    assert.ok(room.awaySec >= 0 && room.awaySec < 60, `awaySec=${room.awaySec}`);
  });

  test('关房：无人在线时直接关（客户端收到 room.closed{admin}），房间从列表消失', async () => {
    const host = await player('Closer');
    const r = await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    assert.equal(r.t, 'ok');
    const state = await host.waitFor('room.state', (s) => s.hostId === host.id);
    const code = state.code;
    await host.terminate();
    await new Promise((r2) => setTimeout(r2, 120));

    const closed = await get(srv.port, `/api/admin/room/close?token=${TOKEN}&code=${code}`);
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    assert.equal(closed.json.ok, true);

    const j = (await get(srv.port, `/api/admin/rooms?token=${TOKEN}`)).json;
    assert.ok(!j.rooms.some((x) => x.code === code), 'room gone');
    // 关完再关一次：404 而不是 500
    assert.equal((await get(srv.port, `/api/admin/room/close?token=${TOKEN}&code=${code}`)).status, 404);
  });

  test('关房：有人在线时 409（保护正在玩的房），force=1 才关，并在线的玩家收到 room.closed{admin}', async () => {
    const host = await player('Busy');
    const r = await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    assert.equal(r.t, 'ok');
    const state = await host.waitFor('room.state', (s) => s.hostId === host.id);
    const code = state.code;

    const refused = await get(srv.port, `/api/admin/room/close?token=${TOKEN}&code=${code}`);
    assert.equal(refused.status, 409, JSON.stringify(refused.json));
    assert.equal(refused.json.ok, false);
    assert.equal(refused.json.connected, 1);

    const wait = host.waitFor('room.closed');
    const forced = await get(srv.port, `/api/admin/room/close?token=${TOKEN}&code=${code}&force=1`);
    assert.equal(forced.status, 200, JSON.stringify(forced.json));
    assert.equal(forced.json.kicked, 1);
    const msg = await wait;
    assert.equal(msg.reason, 'admin');
  });

  test('房间密钥格式不对 → 400，不存在的房 → 404', async () => {
    assert.equal((await get(srv.port, `/api/admin/room/close?token=${TOKEN}&code=ab`)).status, 400);
    assert.equal((await get(srv.port, `/api/admin/room/close?token=${TOKEN}&code=zzzz`)).status, 404);
  });
});
