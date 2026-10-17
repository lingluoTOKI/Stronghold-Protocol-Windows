// server/sim/content/lungmen.js — 龙门 (lungmenShip) —— 本 fork 第六个扩展阵营。
//
// 用户 2026-10-14 规格（数值全部读 data/bonds.json lungmenShip.bb / buffs[0].bb，键 lungmen_covenant）：
//
//   【龙门】被激活时：
//     * 所有龙门干员每秒回复（150 + 层数×0.8）点生命值（hpRegen buff，live 随层数刷新）。
//     * 从「炽刃明霄陈 / 琳琅诗怀雅 / 斩业星熊 / 林」中随机一名获得随机强化（四选一之一），
//       且强化类型在「技能数值 / 技能持续时间 / 特质数值」三者中随机：
//         · 技能数值    提升（10 + 层数×0.5）%   → 伤害倍率 dmg.mul（本干员的伤害）
//         · 持续时间    提升（10 + 层数×0.5）%   → skill.timeLeft 每次进入技能时按比例延长
//         · 特质数值    提升（50 + 每20层×5）%   → 该干员的 atk/def/hp 属性提升该比例
//       强化对象在**每场战斗开始时**随机一次（battle 构造时抽取，整场不变）。
//   <在场6名不同【龙门】干员> 随机获得上述一位「非强化干员」，该干员另获得强化干员（25 + 层数×0.1）% 的部分效果；
//       且**所有龙门干员**造成伤害提升（15 + 层数×0.3）%（用户 2026-10-16，dmgDealtMul 乘算，含陈）；
//       【龙门】层数达到 300 层时，额外随机获得一名「随机强化的干员」（获得完整强化效果）。
//       —— 2026-10-14 二次裁定：这是**两个互相独立**的奖励（原实现误写成「6 名 且 300 层」才发一次，
//          于是「在场 6 龙门不发干员」）。两个门槛各自记账、各自发一次。
//       —— 「强化 / 非强化」指的是**龙门盟约那个随机强化**（技能数值 / 持续时间 / 特质数值），
//          **不是**精锐 `_b`：两张卡都是普通卡，区别只在发出的干员上场后叠不叠加强化、叠多少。
//   <在场9名不同【龙门】干员> 再随机获得上述一位非强化干员（不可是上次那名），
//       所有非强化干员获得（50 + 层数×0.2）% 的效果。
//
//   档位攻击力 / 法术附伤 / 攻速加成（原 3/6/9 人档）已按用户 2026-10-14 要求全部移除，龙门只保留上方激活/在场强化与回血。
//
// 干员特质（备戡侧走盟约 meta；战斗侧走 install；精锐加成翻倍）：
//   暗锁/阿消 获得时 自身盟约+3   食铁兽 获得时 自身盟约+6   星熊 获得时 自身盟约+15
//   斩业星熊 获得时 龙门与重装+24   老鲤 获得时 龙门与特种+20
//   诗怀雅 休整期结束时随机触发场上一个获得时效果
//   琳琅诗怀雅 休整期结束时触发场上叠层数量最多的获得时效果1次
//   林 休整期结束时场上每个获得时干员 → 龙门与术师+6
//   陈 龙门+近卫每叠3层 造成伤害+1%      赤刃明霄陈 龙门+近卫每叠3层 攻击力+1%
//   阿 龙门+特种每叠3层 身前一格干员防御力+2   哞 龙门+重装每叠3层 生命值+1%
import * as S from './support/index.js';
import { onHitBy } from './kits/shared/tier1.js';
import { LUNGMEN_BOND, LUNGMEN_BB_KEY, lungmenRosterOf } from '../../../shared/penguinLungmen.js';
import { msg } from '../../../shared/i18n.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bbOf = () => S.buffParams(S.bondRecord(LUNGMEN_BOND), LUNGMEN_BB_KEY);
const rosterOfUnit = (u) => (u && u.def ? lungmenRosterOf(u.def.baseId ?? u.def.id) : null);

/** 可被「随机强化」的龙门干员（规格点名的四位）。 */
const ENHANCE_KEYS = Object.freeze(['chen3', 'linlangswire', 'hsgma2', 'lin']);
/** 强化类型：技能数值 / 技能持续时间 / 特质数值。 */
const ENHANCE_KINDS = Object.freeze(['skill', 'duration', 'trait']);

// ---- 诗怀雅策略【天选明星】(data/bands.json band_swire, content/bands/meta.js band_swire_choose_enhance) -----------
// 持有该策略时，龙门盟约的「随机一位获得随机强化」被玩家在**第一回合**做出的主动选择取代
// （2026-10-15 二次裁定：原先要等龙门首次激活；口径写作「选择本策略首次激活龙门时不会随机强化干员」）：
//   * 玩家已选 → 用选定的 { key, kind }；
//   * 玩家没选（还没做出选择）→ 随机强化**直接失效**（不强化任何人），直到选择完成。
const SWIRE_BAND = 'band_swire';
/** 持有诗怀雅策略的标记（prep 侧 counter → battle player 的 counters 克隆）。 */
const SWIRE_FLAG_KEY = 'lungmen:swire';
/** 玩家选择（JSON 字符串，prep 侧写、battle 侧读）：{ key, opId, kind }。 */
const LUNGMEN_PICK_KEY = 'lungmen:pick';

/** 稳定字符串哈希 → 用于「随机」抽取（同一 pid/uid 在同一场战斗里结果一致，便于回放）。 */
function hash32(...parts) {
  let h = 2166136261 >>> 0;
  for (const s of parts) {
    const str = String(s);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  }
  return h >>> 0;
}

function onLayers(battle, pid, fn) {
  const st = S.battleStore(battle, 'lungmen:refresh', () => ({ map: new Map(), hooked: false }));
  if (!st.map.has(pid)) st.map.set(pid, []);
  st.map.get(pid).push(fn);
  if (st.hooked) return;
  st.hooked = true;
  battle.on('layerGain', (c) => {
    if (!st.map.has(c.playerId)) return;
    battle.after(0, () => { for (const f of st.map.get(c.playerId)) f(); });
  }, { priority: -100 });
}

// =====================================================================================================================
// 随机强化

/**
 * 抽取本场的强化分配。
 * @returns {{enhanced:*, kind:string, extra:Set<*>, ratio:number}}
 *   enhanced = 获得完整强化的干员 uid（6 人档 300 层时额外再多一位）
 *   kind     = skill / duration / trait
 *   extra    = 获得部分效果的非强化干员 → 比例
 *   ratio    = extra 成员享受的比例（6 人档 25+层×0.1%，9 人档 50+层×0.2%，取较高者）
 */
function rollEnhance(battle, pid, members, L, tier, grants = null) {
  const bb = bbOf() || {};
  const cands = members.filter((u) => {
    const r = rosterOfUnit(u);
    return r && ENHANCE_KEYS.includes(r.key);
  });
  const nonCands = members.filter((u) => !cands.includes(u));
  // 场上没有任何「可获得随机强化」的候选时：若本局有盟约奖励发来的干员要叠加强化，仍要走下去（kind 照抽）；
  // 否则没有可强化的对象，直接放弃。
  const granted = !!(grants && (grants.full.size || grants.partial.size));
  if (!cands.length && !granted) return null;

  const seed = hash32(pid, battle.seed ?? '', 'lm');
  let h = seed;
  const pickFrom = (arr) => (arr.length ? arr[(h = (h * 1103515245 + 12345) >>> 0) % arr.length] : null);

  // 诗怀雅策略【天选明星】：持有该策略时，「随机一位 + 随机类型」被玩家在龙门首次激活时做出的选择取代；
  // 未完成选择前随机强化直接失效（返回 null，本场不强化任何人）。选定的干员不在场时同样视为无强化对象。
  let primary;
  let kind;
  if (hasSwireBand(battle, pid)) {
    const pick = lungmenPickOf(battle, pid);
    if (!pick) return null;
    primary = cands.find((u) => { const r = rosterOfUnit(u); return r && r.key === pick.key; }) || null;
    kind = pick.kind;
    if (!primary) return null;
  } else {
    primary = pickFrom(cands);
    kind = ENHANCE_KINDS[(h = (h * 1103515245 + 12345) >>> 0) % ENHANCE_KINDS.length];
  }

  // 6 人档：随机一位非强化干员获得部分效果；**所有非强化干员都获得该效果**（2026-10-16 用户：
    // 原「9 人档所有非强化干员获得效果」移到 6 人档）；300 层起强化名额 +1
  const extra = new Set();
  let ratio = 0;
  if (tier >= 2 && nonCands.length) {
    const e1 = pickFrom(nonCands);
    if (e1) extra.add(e1.uid);
    ratio = Math.max(ratio, num(bb.enhance6_base, 25) / 100 + L * num(bb.enhance6_per_layer, 0.1) / 100);
    // 所有非强化干员都吃到这一档的部分效果
    for (const u of nonCands) extra.add(u.uid);
  }
  // 9 人档：再随机一位非强化干员（不可是上次那名）；所有非强化干员获得更高比例
  if (tier >= 3) {
    const rest = nonCands.filter((u) => !extra.has(u.uid));
    const e2 = pickFrom(rest.length ? rest : nonCands);
    if (e2) extra.add(e2.uid);
    ratio = Math.max(ratio, num(bb.enhance9_base, 50) / 100 + L * num(bb.enhance9_per_layer, 0.2) / 100);
  }

  // 文本规格：强化名额只有「被激活时随机一名」这一位（primary）。
  // 「层数达到 300 层」的奖励是**另一条独立路径**（onPrepStart 发干员 —— 见文件末尾），不在这里加满强化名额。
  const enhanced = new Set();
  if (primary) enhanced.add(primary.uid);

  // 本局从盟约奖励「获得」的干员（prep 侧 recordGranted 登记的 uid）：上场时额外叠加强化。
  //   full    → 完整效果（与该场被随机强化的那位同等档位）—— 文案「层数达到300层获得随机强化的干员」
  //   partial → (25 + 层数×0.1)% 的部分效果               —— 文案「<在场6名不同龙门>…且获得（25+层数×0.1）%的效果」
  if (grants && (grants.full.size || grants.partial.size)) {
    for (const u of members) {
      if (grants.full.has(u.uid)) enhanced.add(u.uid);
      else if (grants.partial.has(u.uid)) extra.add(u.uid);
    }
    if (grants.partial.size) {
      ratio = Math.max(ratio, num(bb.enhance6_base, 25) / 100 + L * num(bb.enhance6_per_layer, 0.1) / 100);
    }
  }

  return { enhanced, kind, extra, ratio, primary };
}

/** 玩家是否持有诗怀雅策略【天选明星】（battle player 的 counters 是 ps.counters 的克隆）。 */
function hasSwireBand(battle, pid) {
  const c = S.player(battle, pid)?.counters;
  return !!(c && (c[SWIRE_FLAG_KEY] || (S.player(battle, pid)?.bandId === SWIRE_BAND)));
}

/** 玩家在龙门首次激活时做出的强化选择（`{ key, opId, kind }`）；未完成选择时为 null。 */
function lungmenPickOf(battle, pid) {
  const c = S.player(battle, pid)?.counters?.[LUNGMEN_PICK_KEY];
  if (typeof c !== 'string' || !c) return null;
  try { const r = JSON.parse(c) || {}; return (r && r.key && r.kind) ? r : null; } catch { return null; }
}

/**
 * 读本局盟约奖励「获得」的干员 uid 表（prep 侧 recordGranted 写入；battle player 的 counters 是 ps.counters 的克隆）。
 * @returns {{full:Set<number>, partial:Set<number>}}
 */
function grantedOps(battle, pid) {
  const empty = { full: new Set(), partial: new Set() };
  const c = S.player(battle, pid)?.counters?.[LUNGMEN_GRANTED_KEY];
  if (typeof c !== 'string' || !c) return empty;
  try {
    const r = JSON.parse(c) || {};
    return { full: new Set(Array.isArray(r.full) ? r.full : []), partial: new Set(Array.isArray(r.partial) ? r.partial : []) };
  } catch { return empty; }
}

/** 强化数值：技能/持续 = (10 + 层数×0.5)%；特质 = (50 + 每20层×5)%。 */
function enhancePct(kind, L) {
  const bb = bbOf() || {};
  if (kind === 'trait') return num(bb.trait_base, 50) / 100 + Math.floor(L / 20) * num(bb.trait_per_20, 5) / 100;
  return num(bb.enhance_base, 10) / 100 + L * num(bb.enhance_per_layer, 0.5) / 100;
}

/**
 * 把强化挂到干员身上。
 *   skill    → 伤害倍率（本干员打出的伤害 ×(1+p)）
 *   duration → 技能持续时间内每次进入技能按比例延长 timeLeft
 *   trait    → 属性（atk/def/hp）×(1+p)
 *
 * key 一律是 `bond:lungmen:enh:<kind>:<full|part>` —— kind 段不可省：
 *   客户端 public/js/battle/runner.js 的 lungmenEnhanceInfo 按 `/^bond:lungmen:enh:(skill|duration|trait):(full|part)$/`
 *   扫 buff 来还原「谁被强化 / 强化了什么 / 百分之多少」，少一段就匹配不上（原先 trait 缺 kind 段，
 *   抽到特质强化时界面什么都不显示）。
 * 数值与类型写进 buff.data（makeBuff 原样保留该字段），界面不必反推闭包；`chosen` 标记这一场是
 * 诗怀雅【天选明星】的**玩家自选**还是随机（用户 2026-10-16：策略诗怀雅是自选的，显示要区分开）。
 */
function installEnhance(battle, u, kind, p, keySuffix, chosen = false) {
  if (!(p > 0)) return;
  const meta = { lungmen: true, kind, pct: p, suffix: keySuffix, chosen: !!chosen };
  if (kind === 'trait') {
    S.passiveBuff(battle, u, `bond:lungmen:enh:${kind}:${keySuffix}`, S.directMods({ atk: p, def: p, hp: p }), { data: meta });
    return;
  }
  if (kind === 'duration') {
    const mk = `bond:lungmen:enh:${kind}:${keySuffix}`;
    S.passiveBuff(battle, u, mk, {}, { data: meta }); // 展示条目
    if (!u.mem) u.mem = {};
    if (!u.mem[mk]) {
      u.mem[mk] = true;
      battle.on('skillStart', (c) => {
        if (c.unit !== u) return;
        const sk = u.skill;
        if (sk && sk.kind === 'duration' && sk.timeLeft > 0) sk.timeLeft *= (1 + p);
      });
    }
    return;
  }
  // skill：本干员技能造成的伤害提升（走 'hit' 事件，pre-mitigation）
  const mk = `bond:lungmen:enh:${kind}:${keySuffix}`;
  S.passiveBuff(battle, u, mk, {}, { data: meta });
  if (!u.mem) u.mem = {};
  if (!u.mem[mk]) {
    u.mem[mk] = true;
    onHitBy(battle, u, ({ dmg }) => { if (dmg && dmg.isSkill && typeof dmg.mul === 'number') dmg.mul *= (1 + p); });
  }
}

// =====================================================================================================================
// 战斗侧

function installLungmen(battle, pid, bb, members) {
  const L = () => S.bondLayers(battle, pid, LUNGMEN_BOND);
  const per3 = (prof) => Math.floor(L() / 3) + Math.floor(S.bondLayers(battle, pid, prof) / 3);
  const tier = S.bondTier(battle, pid, LUNGMEN_BOND);

  // 强化分配整场固定一次（battle 构造即该时点）
  const enhance = rollEnhance(battle, pid, members, L(), tier, grantedOps(battle, pid));
  // 诗怀雅【天选明星】持有者的强化是玩家在龙门首次激活时自选的（干员 + 类型），不是随机
  const chosen = hasSwireBand(battle, pid) && !!lungmenPickOf(battle, pid);

  const apply = () => {
    const lv = L();
    // 激活即生效：所有龙门干员每秒回复（150 + 层数×0.8）点生命值
    // 用户 2026-10-14：原 3 人档攻击力 / 6 人档法术附伤 / 9 人档攻速 三档加成已删除，龙门只保留「激活强化 + 回血 + 6/9 名在场加成 + 300 层赠送干员」
    const regen = num(bb.regen_base, 150) + num(bb.regen_per_layer, 0.8) * lv;

    // 6 人档（tier≥2）：所有龙门干员造成伤害提升（15 + 层数×0.3）%（用户 2026-10-16）。
    // dmgDealtMul 是乘算键，与陈的 bond:lungmen:chen 各自独立相乘，叠在所有人身上（含陈）。
    const dmgAll = tier >= 2 ? (num(bb.dmg6_base, 15) + num(bb.dmg6_per_layer, 0.3) * lv) / 100 : 0;

    for (const u of members) {
      // 每秒回血（hpRegen 是属性加法，不是治疗 —— 不受治疗加成/禁疗影响）
      if (regen > 0) S.passiveBuff(battle, u, 'bond:lungmen:regen', { hpRegen: regen });
      // 6 人档全体龙门干员造成伤害提升（乘算键，与陈自身加成相乘叠加）
      if (dmgAll > 0) S.passiveBuff(battle, u, 'bond:lungmen:damage6', { dmgDealtMul: 1 + dmgAll });

      // ---- 强化（诗怀雅【天选明星】= 玩家自选，其余 = 随机）----
      if (enhance) {
        const full = enhance.enhanced.has(u.uid);
        const part = enhance.extra.has(u.uid) ? enhance.ratio : 0;
        const p = enhancePct(enhance.kind, lv);
        if (full) installEnhance(battle, u, enhance.kind, p, 'full', chosen);
        else if (part > 0) installEnhance(battle, u, enhance.kind, p * part, 'part', chosen);
      }

      const r = rosterOfUnit(u);
      if (!r) continue;
      const k = S.isElite(u) ? 2 : 1; // 精锐加成翻倍
      if (r.key === 'chen') {
        const p = Math.min(0.9, per3('warriorShip') * num(bb.chen_dmg_pct, 0.01) * k);
        if (p > 0) S.passiveBuff(battle, u, 'bond:lungmen:chen', { dmgDealtMul: 1 + p });
      } else if (r.key === 'chen3') {
        const p = per3('warriorShip') * num(bb.chen3_atk_pct, 0.01) * k;
        if (p > 0) S.passiveBuff(battle, u, 'bond:lungmen:chen3', S.directMods({ atk: p }));
      } else if (r.key === 'mou') {
        const p = per3('tankShip') * num(bb.mou_hp_pct, 0.01) * k;
        if (p > 0) S.passiveBuff(battle, u, 'bond:lungmen:mou', S.directMods({ hp: p }));
      } else if (r.key === 'a') {
        // 身前一格干员防御力+2（每3层）：作用于当前身前的干员
        if (!S.onField(u)) continue;
        const [fr, fc] = S.frontTile(u);
        const f = S.allyAt(battle, fr, fc);
        if (f && S.isOp(f)) {
          const flat = per3('specialShip') * num(bb.a_def_flat, 2) * k;
          if (flat > 0) S.passiveBuff(battle, f, 'bond:lungmen:a', { defFlat: flat });
        }
      }
    }
  };
  apply();
  onLayers(battle, pid, apply);
}

export function install(battle) {
  if (!battle || !Array.isArray(battle.players)) return;
  for (const p of battle.players) {
    const pid = p.playerId;
    if (!p.bonds || typeof p.bonds !== 'object') continue;
    if (!S.bondActive(battle, pid, LUNGMEN_BOND)) continue;
    const bb = bbOf();
    if (!bb) continue;
    const members = S.bondMembers(battle, pid, LUNGMEN_BOND);
    if (!members.length) continue;
    installLungmen(battle, pid, bb, members);
  }
  // 开局提示（用户 2026-10-14「开局提示本局龙门强化干员」）：把本场随机到的强化干员名字挂到 battle 上，
  // 由 match/combat.js 在开战时 toast 给玩家。放在这里而不是 installLungmen 里，是因为那边拿不到 m/toast。
  publishEnhanceHint(battle);
}

/** battle._lungmenEnhanceHint: pid → 本场被完整强化的干员名（供开局提示）。 */
export const ENHANCE_HINT_KEY = 'lungmenEnhanceHint';

/**
 * 汇总本场每位玩家的强化结果，写入 `battle[ENHANCE_HINT_KEY]`（pid → { name, kind }）。
 * 只有真正抽到强化（`rollEnhance` 返回非 null）的玩家才有条目 —— 没带龙门 / 没强化候选就不提示。
 */
function publishEnhanceHint(battle) {
  const out = {};
  for (const p of battle.players) {
    const pid = p.playerId;
    if (!S.bondActive(battle, pid, LUNGMEN_BOND)) continue;
    const members = S.bondMembers(battle, pid, LUNGMEN_BOND);
    if (!members.length) continue;
    const enhance = rollEnhance(battle, pid, members, S.bondLayers(battle, pid, LUNGMEN_BOND), S.bondTier(battle, pid, LUNGMEN_BOND), grantedOps(battle, pid));
    if (!enhance || !enhance.primary) continue;
    const u = enhance.primary;
    const name = (u.def && u.def.name) || (u.defId || '');
    if (name) out[pid] = { name, kind: enhance.kind };
  }
  if (Object.keys(out).length) battle[ENHANCE_HINT_KEY] = out;
  else delete battle[ENHANCE_HINT_KEY];
}

// ==============================================================================================================
// prep side
//
// 特质全部走 garrison（garrison_lm_*_g_*，chess.garrisonIds 接线）：
//   获得时类 = 通用 effectKey（SERVER_ADD_BOND / SERVER_ADD_MULTIPLE_BOND，派发器自带 投资人 repeat）；
//   休整期类 = 自定义 effectKey（USLM_PREP_GAIN_RANDOM/TOP/COUNT，下方注册）；
//   战斗侧特质 = 展示条目（USLM_BATTLE_DISPLAY 不注册 → 派发 no-op，效果在 install()）。
// 盟约 meta 无需注册（龙门无盟约级 prep 效果）。

// 干员数值一律取自该干员自己的 garrison（garrison_lm_*_g_*），不再在本文件里硬编码一份 GAIN_MAP。
// 用户 2026-10-14 裁定：本文件曾有的 GAIN_MAP（anlock/axue/shitie/hoshiguma/hsgma2/laoli）与干员真实数据全部不符：
//   暗索 3/3 → 实际 lungmenShip,specialShip = 2,2；阿消 3(龙门) → 实际 specialShip 3（无龙门）；
//   食铁兽 6(龙门) → 实际 specialShip 4（无龙门）；星熊 15 → 实际 bb.count = 12；
//   斩业星熊 24 → 实际 lungmenShip,tankShip = 20,20；老鲤 20 → 实际 lungmenShip,specialShip = 16,16。
// 现在统一走 ctx.triggerGarrisons（见 fireGain），各干员的 bb / bbStr 说了算。

const recOf = (ctx, p) => ctx.chessRecord(p.id);

const hasGainGarrison = (ctx, p) => {
  const rec = recOf(ctx, p);
  const ids = rec && Array.isArray(rec.garrisonIds) ? rec.garrisonIds : [];
  return ids.some((gid) => { const g = ctx.gd.garrison(gid); return g && g.eventType === 'SERVER_GAIN'; });
};

/**
 * 该干员 SERVER_GAIN garrison 能给出的最大层数（琳琅诗怀雅据此挑「叠层数量最多」的那一个）。
 *
 * 两种写法都要读：bb.count（单盟约，如 食铁兽 bb={count:4}、星熊 bb={count:12}）
 * 与 bbStr.count（多盟约 CSV，如 暗索 "2,2"）—— CS 里数字常以**字符串**存（"3"、"20,20"），
 * 所以这里不能走本文件的 num()（它只认 number 类型，见到字符串一律返回默认值 0），必须自己 +v。
 */
const gainScore = (ctx, p) => {
  const rec = recOf(ctx, p);
  let score = 0;
  for (const gid of (rec && Array.isArray(rec.garrisonIds) ? rec.garrisonIds : [])) {
    const g = ctx.gd.garrison(gid);
    if (!g || g.eventType !== 'SERVER_GAIN') continue;
    const vals = [];
    for (const v of Object.values(g.bb || {})) vals.push(v);
    for (const v of Object.values(g.bbStr || {})) vals.push(v);
    for (const raw of vals) {
      for (const piece of String(raw ?? '').split(',')) {
        const t = piece.trim();
        if (t === '') continue;
        const n = +t;                                   // 字符串数字也要认
        if (Number.isFinite(n) && n > 0 && n <= 999) score = Math.max(score, n);
      }
    }
  }
  return score;
};

/**
 * 「获得时干员」判定：任意带 SERVER_GAIN 特质的干员（含龙门六人，他们的 numeric 来自自己的 garrison）。
 *
 * score 决定琳琅诗怀雅挑谁（「叠层数量最多的获得时特质」）：取该干员所有 SERVER_GAIN garrison 里
 * 最大的那个层数。bbStr.count 是逗号分隔的多盟约写法（"2,2" / "20,20" / "16,16"），bb.count 是单盟约写法，
 * 两种都要读，否则暗索/斩业星熊/老鲤/阿消会算成 0 而永远选不中。
 */
const gainValueOf = (ctx, p) => (hasGainGarrison(ctx, p) ? { r: null, score: gainScore(ctx, p) } : null);

const gainCandidates = (ctx) => {
  const out = [];
  for (const p of ctx.board()) {
    if (!p || p.kind !== 'chess') continue;
    const info = gainValueOf(ctx, p);
    if (info) out.push({ p, info });
  }
  return out;
};

/**
 * 对一名获得时干员触发其效果 —— 一律走引擎的 ctx.triggerGarrisons，用该干员自己的 garrison 数据。
 *
 * 为什么不再自己发层：本文件原先对龙门六人走一条硬编码分支（读 bonds.json 的 lungmenShip.bb.gain_*），
 * 那条分支的六个数值与干员真实 garrison 全部不符（见上方注释），而且它对阿消/食铁兽多发了一份龙门层数、
 * 对星熊少发了 3 层。走 triggerGarrisons 后「数值由干员数据说了算」，将来改 data 即生效。
 *
 * @param selfK 触发者（诗怀雅/琳琅诗怀雅）自身的翻倍系数——她为精锐(_b)时 = 2（「精锐加成翻倍」）。
 *   目标干员自身为精锐时也 ×2（官方口径）——那一份由 garrison 的 _a/_b 记录天然给出，两者叠加。
 */
function fireGain(ctx, piece, info, selfK = 1) {
  void info;
  if (typeof ctx.triggerGarrisons !== 'function') return;
  for (let i = 0; i < Math.max(1, selfK); i++) ctx.triggerGarrisons(piece.uid, 'SERVER_GAIN');
}

/** 触发者自身（ctx.source.piece）为精锐(_b)时 = 2。 */
const selfKOf = (ctx) => {
  const p = ctx.source && ctx.source.piece;
  return p && ctx.gd.isGolden(p.id) ? 2 : 1;
};

// —— 休整期结束特质（garrison：garrison_lm_{swire,linlangswire,lin}_g_*，USLM_PREP_*；每副本各触发一次）——

/** 诗怀雅 <休整期结束时>随机触发场上一个获得时特质（自身精锐 → 效果翻倍）。 */
const USLM_PREP_GAIN_RANDOM = {
  run(ctx) {
    if (!ctx.bondActive(LUNGMEN_BOND)) return;
    const cands = gainCandidates(ctx);
    if (!cands.length) return;
    const pick = cands[Math.floor(ctx.rng() * cands.length) % cands.length];
    fireGain(ctx, pick.p, pick.info, selfKOf(ctx));
  },
};

/** 琳琅诗怀雅 <休整期结束时>触发叠层数量最多的获得时特质1次（数值最大者；自身精锐 → 效果翻倍）。 */
const USLM_PREP_GAIN_TOP = {
  run(ctx) {
    if (!ctx.bondActive(LUNGMEN_BOND)) return;
    const cands = gainCandidates(ctx);
    if (!cands.length) return;
    const best = cands.reduce((a, b) => (b.info.score > a.info.score ? b : a), cands[0]);
    fireGain(ctx, best.p, best.info, selfKOf(ctx));
  },
};

/** 林 <休整期结束时>场上每有一个获得时干员：龙门与术师层数+per（_b bb=12 精锐翻倍）。 */
const USLM_PREP_GAIN_COUNT = {
  run(ctx) {
    if (!ctx.bondActive(LUNGMEN_BOND)) return;
    const { bb, bbStr } = ctx.source;
    const n = gainCandidates(ctx).length;
    if (!(n > 0)) return;
    const per = Math.floor(num(bb?.per, 6));
    if (!(per > 0)) return;
    ctx.addLayers(bbStr?.bond || LUNGMEN_BOND, per * n, { requireActive: false, reason: 'garrison:lm_gain_count' });
    if (bbStr?.profBond) ctx.addLayers(bbStr.profBond, per * n, { requireActive: false, reason: 'garrison:lm_gain_count' });
  },
};

export function registerMeta(registry) {
  registry.garrison('USLM_PREP_GAIN_RANDOM', USLM_PREP_GAIN_RANDOM);
  registry.garrison('USLM_PREP_GAIN_TOP', USLM_PREP_GAIN_TOP);
  registry.garrison('USLM_PREP_GAIN_COUNT', USLM_PREP_GAIN_COUNT);
  registry.bond(LUNGMEN_BOND, lungmenBond);
}

// =====================================================================================================================
// 盟约级：激活后**发一名干员**（用户 2026-10-14）

/**
 * 地图文本「<在场6名不同【龙门】干员>随机获得上述一位非强化干员」原先没有任何发放调用 —— 这就是「龙门不发干员」。
 *
 * 用户 2026-10-14 二次裁定：**这是两个互相独立的奖励，各自整局一次**：
 *   ① 在场 6 名不同【龙门】干员 → 随机获得一名「非强化干员」（普通版 `_a`）。
 *   ② 【龙门】层数达到 300 层        → 随机获得一名「强化干员」（精锐版 `_b`）。
 * 原实现把 ① ② 误写成「6 名 **且** 300 层」才发一次，于是「在场 6 龙门却什么也不发」。
 *
 * 两名候选都从「炽刃明霄陈 / 琳琅诗怀雅 / 斩业星熊 / 林」里随机挑一名**尚未拥有**的（baseId 判，_a/_b 通吃）；
 * 四名全部拥有时该奖励记为空账、不再反复尝试（计数器已记）。
 *
 * 用 onPrepStart 而不是别的钩子：龙门是地图文本里的「获得」语义，而 grantChess 只在休整期真正兑现
 * （与巴别塔「6 人档立刻获得维什戴尔」babelMeta.grantImmediateTier 同一手法同一时机）。
 * 注意它每次进入休整期只派发一次 —— 在本期中途才凑齐 6 龙门要等下一个休整期。
 */
const LUNGMEN_GRANT_COUNTER = 'lungmen:grantOp';          // ① 6 名在场 → 非强化干员（_a）
const LUNGMEN_GRANT_GOLD_COUNTER = 'lungmen:grantGoldOp'; // ② 300 层    → 强化干员（_b）
const LUNGMEN_GRANT_LAYERS_FALLBACK = 300;

/** 四名候选的 chessId（普通版；强化版走 ctx.grantChess 的 golden:true → goldenIdOf → _b）。 */
const GRANT_CANDIDATES = Object.freeze(['chess_chen3_a', 'chess_char_3_04_a', 'chess_lm_hsgma2_a', 'chess_lm_lin_a']);

/** ② 的层数门槛：优先读 data/bonds.json lungmenShip.bb.enhance_unlock_layers（缺/非正数则回退 300）。 */
function grantUnlockLayers() {
  const bb = bbOf() || {};
  const n = num(bb.enhance_unlock_layers, LUNGMEN_GRANT_LAYERS_FALLBACK);
  return n > 0 ? n : LUNGMEN_GRANT_LAYERS_FALLBACK;
}

/** 玩家是否已拥有该干员（含精锐副本、含备战席与手上、含装备在某干员身上的 —— 与引擎「已拥有」口径一致）。 */
function ownsChessAnywhere(ctx, baseId) {
  const seen = (p) => p && p.kind === 'chess' && ctx.gd.baseIdOf(p.id) === baseId;
  for (const p of ctx.board()) if (seen(p)) return true;
  for (const p of ctx.hand()) if (seen(p)) return true;
  for (const p of ctx.temp()) if (seen(p)) return true;
  return false;
}

/** 当前在场的不同【龙门】干员数量（规格「在场6名不同【龙门】干员」= 6 龙门激活）。 */
function lungmenOnFieldDistinct(ctx) {
  const seen = new Set();
  for (const p of ctx.board()) {
    if (!p || p.kind !== 'chess') continue;
    const base = ctx.gd.baseIdOf(p.id);
    if (lungmenRosterOf(base)) seen.add(base);
  }
  return seen.size;
}

/** 从四名候选中随机挑一名「尚未拥有」的（baseId 判，含精锐副本 / 手上 / 备战席 / 挂在别人身上）；都已有则 null。 */
function pickUnownedCandidate(ctx) {
  const pool = GRANT_CANDIDATES.filter((id) => ctx.gd.chess(id) && !ownsChessAnywhere(ctx, ctx.gd.baseIdOf(id)));
  if (!pool.length) return null;
  return pool[Math.floor(ctx.rng() * pool.length) % pool.length];
}

/** 本局盟约奖励「获得」的干员登记表（ps.counters 里的 JSON 字符串）：{ partial: [uid…], full: [uid…] }。 */
const LUNGMEN_GRANTED_KEY = 'lungmen:grantedOps';

/** 把发出去的干员 uid 记进登记表（战斗侧据此在它上场时叠加强化）。 */
function recordGranted(ctx, uid, mode) {
  if (!Number.isInteger(uid)) return;
  let rec = {};
  try { rec = JSON.parse(ctx.counterText(LUNGMEN_GRANTED_KEY) || '{}') || {}; } catch { rec = {}; }
  const arr = Array.isArray(rec[mode]) ? rec[mode] : [];
  if (!arr.includes(uid)) arr.push(uid);
  rec[mode] = arr;
  ctx.setCounterText(LUNGMEN_GRANTED_KEY, JSON.stringify(rec));
}

/**
 * 发一名候选，整局一次。
 *
 * 「强化 / 非强化」说的是**龙门盟约那个随机强化**（不是精锐 `_b`）：发出的干员下场战斗上场时，
 * 会在战斗侧额外叠加强化 —— ① 的干员吃 (25+层数×0.1)% 的部分效果，② 的干员吃完整效果。
 * 登记表写进 `ps.counters`，战斗侧经 battle player 的 `counters` 克隆读回
 * （player/round.js 构造 battle input 时 `counters: { ...this.counters }`，players.js 再 clone 一次）。
 *
 * **非休整期的发放（用户 2026-10-16「激活了就立刻送」）**：现在判据挂在 onLayers（战斗结算时），
 * 而 ctx.grantChess 在非休整期会把整笔**排队**到下个休整期并返回 null（effectsMeta.js grantChess）。
 * 旧写法 `if (!got) return false;` 会把「已排队」误判成发放失败 —— 而记账已经写过了，
 * 于是这一档被永久烧掉，界面上什么都不送。用 deferredCount() 的前后差把「排队成功」也算进去。
 *
 * @param {string} counterKey 该奖励自己的记账键（① 与 ② 各一个）
 * @param {'partial'|'full'} enhanceMode 发出的干员在战斗中叠加的强化档
 * @param {string} sourceSuffix 加在赠予 source 后面的后缀（便于日志区分两个奖励）
 * @returns {boolean} 是否真的发出了干员（或已排队）
 */
function grantCandidate(ctx, counterKey, enhanceMode, sourceSuffix) {
  if (ctx.counter(counterKey)) return false;             // 整局一次
  const pick = pickUnownedCandidate(ctx);
  ctx.setCounter(counterKey, 1);                         // 先记账：发放失败（四名都已有 / 不可发放）也不反复尝试
  if (!pick) return false;
  try {
    // requirePool: false —— 盟约奖励是「赠送」，不因该干员在共享卡池里没货而拿不到
    const before = ctx.deferredCount?.() ?? 0;
    // enhanceMode 走 opts 传下去：非休整期时 grantChess 整笔排队（返回 null），要等 flushDeferredGrants 兑现时
    // 才有真实 uid 去写 LUNGMEN_GRANTED_KEY —— 兑现侧 player/round.js 按这个字段回填。
    const got = ctx.grantChess(pick, { requirePool: false, source: `bond:${LUNGMEN_BOND}${sourceSuffix}`, lungmenEnhanceMode: enhanceMode });
    const queued = !got && (ctx.deferredCount?.() ?? 0) > before;
    if (!got && !queued) return false;
    // 即时兑现的那笔现在就有 uid，直接登记
    if (got) recordGranted(ctx, got.uid, enhanceMode);
    const rec = ctx.gd.chess(got?.id) || ctx.gd.chess(pick);
    const name = (rec && rec.name) || pick;
    ctx.toast?.(msg('{who}：{name} 已加入', { who: ctx.gd.bond(LUNGMEN_BOND)?.name || '龙门', name }), 'success');
    return true;
  } catch { return false; /* 不可发放不阻断结算 */ }
}

/**
 * 发放判定（onLayers 与 onPrepStart 共用）：两条奖励各自整局一次。
 * 用户 2026-10-16「6 龙门为什么不送干员，激活了就立刻送」——原先只在 onPrepStart 检查，
 * 而休整期才跑一次，于是「在场凑齐 6 龙门」当场什么都不发，必须等下个休整期。
 * 现在改为**层数一变就检查**（settle.js 每次层数变化都 dispatch onLayers），激活即刻送达；
 * onPrepStart 保留，作为「开局就已满足条件」的兜底（同一记账键，不会重复发）。
 */
function checkGrants(ctx) {
  if (!ctx.bondActive(LUNGMEN_BOND)) return;
  // ① 在场 6 名不同【龙门】干员 → 随机获得「上述一位非强化干员」（上场后吃 (25+层数×0.1)% 的部分强化）
  if (lungmenOnFieldDistinct(ctx) >= 6) grantCandidate(ctx, LUNGMEN_GRANT_COUNTER, 'partial', '');
  // ② 【龙门】层数达到 300 层 → 随机获得「随机强化的干员」（上场后吃完整强化）；与 ① 互不依赖
  if (ctx.layers(LUNGMEN_BOND) >= grantUnlockLayers()) grantCandidate(ctx, LUNGMEN_GRANT_GOLD_COUNTER, 'full', ':gold');
}

const lungmenBond = {
  /** 层数一变就检查 → 「激活了就立刻送」 */
  onLayers(ctx, ev) {
    // 只关心本盟约的层数变化（settle.js 对每个盟约都派发一次）
    if (ev && ev.bondId && ev.bondId !== LUNGMEN_BOND) return;
    checkGrants(ctx);
  },
  onPrepStart(ctx) {
    checkGrants(ctx);
  },
};
