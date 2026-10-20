import test from 'node:test';
import assert from 'node:assert/strict';
import { recordAchievementNotice, unreadAchievements, markAchievementsSeen, resetAchievementNotices, subscribeAchievements, claimAchievementCelebration } from '../../public/js/ui/achievementNotices.js';
const a = { id: 'ultimate-clear', division: 'solo', at: 100 };
test('UI notice dedupes replay and never alters the server result', () => {
  resetAchievementNotices();const msg = { newAchievements: [a], challengeFeedback: { pointsAdded: 1 } };const original = JSON.stringify(msg);
  let refreshes = 0;const stop = subscribeAchievements(k => { if (k === 'settlement') refreshes++; });
  recordAchievementNotice(msg);recordAchievementNotice(msg);stop();
  assert.equal(refreshes, 1);assert.equal(unreadAchievements().length, 1);assert.equal(JSON.stringify(msg), original);
});
test('viewed medals stay read on replay; divisions remain independent', () => {
  resetAchievementNotices();const b = { ...a, division: 'coop' };recordAchievementNotice({ newAchievements: [a,b] });
  markAchievementsSeen('solo', [a.id]);assert.deepEqual(unreadAchievements(), [b]);
  recordAchievementNotice({ newAchievements: [a,b], duration: 1 });assert.deepEqual(unreadAchievements(), [b]);
});
test('identity restore resets only notification metadata', () => {
  resetAchievementNotices();assert.deepEqual(unreadAchievements(), []);
  recordAchievementNotice({ newAchievements: [{ id: '../bad', division: 'solo', at: 1 }] });assert.deepEqual(unreadAchievements(), []);
});
test('celebration is shown once for the same unlock timestamp', () => {
  const awards = [{ ...a, at: 9876 }];assert.equal(claimAchievementCelebration(awards), true);assert.equal(claimAchievementCelebration(awards), false);
  assert.equal(claimAchievementCelebration([]), false);
});
