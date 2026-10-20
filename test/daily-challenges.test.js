import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDailyChallengeBoard } from '../server/dailyChallenges.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { makeMatch } from './match/harness.js';

const time = Date.parse('2026-10-20T12:00:00+08:00');
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
}
function settlement(ids) {
  return { difficulty: 'ABYSS', victory: true, hiddenReached: true, hiddenCleared: true, players: ids.map(playerId => ({ playerId, victory: true, alive: true, roundsPassed: 15,
    bonds: [{ bondId: 'a', active: true }, { bondId: 'b', active: true }],
    stats: { refreshes: 0, perfectRounds: 8, merges: 5, itemsEquipped: 5 } })) };
}
function proofFor(ids, extra = {}) {
  return { mode: ids.length === 1 ? 'solo' : 'coop', difficulty: 'ABYSS', bossHp: 1, usedAI: false,
    participants: ids.map(playerId => ({ playerId, isBot: false })), ...extra };
}
function award(f, result, room = f.room, extra = {}) {
  f.board.record(room, result, f.registry, proofFor(result.players.map(p => p.playerId), extra));
}
async function fixture(t) {
  let clock = time;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-daily-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'board.json');
  const sessions = new Map();
  const registry = { byPlayerId: sessions, byToken: token => [...sessions.values()].find(s => s.token === token) };
  const board = await createDailyChallengeBoard({ file, now: () => clock, log: { error() {} } });
  const room = { seatOf: id => sessions.has(id) ? { playerId: id } : null };
  async function bind(id, cookie) {
    const session = { playerId: id, token: id.charCodeAt(0).toString(16).padStart(32, '0'), name: id, connected: true };
    sessions.set(id, session);
    const res = response();
    await board.handle({ method: 'GET', headers: { authorization: `Bearer ${session.token}`, ...(cookie ? { cookie } : {}) } }, res, registry);
    return res.headers['Set-Cookie']?.split(';')[0] || cookie;
  }
  return { board, room, registry, sessions, bind, file, setTime: ms => { clock = ms; } };
}
test('server-owned settlements award each challenge only once, ties share rank', async t => {
  const f = await fixture(t);
  await f.bind('a');await f.bind('b');
  award(f, settlement(['a', 'b']));
  award(f, settlement(['a', 'b']));
  await f.board.flush();
  assert.deepEqual(f.board.snapshot('coop').rows.map(r => [r.rank, r.points]), [[1, 3], [1, 3]]);
  assert.equal(f.board.snapshot('solo').rows.length, 0);
  const persisted = await fs.readFile(f.file, 'utf8');
  assert.ok(!persisted.includes(f.sessions.get('a').token), 'never persist reconnect tokens');
});
test('same browser cookie survives restart and multiple sessions cannot create extra entries', async t => {
  const f = await fixture(t);const cookie = await f.bind('a');await f.bind('b', cookie);
  award(f, settlement(['a', 'b']));await f.board.flush();
  assert.equal(f.board.snapshot('coop').rows.length, 1);
  const reopened = await createDailyChallengeBoard({ file: f.file, now: () => time });
  const res = response();await reopened.handle({ method: 'GET', url: '/?division=coop', headers: { cookie } }, res, f.registry);
  assert.equal(JSON.parse(res.body).self.points, 3);
  assert.equal(res.headers['Set-Cookie'], undefined);
});
test('training, funny, test, modded, bot, left and spectator rows cannot score', async t => {
  const f = await fixture(t);await f.bind('a');
  for (const extra of [{ difficulty: 'TRAINING' }, { difficulty: 'FUNNY' }, { test: true },
    { players: [{ ...settlement(['a']).players[0], isBot: true }] }, { players: [{ ...settlement(['a']).players[0], left: true }] }]) {
    award(f, { ...settlement(['a']), ...extra });
  }
  award(f, settlement(['a']), { ...f.room, content: { vanilla: false } });
  award(f, settlement(['a']), { ...f.room, seatOf: () => null });
  assert.equal(f.board.snapshot().rows.length, 0);
});
test('read API cannot submit scores; forged cookies cannot claim a stored identity', async t => {
  const f = await fixture(t);const cookie = await f.bind('a');
  const res = response();await f.board.handle({ method: 'GET', headers: { cookie }, body: settlement(['a']) }, res, f.registry);
  assert.equal(JSON.parse(res.body).self, null);
  award(f, settlement(['a']));await f.board.flush();
  const forged = response();await f.board.handle({ method: 'GET', headers: { cookie: cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0') } }, forged, f.registry);
  assert.equal(JSON.parse(forged.body).self, null);
});
test('corrupt primary recovers its backup; two corrupt copies fail closed', async t => {
  const f = await fixture(t);await f.bind('a');award(f, settlement(['a']));await f.board.flush();
  await fs.writeFile(f.file, 'corrupt');
  const recovered = await createDailyChallengeBoard({ file: f.file, now: () => time, log: { error() {} } });
  assert.equal(recovered.snapshot().ok, true);
  assert.equal(recovered.snapshot().rows[0].points, 3);
  await fs.writeFile(f.file, 'corrupt');await fs.writeFile(f.file + '.backup', 'corrupt');
  const board = await createDailyChallengeBoard({ file: f.file, now: () => time, log: { error() {} } });
  assert.equal(board.snapshot().ok, false);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'corrupt');
});

test('solo and multiplayer scores and medals stay separate; fixed profile rejects AI, non-1x and missing proof', async t => {
  const f = await fixture(t);await f.bind('a');await f.bind('b');
  for (const extra of [{ bossHp: 3.25 }, { usedAI: true }, { mode: 'coop' }, { mode: 'unknown' }, { difficulty: 'NORMAL' }]) {
    award(f, settlement(['a']), f.room, extra);
  }
  f.board.record(f.room, settlement(['a']), f.registry);
  assert.equal(f.board.snapshot('solo').rows.length, 0);
  award(f, settlement(['a']));await f.board.flush();
  assert.equal(f.board.snapshot('solo').rows[0].points, 3);
  assert.equal(f.board.snapshot('coop').rows.length, 0);
  award(f, settlement(['a', 'b']));await f.board.flush();
  assert.equal(f.board.snapshot('solo').rows[0].points, 3);
  assert.equal(f.board.snapshot('coop').rows.length, 2);
  const bad = response();await f.board.handle({ method: 'GET', url: '/?division=invalid', headers: {} }, bad, f.registry);
  assert.equal(bad.statusCode, 400);
});

test('real match keeps AI usage latched after autoplay is disabled; ordinary reconnect does not mark AI', t => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', fake: true }).start();
  t.after(() => h.m.dispose());
  assert.equal(h.m.challengeUsedAI, false);
  h.m.onDisconnect('p_0');h.m.onReconnect('p_0');
  assert.equal(h.m.challengeUsedAI, false);
  const p = h.m.players.get('p_0');h.m.setAutoplay(p, true);h.m.setAutoplay(p, false);
  assert.equal(h.m.challengeUsedAI, true);
  const withBot = makeMatch({ mode: 'coop', humans: 1, bots: 1, difficulty: 'ABYSS', fake: true });
  t.after(() => withBot.m.dispose());
  assert.equal(withBot.m.challengeUsedAI, true);
});

test('legacy easy scores are archived, not promoted into new ultimate divisions', async t => {
  const f = await fixture(t);const original = JSON.parse(await fs.readFile(f.file, 'utf8'));
  const legacy = { version: 1, secret: original.secret, days: {} };
  await fs.writeFile(f.file, JSON.stringify(legacy));
  const board = await createDailyChallengeBoard({ file: f.file, now: () => time });
  assert.equal(board.snapshot().ok, true);
  assert.equal(JSON.parse(await fs.readFile(f.file, 'utf8')).secret, original.secret);
  assert.equal(JSON.parse(await fs.readFile(f.file + '.previous-rules', 'utf8')).version, 1);
});

test('daily boundary resets scores and later settlements trim retained history', async t => {
  const f = await fixture(t);await f.bind('a');
  award(f, settlement(['a']));await f.board.flush();
  f.setTime(time + 86400000);
  assert.equal(f.board.snapshot().rows.length, 0);
  award(f, settlement(['a']));await f.board.flush();
  assert.equal(f.board.snapshot().rows[0].points, 3);
  f.setTime(time + 9 * 86400000);
  award(f, settlement(['a']));await f.board.flush();
  const saved = JSON.parse(await fs.readFile(f.file, 'utf8'));
  assert.equal(Object.keys(saved.days).length, 1);
});

test('real HTTP and lobby settlement hook: only server results score; POST is refused', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-daily-http-'));
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, studio: false, assetIndex: false,
    dailyChallenges: { file: path.join(dir, 'board.json') } });
  // The existing HTML response issues identity; no challenge API request is necessary to record a run.
  const page = await fetch(server.url + '/');
  const initialCookie = page.headers.get('set-cookie').split(';')[0];
  const client = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`, { wsOptions: { headers: { Cookie: initialCookie } } });
  t.after(async () => { await client.close();await server.close();await fs.rm(dir, { recursive: true, force: true }); });
  const welcome = await client.hello('DailyDoctor');
  const url = server.url + '/api/daily-challenges';
  const cookie = initialCookie;
  assert.equal(server.lobby.dailyBoard.snapshot().rows.length, 0);
  assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify(settlement([welcome.playerId])) })).status, 405);
  const room = { disposed: false, test: false, content: null, seats: [], spectators: [], lastSummary: null,
    code: 'TEST', matchCount: 1, activeHumans: () => [], seatOf: () => ({ playerId: welcome.playerId }) };
  const ctx = { live: true, ended: false, match: { challengeUsedAI: false }, challenge: proofFor([welcome.playerId]) };room.matchCtx = ctx;
  // Exercise the real hook and early double-callback guard without creating a full simulated battle.
  const originalDispose = server.lobby.disposeMatchCtx;const originalRoomDispose = server.lobby.disposeRoom;
  server.lobby.disposeMatchCtx = () => {};server.lobby.disposeRoom = () => {};
  try {
    server.lobby.onMatchEnd(room, ctx, settlement([welcome.playerId]));
    server.lobby.onMatchEnd(room, ctx, settlement([welcome.playerId]));
  } finally { server.lobby.disposeMatchCtx = originalDispose;server.lobby.disposeRoom = originalRoomDispose; }
  const board = await (await fetch(url, { headers: { cookie } })).json();
  assert.equal(board.self.points, 3);
  assert.equal(board.rows.length, 1);
  assert.equal(board.rows[0].name, 'DailyDoctor');
  const exportResponse = await fetch(url + '/identity', { headers: { cookie } });
  assert.equal(exportResponse.status, 200);
  const exported = await exportResponse.json();
  const restored = await fetch(url + '/identity', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${welcome.token}` },
    body: JSON.stringify({ recoveryCode: exported.recoveryCode }) });
  assert.equal(restored.status, 200);
  const restoredCookie = restored.headers.get('set-cookie').split(';')[0];
  const recovered = await (await fetch(url, { headers: { cookie: restoredCookie } })).json();
  assert.equal(recovered.self.points, 3);
  const invalid = await fetch(url + '/identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recoveryCode: 'fake', score: 3 }) });
  assert.equal(invalid.status, 400);
  const crossOrigin = await fetch(url + '/identity', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://not-this-server.example' }, body: JSON.stringify({ recoveryCode: exported.recoveryCode }) });
  assert.equal(crossOrigin.status, 403);
});
