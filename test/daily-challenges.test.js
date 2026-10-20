import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createDailyChallengeBoard } from '../server/dailyChallenges.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { makeMatch } from './match/harness.js';
import { earnedAchievements } from '../shared/achievements.js';
import { Lobby } from '../server/lobby.js';

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
  return { runId: randomBytes(16).toString('hex'), mode: ids.length === 1 ? 'solo' : 'coop', difficulty: 'ABYSS', bossHp: 1, usedAI: false,
    participants: ids.map(playerId => ({ playerId, isBot: false })), ...extra };
}
const resultIds = new WeakMap();
function award(f, result, room = f.room, extra = {}) {
  if (!resultIds.has(result)) resultIds.set(result, randomBytes(16).toString('hex'));
  return f.board.record(room, result, f.registry, proofFor(result.players.map(p => p.playerId), { runId: resultIds.get(result), ...extra }));
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
  assert.equal(f.board.snapshot().rows[0].points, 1, 'rotating day requires Yan for its other goals');
  f.setTime(time + 9 * 86400000);
  award(f, settlement(['a']));await f.board.flush();
  const saved = JSON.parse(await fs.readFile(f.file, 'utf8'));
  assert.equal(Object.keys(saved.days).length, 1);
});

test('permanent criteria require a personal clear; missing leaks is not a flawless run', () => {
  const r = settlement(['a']);
  assert.deepEqual(earnedAchievements(r, 'a'), ['ultimate-clear', 'clear-ten', 'clear-thirty', 'hidden-core']);
  r.players[0].stats.leaks = 0;
  assert.deepEqual(earnedAchievements(r, 'a'), ['ultimate-clear', 'clear-ten', 'clear-thirty', 'flawless-clear', 'hidden-core']);
  for (const leaks of [1, -1, null, undefined, '0']) {
    r.players[0].stats.leaks = leaks;
    assert.ok(!earnedAchievements(r, 'a').includes('flawless-clear'));
  }
  for (const patch of [{ alive: false }, { victory: false }, { left: true }, { isBot: true }]) {
    assert.deepEqual(earnedAchievements({ ...r, players: [{ ...r.players[0], ...patch }] }, 'a'), []);
  }
  assert.deepEqual(earnedAchievements({ ...r, difficulty: 'HARD' }, 'a'), []);
  assert.deepEqual(earnedAchievements(r, 'spectator'), []);
});

test('permanent collections survive day trimming, restart and backup recovery; repeated clears do not write', async t => {
  const f = await fixture(t);const cookie = await f.bind('a');await f.bind('b');
  const r = settlement(['a']);r.players[0].stats.leaks = 0;
  assert.deepEqual(award(f, r).a.map(a => a.id), ['ultimate-clear']);await f.board.flush();
  const original = await fs.readFile(f.file, 'utf8');const stamp = (await fs.stat(f.file)).mtimeMs;
  assert.deepEqual(award(f, r), {});await f.board.flush();
  assert.equal((await fs.stat(f.file)).mtimeMs, stamp, 'no disk write for repeated daily/permanent completion');
  assert.equal(await fs.readFile(f.file, 'utf8'), original);
  f.setTime(time + 20 * 86400000);award(f, structuredClone(r));await f.board.flush();
  const saved = JSON.parse(await fs.readFile(f.file, 'utf8'));
  const state = Object.values(saved.achievements)[0].solo;const unlocks = state.unlocked;
  assert.equal(Object.keys(unlocks).length, 1);assert.equal(unlocks['ultimate-clear'], time);
  assert.equal(state.progress['flawless-clear'], 2);assert.equal(state.progress['hidden-core'], 2);
  assert.equal(Object.keys(saved.days).length, 0, 'permanent progress survives even when today has no qualifying covenant task');
  await fs.writeFile(f.file, 'broken');
  const reopened = await createDailyChallengeBoard({ file: f.file, now: () => time + 20 * 86400000, log: { error() {}, info() {} } });
  const own = response();reopened.collection({ method: 'GET', headers: { cookie } }, own, f.registry);
  assert.deepEqual(JSON.parse(own.body).unlocked.solo, unlocks);
  const stranger = response();reopened.collection({ method: 'GET', headers: {} }, stranger, f.registry);
  assert.deepEqual(JSON.parse(stranger.body).unlocked, { solo: {}, coop: {} });
  assert.equal(own.headers['Cache-Control'], 'private, no-store');
});

test('adding permanent schema preserves existing daily scores and signing identity without retroactive awards', async t => {
  const f = await fixture(t);const cookie = await f.bind('a');award(f, settlement(['a']));await f.board.flush();
  const prior = JSON.parse(await fs.readFile(f.file, 'utf8'));delete prior.achievements;
  await fs.writeFile(f.file, JSON.stringify(prior));
  const migrated = await createDailyChallengeBoard({ file: f.file, now: () => time });
  const daily = response();await migrated.handle({ method: 'GET', headers: { cookie } }, daily, f.registry);
  assert.equal(JSON.parse(daily.body).self.points, 3);assert.equal(daily.headers['Set-Cookie'], undefined);
  const collection = response();migrated.collection({ method: 'GET', headers: { cookie } }, collection, f.registry);
  assert.deepEqual(JSON.parse(collection.body).unlocked, { solo: {}, coop: {} });
  assert.equal(JSON.parse(await fs.readFile(f.file, 'utf8')).secret, prior.secret);
});

test('counter milestones separate divisions, unlock exactly at 10 and keep the first timestamp', async t => {
  const f = await fixture(t);const cookie = await f.bind('a');await f.bind('b');
  const r = settlement(['a']);r.hiddenCleared = false;
  assert.deepEqual(award(f, r).a.map(a => a.id), ['ultimate-clear']);
  for (let i = 1; i <= 10; i++) {
    f.setTime(time + i * 1000);const run = settlement(['a']);run.players[0].stats.leaks = 0;
    const added = award(f, run);
    assert.deepEqual(added.a?.map(a => a.id) || [], i === 10 ? ['flawless-clear', 'hidden-core'] : i === 9 ? ['clear-ten'] : []);
    assert.equal(f.board.snapshot().rows[0].points, 3, 'permanent progress never adds daily points');
  }
  const coop = award(f, settlement(['a', 'b']));assert.equal(coop.a.length, 1);
  const res = response();f.board.collection({ method: 'GET', headers: { cookie } }, res, f.registry);
  const own = JSON.parse(res.body);
  assert.equal(own.unlocked.solo['ultimate-clear'], time);assert.equal(own.unlocked.solo['flawless-clear'], time + 10000);
  assert.equal(Object.keys(own.unlocked.coop).length, 1);assert.equal(own.progress.coop['hidden-core'], 1);
  const extra = settlement(['a']);extra.players[0].stats.leaks = 0;award(f, extra);await f.board.flush();
  const state = Object.values(JSON.parse(await fs.readFile(f.file, 'utf8')).achievements)[0];
  assert.equal(state.solo.progress['hidden-core'], 10, 'counters stop at target');
});

test('designated covenant clears count the player’s active final tier only, and unlock at five', async t => {
  const f = await fixture(t);const cookie = await f.bind('a');
  for (const bond of [{ bondId: 'yanShip', count: 5, tier: 1, active: true }, { bondId: 'yanShip', count: 6, tier: 2, active: false },
    { bondId: 'yanShip', count: 6, tier: 1, active: true }, { bondId: 'unknown', count: 9, tier: 3, active: true }]) {
    const r = settlement(['a']);r.players[0].bonds = [bond];award(f, r);
  }
  for (let i = 0; i < 5; i++) {
    const r = settlement(['a']);r.players[0].bonds = ['yanShip', 'lateranoShip', 'kjeragShip'].map(bondId => ({ bondId, count: 6, tier: 2, active: true }));
    const added = award(f, r);
    assert.deepEqual(added.a?.map(a => a.id) || [], i === 4 ? ['bond-yan', 'bond-kjerag', 'bond-laterano'] : []);
    assert.deepEqual(award(f, r), {}, 'duplicate callbacks cannot increment covenant counters');
  }
  const res = response();f.board.collection({ method: 'GET', headers: { cookie } }, res, f.registry);
  const own = JSON.parse(res.body);assert.equal(own.progress.solo['bond-yan'], 5);assert.ok(own.unlocked.solo['bond-kjerag']);
  await f.board.flush();
});

test('permanent counters reject ineligible profiles and never borrow another player’s covenant', async t => {
  const f = await fixture(t);const cookie = await f.bind('a');await f.bind('b');
  for (const extra of [{ usedAI: true }, { bossHp: 3.25 }, { runId: 'client' }, { mode: 'coop' },
    { participants: [{ playerId: 'a', isBot: true }] }]) award(f, settlement(['a']), f.room, extra);
  const before = response();f.board.collection({ method: 'GET', headers: { cookie } }, before, f.registry);
  assert.deepEqual(JSON.parse(before.body).progress, { solo: {}, coop: {} });
  const r = settlement(['a', 'b']);r.players[1].bonds = [{ bondId: 'yanShip', count: 6, active: true, tier: 2 }];
  award(f, r);await f.board.flush();
  const own = response();f.board.collection({ method: 'GET', headers: { cookie } }, own, f.registry);
  assert.equal(JSON.parse(own.body).progress.coop['bond-yan'], undefined);
  const states = Object.values(JSON.parse(await fs.readFile(f.file, 'utf8')).achievements);
  assert.equal(states.filter(s => s.coop.progress['bond-yan'] === 1).length, 1);
});

test('counter progress deduplicates after restart and invalid progress recovers its valid backup', async t => {
  const f = await fixture(t);const cookie = await f.bind('a');const r = settlement(['a']);award(f, r);await f.board.flush();
  const prior = JSON.parse(await fs.readFile(f.file, 'utf8'));
  const id = Object.keys(prior.achievements)[0];prior.achievements[id].solo.progress['hidden-core'] = -1;
  await fs.writeFile(f.file, JSON.stringify(prior));
  const board = await createDailyChallengeBoard({ file: f.file, now: () => time, log: { error() {}, info() {} } });
  const res = response();await board.handle({ method: 'GET', headers: { cookie, authorization: `Bearer ${f.sessions.get('a').token}` } }, res, f.registry);
  assert.deepEqual(board.record(f.room, r, f.registry, proofFor(['a'], { runId: resultIds.get(r) })), {});
  await board.flush();const saved = JSON.parse(await fs.readFile(f.file, 'utf8'));
  assert.equal(saved.achievements[id].solo.progress['hidden-core'], 1);
});

test('real Match settlement adds personal unlock notices before sending, and never grants a spectator award', async t => {
  const f = await fixture(t);await f.bind('p_0');
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, bots: 0, fake: true });
  t.after(() => h.m.dispose());h.m.hiddenReached = true;h.ps('p_0').stats.perfectRounds = 8;
  const lobby = Object.create(Lobby.prototype);lobby.dailyBoard = f.board;lobby.registry = f.registry;
  lobby.log = { error() {} };const sent = [];lobby.sendToPlayer = (_room, id, msg) => sent.push([id, msg]);
  const room = { ...f.room, seats: [{ playerId: 'p_0' }], spectators: [{ playerId: 'watcher' }] };
  const ctx = { live: true, ended: false, match: h.m, results: new Map(), challenge: proofFor(['p_0']) };room.matchCtx = ctx;
  h.onSend.push((id, msg) => lobby.matchSend(room, ctx, id, msg));
  h.m.finish({ victory: true, hiddenCleared: true, reason: 'victory' });
  const frame = sent.find(([id, msg]) => id === 'p_0' && msg.t === 'm.result')[1];
  assert.deepEqual(frame.newAchievements.map(a => a.id), ['ultimate-clear']);
  lobby.matchSend(room, ctx, 'watcher', frame);
  assert.deepEqual(sent.at(-1)[1].newAchievements, []);
  await f.board.flush();
  const next = { ...ctx, challengeRecorded: false };room.matchCtx = next;
  lobby.matchSend(room, next, 'p_0', frame);
  assert.deepEqual(sent.at(-1)[1].newAchievements, [], 'a later clear never re-announces an old unlock');
  await f.board.flush();
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
  ctx.results = new Map();
  server.registry.byPlayerId.get(welcome.playerId).roomCode = room.code;
  server.lobby.matchSend(room, ctx, welcome.playerId, { t: 'm.result', ...settlement([welcome.playerId]) });
  const frame = await client.waitFor('m.result');
  assert.deepEqual(frame.newAchievements.map(a => a.id), ['ultimate-clear']);
  assert.deepEqual(JSON.parse(ctx.results.get(welcome.playerId)).newAchievements, frame.newAchievements, 'reconnection replay retains the original unlock notice');
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
  const collection = await (await fetch(server.url + '/api/achievements', { headers: { cookie: restoredCookie } })).json();
  assert.deepEqual(Object.keys(collection.unlocked.solo), ['ultimate-clear']);
  assert.equal(collection.progress.solo['hidden-core'], 1);
  const sharedRecovery = await (await fetch(url + '/identity', { headers: { cookie: restoredCookie } })).json();
  assert.equal(sharedRecovery.recoveryCode, exported.recoveryCode, 'daily points and permanent collection share one stable recovery code, not a score snapshot');
  assert.equal((await fetch(server.url + '/api/achievements', { method: 'POST', body: '{}' })).status, 405);
  const invalid = await fetch(url + '/identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recoveryCode: 'fake', score: 3 }) });
  assert.equal(invalid.status, 400);
  const crossOrigin = await fetch(url + '/identity', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://not-this-server.example' }, body: JSON.stringify({ recoveryCode: exported.recoveryCode }) });
  assert.equal(crossOrigin.status, 403);
});

// Rotation/migration regression coverage: all fixtures are temporary stores, never runtime/.
test('weekly rotation uses each of the 21 goals once and repeats exactly on day eight', async () => {
  const { challengesForDay, ROTATING_CHALLENGES } = await import('../shared/dailyChallenges.js');
  assert.equal(ROTATING_CHALLENGES.length, 21);
  assert.deepEqual(challengesForDay('2026-10-20').map(c => c.id), ['victory','perfect','core']);
  const weeks = [];
  for (let week = 0; week < 4; week++) {
    const tasks = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(Date.parse('2026-10-21T00:00:00Z') + (week * 7 + i) * 86400000).toISOString().slice(0,10);
      const goals = challengesForDay(day);
      assert.equal(goals.length,3);assert.ok(goals.every(Boolean));
      assert.equal(new Set(goals.map(c=>c.id)).size,3);
      tasks.push(goals.map(c=>c.id));
    }
    assert.equal(new Set(tasks.flat()).size,21);
    assert.deepEqual([...tasks.flat()].sort(),ROTATING_CHALLENGES.map(c=>c.id).sort());
    weeks.push(tasks);
  }
  for (const week of weeks.slice(1)) assert.deepEqual(week,weeks[0]);
});
test('all 23 covenant definitions match game thresholds including exact/hand/elite rules', async () => {
  const { COVENANTS, covenantActive } = await import('../shared/challengeCovenants.js');
  const bonds = JSON.parse(await fs.readFile(new URL('../data/bonds.json', import.meta.url), 'utf8'));
  assert.equal(COVENANTS.length, Object.keys(bonds).length);
  for (const c of COVENANTS) {
    assert.equal(c.count, Math.max(...bonds[c.bond].thresholds));
    assert.equal(c.tier, bonds[c.bond].thresholds.length);
    assert.equal(c.hand, bonds[c.bond].countsHand);
    assert.equal(c.golden, bonds[c.bond].countsGoldenOnly);
    const b = { bondId: c.bond, count: c.count, tier: c.tier, active: true };
    assert.ok(covenantActive({ bonds: [b] }, c));
    assert.ok(!covenantActive({ bonds: [{ ...b, count: c.count - 1 }] }, c));
    assert.ok(!covenantActive({ bonds: [{ ...b, active: false }] }, c));
    assert.ok(!covenantActive({ bonds: [{ ...b, tier: c.tier - 1 }] }, c));
    if (c.exact) assert.ok(!covenantActive({ bonds: [{ ...b, count: 2 }] }, c));
  }
});
test('rules-3 migration preserves identity, scores, dates, unfinished counts, dedup and legacy Yan', async t => {
  const f = await fixture(t), cookie = await f.bind('a');
  const r = settlement(['a']);r.players[0].stats.leaks = 0;
  r.players[0].bonds = [{ bondId: 'yanShip', count: 6, tier: 2, active: true }];
  for (let i = 0; i < 5; i++) award(f, structuredClone(r));
  await f.board.flush();
  const old = JSON.parse(await fs.readFile(f.file, 'utf8'));old.rules = 3;delete old.rotationStart;
  const state = Object.values(old.achievements)[0].solo;
  delete state.progress['clear-ten'];delete state.progress['clear-thirty'];delete state.daily;
  await fs.writeFile(f.file, JSON.stringify(old));
  const migrated = await createDailyChallengeBoard({ file: f.file, now: () => time });await migrated.flush();
  const next = JSON.parse(await fs.readFile(f.file, 'utf8')), after = Object.values(next.achievements)[0].solo;
  assert.equal(next.secret, old.secret);assert.deepEqual(next.days, old.days);
  assert.deepEqual(after.unlocked, state.unlocked);assert.deepEqual(after.recent, state.recent);
  for (const [id,n] of Object.entries(state.progress)) assert.equal(after.progress[id],n);
  assert.equal(after.progress['clear-ten'],5);assert.equal(after.progress['clear-thirty'],5);
  assert.equal(after.progress['bond-yan-nine'], undefined);assert.ok(after.daily.victory);assert.equal(after.legacyDaily.collection, '2026-10-20');
  const res = response();await migrated.handle({ method:'GET',headers:{cookie} },res,f.registry);
  assert.equal(JSON.parse(res.body).self.points,3);
  assert.deepEqual(JSON.parse(await fs.readFile(f.file + '.pre-rotation','utf8')),old);
  const reopened = await createDailyChallengeBoard({ file:f.file, now:()=>time });await reopened.flush();
  assert.deepEqual(JSON.parse(await fs.readFile(f.file,'utf8')),next,'migration is idempotent');
});
test('cross-midnight settlement uses server start day, stores daily medals and task-only reads omit ranking', async t => {
  const f = await fixture(t), cookie = await f.bind('a');
  const start = Date.parse('2026-10-21T23:59:00+08:00');f.setTime(start + 120000);
  const result = settlement(['a']);result.players[0].bonds = [{bondId:'yanShip',count:9,tier:3,active:true}];
  award(f, result, f.room, { startedAt: start });await f.board.flush();
  const saved = JSON.parse(await fs.readFile(f.file,'utf8'));
  assert.equal(Object.keys(saved.days)[0], '2026-10-21');
  assert.equal(Object.values(saved.days['2026-10-21'].solo)[0].completed.length,3);
  assert.equal(f.board.snapshot().rows.length,0);
  assert.ok(Object.values(saved.achievements)[0].solo.daily['core-yanShip']);
  const res=response();await f.board.handle({ method:'GET',url:'/?ranking=0',headers:{cookie} },res,f.registry);
  const body=JSON.parse(res.body);assert.deepEqual(body.rows,[]);assert.equal(body.preview.length,7);
});
test('collection meta medals unlock once from all covenant chapters, separately per division', async t => {
  const { COVENANTS } = await import('../shared/challengeCovenants.js');
  const f=await fixture(t);await f.bind('a');
  for (let i=0;i<5;i++) {
    const r=settlement(['a']);r.players[0].bonds=COVENANTS.map(c=>({bondId:c.bond,count:c.count,tier:c.tier,active:true}));
    const awards=award(f,r);
    if(i===4) { assert.ok(awards.a.some(a=>a.id==='all-core'));assert.ok(awards.a.some(a=>a.id==='all-covenants')); }
  }
  await f.board.flush();const state=Object.values(JSON.parse(await fs.readFile(f.file,'utf8')).achievements)[0];
  assert.equal(state.solo.progress['all-covenants'],23);assert.equal(state.coop,undefined);
});

test('unknown future rules fail closed without clearing or rewriting player data', async t => {
  const f=await fixture(t);await f.bind('a');award(f,settlement(['a']));await f.board.flush();
  const raw=JSON.parse(await fs.readFile(f.file,'utf8'));raw.rules=999;
  const bytes=JSON.stringify(raw);await fs.writeFile(f.file,bytes);await fs.writeFile(f.file+'.backup',bytes);
  const reopened=await createDailyChallengeBoard({file:f.file,now:()=>time,log:{error(){}}});
  assert.equal(reopened.snapshot().ok,false);await reopened.flush();
  assert.equal(await fs.readFile(f.file,'utf8'),bytes);assert.equal(await fs.readFile(f.file+'.backup','utf8'),bytes);
});
