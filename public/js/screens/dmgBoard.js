// public/js/screens/dmgBoard.js — 结算页「伤害看板」：把这一局的结算数据（m.result）按造成伤害排成一张表。
//
// 移植自工坊包 `dmg-board`（作者 jingjiangze，GPL-3.0-or-later，来源见包内 PROVENANCE.md）。
// 本作**没有工坊面板系统**（public/js/ui/extensions.js、MOD_PANEL_SLOTS、workshop/ 都不存在），
// 所以这个包不能直接装 —— 改成**原生的 Preact 组件**接在结算屏里（screens/result.js 的 <ResultView> 底部），
// 判可见性那套（.screen.result / .st）在这里天然成立：组件只在结算屏里渲染。
//
// 数据只有一个来源：引擎自己的对局结算 `m.result`（server/match/results.js buildResult 组装）。
// 看板**不重算、不猜测、不碰对局**：引擎说什么就画什么；没有数据时整块不渲染
// （一个空表会被读成「引擎没算伤害」）。
//
// 与结算卡的关系：卡片每人一张、七项一行行摆着；这里是把同一份数**按造成伤害排序**的一张总表，
// 外加卡上放不下的那几项（未击倒 / 损失生命 / 刷新次数 / 完美作战）。两者并存。

import { html, Icon, MicroLabel } from '../ui/components.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * 展示的列（顺序即渲染顺序）：[键, 表头]。
 * 表头沿用结算卡的中文名（N_ 走 i18n 目录），与 screens/result.js 的 STAT_ROWS 同一套说法。
 * **只有在本局数据里真的存在这个键时才画这一列**（缺键不画 —— 老版本 / 部分字段的结算不该出现空列）。
 */
export const DMG_COLUMNS = Object.freeze([
  ['dmgDealt', N_('造成伤害')],
  ['bossDamage', N_('领袖伤害')],
  ['kills', N_('击倒敌人')],
  ['leaks', N_('未击倒')],
  ['lpLost', N_('损失生命')],
  ['merges', N_('晋升次数')],
  ['itemsEquipped', N_('配发装备')],
  ['activatedLayers', N_('盟约层数')],
  ['refreshes', N_('刷新次数')],
  ['perfectRounds', N_('完美作战')],
  ['gold', N_('消耗资金')],
]);

/** 一个统计值：存在且是有限数字才回数字，否则 `null`（缺值不当 0 画 —— `Number(null)` 就是 0，不能直接用）。 */
const numOf = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * 数字的短写法：12,345 → 1.2万（**万位**就短写，保留一位小数、去尾零）。
 *
 * 注意这里**不复用引擎的 `fmtNum`**：那个函数从 10万（1e5）起才短写，4~5 位数字原样摆着；
 * 而看板是「一眼看出谁打了多少」的表，结算页的伤害动辄几万，`52,310` 这种读起来比 `5.2万` 慢。
 * 本包原作者的口径就是 1e4 起短写（工坊包 dmg-board 的 `fmt`），照搬。
 * 亿以上仍按中文的万/亿步进（与引擎的 numberUnits 口径一致）。
 */
export function fmtBoardNum(v) {
  const n = numOf(v);
  if (n === null) return '—';
  const abs = Math.abs(n);
  if (abs < 10000) return String(Math.round(n));
  if (abs >= 1e8) return `${trimZero(n / 1e8)}亿`;
  return `${trimZero(n / 1e4)}万`;
}

/** 保留一位小数、去掉尾零：1.0 → 1，1.25 → 1.3。 */
const trimZero = (w) => {
  const r = Math.round(w * 10) / 10;
  return Number.isInteger(r) ? String(r) : String(r);
};

/**
 * 从 `m.result` 里抽出这张表要的东西。
 * 形状不对（老版本 / 坏消息 / 没到过结算帧）时返回 `null` —— 调用方据此整块不渲染。
 * @param {any} result m.result 载荷
 */
export function boardFrom(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.players) || !result.players.length) return null;
  const rows = [];
  for (const p of result.players) {
    if (!p || typeof p !== 'object') continue;
    const stats = p.stats && typeof p.stats === 'object' ? p.stats : null;
    if (!stats) continue;
    rows.push({
      playerId: typeof p.playerId === 'string' ? p.playerId : '',
      name: typeof p.name === 'string' && p.name ? p.name : (typeof p.playerId === 'string' ? p.playerId : '?'),
      seat: Number.isInteger(p.seat) ? p.seat : null,
      isBot: p.isBot === true,
      alive: p.alive !== false,
      stats,
    });
  }
  if (!rows.length) return null;
  // 名次：按造成伤害降序（「看板」的常用读法；数还是引擎那些数，排序只是呈现）
  rows.sort((a, b) => (numOf(b.stats.dmgDealt) ?? 0) - (numOf(a.stats.dmgDealt) ?? 0));
  const columns = DMG_COLUMNS.filter(([key]) => rows.some((r) => numOf(r.stats[key]) !== null));
  if (!columns.length) return null;
  const top = Math.max(0, ...rows.map((r) => numOf(r.stats.dmgDealt) ?? 0));
  return {
    rows, columns, top,
    victory: result.victory === true,
    roundsPassed: Number.isInteger(result.roundsPassed) ? result.roundsPassed : null,
    difficulty: typeof result.difficulty === 'string' ? result.difficulty : '',
  };
}

/**
 * 结算页底部的伤害看板。`res` 是**原始** m.result（不是 normalizeResult 之后的那份 ——
 * 归一化会把 stats 之外的形状改掉，而这里要的就是引擎原样送来的 stats）。
 * 数据不成形时返回 null（整块不渲染）。
 */
export function DamageBoard({ res, myId = null }) {
  const board = boardFrom(res);
  if (!board) return null;
  const meta = [
    board.difficulty,
    board.roundsPassed !== null ? t('{n} 回合', { n: board.roundsPassed }) : '',
    board.victory ? t('胜利') : '',
  ].filter(Boolean).join(' · ');

  return html`<section class="dmg-board" aria-label=${t('伤害看板')}>
    <header class="dmg-board__head">
      <${Icon} name="sword" class="dmg-board__icon" />
      <b>${t('伤害看板')}</b>
      ${meta ? html`<small>${meta}</small>` : null}
      <${MicroLabel} tone="mint">DAMAGE BOARD</${MicroLabel}>
    </header>
    <div class="dmg-board__wrap">
      <table>
        <thead>
          <tr>
            <th class="dmg-board__rank">#</th>
            <th class="dmg-board__name">${t('玩家')}</th>
            ${board.columns.map(([key, label]) => html`<th key=${key}>${t(label)}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${board.rows.map((row, i) => html`<tr key=${row.playerId || i} class=${cx(i === 0 && 'is-top', row.playerId === myId && 'is-self', !row.alive && 'is-dead')}>
            <td class="dmg-board__rank">${i + 1}</td>
            <td class="dmg-board__name">
              <span class="dmg-board__who">${row.name}</span>
              ${row.isBot ? html`<span class="dmg-board__tag">AI</span>` : null}
              ${row.seat !== null ? html`<span class="dmg-board__seat num">${t('座 {n}', { n: row.seat + 1 })}</span>` : null}
              ${row.playerId === myId ? html`<span class="dmg-board__tag is-you">${t('你')}</span>` : null}
            </td>
            ${board.columns.map(([key]) => {
              const v = numOf(row.stats[key]);
              const bad = (key === 'leaks' || key === 'lpLost') && v !== null && v > 0;
              return html`<td key=${key} class=${cx(bad && 'dmg-board__bad', key === 'dmgDealt' && 'dmg-board__dmg')}>
                ${fmtBoardNum(row.stats[key])}
                ${key === 'dmgDealt' && board.top > 0 && v !== null && v > 0
                  ? html`<i class="dmg-board__bar" aria-hidden="true" style=${`--w:${Math.max(4, Math.round((v / board.top) * 100))}%`}></i>`
                  : null}
              </td>`;
            })}
          </tr>`)}
        </tbody>
      </table>
    </div>
    <p class="dmg-board__hint">${t('数据来自引擎的对局结算，只读展示；不重算、不影响对局。')}</p>
  </section>`;
}

export default DamageBoard;
