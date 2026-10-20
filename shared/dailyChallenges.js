// Shared, pure settlement predicates. Ranking calls these only with server-owned accepted results.
import { N_ } from './i18n.js';
import { COVENANTS, covenantActive } from './challengeCovenants.js';

export const DAILY_VERSION = 4;
export const ROTATION_START = '2026-10-21';
const DAY_MS = 86400000;
export function challengeDay(ms = Date.now()) {
  if (!Number.isFinite(ms)) return null;
  try { return new Date(ms + 8 * 3600000).toISOString().slice(0, 10); } catch { return null; }
}
const self = r => Array.isArray(r?.players) ? r.players.find(p => p?.playerId && p.playerId === r.selfId && !p.isBot) : null;
const stat = (r, key) => {
  const n = self(r)?.stats?.[key];
  return Number.isFinite(n) && n >= 0 ? n : null;
};
/** @typedef {{id:string,tier:number,name:string,goal:string,pass:(r:any)=>boolean,covenant?:typeof COVENANTS[number]}} Challenge */
/** @type {Challenge[]} */
export const CHALLENGES = [
  { id: 'victory', tier: 0, name: N_('终局捷报'), goal: N_('终极模拟通关，且本人存活到结算。'), pass: r => cleared(r) },
  { id: 'perfect', tier: 1, name: N_('无隙防御'), goal: N_('终极模拟通关，本人存活到结算，且个人累计至少 8 个无漏怪回合。'), pass: r => cleared(r) && stat(r, 'perfectRounds') >= 8 },
  { id: 'core', tier: 2, name: N_('核心决胜'), goal: N_('终极模拟击败隐秘核心，且本人存活到结算。'), pass: r => cleared(r) && r.hiddenReached === true && r.hiddenCleared === true },
];
const core = r => cleared(r) && r.hiddenReached === true && r.hiddenCleared === true;
/** @type {Challenge[]} */
export const ROTATING_CHALLENGES = [
  ...CHALLENGES,
  { id: 'flawless', tier: 1, name: N_('完整防线'), goal: N_('终极模拟通关，本人存活且个人整局零漏怪。'), pass: r => cleared(r) && stat(r, 'leaks') === 0 },
  { id: 'core-perfect', tier: 2, name: N_('核心固守'), goal: N_('击败隐秘核心并通关，本人存活且个人至少 8 个无漏怪回合。'), pass: r => core(r) && stat(r, 'perfectRounds') >= 8 },
  ...COVENANTS.filter(c => c.category === 'core').flatMap(c => [
    { id: 'trial-' + c.bond, tier: 1, name: N_('盟约试炼'), goal: N_('指定盟约最高档通关，且本人存活。'), covenant: c, pass: r => cleared(r) && covenantActive(self(r), c) },
    { id: 'core-' + c.bond, tier: 2, name: N_('核心盟誓'), goal: N_('指定盟约最高档击败隐秘核心并通关，且本人存活。'), covenant: c, pass: r => core(r) && covenantActive(self(r), c) },
  ]),
];
// Each of the 21 goals appears exactly once per seven-day cycle.
// Two days include a second covenant; goals may be completed across separate matches.
export const WEEKLY_ROTATION = [
  ['victory', 'trial-yanShip', 'core-yanShip'],
  ['perfect', 'trial-sargonShip', 'core-sargonShip'],
  ['core', 'trial-victoriaShip', 'core-victoriaShip'],
  ['flawless', 'trial-kjeragShip', 'core-kjeragShip'],
  ['core-perfect', 'trial-lateranoShip', 'core-lateranoShip'],
  ['trial-egirShip', 'core-egirShip', 'trial-kazimierzShip'],
  ['trial-siracusaShip', 'core-siracusaShip', 'core-kazimierzShip'],
];
export function challengesForDay(day, start = ROTATION_START) {
  if (!day || day < start) return CHALLENGES;
  const offset = Math.floor((Date.parse(day + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / DAY_MS);
  if (!Number.isFinite(offset) || offset < 0) return CHALLENGES;
  return WEEKLY_ROTATION[offset % 7].map(id => ROTATING_CHALLENGES.find(c => c.id === id));
}
export function challengePreview(ms = Date.now(), start = ROTATION_START) {
  return Array.from({ length: 7 }, (_, i) => { const day = challengeDay(ms + i * DAY_MS);return { day, challenges: challengesForDay(day, start).map(({ pass, ...c }) => c) }; });
}
function cleared(r) {
  const p = self(r);
  return r?.difficulty === 'ABYSS' && r.victory === true && p?.victory === true && p.alive === true && !p.left;
}
function eligible(r) {
  return r?.end === 'settled' && r.test !== true && (!r.content || r.content.vanilla === true) && !!self(r) && !self(r).left;
}
export function dailyChallenges(records = [], ms = Date.now(), start = ROTATION_START) {
  const day = challengeDay(ms);
  if (!day) return { day: null, challenges: [] };
  const today = records.filter(r => eligible(r) && Number.isFinite(r.t) && r.t > 0 && r.t <= ms && challengeDay(r.t) === day);
  return { day, challenges: challengesForDay(day, start).map(c => ({ id: c.id, tier: c.tier, name: c.name, goal: c.goal, ...(c.covenant ? { covenant: c.covenant } : {}), done: today.some(c.pass) })) };
}
export { funReport } from './funReport.js';
