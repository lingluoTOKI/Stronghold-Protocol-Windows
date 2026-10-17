// 本局信息 dialog under the top bar (opened by the left 🔍, official btn_check_player / autochess_hud_player_info_dialog,
// research 09 §2.1) with three tabs:
//   本局信息 — own strategy, stage, disabled bonds with banned-member counts and the banned operator list (default) —
//              the same bonds, states and banned operators (by tier) as the briefing and the strategy draft's 本局信息
//              dialog: ui/matchInfo.js matchInfoModel, drawn here as compact chips and avatars;
//   敌方情报 — the secondary enemy list: m.private.nextEnemies (icons, names, counts, tags, 特训 faction tags) + this
//              match's factions and the enemy leader on boss rounds. The primary enemy preview is the pen on the board
//              (the right 🔍▶▶ pans the camera there; tapping an enemy in the pen opens its detail card) — research 09 §6.2.
//   查看契约 — the contracts this player picked, grouped 我方 / 中立 / 敌方 (user 2026-10-12: the right-edge effects
//              column no longer lists contracts at all — ui/effectsList.js filters them out — they live here instead,
//              each with its own per-contract glyph from ui/contractGlyphs.js).

import { html, Icon, Tabs, MicroLabel } from './components.js';
import { Img, UnitThumb, BondGlyph, BandIcon, RichText, GIcon } from './gameComponents.js';
import { battleRunner } from '../battle/runner.js';
import { groupEnemies, factionTypes, briefingBondTip } from './gameLogic.js';
import { matchInfoModel, DiyBannedLine } from './matchInfo.js';
import { inBondScope } from '../../../shared/bondScope.js';
import { useBondScope } from './bondScope.js';
import { contractGlyph, contractPlus, isContractRef, contractIdOf, contractGroupOf } from './contractGlyphs.js';
import { factionIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t, tParts, tName, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const TAG = { boss: N_('领袖'), bounty: N_('悬赏'), escort: N_('护卫') };

// 敌方契约的加成基数表（server/sim/content/contracts.js enemyPlanOf 同源）—— 敌方情报页把当前生效的
// 加成写出来（实测报告 2026-10-10「血量敌方加成你也写出来」）：× 当前回合，生命值/攻击力/移速/防御/法抗 %、攻速 点。
// stat 字段供 detailPanel 的敌方面板把百分比换算成具体数字（绿字，用户口径：跟着百分比一起显示）。
export const ENEMY_CONTRACT_BONUS = {
  contract_e_atk2: { label: N_('攻击力'), base: 5, pct: true, stat: 'atk' },
  contract_e_aspd2: { label: N_('攻击速度'), base: 5, pct: false, stat: 'aspd' },
  contract_e_move2: { label: N_('移动速度'), base: 5, pct: true, stat: 'moveSpeed' },
  contract_e_hp2: { label: N_('生命值'), base: 7, pct: true, stat: 'maxHp' },
  contract_e_def2: { label: N_('防御力和法术抗性'), base: 5, pct: true, stat: 'defres' },
  contract_e_atk8: { label: N_('攻击力'), base: 10, pct: true, stat: 'atk' },
  contract_e_aspd8: { label: N_('攻击速度'), base: 10, pct: false, stat: 'aspd' },
  contract_e_move8: { label: N_('移动速度'), base: 10, pct: true, stat: 'moveSpeed' },
  contract_e_hp8: { label: N_('生命值'), base: 15, pct: true, stat: 'maxHp' },
  contract_e_def8: { label: N_('防御力和法术抗性'), base: 10, pct: true, stat: 'defres' },
};

/** 当前生效的敌方契约加成一行（无则不渲染）。 */
function ContractBonusLine({ pub, priv }) {
  const round = Math.max(1, pub?.round || 1);
  const ids = (priv?.effects || [])
    .map((e) => String(e?.key || '').replace(/^contract:/, ''))
    .filter((id) => ENEMY_CONTRACT_BONUS[id]);
  if (!ids.length) return null;
  const parts = ids.map((id) => {
    const b = ENEMY_CONTRACT_BONUS[id];
    return `${t(b.label)} +${b.base * round}${b.pct ? '%' : ''}`;
  });
  return html`<p class="ebonus"><${GIcon} name="skull" />${t('契约加成（第{r}回合）：', { r: round })}<b class="t-orange">${parts.join(' · ')}</b></p>`;
}

function FactionChips({ types }) {
  const f = data.get('factions')?.types || {};
  const m = data.get('assets');
  return html`<div class="fchips">${types.map((t) => html`<span key=${t} class="fchip" title=${f[t]?.desc || ''}>
    <${Img} src=${factionIconUrl(m, f[t]?.icon)} class="fchip__icon" /><span>${f[t]?.name || t}</span></span>`)}</div>`;
}

function EnemiesTab({ pub, priv, onEnemy }) {
  const rows = groupEnemies(priv?.nextEnemies, (k) => data.lookup('enemies', k));
  const types = factionTypes(pub?.factions);
  const f = data.get('factions')?.types || {};
  const total = rows.reduce((s, r) => s + r.count, 0);
  const boss = pub?.bossId ? data.lookup('bosses', pub.bossId) : null;
  return html`<div class="edrawer__body">
    <div class="edrawer__sum">
      <span>${tParts('第 {r} 回合 · 即将迎击 {n} 名敌人', { r: html`<b class="num">${pub?.round ?? '-'}</b>`, n: html`<b class="num t-orange">${total}</b>`, count: total })}</span>
      ${types.length ? html`<${FactionChips} types=${types} />` : null}
    </div>
    <${ContractBonusLine} pub=${pub} priv=${priv} />
    ${rows.length ? html`<div class="elist">
      ${rows.map((r) => html`<button key=${`${r.enemyKey}|${r.tag}`} type="button" class=${cx('erow', r.tag && `erow--${r.tag}`, `erow--${r.rank.toLowerCase()}`)}
          onClick=${() => onEnemy(r.enemyKey, r.count)}>
        <${UnitThumb} kind="enemy" id=${r.enemyKey} size="md" />
        <span class="erow__text">
          <b class="erow__name">${r.name}</b>
          <span class="erow__tags">
            ${r.tag ? html`<span class=${`etag etag--${r.tag}`}>${t(TAG[r.tag] || r.tag)}</span>` : null}
            ${r.rank === 'ELITE' ? html`<span class="etag etag--elite">${t('精英')}</span>` : null}
            ${r.fly ? html`<span class="etag etag--fly">${t('空中')}</span>` : null}
            ${r.acTypes.map((ty) => html`<span key=${ty} class="etag etag--faction">${(f[ty]?.name || ty).replace(t('特训敌人·'), '')}</span>`)}
          </span>
        </span>
        <b class="erow__count num">×${r.count}</b>
      </button>`)}
    </div>` : html`<p class="edrawer__empty"><${GIcon} name="target" />${t('暂无敌方情报')}</p>`}
    ${boss ? html`<div class="eboss">
      <${UnitThumb} kind="enemy" id=${boss.enemyKey} size="md" />
      <div><${MicroLabel} tone="gold">${t('ENEMY LEADER // 敌方领袖')}</${MicroLabel}><b>${boss.name}</b>
        <span class="t-lo">${t('第 {r} 回合 · 最终攻势', { r: data.get('config')?.modes?.[pub.modeId]?.bossRound ?? pub.lastRound ?? 14 })}</span></div>
    </div>` : null}
  </div>`;
}

/** 契约的展示顺序（用户口径）：我方 → 中立 → 敌方。 */
const CGROUP = [
  { id: 'self', label: N_('我方契约') },
  { id: 'neutral', label: N_('中立契约') },
  { id: 'enemy', label: N_('敌方契约') },
];

/**
 * 本局选过的契约，按 我方 / 中立 / 敌方 分组（用户 2026-10-12）。
 * 数据就是 m.private.effects 里 key 带 `contract:` 的那几条 —— 名字和描述服务端已经随 EffectRef 发下来了
 * （server/match/contracts.js applyContract 用 choices.json contracts[].name/desc），不必再查表。
 * 图标走 ui/contractGlyphs.js 的逐条字形，和契约选择卡面上那一套是同一个。
 * @param {{ priv:any }} props
 */
function ContractsTab({ priv }) {
  const seen = new Set();
  const picked = [];
  for (const e of priv?.effects || []) {
    if (!isContractRef(e)) continue;
    const id = contractIdOf(e);
    if (!id || seen.has(id)) continue; // 同一契约只会选到一次，去重是防「联合」那种全队复制的脏数据
    seen.add(id);
    picked.push({ id, group: contractGroupOf(id, e.group), name: tName(e.name) || e.name || id, desc: e.desc || '' });
  }
  const byGroup = new Map(CGROUP.map((g) => [g.id, []]));
  for (const c of picked) (byGroup.get(c.group) || byGroup.get('self')).push(c);

  return html`<div class="edrawer__body">
    <p class="edrawer__sum"><span>${tParts('本局已选契约 {n} 条', { n: html`<b class="num t-orange">${picked.length}</b>`, count: picked.length })}</span></p>
    ${picked.length ? CGROUP.map((g) => {
      const rows = byGroup.get(g.id);
      if (!rows.length) return null;
      return html`<div key=${g.id} class=${cx('cgroup', `cgroup--${g.id}`)}>
        <h4 class=${cx('cgroup__head', `is-${g.id}`)}>${t(g.label)}<small class="num">${rows.length}</small></h4>
        <div class="clist">
          ${rows.map((c) => html`<div key=${c.id} class="crow">
            <span class=${cx('crow__glyph', contractPlus(c.id) && 'is-plus')}><${GIcon} name=${contractGlyph(c.id)} /></span>
            <span class="crow__text">
              <b class="crow__name">${c.name}</b>
              <${RichText} as="p" text=${c.desc} class="crow__desc" />
            </span>
          </div>`)}
        </div>
      </div>`;
    }) : html`<p class="edrawer__empty"><${GIcon} name="gear" />${t('本局还没有选择契约')}</p>`}
  </div>`;
}

// =====================================================================================================================
// 龙门强化页（用户 2026-10-16「查看契约旁边新加一个窗口，名字龙门强化」）：显示本局被强化的【龙门】干员、
// 强化类型、实际百分比，以及强化后落到干员身上的「实际数值」（技能倍率 / 技能持续时间 / 三项属性）。
// 诗怀雅【天选明星】策略持有者这里会标记为「主动选择」（不是随机）。
// 数据来自 battleRunner.lungmenEnhanceInfo()（扫 bond:lungmen:enh:<kind>:<full|part> buff，pct 取自 buff.data.pct，
// full 为 100% 强化、part 为部分强化；chosen 标记本场是玩家自选还是随机）。

const LM_ENH_KIND = { skill: '技能数值', duration: '技能持续时间', trait: '特质数值' };
/** 每种强化类型落到干员身上的「实际数值」说明（pct 已是带 % 的字符串）。 */
const LM_ENH_ACTUAL = {
  skill: (p) => `该干员技能造成的伤害提升 ${p} —— 即技能伤害倍率 +${p}`,
  duration: (p) => `每次进入技能时技能持续时间延长 ${p} —— 即技能持续时间 +${p}`,
  trait: (p) => `攻击力、防御力、生命值各提升 ${p} —— 即三项属性 +${p}`,
};
/** 分数倍率 → 百分比字符串（整数去 .0）。 */
function lmPct(v) {
  const n = Number(v) * 100;
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

function LungmenEnhanceTab({ ownerId }) {
  const info = (ownerId != null && battleRunner?.lungmenEnhanceInfo)
    ? battleRunner.lungmenEnhanceInfo(ownerId) ?? null
    : null;
  if (!info) {
    return html`<div class="edrawer__body">
      <p class="edrawer__empty"><${GIcon} name="crown" />${t('本局未激活龙门，或当前不在战斗中，暂无强化信息')}</p>
    </div>`;
  }
  const kindName = t(LM_ENH_KIND[info.kind] || '技能数值');
  const fullPct = lmPct(info.full[0]?.pct ?? 0);
  const partPct = lmPct(info.part[0]?.pct ?? 0);
  const actual = (pct) => LM_ENH_ACTUAL[info.kind]?.(pct) || '';
  return html`<div class="edrawer__body">
    <div class="le__head">
      <span class="le__title">${t('本局龙门强化')}</span>
      ${info.chosen
        ? html`<span class="le__chosen" title=${t('诗怀雅策略【天选明星】：由你主动选择强化干员与强化类型，而非随机')}>${t('主动选择 · 诗怀雅【天选明星】')}</span>`
        : html`<span class="le__rand">${t('随机强化')}</span>`}
    </div>
    <p class="le__kind">${t('强化类型')}：<b>${kindName}</b></p>
    ${info.full.length ? html`<div class="le__group">
      <h4 class="le__ghead is-full">${t('完整强化（{n} 名）', { n: info.full.length })}</h4>
      ${info.full.map((u) => html`<div key=${u.chessId} class=${cx('le__row', 'is-full')}>
        <${UnitThumb} kind="chess" id=${u.chessId} size="md" />
        <div class="le__rowbody">
          <b class="le__name">${u.name}</b>
          <div class="le__line">${t('获得')}<b>${kindName}</b>${t('强化')} <b class=${cx('num', 'le__pct')}>${fullPct}</b></div>
          <div class="le__actual">${actual(fullPct)}</div>
        </div>
      </div>`)}
    </div>` : null}
    ${info.part.length ? html`<div class="le__group">
      <h4 class="le__ghead is-part">${t('部分强化（{n} 名非强化干员）', { n: info.part.length })}</h4>
      <p class="le__note">${t('所有非强化【龙门】干员均获得此部分效果')}</p>
      ${info.part.map((u) => html`<div key=${u.chessId} class=${cx('le__row', 'is-part')}>
        <${UnitThumb} kind="chess" id=${u.chessId} size="md" />
        <div class="le__rowbody">
          <b class="le__name">${u.name}</b>
          <div class="le__line">${t('获得')}<b>${kindName}</b>${t('强化')} <b class=${cx('num', 'le__pct')}>${partPct}</b></div>
          <div class="le__actual">${actual(partPct)}</div>
        </div>
      </div>`)}
    </div>` : null}
    <p class="le__foot">${t('强化数值：技能数值 / 技能持续时间 =（10 + 层数×0.5）%；特质数值 =（50 + 每20层×5）%。部分强化比例：6 名在场（25 + 层数×0.1）%、9 名在场（50 + 层数×0.2）%。')}</p>
  </div>`;
}

function InfoTab({ pub, priv, onChess, bandId = null, bandOwner = null }) {
  const scope = useBondScope(); // 显示范围：盟约(官方) / 契约(本作新增) —— 只列当前档位的盟约
  const model = matchInfoModel(pub, {
    bonds: data.list('bonds').filter((b) => inBondScope(b?.bondId, scope)), chess: (id) => data.lookup('chess', id), mode: data.get('config')?.modes?.[pub?.modeId],
    // the own 自选 pieces this match leaves out of the shop (m.private.diyBanned) — not while scouting a teammate
    priv: bandOwner ? null : priv, diyData: { chess: data.get('chess'), backups: data.get('backups') },
  });
  const { bonds, banned, perBond, stateOf } = model;
  const disabled = new Set(bonds.filter((b) => stateOf(b.bondId)).map((b) => b.bondId));
  // while scouting a teammate's prep board the drawer shows THEIR 策略 in place of one's own (user playtest #2 item 2)
  const band = (bandId || priv?.bandId) ? data.lookup('bands', bandId || priv.bandId) : null;
  const stage = pub?.stageId ? data.lookup('stages', pub.stageId) : null;
  const withBans = bonds.filter((b) => disabled.has(b.bondId) || (perBond.get(b.bondId) || 0) > 0)
    .sort((a, b) => (disabled.has(b.bondId) - disabled.has(a.bondId)) || ((perBond.get(b.bondId) || 0) - (perBond.get(a.bondId) || 0)));
  return html`<div class="edrawer__body">
    ${band ? html`<div class="iband">
      <${BandIcon} bandId=${band.bandId} size="md" />
      <div><${MicroLabel} tone="mint">STRATEGY // ${bandOwner ? t('{bandOwner} 的策略', { bandOwner }) : t('我的策略')}</${MicroLabel}><b>${band.name} <small class="t-lo">${band.effectName}</small></b>
        <${RichText} text=${band.descRaw || band.desc} class="iband__desc" /></div>
    </div>` : null}
    ${stage ? html`<p class="istage"><${Icon} name="rook" />${t('战场：')}<b>${stage.name || stage.id}</b></p>` : null}
    <h4 class="ihead">${t('本局禁用干员情况')} <small class="num">${banned.length}</small></h4>
    <div class="ibonds">
      ${withBans.length ? withBans.map((b) => html`<span key=${b.bondId} class=${cx('ibond', disabled.has(b.bondId) && 'is-off')} title=${briefingBondTip(b.name, stateOf(b.bondId), perBond.get(b.bondId) || 0)}>
        <${BondGlyph} bondId=${b.bondId} /><span>${b.name}</span>
        ${perBond.get(b.bondId) ? html`<span class="ibond__ban num" title=${t('该盟约中被禁用的干员数')}><${Icon} name="user" />${perBond.get(b.bondId)}</span>` : null}
      </span>`) : html`<span class="t-dim">${t('本局没有禁用盟约')}</span>`}
    </div>
    ${banned.length ? html`<div class="ibanned">${banned.map((id) => html`<button key=${id} type="button" class="ibanned__one" onClick=${() => onChess(id)}>
      <${UnitThumb} kind="chess" id=${id} size="sm" dim=${true} /></button>`)}</div>` : null}
    <${DiyBannedLine} model=${model} class="idiybanned" />
  </div>`;
}

/**
 * @param {{ tab:'enemies'|'info'|'contracts', onTab:(t:string)=>void, pub:any, priv:any, onClose:Function, onEnemy:(key:string, count:number)=>void, onChess:(id:string)=>void,
 *   bandId?: string|null, bandOwner?: string|null }} props
 *   bandId / bandOwner: while scouting a teammate's prep board, the watched player's 策略 (m.public players[].bandId)
 *   replaces one's own in the 本局信息 tab (game.js scoutBandId; user playtest #2 item 2)
 */
export function EnemyDrawer({ tab, onTab, pub, priv, onClose, onEnemy, onChess, ownerId = null, bandId = null, bandOwner = null }) {
  const items = [{ id: 'info', label: t('本局信息') }, { id: 'enemies', label: t('敌方情报') }, { id: 'contracts', label: t('查看契约') }, { id: 'lungmen', label: t('龙门强化') }];
  const label = (items.find((i) => i.id === tab) || items[0]).label;
  return html`<div class="edrawer brackets" role="dialog" aria-label=${label}>
    <div class="edrawer__top">
      <${Tabs} size="sm" value=${tab} onChange=${onTab} items=${items} />
      <button type="button" class="edrawer__close tapx" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    </div>
    ${tab === 'enemies' ? html`<${EnemiesTab} pub=${pub} priv=${priv} onEnemy=${onEnemy} />`
      : tab === 'contracts' ? html`<${ContractsTab} priv=${priv} />`
      : tab === 'lungmen' ? html`<${LungmenEnhanceTab} ownerId=${ownerId} />`
      : html`<${InfoTab} pub=${pub} priv=${priv} onChess=${onChess} bandId=${bandId} bandOwner=${bandOwner} />`}
  </div>`;
}
