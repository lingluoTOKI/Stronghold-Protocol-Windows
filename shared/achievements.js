// Permanent, server-owned unlocks. Profiles match the daily board; these never award daily points.
import { N_ } from './i18n.js';
import { COVENANTS, covenantActive } from './challengeCovenants.js';
/** @type {Array<{id:string,name:string,goal:string,target:number,category?:string,bond?:string,count?:number,tier?:number}>} */
export const ACHIEVEMENTS = [
  { id: 'ultimate-clear', name: N_('终极认证'), goal: N_('首次终极模拟通关，且本人存活到结算。'), target: 1 },
  { id: 'flawless-clear', name: N_('无漏防线'), goal: N_('累计 10 次终极模拟通关，本人存活且个人整局漏怪数为零。'), target: 10 },
  { id: 'hidden-core', name: N_('核心封印'), goal: N_('累计 10 次无 AI 队友、无托管击败终极模拟隐秘核心，且本人存活。'), target: 10 },
  { id: 'bond-yan', name: N_('炎佑长明'), goal: N_('累计 5 次终极模拟通关，最终本人「炎」盟约至少 6 人档激活，且本人存活。'), target: 5, bond: 'yanShip' },
  { id: 'bond-laterano', name: N_('铳鸣圣约'), goal: N_('累计 5 次终极模拟通关，最终本人「拉特兰」盟约至少 6 人档激活，且本人存活。'), target: 5, bond: 'lateranoShip' },
  { id: 'bond-kjerag', name: N_('雪境回响'), goal: N_('累计 5 次终极模拟通关，最终本人「谢拉格」盟约至少 6 人档激活，且本人存活。'), target: 5, bond: 'kjeragShip' },
];
// Stable legacy IDs retain progress and first-unlock dates. Only Yan gets a separate stricter ID.
for (const a of ACHIEVEMENTS) a.category = a.bond ? (a.id === 'bond-yan' ? 'legacy' : 'core') : 'general';
ACHIEVEMENTS.push(
  { id: 'clear-ten', name: N_('百战砺锋'), goal: N_('累计 10 次终极模拟通关，且本人存活。'), target: 10, category: 'general' },
  { id: 'clear-thirty', name: N_('终局守望'), goal: N_('累计 30 次终极模拟通关，且本人存活。'), target: 30, category: 'general' },
);
for (const c of COVENANTS) {
  const a = { ...c, target: 5, goal: N_('累计 5 次终极模拟通关，本人存活且指定盟约达到最高档。') };
  const existing = ACHIEVEMENTS.findIndex(x => x.id === a.id);
  if (existing >= 0) ACHIEVEMENTS[existing] = a;
  else ACHIEVEMENTS.push(a);
}
ACHIEVEMENTS.push(
  { id: 'all-core', name: N_('八方盟誓'), goal: N_('集齐本分组全部 8 枚核心盟约最高档章。'), target: 8, category: 'collection' },
  { id: 'all-covenants', name: N_('万象协奏'), goal: N_('集齐本分组全部 23 枚盟约最高档章。'), target: 23, category: 'collection' },
);
export function earnedAchievements(result, playerId) {
  const p = result?.players?.find(p => p?.playerId === playerId && !p.isBot);
  if (result?.difficulty !== 'ABYSS' || result.victory !== true || p?.victory !== true || p.alive !== true || p.left) return [];
  const ids = ['ultimate-clear', 'clear-ten', 'clear-thirty'];
  if (p.stats?.leaks === 0) ids.push('flawless-clear');
  if (result.hiddenReached === true && result.hiddenCleared === true) ids.push('hidden-core');
  if (covenantActive(p, { bond: 'yanShip', count: 6, tier: 2 })) ids.push('bond-yan');
  for (const c of COVENANTS) if (covenantActive(p, c)) ids.push(c.id);
  return ids;
}
export function updateCollectionAwards(state, at) {
  const added = [];
  for (const { id, list } of [{ id: 'all-core', list: COVENANTS.filter(c => c.category === 'core') }, { id: 'all-covenants', list: COVENANTS }]) {
    const n = list.filter(c => state.unlocked[c.id]).length;
    if (n) state.progress[id] = n;
    if (n === list.length && !state.unlocked[id]) { state.unlocked[id] = at;added.push(id); }
  }
  return added;
}
