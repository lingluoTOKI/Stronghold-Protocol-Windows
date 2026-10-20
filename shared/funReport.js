import { N_ } from './i18n.js';

const self = r => Array.isArray(r?.players) ? r.players.find(p => p?.playerId && p.playerId === r.selfId && !p.isBot) : null;
const stat = (r, key) => {
  const n = self(r)?.stats?.[key];
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const rounds = r => {
  const p = self(r);
  return Number.isFinite(p?.roundsPassed) ? p.roundsPassed : null;
};
function eligible(r) {
  return r?.end === 'settled' && r.test !== true && (!r.content || r.content.vanilla === true) && !!self(r) && !self(r).left;
}
/** Personal facts only: never infer a team ranking from compacted or incomplete teammate records. */
export function funReport(record) {
  if (!eligible(record)) return [];
  const badges = [];
  if (self(record).victory === true) badges.push({ name: N_('凯旋归来'), detail: N_('本局取得个人胜利') });
  for (const [key, minimum, name, detail] of [
    ['perfectRounds', 3, N_('滴水不漏'), N_('无漏怪回合：{n}')],
    ['merges', 3, N_('合成专家'), N_('合成次数：{n}')],
    ['itemsEquipped', 3, N_('整装出击'), N_('配发装备：{n}')],
  ]) {
    const n = stat(record, key);
    if (n !== null && n >= minimum) badges.push({ name, detail, n });
  }
  if (rounds(record) >= 5 && stat(record, 'refreshes') === 0) badges.push({ name: N_('随遇而安'), detail: N_('通过至少 5 回合，商店零刷新') });
  if (!badges.length && rounds(record) > 0) badges.push({ name: N_('坚守阵线'), detail: N_('个人通过回合：{n}'), n: rounds(record) });
  return badges;
}
