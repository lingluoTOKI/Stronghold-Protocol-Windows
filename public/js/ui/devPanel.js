// public/js/ui/devPanel.js — 局内开发者面板（dev-ext 移植，2026-10-15）
//
// 只在 dev 局（m.public.dev === true，仅本地端会话可达）由 screens/game.js 挂载。五分区：
//   1. 干员数值  —— grantChess（新发 / 改持有 uid 的数值覆盖）+ dev-ext 只读诊断浮层
//   2. 资金与等级 —— funds / lp / shopLevel / shopSlots / layers / band / item
//   3. 敌人      —— spawnEnemy（本回合现场添加）+ enemyOverride（逐敌人数值覆盖）
//   4. 首领      —— boss（hp/atk/def/res 覆盖）
//   5. 场景与回合 —— stage（换图）+ roundKind（普通 / 首领）
//
// 全部读写经 net.request('g.dev', { action, ... })，与服务端 server/match/match/devMode.js devEdit 一一对应
// （协议形状见 shared/protocol.js DEV_ACTIONS）。dev-ext 诊断浮层：本面板是 overrides 的唯一写入方，
// 所以本地以 devExtMap(uid -> overrides) 自跟踪，只读展示——服务端 pieceView 不发 meta.data，避免扩协议面。
//
// 记录 id（2026-10-15 修正）：data.list() 返回的是**原始记录**，buildIndex 不会注入 .id —— 各文件自带
// 各自的 id 字段（chess 用 chessId、enemies 用 key、bands 用 bandId、items / stages 用 id）。先前面板
// 一律读 r.id，带 id 的 action 因此发出 chessId: undefined，服务端 devEdit 只能回退到
// "grantChess needs chessId or uid" / "band null not allowed" —— 这是「点什么都是无效的请求」的根因。
// 这里按 public/js/data.js 的 ID_KEYS 顺序抽 id（recId），与服务端索引口径一致。
//
// 干员名单还要按**显示范围**（pub.devScope，'mod' 契约 / 'official' 盟约）过滤：服务端 withBondScope 会把
// 越档干员标成 visible:false / isHidden:true，devMode.js grantChess 随之拒绝（"unknown chess"），
// 所以照原始名单列会给开发者点一个报错一个。过滤口径与 shared/bondScope.js 同源。

import { useState, useMemo } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { net } from '../net.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';
import { data } from '../data.js';
import { scopedChess, operatorInScope } from '../../../shared/bondScope.js';

const cx = (...a) => a.filter(Boolean).join(' ');

/** grantChess 的数值覆盖键（与 DEV_OVERRIDE_KEYS 同口径；battle/main.mjs devMods 的乘算覆盖）。 */
const DEV_OVERRIDE_KEYS = ['atk', 'def', 'hp', 'aspd', 'res', 'bat', 'blockCnt'];
const OVERRIDE_LABELS = { atk: 'ATK', def: 'DEF', hp: 'HP', aspd: 'ASP', res: 'RES', bat: 'BAT', blockCnt: 'BLK' };

/**
 * 记录的 id（与 public/js/data.js 的 idOf / ID_KEYS 同顺序）。
 * data.list() 不给记录补 .id，各文件自带：chess→chessId、enemies→key、bands→bandId、items/stages→id。
 */
const ID_KEYS = ['id', 'chessId', 'bondId', 'itemId', 'bandId', 'enemyKey', 'enemyId', 'stageId', 'bossId', 'tokenId', 'choiceId', 'key'];
const recId = (rec) => {
  if (!rec || typeof rec !== 'object') return '';
  for (const k of ID_KEYS) {
    const v = rec[k];
    if ((typeof v === 'string' && v) || Number.isFinite(v)) return String(v);
  }
  return '';
};

/**
 * 这名干员能不能被 grantChess 接受（与 devMode.js 的拒绝条件一一对应）：
 * 排除金色（isGolden，进阶形态不是可发放的棋子）、自选槽（isDiy）、底包隐藏项（visible:false / isHidden），
 * 以及不在本局显示范围内的干员（operatorInScope —— 服务端已把它们标成越档）。
 */
const chessUsable = (rec, scope) => {
  if (!rec || rec.isGolden || rec.isDiy) return false;
  if (rec.visible === false || rec.isHidden) return false;
  return operatorInScope(scopedChess(rec, scope), scope);
};

const SCOPE_LABELS = { mod: '契约', official: '盟约' };

const SECTIONS = [
  { id: 'ops', label: () => t('干员数值') },
  { id: 'funds', label: () => t('资金与等级') },
  { id: 'enemy', label: () => t('敌人') },
  { id: 'boss', label: () => t('首领') },
  { id: 'stage', label: () => t('场景与回合') },
];

/** 把表单值清理成干净的字段对象（空串 / undefined / null 丢弃）。 */
const cleanFields = (fields) => {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
};

/** 7 个覆盖键的编辑器：value 为 { key: number }，onChange 回传同形状（0 / 空 = 删除该键）。 */
function OverrideEditor({ value, onChange }) {
  return html`<div class="dev-ov">
    ${DEV_OVERRIDE_KEYS.map((k) => html`<label class="dev-ov__f" key=${k}>
      <span>${OVERRIDE_LABELS[k]}</span>
      <input class="dev-input dev-input--num" type="number" step="any" value=${value?.[k] ?? ''} placeholder="0"
        onInput=${(e) => {
          const raw = e.target.value;
          const n = raw === '' ? 0 : Number(raw);
          const next = { ...(value || {}) };
          if (!Number.isFinite(n) || n === 0) delete next[k];
          else next[k] = n;
          onChange(next);
        }} />
    </label>`)}
  </div>`;
}

/** 一个具名枚举（bands / items / enemies / stages）的搜索 + 下拉选择。 */
function RecordPicker({ list, search, onSearch, placeholder, value, onPick, renderName }) {
  const q = (search || '').trim().toLowerCase();
  const matches = useMemo(() => {
    const all = (Array.isArray(list) ? list : []).filter((r) => recId(r));
    const filtered = q
      ? all.filter((r) => (renderName(r) || '').toLowerCase().includes(q) || recId(r).toLowerCase().includes(q))
      : all;
    return filtered.slice(0, 80);
  }, [list, q]);
  if (!Array.isArray(list) || list.length === 0) {
    return html`<div class="dev-empty">${t('没有匹配的项')}</div>`;
  }
  return html`<div class="dev-pick">
    <input class="dev-input" type="search" value=${search || ''} placeholder=${placeholder || t('搜索')}
      onInput=${(e) => onSearch(e.target.value)} />
    <select class="dev-select" size="6" value=${value || ''} onChange=${(e) => onPick(e.target.value)}>
      <option value="" disabled selected=${!value}>${t('没有匹配的项')}</option>
      ${matches.map((r) => html`<option key=${recId(r)} value=${recId(r)}>${renderName(r)}</option>`)}
    </select>
  </div>`;
}

export function DevPanel({ pub, priv }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('ops');
  // 本会话已应用的 dev-ext 覆盖（uid -> overrides），只读诊断浮层用；grantChess 是唯一写入方。
  const [devExt, setDevExt] = useState(/** @type {Record<number, object>} */ ({}));

  const send = (action, fields) =>
    net.request('g.dev', { action, ...cleanFields(fields) })
      .catch((e) => { toast((e && e.message) || String(e && e.code || e), 'warn'); return null; });

  /** 本局显示范围（dev 局 public 帧的 devScope；缺省按大厅默认的契约档）。 */
  const scope = pub?.devScope === 'official' ? 'official' : 'mod';

  // ---- 已持有棋子（uid 候选：board / hand / temp） ----
  const owned = useMemo(() => {
    const out = [];
    for (const arr of [priv?.board, priv?.hand, priv?.temp]) {
      if (Array.isArray(arr)) for (const p of arr) if (p && p.uid != null) out.push(p);
    }
    return out;
  }, [priv]);

  // ---- 分区 1：干员数值 ----
  const [opsSearch, setOpsSearch] = useState('');
  const [opsUid, setOpsUid] = useState('');
  const [opsOv, setOpsOv] = useState({});
  const chessList = useMemo(() => {
    const all = (data.list('chess') || []).filter((c) => chessUsable(c, scope));
    const q = opsSearch.trim().toLowerCase();
    const filtered = q
      ? all.filter((c) => (c.name || '').toLowerCase().includes(q) || recId(c).toLowerCase().includes(q))
      : all;
    return filtered.slice(0, 80);
  }, [opsSearch, scope]);
  const applyOpsOverride = () => {
    const uid = Number(opsUid);
    if (!Number.isInteger(uid)) { toast(t('请先选择一名干员'), 'warn'); return; }
    send('grantChess', { uid, overrides: opsOv });
    setDevExt((m) => {
      const next = { ...m };
      if (Object.keys(opsOv).length) next[uid] = opsOv; else delete next[uid];
      return next;
    });
  };

  // ---- 分区 2：资金与等级 ----
  const [funds, setFunds] = useState('');
  const [lp, setLp] = useState('');
  const [shopLevel, setShopLevel] = useState('');
  const [shopSlots, setShopSlots] = useState('');
  const [layers, setLayers] = useState('');
  const [bandId, setBandId] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const bandList = useMemo(() => (data.list('bands') || []).filter((r) => recId(r)), []);
  const itemList = useMemo(() => (data.list('items') || []).filter((r) => recId(r)), []);

  // ---- 分区 3：敌人 ----
  const [enemySearch, setEnemySearch] = useState('');
  const [spawnKey, setSpawnKey] = useState('');
  const [spawnCount, setSpawnCount] = useState('1');
  const [spawnRoute, setSpawnRoute] = useState('');
  const [ovEnemyKey, setOvEnemyKey] = useState('');
  const [ovEnemy, setOvEnemy] = useState({});
  const enemyList = useMemo(() => (data.list('enemies') || []).filter((r) => recId(r)), []);

  // ---- 分区 4：首领 ----
  const [bossOv, setBossOv] = useState({});

  // ---- 分区 5：场景与回合 ----
  const [stageId, setStageId] = useState('');
  const stageList = useMemo(() => (data.list('stages') || []).filter((r) => recId(r)), []);

  /** 显示名：优先本地化名，回退到记录 id。 */
  const nameOf = (r) => r?.name || recId(r);

  // ===== 渲染 =====
  if (!open) {
    return html`<button type="button" class="devpanel-toggle tapx" onClick=${() => setOpen(true)}
      title=${t('开发者面板')} aria-label=${t('开发者面板')}>
      <${Icon} name="sword" /><span class="devpanel-toggle__badge">DEV</span>
    </button>`;
  }

  const renderOps = () => html`<div class="dev-sec">
    <div class="dev-note">${t('显示范围')}: <b>${SCOPE_LABELS[scope] || scope}</b>（${t('只列出本档位可发放的干员')}）</div>
    <h4 class="dev-sec__h">${t('发放干员')}</h4>
    <input class="dev-input" type="search" value=${opsSearch} placeholder=${t('搜索干员')} onInput=${(e) => setOpsSearch(e.target.value)} />
    <div class="dev-list">
      ${chessList.length === 0 ? html`<div class="dev-empty">${t('没有匹配的项')}</div>`
        : chessList.map((c) => html`<div class="dev-row" key=${recId(c)}>
          <span class="dev-row__name">${c.name || recId(c)}</span>
          <button type="button" class="dev-btn dev-btn--sm tapx" onClick=${() => send('grantChess', { chessId: recId(c) })}>${t('发放')}</button>
        </div>`)}
    </div>

    <h4 class="dev-sec__h">${t('数值覆盖')}</h4>
    <select class="dev-select" value=${opsUid} onChange=${(e) => setOpsUid(e.target.value)}>
      <option value="" disabled selected=${!opsUid}>${t('选择已持有干员（uid）')}</option>
      ${owned.map((p) => html`<option key=${p.uid} value=${String(p.uid)}>#${p.uid} · ${p.id}</option>`)}
    </select>
    <${OverrideEditor} value=${opsOv} onChange=${setOpsOv} />
    <button type="button" class="dev-btn tapx" onClick=${applyOpsOverride}>${t('应用')}</button>

    <h4 class="dev-sec__h">${t('已应用的覆盖')}</h4>
    ${Object.keys(devExt).length === 0 ? html`<div class="dev-empty">—</div>`
      : html`<div class="dev-list">${Object.entries(devExt).map(([uid, ov]) => html`<div class="dev-row" key=${uid}>
          <span class="dev-row__name">#${uid} · ${Object.entries(ov).map(([k, v]) => `${OVERRIDE_LABELS[k] || k}:${v}`).join(' ')}</span>
          <button type="button" class="dev-btn dev-btn--sm dev-btn--ghost tapx"
            onClick=${() => { send('grantChess', { uid: Number(uid), overrides: {} }); setDevExt((m) => { const n = { ...m }; delete n[uid]; return n; }); }}>${t('清除')}</button>
        </div>`)}</div>`}
  </div>`;

  const renderFunds = () => html`<div class="dev-sec">
    <label class="dev-field"><span>${t('资金')}</span>
      <input class="dev-input dev-input--num" type="number" value=${funds} placeholder="0" onInput=${(e) => setFunds(e.target.value)} />
      <button type="button" class="dev-btn dev-btn--sm tapx" onClick=${() => send('funds', { funds: Number(funds) })}>${t('设置')}</button>
    </label>
    <label class="dev-field"><span>LP</span>
      <input class="dev-input dev-input--num" type="number" value=${lp} placeholder="0" onInput=${(e) => setLp(e.target.value)} />
      <button type="button" class="dev-btn dev-btn--sm tapx" onClick=${() => send('lp', { lp: Number(lp) })}>${t('设置')}</button>
    </label>
    <label class="dev-field"><span>${t('商店等级')}</span>
      <input class="dev-input dev-input--num" type="number" min="1" max="8" value=${shopLevel} placeholder="1-8" onInput=${(e) => setShopLevel(e.target.value)} />
      <button type="button" class="dev-btn dev-btn--sm tapx" onClick=${() => send('shopLevel', { shopLevel: Number(shopLevel) })}>${t('设置')}</button>
    </label>
    <label class="dev-field"><span>${t('商店槽位')}</span>
      <input class="dev-input dev-input--num" type="number" min="0" max="8" value=${shopSlots} placeholder="0-8" onInput=${(e) => setShopSlots(e.target.value)} />
      <button type="button" class="dev-btn dev-btn--sm tapx" onClick=${() => send('shopSlots', { shopSlots: Number(shopSlots) })}>${t('设置')}</button>
    </label>
    <label class="dev-field"><span>${t('盟约层数')}</span>
      <input class="dev-input dev-input--num" type="number" value=${layers} placeholder="±n" onInput=${(e) => setLayers(e.target.value)} />
      <button type="button" class="dev-btn dev-btn--sm tapx" onClick=${() => send('layers', { layers: Number(layers) })}>${t('设置')}</button>
    </label>
    <div class="dev-note">${t('层数只对已激活盟约生效，需先有盟约已激活')}</div>
    <h4 class="dev-sec__h">${t('盟约')}</h4>
    <${RecordPicker} list=${bandList} search=${bandId} onSearch=${setBandId} placeholder=${t('搜索盟约')} value=${bandId}
      renderName=${nameOf}
      onPick=${(id) => { setBandId(id); if (id) send('band', { bandId: id }); }} />
    <h4 class="dev-sec__h">${t('道具')}</h4>
    <${RecordPicker} list=${itemList} search=${itemSearch} onSearch=${setItemSearch} placeholder=${t('搜索道具')} value=${''}
      renderName=${nameOf}
      onPick=${(id) => { if (id) send('item', { itemId: id }); }} />
  </div>`;

  const renderEnemy = () => html`<div class="dev-sec">
    <h4 class="dev-sec__h">${t('添加敌人')}</h4>
    <${RecordPicker} list=${enemyList} search=${enemySearch} onSearch=${setEnemySearch} placeholder=${t('搜索敌人')} value=${spawnKey}
      renderName=${nameOf} onPick=${setSpawnKey} />
    <div class="dev-inline">
      <label class="dev-field dev-field--mini"><span>${t('数量')}</span>
        <input class="dev-input dev-input--num" type="number" min="1" max="50" value=${spawnCount} onInput=${(e) => setSpawnCount(e.target.value)} /></label>
      <label class="dev-field dev-field--mini"><span>route</span>
        <input class="dev-input dev-input--num" type="number" min="0" max="7" value=${spawnRoute} placeholder="auto" onInput=${(e) => setSpawnRoute(e.target.value)} /></label>
      <button type="button" class="dev-btn dev-btn--sm tapx"
        onClick=${() => { if (!spawnKey) { toast(t('请先选择敌人'), 'warn'); return; } send('spawnEnemy', { enemyKey: spawnKey, count: Number(spawnCount) || 1, routeIndex: spawnRoute === '' ? undefined : Number(spawnRoute) }); }}>${t('添加敌人')}</button>
    </div>
    <div class="dev-note">${t('添加的敌人只在本回合出现，下回合起始清空')}</div>
    <h4 class="dev-sec__h">${t('敌人覆盖')}</h4>
    <${RecordPicker} list=${enemyList} search=${''} onSearch=${() => {}} placeholder=${t('选择敌人')} value=${ovEnemyKey}
      renderName=${nameOf} onPick=${setOvEnemyKey} />
    <${OverrideEditor} value=${ovEnemy} onChange=${setOvEnemy} />
    <button type="button" class="dev-btn tapx"
      onClick=${() => { if (!ovEnemyKey) { toast(t('请先选择敌人'), 'warn'); return; } send('enemyOverride', { enemyKey: ovEnemyKey, atk: ovEnemy.atk, def: ovEnemy.def, hp: ovEnemy.hp, res: ovEnemy.res }); }}>${t('应用')}</button>

    <h4 class="dev-sec__h">${t('本回合已添加敌人')}</h4>
    ${(pub?.devEnemies && pub.devEnemies.length) ? html`<div class="dev-list">${pub.devEnemies.map((e, i) => html`<div class="dev-row" key=${i}>
      <span class="dev-row__name">${String(e.enemyKey || e.key || '?')}${e.count > 1 ? ` ×${e.count}` : ''}${e.fly ? ' ·fly' : ''}${e.elite ? ' ·elite' : ''}</span>
    </div>`)}</div>` : html`<div class="dev-empty">—</div>`}
  </div>`;

  const renderBoss = () => html`<div class="dev-sec">
    <h4 class="dev-sec__h">${t('首领覆盖')}</h4>
    <${OverrideEditor} value=${bossOv} onChange=${setBossOv} />
    <div class="dev-inline">
      <button type="button" class="dev-btn tapx"
        onClick=${() => send('boss', { hp: bossOv.hp, atk: bossOv.atk, def: bossOv.def, res: bossOv.res })}>${t('应用')}</button>
      <button type="button" class="dev-btn dev-btn--ghost tapx" onClick=${() => { setBossOv({}); send('boss', {}); }}>${t('清除')}</button>
    </div>
    ${pub?.bossHp ? html`<div class="dev-note">${t('首领血池')}: ${Math.round(pub.bossHp.hp)} / ${Math.round(pub.bossHp.max)}</div>` : null}
  </div>`;

  const renderStage = () => html`<div class="dev-sec">
    <h4 class="dev-sec__h">${t('关卡')}</h4>
    <${RecordPicker} list=${stageList} search=${''} onSearch=${() => {}} placeholder=${t('选择关卡')} value=${stageId}
      renderName=${nameOf} onPick=${(id) => { setStageId(id); if (id) send('stage', { stage: id }); }} />
    <h4 class="dev-sec__h">${t('回合类型')}</h4>
    <div class="dev-inline">
      <button type="button" class="dev-btn dev-btn--sm tapx" onClick=${() => send('roundKind', { roundKind: 'normal' })}>${t('普通')}</button>
      <button type="button" class="dev-btn dev-btn--sm tapx" onClick=${() => send('roundKind', { roundKind: 'boss' })}>${t('首领回合')}</button>
    </div>
    <div class="dev-note">${t('下一回合类型')}: <b>${pub?.devNextKind ? (pub.devNextKind === 'boss' ? t('首领') : t('普通')) : '—'}</b></div>
  </div>`;

  return html`<aside class="devpanel" role="dialog" aria-label=${t('开发者面板')}>
    <header class="devpanel__head">
      <${Icon} name="sword" /><b>${t('开发者面板')}</b>
      <span class="devpanel__tag">DEV</span>
      <span class="devpanel__scope">${SCOPE_LABELS[scope] || scope}</span>
      <button type="button" class="devpanel__close tapx" onClick=${() => setOpen(false)} aria-label=${t('收起')}>✕</button>
    </header>
    <nav class="devpanel__tabs">
      ${SECTIONS.map((s) => html`<button type="button" key=${s.id} class=${cx('devpanel__tab', tab === s.id && 'is-on')}
        onClick=${() => setTab(s.id)}>${s.label()}</button>`)}
    </nav>
    <div class="devpanel__body">
      ${tab === 'ops' && renderOps()}
      ${tab === 'funds' && renderFunds()}
      ${tab === 'enemy' && renderEnemy()}
      ${tab === 'boss' && renderBoss()}
      ${tab === 'stage' && renderStage()}
    </div>
  </aside>`;
}
