// Smoke test for server matchmaking (自加). Run with the project's node.
// Verifies (public-pool remake): 4-player auto-formation + auto-start, host=first enqueuer, AI top-up,
// startNow (no AI), cancel, and that each difficulty is its own pool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const MT = 4; // Lobby.MATCH_TARGET

async function mk(port, name) {
  const c = await TestClient.connect(`ws://127.0.0.1:${port}/ws`);
  const w = await c.hello(name);
  c.id = w.playerId;
  return c;
}

test('matchmaking: 4 players auto-form a coop room + auto-start, host = first enqueuer', async () => {
  const srv = await startServer({ port: 0, quiet: true });
  const port = srv.port;
  const clients = [];
  try {
    for (let i = 0; i < MT; i++) clients.push(await mk(port, `P${i + 1}`));
    const a = clients[0];
    const r1 = await a.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
    assert.equal(r1.t, 'ok', 'enqueue1 ok');
    await a.waitFor('match.status', (m) => m.count === 1 && m.target === MT);
    const b = clients[1];
    await b.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
    await b.waitFor('match.status', (m) => m.count === 2 && m.target === MT);
    const c = clients[2];
    await c.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
    await c.waitFor('match.status', (m) => m.count === 3 && m.target === MT);
    const d = clients[3];
    const r4 = await d.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
    assert.equal(r4.t, 'ok', 'enqueue4 ok');
    // the 4th enqueue fills the bucket → match.found then room.state (coop, 4 seats, host = P1) and auto-start
    const found = [];
    for (const cl of clients) found.push(await cl.waitFor('match.found', (m) => m.difficulty === 'NORMAL'));
    console.log('  found codes:', found.map((f) => f.code));
    const states = [];
    for (const cl of clients) states.push(await cl.waitFor('room.state', (m) => m.mode === 'coop' && m.inMatch === true));
    console.log('  state codes:', states.map((s) => s.code));
    for (const s of states) {
      assert.equal(s.code, found[0].code, 'same room code');
      const humans = s.seats.filter((x) => x && !x.isBot).length;
      assert.equal(humans, MT, '4 human seats');
      // every matched human is already ready (auto-start, no ready handshake)
      assert.ok(s.seats.every((x) => x && !x.isBot ? x.ready : true), 'matched humans are ready');
    }
    assert.equal(states[0].hostId, a.id, 'host is first enqueuer (P1)');
    assert.equal(states[0].inMatch, true, '4-player room auto-started');
    console.log('  4-player auto-form + auto-start OK, room', states[0].code);
  } finally {
    for (const c of clients) c.terminate().catch(() => {});
    await srv.close();
  }
});

test('matchmaking: topUp fills the room with AI up to 4 and starts', async () => {
  const srv = await startServer({ port: 0, quiet: true });
  const port = srv.port;
  const a = await mk(port, 'TA');
  const b = await mk(port, 'TB');
  try {
    await a.request({ t: 'match.enqueue', difficulty: 'HARD' });
    await a.waitFor('match.status', (m) => m.count === 1);
    await b.request({ t: 'match.enqueue', difficulty: 'HARD' });
    await b.waitFor('match.status', (m) => m.count === 2);
    const rb = await b.request({ t: 'match.topUp' });
    assert.equal(rb.t, 'ok', 'topUp ok');
    const fA = await a.waitFor('match.found', (m) => m.difficulty === 'HARD');
    const fB = await b.waitFor('match.found', (m) => m.difficulty === 'HARD');
    assert.equal(fA.code, fB.code, 'same room');
    const sA = await a.waitFor('room.state', (m) => m.mode === 'coop' && m.inMatch === true);
    const humans = sA.seats.filter((x) => x && !x.isBot).length;
    const bots = sA.seats.filter((x) => x && x.isBot).length;
    assert.equal(humans, 2, '2 humans');
    assert.equal(humans + bots, MT, 'filled to 4 with AI');
    assert.equal(sA.inMatch, true, 'topUp auto-started');
    console.log('  topUp OK: 2 humans +', bots, 'AI =', humans + bots, ', auto-started');
  } finally {
    a.terminate().catch(() => {}); b.terminate().catch(() => {});
    await srv.close();
  }
});

test('matchmaking: startNow forms a room with no AI and starts', async () => {
  const srv = await startServer({ port: 0, quiet: true });
  const port = srv.port;
  const a = await mk(port, 'SN_A');
  const b = await mk(port, 'SN_B');
  try {
    await a.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
    await a.waitFor('match.status', (m) => m.count === 1 && m.target === MT);
    await b.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
    await b.waitFor('match.status', (m) => m.count === 2 && m.target === MT);
    const rb = await b.request({ t: 'match.startNow' });
    assert.equal(rb.t, 'ok', 'startNow ok');
    const fA = await a.waitFor('match.found', (m) => m.difficulty === 'NORMAL');
    const fB = await b.waitFor('match.found', (m) => m.difficulty === 'NORMAL');
    assert.equal(fA.code, fB.code, 'same room');
    const sA = await a.waitFor('room.state', (m) => m.mode === 'coop' && m.inMatch === true);
    const humans = sA.seats.filter((x) => x && !x.isBot).length;
    const bots = sA.seats.filter((x) => x && x.isBot).length;
    assert.equal(humans, 2, '2 humans only');
    assert.equal(humans + bots, 2, 'no AI filled (startNow)');
    assert.equal(sA.inMatch, true, 'startNow auto-started');
    console.log('  startNow OK: 2 humans, 0 AI, room', sA.code);
  } finally {
    a.terminate().catch(() => {}); b.terminate().catch(() => {});
    await srv.close();
  }
});

test('matchmaking: cancel removes a player from the pool', async () => {
  const srv = await startServer({ port: 0, quiet: true });
  const port = srv.port;
  const a = await mk(port, 'CA');
  const b = await mk(port, 'CB');
  try {
    await a.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
    await b.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
    const rb = await b.request({ t: 'match.cancel' });
    assert.equal(rb.t, 'ok', 'cancel ok');
    // A should get a status update back to count=1 (B left)
    const st = await a.waitFor('match.status', (m) => m.count === 1);
    assert.equal(st.count, 1);
    console.log('  cancel OK: pool back to 1');
  } finally {
    a.terminate().catch(() => {}); b.terminate().catch(() => {});
    await srv.close();
  }
});

test('matchmaking: different difficulties are separate pools (a NORMAL queuer does not pull an ABYSS one)', async () => {
  const srv = await startServer({ port: 0, quiet: true });
  const port = srv.port;
  const a = await mk(port, 'ABYSS');
  const b = await mk(port, 'NORMAL');
  try {
    await a.request({ t: 'match.enqueue', difficulty: 'ABYSS' });
    await a.waitFor('match.status', (m) => m.count === 1 && m.target === MT);
    await b.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
    await b.waitFor('match.status', (m) => m.count === 1 && m.target === MT);
    // the NORMAL queuer must NOT pull A into a match; A stays alone in its ABYSS pool
    await a.expectNone('match.found', () => true, 400);
    assert.equal(a.isOpen, true, 'A still connected / not matched');
    console.log('  separate pools OK: ABYSS=1, NORMAL=1, no cross-match');
  } finally {
    a.terminate().catch(() => {}); b.terminate().catch(() => {});
    await srv.close();
  }
});
