// shared/profBonds.js — 岁·职业附加盟约的成员判定表（weight=0，永不进开局 BAN 抽取）。
//
// 单职业盟约的成员 = **mod 阵营干员**中该 profession 的干员（巴别塔/彩虹小队/罗德岛/莱茵生命 —— 用户
// 2026-10-09 裁定：官方干员不加入职业盟约）；复合职业盟约（狙击术师/近卫重装/先锋医疗/特种辅助）=
// 用户 2026-10-09 裁定改为**图鉴专属**：不再归属到干员身上（不计数/不显示芯片），只在盟约与策略总览
// 里展示成员名单。其联动效果的触发/档位本来就由组成单职业盟约的 tier 驱动（见 suiProf.js），不受影响。
export const PROFESSION_BONDS = Object.freeze({
  PIONEER: ['vanguardShip', 'vangmedShip'],
  WARRIOR: ['warriorShip', 'warrtankShip'],
  TANK: ['tankShip', 'warrtankShip'],
  SNIPER: ['sniperShip', 'sncasterShip'],
  CASTER: ['casterShip', 'sncasterShip'],
  MEDIC: ['medicShip', 'vangmedShip'],
  SUPPORT: ['supportShip', 'spcsupShip'],
  SPECIAL: ['specialShip', 'spcsupShip'],
});

/**
 * 职业盟约的归属门槛：干员的 bonds 里至少要有其中一条 —— 本作新增的 8 个核心阵营全算，**岁** 与
 * **乌萨斯学生团** 也在里面（古米＝【乌萨斯学生团】⇒ 契约档自动挂【重装】，与此前手写的阵营干员同口径）。
 */
export const PROF_BOND_FACTIONS = Object.freeze(['rodosShip', 'babelShip', 'rhineShip', 'rainbowShip', 'penguinShip', 'lungmenShip', 'suiShip', 'usStudentShip']);

/** Bonds a mod-faction chess with `profession` counts for: **only its single-profession bond**（复合盟约已改为
 *  图鉴专属，不再归属干员 —— 用户 2026-10-09 裁定）。
 *  `bonds` = 该干员的 bonds 数组（无任一 mod 阵营 ⇒ 不归属任何职业盟约，返回 []）。 */
export function profBondsOf(profession, bonds) {
  const list = PROFESSION_BONDS[String(profession || '').toUpperCase()] || [];
  const single = list.length ? list[0] : null;
  if (!single || !Array.isArray(bonds)) return [];
  return PROF_BOND_FACTIONS.some((f) => bonds.includes(f)) ? [single] : [];
}

/** 干员的「生效盟约」= chess.bonds + 按 profession 归属的职业盟约（与服务器 pieceBonds 同口径；UI 盟约芯片/筛选共用）。 */
export function effectiveBonds(chess) {
  const out = Array.isArray(chess?.bonds) ? chess.bonds.slice() : [];
  for (const b of profBondsOf(chess?.profession, chess?.bonds)) if (!out.includes(b)) out.push(b);
  return out;
}

/** The single-profession bond of `profession` (null when the profession has none — e.g. tokens / DEVICE). */
export function singleProfBond(profession) {
  const list = PROFESSION_BONDS[String(profession || '').toUpperCase()] || [];
  return list.length ? list[0] : null;
}

/** Composite bond ids (their activation is driven by the two member bonds' tiers, never their own count).
 *  图鉴专属：不归属干员、不进变形同构体。 */
export const COMPOSITE_PROF_BONDS = Object.freeze(['sncasterShip', 'warrtankShip', 'vangmedShip', 'spcsupShip']);

/** 复合职业盟约 → 组成它的两个单职业盟约 id（从 PROFESSION_BONDS 推导：每个复合出现在两个 profession 的列表里）。 */
export const COMPOSITE_PARTS = Object.freeze(
  Object.values(PROFESSION_BONDS).reduce((acc, list) => {
    const single = list[0], composite = list[1];
    if (!composite) return acc;
    (acc[composite] || (acc[composite] = [])).push(single);
    return acc;
  }, {})
);

/** 显示层：把复合职业盟约的「自动激活」派生进 bonds 列表 —— 当组成它的两个单职业盟约都激活（active）时，
 *  复合盟约自动激活，派生 tier = min(两单职业 tier)。复合盟约本身不挂干员身上（不进 BAN / 变形同构体 / 干员 chips），
 *  仅在盟约条与弹窗里显示派生激活状态（用户 2026-10-09 裁定：狙击+术师激活 ⇒ 狙击术士自动激活，以此类推）。
 *  @param {any[]} bonds 玩家真实盟约条目（含 bondId / count / active / tier / layers）
 *  @returns {any[]} 原列表 + 派生的复合条目（标记 composite:true、compositeParts）。 */
export function injectCompositeBonds(bonds) {
  if (!Array.isArray(bonds)) return bonds;
  const byId = new Map();
  for (const b of bonds) if (b && typeof b.bondId === 'string') byId.set(b.bondId, b);
  const out = bonds.slice();
  for (const [cid, parts] of Object.entries(COMPOSITE_PARTS)) {
    if (out.some((b) => b && b.bondId === cid)) continue; // 真实已有（不应发生）
    const ps = parts.map((p) => byId.get(p)).filter(Boolean);
    if (ps.length !== parts.length || !ps.every((p) => p && p.active)) continue;
    const tier = Math.min(...ps.map((p) => Number(p.tier) || 0));
    if (tier < 1) continue;
    const count = ps.reduce((s, p) => s + (Number(p.count) || 0), 0);
    const layers = ps.reduce((s, p) => s + (Number(p.layers) || 0), 0);
    out.push({
      bondId: cid, count, layers, active: true, tier, thresholds: [], composite: true,
      compositeParts: ps.map((p) => ({ id: p.bondId, count: Number(p.count) || 0 })),
    });
  }
  return out;
}

/** 全部 12 条职业附加盟约的 id（单职业 8 + 复合 4）—— 变形同构体不给职业盟约（用户 2026-10-09 裁定）。 */
export const PROF_BOND_IDS = Object.freeze(Object.values(PROFESSION_BONDS).flat());

/** Is `id` a profession add-on bond (变形同构体 pairing must skip these)? */
export function isProfBond(id) {
  return typeof id === 'string' && PROF_BOND_IDS.includes(id);
}

/**
 * items.json 里「这件装备的职业附加盟约**允许**由变形同构体给出」的标记。
 *
 * 职业附加盟约默认不走变形同构体（用户 2026-10-09 裁定：职业盟约的成员是 `profBondsOf` 按 profession
 * 派生的，谁都有职业，拿来判定归属没有意义）。**职业芯片**（用户 2026-10-10）是这条裁定唯一的例外，
 * 也正是在于它自己：一件职业芯片单独戴着不转职，只有与变形同构体一同装备才让携带者「视为对应职业盟约」——
 * 记录的 `giveProfBond: true` 就是这份声明。
 *
 * 三处判定共用本键（必须同步）：server/sim/content/support/index.js unitBonds（战斗）、
 * server/match/bondsMeta.js pieceBonds（盟约计数）、public/js/ui/gameLogic/bonds.js grantedBonds（UI 芯片）。
 */
export const GIVE_PROF_BOND_KEY = 'giveProfBond';

/** 这件装备的 `giveBondId` 能否作为变形同构体的配对结果（职业盟约需要显式声明 `giveProfBond`）。 */
export function allowsProfBond(rec, bondId) {
  if (!isProfBond(bondId)) return true;
  return !!(rec && rec[GIVE_PROF_BOND_KEY]);
}

/**
 * items.json 里「**这件装备自己就能**把携带者算作该盟约成员」的标记 —— 不需要与变形同构体一同装备。
 *
 * 只有**叠层 150 首次达成时赠送的 4 阶职业芯片组**（`chess_item_4_{caster,tank,support,warrior,special,vanguard,
 * medic,sniper}_chip_a/_b`，data/bonds.json 的 `layerMilestones`）带它：它们的 desc 本来就写着「装备者携带本装备
 * 视为X盟约干员」（用户 2026-10-16：「所有叠层150送的4阶装备不需要变形同构体，穿戴就是本职业」）。
 * 3 阶「芯片」是商店货、desc 没有那句，仍然只走变形同构体那条路（`giveProfBond`）。
 *
 * 判定点与 `GIVE_PROF_BOND_KEY` 相同，必须一起改：server/match/bondsMeta.js pieceBonds（盟约计数）、
 * server/sim/content/support/index.js unitBonds（战斗）、server/sim/content/support/meta.js withGrants（盟约视图）、
 * public/js/ui/gameLogic/bonds.js grantedBonds（UI 芯片 / 详情卡 / 成员名单）。
 */
export const SELF_PROF_BOND_KEY = 'selfProfBond';

/** 这件装备**单穿**（不需要变形同构体）就把自己的 `giveBondId` 给携带者。 */
export function grantsBondAlone(rec) {
  return !!(rec && rec[SELF_PROF_BOND_KEY]);
}
