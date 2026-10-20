// Shared, pure settlement predicates. Ranking calls these only with server-owned accepted results.
import { N_ } from './i18n.js';

export const DAILY_VERSION = 3;
export function challengeDay(ms = Date.now()) {
  if (!Number.isFinite(ms)) return null;
  try { return new Date(ms + 8 * 3600000).toISOString().slice(0, 10); } catch { return null; }
}
const self = r => Array.isArray(r?.players) ? r.players.find(p => p?.playerId && p.playerId === r.selfId && !p.isBot) : null;
const stat = (r, key) => {
  const n = self(r)?.stats?.[key];
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export const CHALLENGES = [
  { id: 'victory', tier: 0, name: N_('终局捷报'), goal: N_('终极模拟通关，且本人存活到结算。'), pass: r => cleared(r) },
  { id: 'perfect', tier: 1, name: N_('无隙防御'), goal: N_('终极模拟通关，本人存活到结算，且个人累计至少 8 个无漏怪回合。'), pass: r => cleared(r) && stat(r, 'perfectRounds') >= 8 },
  { id: 'core', tier: 2, name: N_('核心决胜'), goal: N_('终极模拟击败隐秘核心，且本人存活到结算。'), pass: r => cleared(r) && r.hiddenReached === true && r.hiddenCleared === true },
];
function cleared(r) {
  const p = self(r);
  return r?.difficulty === 'ABYSS' && r.victory === true && p?.victory === true && p.alive === true && !p.left;
}
function eligible(r) {
  return r?.end === 'settled' && r.test !== true && (!r.content || r.content.vanilla === true) && !!self(r) && !self(r).left;
}
export function dailyChallenges(records = [], ms = Date.now()) {
  const day = challengeDay(ms);
  if (!day) return { day: null, challenges: [] };
  const today = records.filter(r => eligible(r) && Number.isFinite(r.t) && r.t > 0 && r.t <= ms && challengeDay(r.t) === day);
  return { day, challenges: CHALLENGES.map(c => ({ id: c.id, tier: c.tier, name: c.name, goal: c.goal, done: today.some(c.pass) })) };
}
export { funReport } from './funReport.js';
