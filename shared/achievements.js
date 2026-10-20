// Permanent, server-owned unlocks. Profiles match the daily board; these never award daily points.
import { N_ } from './i18n.js';
export const ACHIEVEMENTS = [
  { id: 'ultimate-clear', name: N_('终极认证'), goal: N_('首次终极模拟通关，且本人存活到结算。'), target: 1 },
  { id: 'flawless-clear', name: N_('无漏防线'), goal: N_('累计 10 次终极模拟通关，本人存活且个人整局漏怪数为零。'), target: 10 },
  { id: 'hidden-core', name: N_('核心封印'), goal: N_('累计 10 次无 AI 队友、无托管击败终极模拟隐秘核心，且本人存活。'), target: 10 },
  { id: 'bond-yan', name: N_('炎佑长明'), goal: N_('累计 5 次终极模拟通关，最终本人「炎」盟约至少 6 人档激活，且本人存活。'), target: 5, bond: 'yanShip' },
  { id: 'bond-laterano', name: N_('铳鸣圣约'), goal: N_('累计 5 次终极模拟通关，最终本人「拉特兰」盟约至少 6 人档激活，且本人存活。'), target: 5, bond: 'lateranoShip' },
  { id: 'bond-kjerag', name: N_('雪境回响'), goal: N_('累计 5 次终极模拟通关，最终本人「谢拉格」盟约至少 6 人档激活，且本人存活。'), target: 5, bond: 'kjeragShip' },
];
export function earnedAchievements(result, playerId) {
  const p = result?.players?.find(p => p?.playerId === playerId && !p.isBot);
  if (result?.difficulty !== 'ABYSS' || result.victory !== true || p?.victory !== true || p.alive !== true || p.left) return [];
  const ids = ['ultimate-clear'];
  if (p.stats?.leaks === 0) ids.push('flawless-clear');
  if (result.hiddenReached === true && result.hiddenCleared === true) ids.push('hidden-core');
  for (const a of ACHIEVEMENTS) {
    if (a.bond && p.bonds?.some(b => b.bondId === a.bond && b.active === true && Number.isFinite(b.count) && b.count >= 6 && b.tier >= 2)) ids.push(a.id);
  }
  return ids;
}
