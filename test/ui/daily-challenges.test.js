import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeDay, dailyChallenges, CHALLENGES } from '../../public/js/ui/dailyChallenges.js';

const now = Date.parse('2026-10-20T12:00:00+08:00');
const record = (extra = {}) => ({ end: 'settled', t: now - 1000, selfId: 'me', difficulty: 'ABYSS', victory: true,
  hiddenReached: true, hiddenCleared: true, players: [{ playerId: 'me', victory: true, alive: true,
  roundsPassed: 15, stats: { refreshes: 0, perfectRounds: 8, merges: 5, itemsEquipped: 4 } }], ...extra });

test('daily boundary is UTC+8 and invalid dates are rejected', () => {
  assert.equal(challengeDay(Date.parse('2026-10-19T15:59:59Z')), '2026-10-19');
  assert.equal(challengeDay(Date.parse('2026-10-19T16:00:00Z')), '2026-10-20');
  assert.equal(challengeDay(NaN), null);
  assert.equal(challengeDay(1e20), null);
});
test('three fixed ultimate tiers reset daily without rotating back to easy tasks', () => {
  const a = dailyChallenges([], now);
  assert.equal(a.challenges.length, 3);
  assert.equal(new Set(a.challenges.map(c => c.id)).size, 3);
  assert.deepEqual(a.challenges.map(c => c.tier), [0, 1, 2]);
  assert.deepEqual(a, dailyChallenges([], now));
  assert.ok(a.challenges.every(c => !c.done));
  const choices = new Set(Array.from({ length: 10 }, (_, i) => dailyChallenges([], now + i * 86400000).challenges.map(c => c.id).join(',')));
  assert.equal(choices.size, 1);
});
test('completion uses only current-day settled original personal records, including imports', () => {
  assert.ok(dailyChallenges([record()], now).challenges.every(c => c.done));
  for (const extra of [{ t: now - 86400000 }, { t: now + 1000 }, { t: NaN }, { end: 'quit' }, { test: true },
    { content: { cs: 'modded' } }, { selfId: 'spectator' }, { players: [] }]) {
    assert.ok(dailyChallenges([record(extra)], now).challenges.every(c => !c.done), JSON.stringify(extra));
  }
});
test('personal survival and victory are required; missing perfect count is not eight', () => {
  const r = record({ victory: true, players: [{ playerId: 'me', victory: false, roundsPassed: 10, stats: {} }] });
  assert.equal(CHALLENGES.find(c => c.id === 'perfect').pass(r), false);
  assert.equal(CHALLENGES.find(c => c.id === 'victory').pass(r), false);
});
test('ultimate tier thresholds: seven is insufficient, core requires actual clear, dead teammates do not inherit wins', () => {
  const r = record();
  r.players[0].stats.perfectRounds = 7;
  assert.deepEqual(dailyChallenges([r], now).challenges.map(c => c.done), [true, false, true]);
  r.hiddenCleared = false;r.players[0].stats.perfectRounds = 8;
  assert.deepEqual(dailyChallenges([r], now).challenges.map(c => c.done), [true, true, false]);
  r.players[0].alive = false;
  assert.ok(dailyChallenges([r], now).challenges.every(c => !c.done));
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'TRAINING']) {
    assert.ok(dailyChallenges([record({ difficulty })], now).challenges.every(c => !c.done));
  }
});
test('left and bot seats cannot receive awards', () => {
  for (const flag of ['left', 'isBot']) {
    const r = record();r.players[0][flag] = true;
    assert.ok(dailyChallenges([r], now).challenges.every(c => !c.done));
  }
});
test('derivation does not mutate statistics or require storage/network APIs', () => {
  const r = record();const before = JSON.stringify(r);
  dailyChallenges([r, r], now);
  assert.equal(JSON.stringify(r), before);
});
