// public/js/ui/liveDamage.js — 局内实时伤害面板
// （用户 2026-10-14：「局内干员，谁，造成多少伤害，是物理还是法术还是真伤」）。
//
// 打开：战斗中按 **Tab**（也可点 HUD 的「伤害」按钮）。关闭：再按 Tab / Esc / 面板右上角 ×。
// 拖拽：按住**标题栏**拖到任意位置；拖**右下角手柄**改大小。位置与大小记在 localStorage，
//       下次打开保持原样。双击标题栏复位。
//
// 数据只有一个来源：`battleRunner.liveDamageByOwner(...)` / `liveDamage(...)` —— 本地 sim 的逐单位累计值
// （server/sim/damage.js 每次结算伤害时写 `source.stats.dmg` 与按类型分列的 `stats.dmgBy`）。
// 这是**权威的实时值**：不重算、不猜测、不联网。面板每 250 ms 重读一次。
//
// 每行 = 一名干员（或召唤物）：名字 → 该 **主伤害类型** 的图标与颜色 → 总伤害 → 占比 →
// 物理 / 法术 / 真实 / 元素 四栏明细 → 击杀 / 治疗。
//
// **联防阶段**（用户 2026-10-14「联防阶段也要显示伤害，这样显示：联防者、干员名字…」）：
// 一个战场上有多名联防者的干员（各自带 unit.ownerId），此时按「联防者」分组 ——
//   小组标题行：联防者 名字        小计
//   干员行：      干员名  ...
// 单人战斗时不显示分组标题（那时分组没有意义），外观与从前一致。

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel } from '../ui/components.js';
import { battleRunner } from '../battle/runner.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 面板重读间隔（ms）：与 boss 战 b.progress 的 4 Hz 对齐。 */
const REFRESH_MS = 250;

/** 位置 / 大小的持久化键（用户切屏、重开面板都保持原样）。 */
const LS_KEY = 'sp.ldmg.geom';

/** 面板最小/最大尺寸（px）—— 拖小于此值会拖成一团看不清。 */
const MIN_W = 260, MIN_H = 120;

/**
 * 伤害类型 → 显示名 / 图标 / css 修饰。
 * 图标只能用 components.js 里已有的那 37 个（没有专门的「法术 / 真实 / 元素」图标），所以：
 *   物理 = sword · 法术 = snow（寒色，配紫色） · 真实 = check（直给、不减免） · 元素 = eye（侵蚀/灼燃那类持续损伤）
 * 真正区分靠的是 `is-<type>` 的颜色（蓝灰 / 紫 / 白 / 青）。
 */
export const DMG_TYPES = Object.freeze([
  ['phys', '物理', 'sword', 'phys'],
  ['arts', '法术', 'snow', 'arts'],
  ['true', '真实', 'check', 'true'],
  ['element', '元素', 'eye', 'element'],
]);
const TYPE_OF = new Map(DMG_TYPES.map(([k, label, icon, cls]) => [k, { label, icon, cls }]));

/** 数字短写：12345 → 1.2万（与结算看板同口径）。 */
export function fmtDmg(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs < 10000) return String(Math.round(n));
  if (abs >= 1e8) return `${Math.round((n / 1e8) * 10) / 10}亿`;
  return `${Math.round((n / 1e4) * 10) / 10}万`;
}

/** 战斗已进行多久 → m:ss。 */
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 一行里「哪些类型真的打了」——只有 >0 的才画，避免四条空栏把表撑宽。
 * @param {{phys:number,arts:number,true:number,element:number}} by
 * @returns {Array<[string, number]>} [[类型, 伤害], ...] 按伤害降序
 */
export function typesPresent(by) {
  if (!by) return [];
  return DMG_TYPES.map(([k]) => [k, Math.max(0, Math.round(Number(by[k]) || 0))])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
}

// ---- 几何（位置 / 大小）------------------------------------------------------------------------

/** 读回上次的几何；坏数据一律当没存过（不能让一个烂值把面板丢到屏幕外）。 */
function loadGeom() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw);
    if (!g || typeof g !== 'object') return null;
    const num = (v) => (Number.isFinite(v) ? v : null);
    return { x: num(g.x), y: num(g.y), w: num(g.w), h: num(g.h) };
  } catch { return null; }
}
function saveGeom(g) {
  try { globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(g)); } catch { /* 隐私模式等：忽略 */ }
}

/**
 * 把几何夹进视口，保证标题栏始终能被抓到（否则拖出屏幕就再也拖不回来）。
 * @param {{x:number|null,y:number|null,w:number|null,h:number|null}} g
 * @param {{w:number,h:number}} size 视口尺寸
 * @returns {{x:number,y:number,w:number,h:number}} 全部是 px 数值
 */
export function clampGeom(g, size) {
  const vw = Math.max(320, Number(size?.w) || 1280);
  const vh = Math.max(240, Number(size?.h) || 720);
  let w = Number.isFinite(g?.w) ? g.w : 0;
  let h = Number.isFinite(g?.h) ? g.h : 0;
  w = w > 0 ? Math.min(Math.max(MIN_W, w), vw) : 0;         // 0 = 用 CSS 默认宽度
  h = h > 0 ? Math.min(Math.max(MIN_H, h), vh) : 0;         // 0 = 用 CSS 默认高度
  const hay = h > 0 ? h : 320;                              // 估算高度，用于 y 的夹取
  const hw = w > 0 ? w : 320;
  // 横向：整块留在视口内；纵向：至少留 40px 标题栏可抓
  let x = Number.isFinite(g?.x) ? g.x : null;
  let y = Number.isFinite(g?.y) ? g.y : null;
  if (x != null) x = Math.min(Math.max(0, x), Math.max(0, vw - Math.min(hw, vw)));
  if (y != null) y = Math.min(Math.max(0, y), Math.max(0, vh - 40));
  return { x, y, w, h, _est: hay };
}

/**
 * @param {{ ownerId: string|null, fieldId?: string|null, onClose: () => void, live?: boolean,
 *   selfIds?: string[], names?: Map<string,string>|Record<string,string>|null }} props
 *   `live`: 屏幕上有没有战斗；没有就读不到数据，面板显示等待文案。
 *   `selfIds`: 自己（含队友）的 playerId，用于把「自己」的分组排在最前。
 *   `names`: playerId → 显示名（联防分组标题用）。
 */
export function LiveDamagePanel({ ownerId, fieldId = null, onClose, live = false, selfIds = null, names = null }) {
  const [snap, setSnap] = useState(null);
  const [geom, setGeom] = useState(() => clampGeom(loadGeom() || {}, globalThis));
  const dragRef = useRef(null);          // { mode:'move'|'size', dx, dy, w0, h0 }
  const rootRef = useRef(null);

  useEffect(() => {
    if (!live) { setSnap(null); return undefined; }
    const read = () => {
      let v = null;
      try {
        v = battleRunner?.liveDamageByOwner?.(Array.isArray(selfIds) ? selfIds : [], fieldId) ?? null;
        // 老跑动（或测试桩）没有 liveDamageByOwner 时退回单人接口
        if (!v && ownerId && battleRunner?.liveDamage) {
          const one = battleRunner.liveDamage(ownerId, fieldId);
          if (one) v = { groups: [{ ownerId, ...one }], total: one.total, totals: one.totals, totalKills: one.totalKills, time: one.time, multi: false };
        }
      } catch { v = null; }
      setSnap(v);
    };
    read();
    const id = setInterval(read, REFRESH_MS);
    return () => clearInterval(id);
  }, [ownerId, fieldId, live, selfIds]);

  // ---- 拖拽（标题栏移动 / 右下角改大小）--------------------------------------------------------
  useEffect(() => {
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const pt = ev.touches ? ev.touches[0] : ev;
      if (!pt) return;
      const nx = pt.clientX - d.dx;
      const ny = pt.clientY - d.dy;
      setGeom((prev) => {
        const next = d.mode === 'move'
          ? clampGeom({ ...prev, x: nx, y: ny }, { w: window.innerWidth, h: window.innerHeight })
          : clampGeom({ ...prev, w: d.w0 + (pt.clientX - d.sx), h: d.h0 + (pt.clientY - d.sy) }, { w: window.innerWidth, h: window.innerHeight });
        return next;
      });
      ev.preventDefault?.();
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setGeom((g) => { saveGeom({ x: g.x, y: g.y, w: g.w, h: g.h }); return g; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  const startMove = (ev) => {
    const r = rootRef.current?.getBoundingClientRect?.();
    const pt = ev.touches ? ev.touches[0] : ev;
    if (!r || !pt) return;
    dragRef.current = { mode: 'move', dx: pt.clientX - r.left, dy: pt.clientY - r.top };
  };
  const startSize = (ev) => {
    const r = rootRef.current?.getBoundingClientRect?.();
    const pt = ev.touches ? ev.touches[0] : ev;
    if (!r || !pt) return;
    dragRef.current = { mode: 'size', sx: pt.clientX, sy: pt.clientY, w0: r.width, h0: r.height };
    ev.stopPropagation?.();
  };

  /**
   * 「记住关闭时的位置」（用户 2026-10-14）：关闭的那一刻把当前几何落盘。
   *
   * 关闭有三条路（Tab / Esc / ×），三条都会让 game.js 不再渲染这个组件 ⇒ **卸载**。
   * 所以用「卸载时保存」而不是在各个关闭按钮上分别挂钩子：一处覆盖全部三条路径，
   * 也顺带覆盖「战斗中关掉面板 / 切到别的阶段导致面板消失」这类隐式关闭。
   *
   * geomRef 是为了在卸载回调里读到**最新**的几何（effect 的依赖数组不能放 geom，
   * 否则每次拖动都会重绑卸载钩子、让清理函数在中途乱保存）。
   */
  const geomRef = useRef(geom);
  geomRef.current = geom;
  useEffect(() => () => {
    const g = geomRef.current;
    if (g) saveGeom({ x: g.x, y: g.y, w: g.w, h: g.h });
  }, []);

  /** 双击标题栏复位（拖飞了 / 拖乱了都能一键回到默认）。 */
  const resetGeom = () => { setGeom(clampGeom({}, globalThis)); saveGeom({}); };

  /**
   * 窗口变小（或换显示器）时把面板拉回视口内 —— 否则上次记的右下角位置可能整块落在屏幕外，
   * 用户会以为「面板丢了」。同时把结果落盘，保证「关闭时的位置」始终是可见的。
   */
  useEffect(() => {
    const onResize = () => {
      setGeom((g) => {
        const next = clampGeom(g, { w: window.innerWidth, h: window.innerHeight });
        if (next.x !== g.x || next.y !== g.y || next.w !== g.w || next.h !== g.h) {
          saveGeom({ x: next.x, y: next.y, w: next.w, h: next.h });
        }
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const nameOf = (id) => {
    if (!id) return t('未知');
    if (names instanceof Map) return names.get(id) || id;
    if (names && typeof names === 'object' && names[id]) return names[id];
    return id;
  };

  const groups = (snap?.groups ?? []).filter((g) => (g.units ?? []).length);
  const showGroups = !!snap?.multi && groups.length > 1;
  // 单人：拍平成一个列表（不带分组标题），外观与从前一致
  const flat = groups.length === 1 ? groups[0].units : groups.flatMap((g) => g.units);
  const top = flat.length ? Math.max(...flat.map((u) => u.dmg)) : 0;
  const totals = snap?.totals ?? null;
  const totalTypes = totals ? typesPresent(totals) : [];
  const hasRows = flat.some((u) => u.dmg > 0 || u.heal > 0 || u.kills > 0);

  const style = [
    geom.x != null ? `left:${Math.round(geom.x)}px` : null,
    geom.y != null ? `top:${Math.round(geom.y)}px` : null,
    geom.w ? `width:${Math.round(geom.w)}px` : null,
    geom.h ? `height:${Math.round(geom.h)}px` : null,
  ].filter(Boolean).join(';');

  /** 一行干员。 */
  const rowOf = (u, i, rankBase) => {
    const tt = TYPE_OF.get(u.mainType) || null;
    const present = typesPresent(u.by);
    const shown = new Map(present);
    return html`<li key=${u.unitId >= 0 ? u.unitId : `${rankBase}-${i}`}
        class=${cx('ldmg__row', i === 0 && rankBase === 0 && 'is-top', !u.alive && 'is-dead', tt && `is-${tt.cls}`)}>
      <span class="ldmg__rank num">${rankBase + i + 1}</span>
      <span class="ldmg__name">
        ${tt ? html`<${Icon} name=${tt.icon} class="ldmg__ticon" title=${t(tt.label)} />` : null}
        <span class="ldmg__who" title=${u.name || u.defId || ''}>${u.name || u.defId || '?'}</span>
        ${u.golden ? html`<span class="ldmg__tag is-elite">${t('精锐')}</span>` : null}
        ${u.token ? html`<span class="ldmg__tag">${t('召唤')}</span>` : null}
        ${!u.alive ? html`<span class="ldmg__tag is-down">${t('已阵亡')}</span>` : null}
      </span>
      <span class="ldmg__num num">${fmtDmg(u.dmg)}</span>
      <span class="ldmg__pct num">${Math.round(u.share * 100)}%</span>
      ${DMG_TYPES.map(([k]) => html`<span key=${k} class=${cx('ldmg__cell num', `is-${k}`, !shown.has(k) && 'is-zero')}>
        ${shown.has(k) ? fmtDmg(shown.get(k)) : '—'}
      </span>`)}
      <span class="ldmg__kills num">${u.kills}</span>
      <span class="ldmg__heal num">${u.heal > 0 ? fmtDmg(u.heal) : '—'}</span>
      <i class="ldmg__bar" aria-hidden="true" style=${`--w:${top > 0 ? Math.max(3, Math.round((u.dmg / top) * 100)) : 0}%`}></i>
    </li>`;
  };

  /** 表头（真正的列标题：数值列右对齐，与下面的数字同一条右边界）。 */
  const headRow = () => html`<li class="ldmg__row ldmg__row--head" aria-hidden="true">
    <span class="ldmg__rank">#</span>
    <span class="ldmg__name">${t('干员')}</span>
    <span class="ldmg__num">${t('造成伤害')}</span>
    <span class="ldmg__pct">${t('占比')}</span>
    ${DMG_TYPES.map(([k, label]) => html`<span key=${k} class=${cx('ldmg__cell', `is-${k}`)}>${t(label)}</span>`)}
    <span class="ldmg__kills">${t('击倒')}</span>
    <span class="ldmg__heal">${t('治疗')}</span>
  </li>`;

  return html`<aside class="ldmg" role="dialog" aria-label=${t('实时伤害')} ref=${rootRef}
      style=${style || null} data-multi=${showGroups ? '1' : null}>
    <header class="ldmg__head" onMouseDown=${startMove} onTouchStart=${startMove} onDblClick=${resetGeom}
        title=${t('拖动移动 · 双击复位 · 右下角拖拽改大小')}>
      <${Icon} name="sword" class="ldmg__icon" />
      <b>${t('实时伤害')}</b>
      ${snap && snap.time != null ? html`<span class="ldmg__time num">${fmtTime(snap.time)}</span>` : null}
      <${MicroLabel} tone="mint">DAMAGE</${MicroLabel}>
      <button type="button" class="ldmg__close" onClick=${onClose} aria-label=${t('关闭')} title=${t('关闭 (Esc)')}>
        <${Icon} name="close" />
      </button>
    </header>

    ${!live
      ? html`<p class="ldmg__empty">${t('当前没有正在进行的战斗')}</p>`
      : !groups.length
        ? html`<p class="ldmg__empty">${t('本场还没有伤害记录')}</p>`
        : html`<ol class="ldmg__list">
            ${headRow()}
            ${showGroups
              ? groups.map((g) => html`<${GroupBlock} key=${g.ownerId} group=${g} name=${nameOf(g.ownerId)}
                  self=${!!(selfIds && selfIds.includes(g.ownerId))} rowOf=${rowOf} />`)
              : groups[0].units.map((u, i) => rowOf(u, i, 0))}
          </ol>`}

    ${live && groups.length
      ? html`<footer class="ldmg__foot">
          <span>${t('本场合计')}</span>
          <b class="num">${fmtDmg(snap.total)}</b>
          ${totalTypes.map(([k, v]) => html`<span key=${k} class=${cx('ldmg__chip', `is-${k}`)}>
            <${Icon} name=${TYPE_OF.get(k).icon} />${t(TYPE_OF.get(k).label)} <b class="num">${fmtDmg(v)}</b>
          </span>`)}
          <span class="ldmg__fsep">·</span>
          <span>${t('击倒')}</span><b class="num">${snap.totalKills}</b>
          <span class="ldmg__hint">${showGroups ? t('联防：按联防者分组；') : ''}${t('只统计我方；数据来自本地战斗模拟，实时刷新')}</span>
        </footer>`
      : null}

    <span class="ldmg__grip" onMouseDown=${startSize} onTouchStart=${startSize} aria-hidden="true"></span>
  </aside>`;
}

/**
 * 联防分组：一行标题（联防者 名字 + 小计），下面是他自己的干员。
 * 做成独立组件是为了让 key 稳定、避免每次刷新重建整棵子树（列表 250 ms 刷一次）。
 * 标题右侧的小计 / 击倒与干员行的数值列对齐（同一套 grid 列，见 CSS `.ldmg__ghead`）。
 */
function GroupBlock({ group, name, self, rowOf }) {
  const units = group.units ?? [];
  return html`<li class="ldmg__group">
    <div class=${cx('ldmg__ghead', self && 'is-self')}>
      <span class="ldmg__gname">
        <${Icon} name="users" class="ldmg__gicon" />
        <span class="ldmg__glabel">${t('联防者')}</span>
        <b class="ldmg__gwho" title=${name}>${name}</b>
        ${self ? html`<span class="ldmg__gtag">${t('你')}</span>` : null}
      </span>
      <span class="ldmg__gsum num">${fmtDmg(group.total)}</span>
      <span class="ldmg__gkills num">${group.totalKills}</span>
    </div>
    <ol class="ldmg__glist">
      ${units.map((u, i) => rowOf(u, i, 0))}
    </ol>
  </li>`;
}

export default LiveDamagePanel;
