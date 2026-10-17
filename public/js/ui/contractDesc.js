// 契约文本求值（浏览器侧）—— 与 server/match/contracts.js contractDesc 同一份口径。
//
// 契约文本按盟约模式的写法走：`desc` 里放 `{i:fmt}` 占位符，数值 = `params[base] + params[perStep] × 当前回合`。
// 例：强攻 = 「敌方攻击力提升（5×当前回合)%」→「敌方攻击力提升+15%」（第 3 回合）。
//
// 服务端在局内下发卡面 / 效果栏时已经算好；这里给的是**局外图鉴**（screens/alliances.js 契约页签、
// screens/sweep.js 契约报告）用的 —— 那两处没有「当前回合」，就按该契约自己的可选回合（rounds[0]）求值，
// 至少不会把 `{0:0%}` 这种占位符直接甩给玩家。

// 随回合数提升的契约，在末尾括号里补这句（与 server/match/contracts.js CONTRACT_ROUND_HINT 同文）
const ROUND_HINT = '随着回合数提升';
const HINT_RE = /[（(]([^）)]*)[）)]\s*$/;

/**
 * 求值一条契约的 desc。
 * @param {object} rec choices.json 的契约
 * @param {number} [round] 当前回合；不给就用 rec.rounds[0]
 * @returns {string}
 */
export function contractDesc(rec, round) {
  const src = rec?.desc;
  if (typeof src !== 'string' || !src) return '';
  const params = Array.isArray(rec.descParams) ? rec.descParams : [];
  if (!params.length) return src;
  const vals = rec.params && typeof rec.params === 'object' ? rec.params : {};
  const r = Number.isFinite(Number(round))
    ? Number(round)
    : (Array.isArray(rec.rounds) && Number.isFinite(Number(rec.rounds[0])) ? Number(rec.rounds[0]) : 0);
  let filled = src.replace(/\{(\d+):([^}]+)\}/g, (m, i, fmt) => {
    const p = params.find((q) => q && q.index === Number(i));
    if (!p) return m;
    const v = (Number(vals[p.base]) || 0) + (Number(vals[p.perStep]) || 0) * r;
    if (fmt === '0%') return Math.round(v * 100) + '%';
    if (fmt === '0.0%') return (Math.round(v * 1000) / 10) + '%';
    if (fmt === '0.00%') return (Math.round(v * 10000) / 100) + '%';
    return String(Math.round(v));
  });
  // 插进末尾括号里：「敌方攻击速度+10（随着回合数提升，与狂暴互斥，加成持续一整局）」
  filled = filled.replace(HINT_RE, (m, inner) => m.replace(inner, ROUND_HINT + '，' + inner));
  return filled;
}