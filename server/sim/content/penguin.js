// server/sim/content/penguin.js — 企鹅物流 (penguinShip) —— 本 fork 第五个扩展阵营（用户 2026-10-10 规格）。
//
//   2人  首次激活随机获得两件一阶/二阶装备；每叠25层随机获得一件不超过当前等级的装备
//        （2026-10-15 用户：20 层 → **25 层**，数据在 bb.milestone_layer）；
//        携带装备的【企鹅物流】干员攻击力 +(10+层数×0.4)%（携带精锐装备时翻倍，用户 2026-10-11）
//   5人  进入休整期时，**携带至少一件精锐装备**的【企鹅物流】干员每人使下回合资金 +1
//        （每名干员最多 +1、带多件不叠加，总数最多 3 —— bb.elite_fund / bb.elite_fund_cap；用户 2026-10-16：原 +2/每名+2 → +1）
//   8人  携带精锐装备的【企鹅物流】干员攻击力加成翻倍（base/per_layer 的攻击力提升 ×carrier_atk_elite_mul，仅第 3 档生效）
//        （原 8 人档的「精锐造成伤害提升」已废除 —— 用户 2026-10-16）
//   档位（2026-10-15 用户：2/4/6 → **2/5/8**）：首次激活 2 人、给钱 5 人、伤害 8 人 —— data/bonds.json 的 thresholds
//   干员特质（备戡侧走盟约 meta 钩，战斗侧走 install；用户 2026-10-11 规格，精锐数值翻倍）：
//     德克萨斯     <获得时>攻击力和防御力+10%（战斗侧 garrison_pg_texas_stat_* 的 GAIN_BUFF：获得即永久，等价常驻）
//     能天使       <战斗中>攻击造成弱点伤害（act1autochess_gar_eff_chaos）；
//                  自身每携带一件装备 攻击速度+10、精锐装备+20（精锐干员 +20 / 精锐装备 +40）
//                  ——USPG_EXUSIAI_ITEM_ASPD（2026-10-13 用户规格，原「休整期→层数」版已废除）
//     莫斯提马     <休整期结束时>自身每携带一件装备：企鹅物流+术师 层数+6、精锐+12、没装备+4（≤48）
//                  ——USPG_PREP_PER_ITEM_LAYERS（2026-10-13 用户规格，替换原「+4/+8 在场队伍」版）
//     拜松         <休整期结束时>自身每携带一件装备：企鹅物流+重装 层数+2；精锐 +4；没装备 +1（最多+8）
//                  —— USPG_PREP_PER_ITEM_LAYERS
//     空           同拜松口径：+3 / 精锐+6 / 没装备+1（最多+12）
//     菲亚梅塔     <战斗中>若任意能天使（能天使或新约能天使）在场，自身每携带一件装备，使能天使们
//                  视为携带一件装备；每携带一件精锐装备，使能天使们视为携带一件精锐装备
//                  —— USPG_PHENXI_VIRTUAL_EQUIP（2026-10-13 用户规格，原「休整期结束时」版已改为战斗中）
//     蕾缪安       <战斗中>自身每携带一件装备，每次开启技能使已激活的【企鹅物流】和【狙击】层数+6，
//                  精锐装备+12（每回合最多+48）—— USPG_LEMUEN_SKILL_LAYERS
//     缄默德克萨斯 本干员每携带一件精锐装备，视为给所有【企鹅物流】干员携带一件装备
//                  （精锐版：视为携带一件精锐装备）—— carryViewOf 的虚拟携带，所有"携带/精锐装备"计数都吃
//     新约能天使   【企鹅物流】与【特种】每叠加3层，攻击力和弹药量+1%；在场的企鹅物流干员携带 ≥12 件精锐
//                  装备（含缄默德克萨斯视为携带的）时，所有【企鹅物流】干员获得本加成的50%
//
// 数值全部在 data/bonds.json penguinShip.bb（penguin_covenant）；花名册/判定见 shared/penguinLungmen.js。
// 层数引擎：企鹅物流层数来自盟约自身（获得干员等，meta 端 addLayers），战斗端只读。
import * as S from './support/index.js';
import { weaknessType } from './garrisons/battle.js';
import { PENGUIN_BOND, PENGUIN_BB_KEY, penguinRosterOf } from '../../../shared/penguinLungmen.js';
import { msg } from '../../../shared/i18n.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function bondBb() {
  return S.buffParams(S.bondRecord(PENGUIN_BOND), PENGUIN_BB_KEY);
}

/** 常驻加成在层数变化后下一 tick 重算（bonds/core.js onLayers 同款）。 */
function onLayers(battle, pid, fn) {
  const st = S.battleStore(battle, 'penguin:refresh', () => ({ map: new Map(), hooked: false }));
  if (!st.map.has(pid)) st.map.set(pid, []);
  st.map.get(pid).push(fn);
  if (st.hooked) return;
  st.hooked = true;
  battle.on('layerGain', (c) => {
    if (!st.map.has(c.playerId)) return;
    battle.after(0, () => { for (const f of st.map.get(c.playerId)) f(); });
  }, { priority: -100 });
}

const rosterOfUnit = (u) => {
  const id = u && u.def ? (u.def.baseId ?? u.def.id) : u?.defId;
  return penguinRosterOf(id);
};

// ---- 缄默德克萨斯的虚拟携带（用户 2026-10-11） --------------------------------------------------------------------------------
// 每携带一件精锐装备视为给所有【企鹅物流】干员携带一件装备（精锐版视为精锐装备）。所有"携带装备 / 精锐装备"
// 的计数（盟约常驻加成、4人档资金、能天使的在场计数、新约的 12 件精锐条件）统一走 carryOf / carryViewOf。

const isEliteItemId = (id) => S.isGoldenId(id);
/** 「能天使」的两种形态（能天使 / 新约能天使）—— 菲亚梅塔的虚拟携带只给这两位。 */
const EXUSIAI_KEYS = new Set(['exusiai', 'ncovenant']);
const NCov_ELITE_REQ = 12;      // 新约能天使的扩散条件：在场的企鹅物流干员携带 ≥12 件精锐装备
/**
 * 扩散比例（用户 2026-10-13 规格）：普通档 **60%**、精锐档 **100%**。
 * 取值优先读 bonds.json 的 `ncovenant_spread` / `ncovenant_spread_elite`，缺省回落到这里的常量。
 */
const SPREAD_RATIO = 0.6;
const SPREAD_RATIO_ELITE = 1.0;

/** 在场的（战斗侧）缄默德克萨斯们贡献的虚拟装备：count = 普通虚拟件数，elite = 其中按精锐计的件数。 */
function omertosaGrantBattle(battle, members) {
  let count = 0, elite = 0;
  for (const om of members) {
    const r = rosterOfUnit(om);
    if (!r || r.key !== 'omertosa' || !S.onField(om)) continue;
    const elites = S.itemsOf(om).filter((id) => isEliteItemId(id)).length;
    if (!(elites > 0)) continue;
    count += elites;
    if (!!(om.def && S.isGoldenId(om.def.id))) elite += elites;
  }
  return { count, elite };
}

/** 一个战斗单位"视为携带"的装备：{ count, elite }（自身是缄默德克萨斯时不吃自己的虚拟授予，避免重复计）。 */
function carryOf(battle, u, grant) {
  const items = S.itemsOf(u);
  const r = rosterOfUnit(u);
  const selfOm = !!(r && r.key === 'omertosa');
  // 菲亚梅塔的虚拟授予：只给能天使（能天使 / 新约能天使）
  const px = r && EXUSIAI_KEYS.has(r.key) ? phenxiVirtualOf(battle, u) : null;
  return {
    count: items.length + (selfOm ? 0 : grant.count) + (px ? px.count : 0),
    elite: items.filter((id) => isEliteItemId(id)).length + (selfOm ? 0 : grant.elite) + (px ? px.elite : 0),
  };
}

function installPenguin(battle, pid, bb, members) {
  const memberSet = new Set(members);
  const ncovStep = () => Math.max(1, Math.floor(num(bb.ncovenant_step, 3)));
  // 新约能天使的基础加成（%）：企鹅物流+特种 合计层 / step（精锐版 ×2）
  const ncovBase = (golden) => {
    const L = S.bondLayers(battle, pid, PENGUIN_BOND) + S.bondLayers(battle, pid, 'specialShip');
    return Math.floor(L / ncovStep()) * num(bb.ncovenant_pct, 0.01) * (golden ? 2 : 1);
  };
  // 扩散条件：在场的企鹅物流干员携带 ≥12 件精锐装备（含缄默德克萨斯 / 菲亚梅塔视为携带的）
  const spreadOn = (grant) => {
    let eliteSum = 0;
    for (const u of members) if (S.onField(u)) eliteSum += carryOf(battle, u, grant).elite;
    return eliteSum >= NCov_ELITE_REQ;
  };
  // 扩散比例：普通 60% / 精锐 100%（用户 2026-10-13）；优先读数据里的显式值
  const spreadRatio = (golden) => (golden
    ? num(bb.ncovenant_spread_elite, SPREAD_RATIO_ELITE)
    : num(bb.ncovenant_spread, SPREAD_RATIO));
  const apply = () => {
    const L = S.bondLayers(battle, pid, PENGUIN_BOND);
    const atk = num(bb.carrier_atk_base) + num(bb.carrier_atk_per_layer) * L;
    const grant = omertosaGrantBattle(battle, members);
    const spread = spreadOn(grant);
    for (const u of members) {
      const carry = carryOf(battle, u, grant);
      const r = rosterOfUnit(u);
      const golden = !!(u.def && S.isGoldenId(u.def.id));
      // 携带（含视为携带）精锐装备的干员：攻击力加成翻倍（用户 2026-10-11）。
      // 翻倍**只在第 3 档（8 人）**生效 —— bb.carrier_atk_elite_tier（默认 3 = 第 3 档）。
      // 低档位不再翻倍；原 8 人口档的「精锐造成伤害提升」（elite_dmg_base/per_layer）已废除（用户 2026-10-16）。
      const eliteTier = Math.max(0, Math.floor(num(bb.carrier_atk_elite_tier, 3)));
      const atkThis = (carry.elite > 0 && S.bondTier(battle, pid, PENGUIN_BOND) >= eliteTier)
        ? atk * num(bb.carrier_atk_elite_mul, 2)
        : atk;
      if (carry.count > 0 && atkThis > 0) S.passiveBuff(battle, u, 'bond:penguin', S.directMods({ atk: atkThis }));
      // 新约能天使：每 step 层（企鹅物流+特种）→ 攻击力 +1%（普通）/ +2%（精锐）；弹药在 skillStart 现算。
      // 条件满足时其余【企鹅物流】干员获得其加成的 60%（普通档）—— 用户 2026-10-13。
      if (r && r.key === 'ncovenant') {
        const pct = ncovBase(golden);
        if (pct > 0) S.passiveBuff(battle, u, 'bond:penguin:ncov', S.directMods({ atk: pct }));
      } else if (spread && ncovBase(false) > 0) {
        S.passiveBuff(battle, u, 'bond:penguin:ncov:spread', S.directMods({ atk: ncovBase(false) * spreadRatio(false) }));
      }
    }
  };
  apply();
  onLayers(battle, pid, apply);
  // 弹药量：技能开启时按当时层数放大 —— 新约能天使全额，其余【企鹅物流】干员在扩散条件下按 60%
  battle.on('skillStart', ({ unit, skill }) => {
    if (!memberSet.has(unit) || !skill || skill.kind !== 'ammo' || !(skill.ammoLeft > 0)) return;
    const r = rosterOfUnit(unit);
    if (!r) return;
    const golden = !!(unit.def && S.isGoldenId(unit.def.id));
    let pct = 0;
    if (r.key === 'ncovenant') pct = ncovBase(golden);
    else {
      const grant = omertosaGrantBattle(battle, members);
      if (spreadOn(grant)) pct = ncovBase(false) * spreadRatio(false);
    }
    if (!(pct > 0)) return;
    const n = Math.floor(skill.ammoLeft * (1 + pct) + 1e-9);
    if (Number.isFinite(n) && n > skill.ammoLeft) skill.ammoLeft = n;
  }, { priority: -10 });
}

export function install(battle) {
  if (!battle || !Array.isArray(battle.players)) return;
  // 个人特质（IN_BATTLE），与盟约是否激活无关：先装它们
  installLemuen(battle);
  installExusiaiAspd(battle);
  installPhenxiVirtualEquip(battle);
  for (const p of battle.players) {
    const pid = p.playerId;
    if (!p.bonds || typeof p.bonds !== 'object') continue;
    if (!S.bondActive(battle, pid, PENGUIN_BOND)) continue;
    const bb = bondBb();
    if (!bb) continue;
    const members = S.bondMembers(battle, pid, PENGUIN_BOND);
    if (!members.length) continue;
    installPenguin(battle, pid, bb, members);
  }
}

// ==============================================================================================================
// 雷缪安（2026-10-13 用户规格）—— IN_BATTLE 特质 USPG_LEMUEN_SKILL_LAYERS
//
// 「自身每携带一件装备，每次开启技能使已激活的【企鹅物流】和【狙击】层数+6，若每携带一件精锐装备则+10
//   （每回合最多+40）；精锐：+12 / +20 / 每回合最多+80」
// 装在雷缪安身上的装备计入：普通件 × per_item，精锐件 × per_elite_item（精锐件按"精英档"数，与普通件可叠加计数）。
// 上限是**每回合**的，所以用 `penguin:lemuen:<unitId>:<round>` 计数键，而不是引擎的每场战斗上限。
const LEMUEN_BONDS = [PENGUIN_BOND, 'sniperShip'];

/** 该战斗单位的某个 effectKey 的 IN_BATTLE garrison 记录。 */
function garrisonTraitFor(unit, effectKey) {
  const list = unit?.def?.raw?.garrisonIds ?? unit?.def?.garrisonIds;
  if (!Array.isArray(list)) return null;
  for (const gid of list) {
    const g = S.garrisonRecord(gid);
    if (g && g.effectKey === effectKey) return g;
  }
  return null;
}

/**
 * 雷缪安「每次开启技能使已激活的【企鹅物流】和【狙击】层数+N」的战斗侧安装。
 * 由 install() 扫描战场上的干员，给带 USPG_LEMUEN_SKILL_LAYERS 的挂 skillStart 钩子。
 */
function installLemuen(battle) {
  if (!battle || !Array.isArray(battle.allyUnits)) return;
  const carriers = [];
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    const trait = garrisonTraitFor(u, 'USPG_LEMUEN_SKILL_LAYERS');
    if (trait) carriers.push({ unit: u, trait });
  }
  if (!carriers.length) return;
  const used = S.battleStore(battle, 'penguin:lemuenUsed', () => new Map());
  for (const { unit, trait } of carriers) {
    battle.on('skillStart', (c) => {
      if (c.unit !== unit || !S.onField(unit)) return;
      const items = S.itemsOf(unit);
      const elite = items.filter((id) => isEliteItemId(id)).length;
      const normal = items.length - elite;
      const add = Math.floor(normal * num(trait.bb?.per_item, 6) + elite * num(trait.bb?.per_elite_item, 10));
      if (!(add > 0)) return;
      // 「每回合最多+N」—— 键里带回合号，跨回合自动归零
      const cap = Math.max(0, Math.floor(num(trait.bb?.cap, 40)));
      const key = `${unit.id}:${battle.round ?? 0}`;
      const spent = used.get(key) ?? 0;
      const n = Math.min(add, cap - spent);
      if (!(n > 0)) return;
      const got = S.gainLayers(battle, {
        playerId: unit.ownerId, bonds: LEMUEN_BONDS, n,
        requireActive: true, source: unit, reason: 'garrison',
      });
      if (got > 0) used.set(key, spent + n);
    }, { owner: unit });
  }
}

// ==============================================================================================================
// 能天使（2026-10-13 用户规格）—— IN_BATTLE 特质 USPG_EXUSIAI_ITEM_ASPD
//
// 「<战斗中>攻击造成的伤害变为弱点伤害；自身每携带一件装备，攻击速度+10，若为精锐装备则攻击速度+20」
//   精锐干员（_b）整体翻倍：普通件 +20、精锐件 +40。
//
// 两条效果合并进**同一个** garrison 记录（用户 2026-10-13：「多余的全部删除」，能天使只留这一条）。
// 弱点伤害本来由**引擎**的 garrison 安装器按 `effectKey === 'act1autochess_gar_eff_chaos'` 处理
// （content/garrisons/battle.js 的 chaos 集合）；合并后 effectKey 变成了本条的 USPG_EXUSIAI_ITEM_ASPD，
// 引擎不再认识它，所以**弱点伤害由这里自己复刻**（bbStr.chaos 标记），口径与引擎一致：
// 命中时把 phys/arts 换成「引擎减伤后更高的那一种」，同值保持原类型。
//
// 装备在战斗开始时就已固定（prep 的棋盘被快照进战场），战斗内不会增减，所以只在安装时结算一次。
// 引擎没有 itemGain / itemRemove 事件，所以不挂那些钩子；进场 / 重装时补算一次。
function installExusiaiAspd(battle) {
  if (!battle || !Array.isArray(battle.allyUnits)) return;
  // 能天使「自身每件装备的攻速」合计（供菲亚梅塔按比例分享，见 installPhenxiAspdShare）
  const exuAspd = new Map();
  const chaosUnits = new Set();
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    const trait = garrisonTraitFor(u, 'USPG_EXUSIAI_ITEM_ASPD');
    if (!trait) continue;
    if (trait.bbStr && trait.bbStr.chaos) chaosUnits.add(u);
    const per = num(trait.bb?.atk_speed, 0);
    const perElite = num(trait.bb?.elite_atk_speed, 0);
    if (!(per > 0) && !(perElite > 0)) continue;
    const key = `gar:${trait.garrisonId}`;
    const apply = () => {
      if (!u.alive) { battle.removeBuff(u, key); return; }
      const items = S.itemsOf(u);
      const elite = items.filter((id) => isEliteItemId(id)).length;
      const normal = items.length - elite;
      const aspd = normal * per + elite * perElite;
      exuAspd.set(u, aspd);
      if (aspd > 0) S.passiveBuff(battle, u, key, { aspd });
      else battle.removeBuff(u, key);
    };
    apply();
    // 进场 / 重装后再算一次（装备可能随快照变化）
    battle.on('deploy', (c) => { if (!c || !c.unit || c.unit === u) apply(); });
  }
  installPhenxiAspdShare(battle, exuAspd);
  // 弱点伤害：与引擎 act1autochess_gar_eff_chaos 同口径（命中时改为减伤后更高的那一类）
  if (chaosUnits.size) {
    battle.on('hit', ({ source, target, dmg }) => {
      if (!source || !chaosUnits.has(source) || !target || target.side !== 'enemy' || !dmg) return;
      if (dmg.type === 'phys' || dmg.type === 'arts') dmg.type = weaknessType(source, target, dmg);
    }, { priority: -10 });
  }
}

// ==============================================================================================================
// 菲亚梅塔的攻速分享（2026-10-13 用户规格）—— 叠加在 USPG_PHENXI_VIRTUAL_EQUIP 上：
//
// 「菲亚梅塔普通 / 精锐新增，自身获得能天使提供攻速加成的 40% / 80%」
//   即：把**能天使那条装备攻速特质给出的攻速**按比例分给菲亚梅塔。
//   普通菲亚梅塔 40%、精锐菲亚梅塔 80%（数据在 bb.aspd_share / bb.aspd_share_elite）。
// 取「场上能天使里最高的那一份」—— 多名能天使在场时不叠加（各自都是同一套装备口径）。
const PHENXI_ASPD_SHARE = 0.4;
const PHENXI_ASPD_SHARE_ELITE = 0.8;

function installPhenxiAspdShare(battle, exuAspd) {
  if (!exuAspd.size) return;
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    const trait = garrisonTraitFor(u, 'USPG_PHENXI_VIRTUAL_EQUIP');
    if (!trait) continue;
    const golden = !!(u.def && S.isGoldenId(u.def.id));
    const share = num(
      golden ? trait.bb?.aspd_share_elite : trait.bb?.aspd_share,
      golden ? PHENXI_ASPD_SHARE_ELITE : PHENXI_ASPD_SHARE,
    );
    if (!(share > 0)) continue;
    const key = `gar:${trait.garrisonId}:aspd`;
    const apply = () => {
      if (!u.alive) { battle.removeBuff(u, key); return; }
      let best = 0;
      for (const [src, v] of exuAspd) {
        if (!src.alive || !S.onField(src)) continue;
        if (v > best) best = v;
      }
      const aspd = best * share;
      if (aspd > 0) S.passiveBuff(battle, u, key, { aspd });
      else battle.removeBuff(u, key);
    };
    apply();
    battle.on('deploy', (c) => { if (!c || !c.unit || c.unit === u) apply(); });
  }
}

// ==============================================================================================================
// 菲亚梅塔（2026-10-13 用户规格）—— IN_BATTLE 特质 USPG_PHENXI_VIRTUAL_EQUIP
//
// 「<战斗中>若任意能天使（能天使或新约能天使）在场，自身每携带一件装备，使能天使们视为携带一件装备；
//   每携带一件精锐装备，使能天使们视为携带精锐装备」—— 精锐：一件精锐对应两件精锐。
//
// 这条与缄默德克萨斯的虚拟授予同属"视为携带"，所以并进 carryOf 的 grant
//（盟约常驻加成、4 人档资金按真实穿戴、新约 12 件精锐扩散条件等所有口径自动一致）。
// **不改写 u.items** —— items 只存装备 id，塞假 id 会被 whenEquipped 等逻辑当真装备处理。
// 明细登记在 battleStore 的虚拟表里，由 phenxiVirtualOf 读取。

function installPhenxiVirtualEquip(battle) {
  if (!battle || !Array.isArray(battle.allyUnits)) return;
  const store = S.battleStore(battle, 'penguin:phenxiVirtual', () => ({ map: new Map() }));
  store.map.clear();
  const phenxi = [];
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    const r = rosterOfUnit(u);
    if (r && r.key === 'phenxi' && garrisonTraitFor(u, 'USPG_PHENXI_VIRTUAL_EQUIP')) phenxi.push(u);
  }
  // 「若任意能天使在场」：能天使 / 新约能天使任一在场
  const hasExusiai = battle.allyUnits.some((u) => {
    if (!S.isOp(u) || !S.onField(u)) return false;
    const r = rosterOfUnit(u);
    return !!r && EXUSIAI_KEYS.has(r.key);
  });
  if (!hasExusiai || !phenxi.length) return;

  for (const ph of phenxi) {
    if (!S.onField(ph)) continue;
    const trait = garrisonTraitFor(ph, 'USPG_PHENXI_VIRTUAL_EQUIP');
    const perItem = Math.max(0, Math.floor(num(trait.bb?.per_item, 1)));
    const perEliteItem = Math.max(0, Math.floor(num(trait.bb?.elite_per_item, 2)));
    const items = S.itemsOf(ph);
    const elite = items.filter((id) => isEliteItemId(id)).length;
    const normal = items.length - elite;
    // 普通件 → 视为携带的普通件；精锐件 → 视为携带的**精锐**件
    const addCount = normal * perItem + elite * perItem;
    const addElite = elite * perEliteItem;
    if (!(addCount > 0) && !(addElite > 0)) continue;
    for (const target of battle.allyUnits) {
      if (!S.isOp(target) || !S.onField(target)) continue;
      const r = rosterOfUnit(target);
      if (!r || !EXUSIAI_KEYS.has(r.key)) continue;
      const cur = store.map.get(target) ?? { count: 0, elite: 0 };
      store.map.set(target, { count: cur.count + addCount, elite: cur.elite + addElite });
    }
  }
}

/** 菲亚梅塔给某单位登记的虚拟携带 { count, elite }（战斗侧），无则 null。 */
function phenxiVirtualOf(battle, u) {
  const store = S.battleStore(battle, 'penguin:phenxiVirtual', () => ({ map: new Map() }));
  return store.map.get(u) ?? null;
}



/** 装备引擎：首次激活发 **1 件一阶精锐装备**（2026-10-16 用户：原「2 件一阶/二阶」改为
 *  「随机获得一件1阶精锐装备」—— bb.first_grant_cnt / first_grant_max_tier / first_grant_golden）；
 *  每 `bb.milestone_layer` 层发 1 件（≤当前商店等级）。
 *  2026-10-15 用户：20 → **25** 层（数据在 bb.milestone_layer，兜底值同口径）。 */
function payEquip(ctx) {
  if (!ctx.bondActive(PENGUIN_BOND)) return 0;
  const bb = bondBb();
  if (!bb) return 0;
  let granted = 0;
  if (!ctx.counter('penguin:first')) {
    ctx.setCounter('penguin:first', 1);
    const cnt = Math.max(0, Math.floor(num(bb.first_grant_cnt, 1)));
    const maxTier = Math.max(1, Math.floor(num(bb.first_grant_max_tier, 1)));
    // 精锐口径（id 以 `_b` 结尾）：rollItem 不支持「只抽精锐」，抽到非精锐就重试（上限 40 次兜底）。
    const wantElite = !!bb.first_grant_golden;
    for (let i = 0; i < cnt; i++) {
      let id = null;
      for (let guard = 0; guard < 40 && !id; guard++) {
        const rolled = ctx.rollItem({ maxTier });
        if (!rolled) break;
        if (!wantElite || isEliteItemId(rolled)) id = rolled;
      }
      if (id && ctx.grantItem(id, { source: 'bond:penguinShip' })) granted++;
    }
  }
  const step = Math.floor(num(bb.milestone_layer, 25));
  if (step > 0) {
    const due = Math.floor(ctx.layers(PENGUIN_BOND) / step);
    for (let guard = 0; guard < 100; guard++) {
      const paid = ctx.counter('penguin:equipMs');
      if (paid >= due) break;
      ctx.setCounter('penguin:equipMs', paid + 1);
      const id = ctx.rollItem({ maxTier: ctx.shopLevel() });
      if (id && ctx.grantItem(id, { source: 'bond:penguinShip' })) granted++;
    }
  }
  if (granted && typeof ctx.toast === 'function') ctx.toast(msg('【企鹅物流】获得{n}件装备', { n: granted }), 'info');
  return granted;
}

const penguinMemberOf = (ctx, p) => {
  if (!p || p.kind !== 'chess') return null;
  const rec = ctx.chessRecord(p.id);
  return rec && Array.isArray(rec.bonds) && rec.bonds.includes(PENGUIN_BOND) ? rec : null;
};

/** 5人档（档位 2/5/8；2026-10-16 用户：每名干员固定 +1（bb.elite_fund），不再翻倍（elite_fund_double 关掉），
 *  一回合最多 +3（bb.elite_fund_cap））：进入休整期时，**携带至少一件精锐装备**的【企鹅物流】干员
 *  每人使下回合资金 +1（带多件不叠加）。
 *  缄默德克萨斯的虚拟精锐不算资金（用户 2026-10-11 裁定）。 */
function prepStartFunds(ctx) {
  if (!ctx.bondActive(PENGUIN_BOND)) return;
  const th = S.bondRecord(PENGUIN_BOND)?.thresholds;
  if (ctx.bondCount(PENGUIN_BOND) < (Array.isArray(th) ? th[1] : 5)) return;
  const bb = bondBb();
  const per = Math.max(1, Math.floor(num(bb?.elite_fund, 1)));
  const cap = Math.max(per, Math.floor(num(bb?.elite_fund_cap, 3)));
  // 每名干员固定 +per（2026-10-16 用户：取消 elite_fund_double，不再按双件翻倍）
  let funds = 0;
  for (const p of ctx.board()) {
    if (funds >= cap) break;
    if (!penguinMemberOf(ctx, p)) continue;
    // 只看「是否携带了精锐装备」（≥1 件即计 +per，带多件不叠加）
    if ((p.items || []).some((it) => isEliteItemId(it.id))) funds += per;
  }
  if (funds > 0) ctx.addPendingFunds(Math.min(funds, cap));
}

// ---- 备战侧虚拟携带（战斗侧见 carryOf/omertosaGrantBattle） -----------------------------------------------------------

const isOmertosaPiece = (ctx, p) => {
  const r = penguinRosterOf(p.baseId || p.id);
  return !!r && r.key === 'omertosa';
};
const isPenguinPiece = (ctx, p) => {
  const uid = p && p.uid;
  return Number.isInteger(uid) && uid > 0 ? ctx.pieceBonds(uid).includes(PENGUIN_BOND) : !!(penguinRosterOf(p.baseId || p.id));
};
/** 板上缄默德克萨斯们的虚拟授予 { count, elite }（精锐版缄默德克萨斯按精锐计）。 */
function omertosaGrantBoard(ctx) {
  let count = 0, elite = 0;
  for (const p of ctx.board()) {
    if (!isPenguinPiece(ctx, p) || !isOmertosaPiece(ctx, p)) continue;
    const elites = (p.items || []).filter((it) => isEliteItemId(it.id)).length;
    if (!(elites > 0)) continue;
    count += elites;
    if (/_b$/.test(p.id)) elite += elites;
  }
  return { count, elite };
}
/** 一个备战棋子"视为携带"的装备 { count, elite }（虚拟授予只给【企鹅物流】干员；自身是缄默德克萨斯时不吃自己的）。 */
function carryViewOf(ctx, p, grant) {
  const items = p.items || [];
  const elite = items.filter((it) => isEliteItemId(it.id)).length;
  const selfOm = isOmertosaPiece(ctx, p);
  const toPenguin = !selfOm && isPenguinPiece(ctx, p) ? grant : { count: 0, elite: 0 };
  return { count: items.length + toPenguin.count, elite: elite + toPenguin.elite };
}

/** 德克萨斯 <获得时>随机获得一件不超过当前等级的装备（_b garrison bb.count=2 = 精锐翻倍）。
 *  攻击力/防御力+10% 在战斗侧（garrison_pg_texas_stat_* 的 GAIN_BUFF：获得即永久，等价常驻）。
 *  获得时特质是个人特质，不要求企鹅物流已激活（官方 requireActiveOf 惯例：描述写「已激活」才要求）——
 *  否则她刚到手牌时自己不算激活人数，特质永远不触发（2026-10-12 用户报修）。 */
const USPG_GAIN_EQUIP = {
  run(ctx) {
    const { bb } = ctx.source;
    const cnt = Math.min(10, Math.max(1, Math.floor(num(bb?.count, 1))));
    let granted = 0;
    for (let i = 0; i < cnt; i++) {
      const id = ctx.rollItem({ maxTier: ctx.shopLevel() });
      if (id && ctx.grantItem(id, { source: 'garrison:pg_texas' })) granted++;
    }
    if (granted && typeof ctx.toast === 'function') ctx.toast(msg('德克萨斯：获得{n}件装备', { n: granted }), 'info');
  },
};

/** 「<休整期结束时>自身每携带一件装备」→ 企鹅物流 + 职业盟约层数：普通 bb.layer / 精锐 bb.elite_layer /
 *  没装备 bb.no_equip；合计 ≤ bb.cap。"已激活的"——只落已激活的盟约（requireActive: true，罗德岛同款）。
 *  拜松（+2/+4/没装备+1，≤8）、空（+3/+6/没装备+1，≤12）；
 *  莫斯提马（2026-10-13 用户规格，+6/+12/没装备+4，≤24；bbStr.profBond = casterShip）。
 *  —— 三位的层数上限 2026-10-15 用户下调：拜松 16→8、空 24→12、莫斯提马 48→24（精锐档同步减半）。 */
const USPG_PREP_PER_ITEM_LAYERS = {
  run(ctx) {
    if (!ctx.bondActive(PENGUIN_BOND)) return;
    const { piece, bb, bbStr } = ctx.source;
    if (!piece || piece.kind !== 'chess') return;
    const self = Number.isInteger(piece.uid) && piece.uid > 0 ? (ctx.piece(piece.uid) || piece) : piece;
    const carry = carryViewOf(ctx, self, omertosaGrantBoard(ctx));
    let n;
    if (carry.count > 0) n = (carry.count - carry.elite) * num(bb?.layer, 0) + carry.elite * num(bb?.elite_layer, 0);
    else n = num(bb?.no_equip, 0);
    const cap = num(bb?.cap, 0);
    n = Math.floor(cap > 0 ? Math.min(n, cap) : n);
    if (!(n > 0)) return;
    for (const b of [bbStr?.bond, bbStr?.profBond]) if (b) ctx.addLayers(b, n, { requireActive: true, reason: 'garrison:pg_carry' });
  },
};

/** 该备战棋子身上某个 effectKey 的 garrison 记录（走 chess 记录的 garrisonIds）。 */
function garrisonTraitOf(ctx, p, effectKey) {
  const rec = ctx.chessRecord(p.baseId || p.id) ?? ctx.chessRecord(p.id);
  const gids = Array.isArray(rec?.garrisonIds) ? rec.garrisonIds : [];
  for (const gid of gids) {
    const g = S.garrisonRecord(gid);
    if (g && g.effectKey === effectKey) return g;
  }
  return null;
}

/** 菲亚梅塔的虚拟携带（2026-10-13 用户规格）：
 *  普通：「休整期结束时，若任意能天使在场，则能天使视作携带一件装备」
 *  精锐：「休整期结束时，若任意能天使在场，则能天使视作携带一件精锐装备，若自身携带一件精锐装备则能天使视作携带两件精锐装备」
 *  这条与缄默德克萨斯的虚拟授予同属"视为携带"，所以并入 carryViewOf 的 grant，
 *  使盟约常驻加成、能天使的在场计数、4人档资金（真实穿戴）等所有口径自动一致。
 *  `count` = 普通件数，`elite` = 其中按精锐计的件数。 */
function phenxiGrantBoard(ctx) {
  let count = 0, elite = 0;
  // 条件：任意能天使在场（能天使 = exusiai；新约能天使是另一名干员，不顶替）
  const hasExusiai = ctx.board().some((q) => {
    const rr = penguinRosterOf(q.baseId || q.id);
    return !!rr && rr.key === 'exusiai';
  });
  if (!hasExusiai) return { count, elite };
  for (const p of ctx.board()) {
    const r = penguinRosterOf(p.baseId || p.id);
    if (!r || r.key !== 'phenxi') continue;
    const goldenSelf = /_b$/.test(p.id);
    if (!goldenSelf) {
      // 普通：能天使视作携带一件装备
      count += 1;
      continue;
    }
    // 精锐：视作携带一件精锐装备；若自身（菲亚梅塔）携带一件精锐装备，则视作两件精锐装备
    const g = garrisonTraitOf(ctx, p, 'USPG_PHENXI_VIRTUAL_EQUIP');
    const two = Math.max(1, Math.floor(num(g?.bb?.elite_count, 2)));
    const ownElite = (p.items || []).filter((it) => isEliteItemId(it.id)).length;
    const n = ownElite > 0 ? two : 1;
    count += n;
    elite += n;
  }
  return { count, elite };
}

/** 合并两个虚拟授予 { count, elite }。 */
const mergeGrants = (a, b) => ({ count: a.count + b.count, elite: a.elite + b.elite });

/** 「<休整期结束时>在场的【企鹅物流】或【职业】干员每携带一件装备」→ 企鹅物流 + 职业盟约层数
 *  （普通 bb.layer / 精锐 bb.elite_layer / 没装备 bb.no_equip，合计 ≤ bb.cap）。
 *  2026-10-13：这条特质原属能天使（狙击），先移交莫斯提马（术师），随后莫斯提马也改用
 *  「自身每件」口径（USPG_PREP_PER_ITEM_LAYERS）。本实现保留给「按在场队伍统计」的策略使用，
 *  当前 data 中已无干员使用它（拜松/空/莫斯提马都走 USPG_PREP_PER_ITEM_LAYERS）。 */
const USPG_PREP_TEAM_CARRY_LAYERS = {
  run(ctx) {
    if (!ctx.bondActive(PENGUIN_BOND)) return;
    const { bb, bbStr } = ctx.source;
    const grant = mergeGrants(omertosaGrantBoard(ctx), phenxiGrantBoard(ctx));
    let n = 0;
    for (const p of ctx.board()) {
      const uid = p && p.uid;
      const pb = Number.isInteger(uid) && uid > 0 ? ctx.pieceBonds(uid) : [];
      if (!pb.includes(PENGUIN_BOND) && !pb.includes(bbStr?.profBond)) continue;
      const carry = carryViewOf(ctx, p, grant);
      if (carry.count > 0) n += (carry.count - carry.elite) * num(bb?.layer, 0) + carry.elite * num(bb?.elite_layer, 0);
      else n += num(bb?.no_equip, 0);
    }
    const cap = num(bb?.cap, 0);
    n = Math.floor(cap > 0 ? Math.min(n, cap) : n);
    if (!(n > 0)) return;
    for (const b of [bbStr?.bond, bbStr?.profBond]) if (b) ctx.addLayers(b, n, { requireActive: true, reason: 'garrison:pg_carry' });
  },
};

/** 菲亚梅塔自己的特质在**战斗侧**（installPhenxiVirtualEquip）：登记给能天使们的虚拟携带。
 *  prep 侧不再需要任何动作（原先"休整期结束时"的口径已由用户 2026-10-13 改成战斗中）。 */
const USPG_PHENXI_VIRTUAL_EQUIP = { run() {} };

/** 能天使的装备攻速特质也在**战斗侧**（installExusiaiAspd）。 */
const USPG_EXUSIAI_ITEM_ASPD = { run() {} };

export function registerMeta(registry) {
  registry.bond(PENGUIN_BOND, {
    onLayers(ctx, ev) { if (!ev || ev.bondId === PENGUIN_BOND) payEquip(ctx); },
    onGain(ctx) { payEquip(ctx); },
    onPrepStart(ctx) { prepStartFunds(ctx); payEquip(ctx); },
  });
  registry.garrison('USPG_GAIN_EQUIP', USPG_GAIN_EQUIP);
  registry.garrison('USPG_PREP_PER_ITEM_LAYERS', USPG_PREP_PER_ITEM_LAYERS);
  registry.garrison('USPG_PREP_TEAM_CARRY_LAYERS', USPG_PREP_TEAM_CARRY_LAYERS);
  // 菲亚梅塔：战斗侧虚拟携带（见 installPhenxiVirtualEquip）
  registry.garrison('USPG_PHENXI_VIRTUAL_EQUIP', USPG_PHENXI_VIRTUAL_EQUIP);
  // 能天使：战斗侧装备攻速（见 installExusiaiAspd）
  registry.garrison('USPG_EXUSIAI_ITEM_ASPD', USPG_EXUSIAI_ITEM_ASPD);
  // 雷缪安：IN_BATTLE，装在 install() 里（见 installLemuen）
  registry.garrison('USPG_LEMUEN_SKILL_LAYERS', { run() {} });
}
