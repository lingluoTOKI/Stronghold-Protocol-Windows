import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAdmission } from './admission.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function setup(options = {}) {
  const calls = [];
  const lobby = { rooms: new Map(), matchPool: new Map(),
    create(...args) { calls.push(['create', ...args]); return { ok: true }; },
    startMatch(room) { calls.push(['start', room]); room.match = {}; return { ok: true }; },
    tryMatch(key) { calls.push(['queue', key]); },
    resolveMatch(key) { calls.push(['resolve', key]); return { ok: true }; },
    join() { return 'join'; }, onHello() { return 'resume'; },
  };
  let clock = 0;
  let memory = { availableMB: 500, rssMB: 100 };
  const guard = installAdmission(lobby, { maxMatches: 2, maxRooms: 4, intervalMs: 0,
    sample: () => memory, now: () => clock, ...options });
  return { lobby, calls, guard, memory: v => { memory = v; }, advance: n => { clock += n; } };
}
test('capacity refuses new matches while keeping existing rooms and reconnect paths intact', () => {
  const t = setup();
  try {
    const a = { match: {} }, b = { match: {} }, fresh = {};
    t.lobby.rooms.set('a', a); t.lobby.rooms.set('b', b);
    assert.equal(t.lobby.startMatch(fresh).error, 'RATE');
    assert.equal(fresh.match, undefined);
    assert.equal(t.lobby.rooms.get('a'), a);
    assert.equal(t.lobby.join(), 'join'); assert.equal(t.lobby.onHello(), 'resume');
    t.lobby.rooms.delete('b');
    assert.deepEqual(t.lobby.startMatch(fresh), { ok: true });
  } finally { t.guard.stop(); }
});
test('memory pressure holds admission with hysteresis then recovers', () => {
  const t = setup();
  try {
    t.memory({ availableMB: 80, rssMB: 100 });
    assert.equal(t.lobby.create({}).error, 'RATE');
    t.memory({ availableMB: 180, rssMB: 100 }); t.advance(20000);
    assert.equal(t.lobby.create({}).error, 'RATE');
    t.memory({ availableMB: 300, rssMB: 100 });
    assert.deepEqual(t.lobby.create({}), { ok: true });
  } finally { t.guard.stop(); }
});
test('queue stays untouched while full and methods restore on stop', () => {
  const t = setup(); const originalJoin = t.lobby.join;
  t.lobby.rooms.set('a', { match: {} }); t.lobby.rooms.set('b', { match: {} });
  t.lobby.matchPool.set('NORMAL', ['p1', 'p2']);
  t.lobby.tryMatch('NORMAL');
  assert.equal(t.lobby.resolveMatch('NORMAL').error, 'RATE');
  assert.deepEqual(t.lobby.matchPool.get('NORMAL'), ['p1', 'p2']);
  assert.deepEqual(t.calls, []);
  t.guard.stop(); t.guard.stop();
  assert.deepEqual(t.lobby.resolveMatch('NORMAL'), { ok: true });
  assert.equal(t.lobby.join, originalJoin);
});
test('room cap and RSS cap do not destroy rooms', () => {
  const t = setup({ maxRooms: 1 });
  try {
    const room = {}; t.lobby.rooms.set('a', room);
    assert.equal(t.lobby.create({}).error, 'RATE');
    assert.deepEqual(t.lobby.startMatch(room), { ok: true });
    t.memory({ availableMB: 400, rssMB: 800 });
    assert.equal(t.lobby.startMatch({}).error, 'RATE');
    assert.equal(t.lobby.rooms.get('a'), room);
  } finally { t.guard.stop(); }
});
test('administrator pause is hot-read and never alters existing room or join', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-admission-'));
  const file = path.join(dir, 'policy.json');
  const t = setup({ policyFile: file });
  try {
    const room = { match: {} }; t.lobby.rooms.set('kept', room);
    fs.writeFileSync(file, JSON.stringify({ paused: true }));
    assert.equal(t.lobby.create({}).error, 'RATE');
    assert.equal(t.lobby.startMatch({}).error, 'RATE');
    assert.equal(t.lobby.join(), 'join'); assert.equal(t.lobby.onHello(), 'resume');
    assert.equal(t.lobby.rooms.get('kept'), room);
    assert.equal(t.guard.snapshot().manualPaused, true);
    fs.writeFileSync(file, JSON.stringify({ paused: false }));
    assert.deepEqual(t.lobby.startMatch({}), { ok: true });
    fs.writeFileSync(file, '{bad json');
    assert.equal(t.lobby.create({}).error, 'RATE');
  } finally { t.guard.stop(); fs.rmSync(dir, { recursive: true }); }
});

test('zero caps admit rooms and matches but still enforce memory protection', () => {
  const t = setup({ maxRooms: 0, maxMatches: 0 });
  try {
    for (let i = 0; i < 100; i++) t.lobby.rooms.set(String(i), { match: {} });
    assert.deepEqual(t.lobby.create({}), { ok: true });
    assert.deepEqual(t.lobby.startMatch({}), { ok: true });
    t.memory({ availableMB: 10, rssMB: 100 });
    assert.equal(t.lobby.create({}).error, 'RATE');
  } finally { t.guard.stop(); }
});
