// 显示范围：盟约（官方）/ 契约（本作新增）—— 客户端（界面开关）与服务端（对局干员池 / 装备池）共用同一份定义。
//
// 「契约」= 本作新增的 8 个核心盟约 + 魔王 / 升变 + 后来加的职业附加盟约；
// 「盟约」= 官方阵营与官方附加盟约。**协防干员 / 调和 / 绝技 两档都保留**。
// 干员 / 装备按「核心阵营」归边（职业附加盟约人人都有，不能拿来判定归属），敌方与地图不受影响。

import { profBondsOf, COMPOSITE_PROF_BONDS, COMPOSITE_PARTS } from './profBonds.js';

/** 两档都显示的盟约。 */
export const SCOPE_KEEP = Object.freeze(['emptyShip', 'maniShip', 'suntShip']);   // 协防干员 / 调和 / 绝技

/** 「契约」档的核心盟约（本作新增阵营）。 */
export const SCOPE_MOD_CORE = Object.freeze([
  'rhineShip', 'rainbowShip', 'rodosShip', 'babelShip', 'suiShip', 'usStudentShip', 'penguinShip', 'lungmenShip',
  'demonShip', 'evolveShip',   // 魔王 / 升变：巴别塔的附属，跟巴别塔一起进契约档
]);

/** 「契约」档的附加盟约（后来加的职业盟约）。 */
export const SCOPE_MOD_ADD = Object.freeze([
  'vanguardShip', 'warriorShip', 'tankShip', 'medicShip', 'sniperShip', 'casterShip', 'supportShip', 'specialShip',
  'sncasterShip', 'warrtankShip', 'vangmedShip', 'spcsupShip',
]);

/** 「盟约」档的核心盟约（官方阵营）。 */
export const SCOPE_OFFICIAL_CORE = Object.freeze([
  'yanShip', 'sargonShip', 'victoriaShip', 'kjeragShip', 'lateranoShip', 'egirShip', 'siracusaShip', 'kazimierzShip',
]);

const MOD = new Set([...SCOPE_MOD_CORE, ...SCOPE_MOD_ADD]);
const BOTH = new Set(SCOPE_KEEP);

/** @param {unknown} v @returns {'mod'|'official'} */
export function normalizeScope(v) {
  return v === 'official' ? 'official' : 'mod';
}

/** 一条盟约属于哪一边：'mod'（契约）| 'official'（盟约）| 'both'（两档都显示）。 */
export function bondScopeOf(bondId) {
  if (BOTH.has(bondId)) return 'both';
  return MOD.has(bondId) ? 'mod' : 'official';
}

/** 该盟约是否在当前档位显示（scope 为空 = 不筛选）。 */
export function inBondScope(bondId, scope) {
  if (!scope) return true;
  const s = bondScopeOf(bondId);
  return s === 'both' || s === scope;
}

/** 挂在某个盟约上的东西（装备 / 特质等）是否显示：无盟约的一直显示。 */
export function bondIdInScope(bondId, scope) {
  return !bondId || inBondScope(bondId, scope);
}

/**
 * 一名干员是否属于该档位（决定他在这一局里能不能被买到 / 上场）。
 *
 * 契约档：bonds 里至少有一条本作新增盟约（核心阵营或职业附加盟约皆可）；协防干员 / 调和 / 绝技 两档都在。
 * 盟约档：必须是 0.2.1 底包里就有的棋子（`officialOp`，由 _inject-official.mjs 按原版包写入），
 *   并且在这一档还有盟约剩下（8 个官方核心阵营，或坚守 / 精准这类官方附加盟约）——
 *   W = [巴别塔, 精准] 这种本作新增棋子带着官方附加盟约，也不算盟约档的人；
 *   只看「有没有官方核心阵营」同样不对：古米、赫默、魔王这些只有官方附加盟约的干员会被整批踢出去（曾漏 33 名）。
 * @param {{ bonds?: string[] }} rec chess 记录
 * @param {'mod'|'official'} [scope]
 */
export function operatorInScope(rec, scope) {
  if (!scope || !rec || typeof rec !== 'object') return !scope;
  const bonds = Array.isArray(rec.bonds) ? rec.bonds : [];
  const hasMod = bonds.some((b) => MOD.has(b));
  if (scope === 'official') {
    if (!rec[CHESS_OFFICIAL_OP_KEY]) return false;
    return bonds.some((b) => BOTH.has(b) || !MOD.has(b));
  }
  return bonds.some((b) => BOTH.has(b)) || hasMod;
}

/**
 * 装备显式指定的档位（items.json `scopeOnly: 'mod' | 'official'`）。
 *
 * 一般装备靠 `giveBondId` 归边（`bondIdInScope`），但**不转职**的装备（刺刀：同维式重锤的攻击力，但把
 * giveBondId 拿掉了）没有盟约可挂，就需要它自己声明：刺刀只在本作新增盟约那一档（契约）出售。
 */
export const ITEM_SCOPE_KEY = 'scopeOnly';

/** 一件装备是否属于该档位：显式的 `scopeOnly` 优先，否则按 `giveBondId`（无盟约的装备两档都能买到）。 */
export function itemInScope(item, scope) {
  if (!scope) return true;
  const only = item?.[ITEM_SCOPE_KEY];
  if (only === 'mod' || only === 'official') return only === scope;
  return bondIdInScope(item?.giveBondId, scope);
}

/**
 * 一名干员「盟约档」要还原的官方字段（0.2.1 底包原值）。
 *
 * 合并时，顶着本作新增盟约的干员被换成了本作的版本 —— 有的是**追加**（德克萨斯 +企鹅物流），
 * 有的是**替换**：格雷伊的 `trait` 从官方的「攻击造成群体法术伤害」换成了罗德岛的机制文案、`garrisonIds`
 * 从 `garrison_67_a` 换成了 `garrison_rodos_greyySell_a`；调香师双换了盟约与驻防。
 * 被换掉的原值仍在 0.2.1 底包里（data/chess.json 的 `officialFields`），盟约档在这里还原，
 * 契约档用本作的值 —— 于是不管看哪一档，干员的特质 / 特性 / 驻防都是那一档自己的一套。
 */
export const CHESS_OFFICIAL_FIELDS = Object.freeze(['bonds', 'trait', 'traitBase', 'garrisonIds']);

/** chess.json 里存放上述字段官方原值的键。 */
export const CHESS_OFFICIAL_KEY = 'officialFields';

/** chess.json 里的标记：这条记录是 0.2.1 底包自带的干员（盟约档的人；本作新增棋子没有它）。 */
export const CHESS_OFFICIAL_OP_KEY = 'officialOp';

/**
 * 干员记录在当前档位下的样子：盟约档把记录的官方原值换回去，契约档保持本作的值。
 * 关键在于 `trait` / `traitBase` / `garrisonIds` 也一并换 —— 它们就是那些自定义特质的文本与实现本体，
 * 服务端探算盟约、跑特质都用同一条记录，UI 卡片也用同一条，两边不会各说一套。
 * @param {Record<string, any>} rec chess 记录
 * @param {'mod'|'official'} [scope]
 */
export function scopedChess(rec, scope) {
  if (!rec || typeof rec !== 'object' || scope !== 'official') return rec;
  const off = rec[CHESS_OFFICIAL_KEY];
  if (!off || typeof off !== 'object') return rec;
  return { ...rec, ...off };
}

/**
 * 按档位重建本局的对局数据视图：
 * - 不在档位里的干员不再进商店 / 自选，装备不再上架；
 * - **在档位里的干员，bonds 数组本身也按档位裁剪**（协防干员 / 调和 / 绝技两档都保留）——
 *   释怀雅这类两边都占的干员：盟约档只剩 炎+远见（职业附加的近卫也随龙门口被裁掉而消失），
 *   契约档只剩 龙门+近卫。盟约计数按 chess.bonds，裁掉即彻底不参与另一档的计数与激活。
 * - 敌方、地图与其余数据原样保留。
 * @param {Record<string, any>} data 整份 data（server/data.js getData()）
 * @param {'mod'|'official'} [scope]
 * @returns {Record<string, any>} 新的 data（无档位时原样返回）
 */
export function withBondScope(data, scope) {
  if (!scope || !data || typeof data !== 'object') return data;
  const chess = data.chess && typeof data.chess === 'object' ? data.chess : null;
  const items = data.items && typeof data.items === 'object' ? data.items : null;
  const bonds = data.bonds && typeof data.bonds === 'object' ? data.bonds : null;
  if (!chess && !items && !bonds) return data;
  const out = { ...data };
  if (bonds) {
    // 盟约清单本身也按档位裁掉：盟约条（ps.bonds 由 gd.bondIds 生成）、开局 BAN 抽取池（drawDisabledBonds
    // 也从 gd.bondIds 取）随之只剩当前档位的盟约 —— 契约档不显示/不 BAN 官方盟约，反之亦然。
    const scopedBonds = Object.fromEntries(Object.entries(bonds).filter(([id, b]) => b && inBondScope(id, scope)));
    // 成员表按档位重建（静态 members 已过期 —— 契约档会漏掉本作新增/补挂职业盟约的干员）。
    out.bonds = rebuildBondMap(scopedBonds, chess ? Object.values(chess) : [], scope);
  }
  if (chess) {
    const next = {};
    for (const [id, rec] of Object.entries(chess)) {
      if (!rec || typeof rec !== 'object') { next[id] = rec; continue; }
      // 自选编队槽（isDiy）：占位记录本无固定干员（bonds 由该槽的 pick 在组合时决定，shared/diy.js
      // diyRecordOf），不参与档位裁剪 —— 裁掉会把 isDiy 抹掉，自选槽整体失效（2026-10-12 休整期切换移植时发现）
      if (rec.isDiy) { next[id] = rec; continue; }
      // 盟约档：先换回官方的 bonds / trait / garrisonIds（见 scopedChess），再按档位裁盟约
      const base = scopedChess(rec, scope);
      if (!operatorInScope(base, scope)) {
        next[id] = { ...rec, visible: false, isDiy: false, isHidden: true };
        continue;
      }
      const bonds = Array.isArray(base.bonds) ? base.bonds : null;
      next[id] = bonds
        ? { ...base, bonds: bonds.filter((b) => inBondScope(b, scope)) }
        : base;
    }
    out.chess = next;
  }
  if (items) {
    const next = {};
    for (const [id, it] of Object.entries(items)) {
      if (it && typeof it === 'object' && !itemInScope(it, scope) && it.itemType === 'EQUIP') {
        next[id] = { ...it, hideInShop: true };
      } else next[id] = it;
    }
    out.items = next;
  }
  return out;
}

// -------------------------------------------------------------------------------------------------------------
// 盟约成员表（图鉴 / 详情用）
//
// 数据里的 `bonds.json` 只在**底包**那一份是自洽的：0.2.41 的 23 条盟约，其 `members` 恰好等于
// 「数据顺序里非精锐、且 bonds 含该盟约的 chess」，`visibleMembers` 再剔掉隐藏项 —— 已逐条比对，顺序一致。
// 本作合并进新干员、又给一批干员补了职业附加盟约之后，这张静态表没有跟着重建，于是**契约档的图鉴会漏人**
// （用户 2026-10-12：「契约模式，盟约图鉴缺少部分干员，比如狙击少了灰喉」「无论是否被ban，他都应该在」）。
// 下面这个纯函数按档位现算，客户端图鉴与服务端对局视图共用同一份口径。
//
// 例外：4 条复合职业盟约（狙击术师 / 近卫重装 / 先锋医疗 / 特种辅助）不归属到干员身上
// （shared/profBonds.js 的裁定 —— 它们不计数、不显示芯片），但**成员表照样要齐全**：
// 取组成它的两个单职业盟约成员之并集（用户 2026-10-12：「复合职业的人员也要齐全」）。
// 早先这里是图鉴手写名单，本作合并新干员后同样会漏人。

/** 干员的「生效盟约」是否含 `bondId`（bonds + 按职业归属的职业盟约，与服务器 bondsMeta.membership 同口径）。 */
function carriesBond(rec, bondId, scope) {
  if (!rec || rec.isGolden === true) return false;
  const base = scopedChess(rec, scope);
  if (!operatorInScope(base, scope)) return false;
  const bonds = Array.isArray(base.bonds) ? base.bonds.slice() : [];
  for (const b of profBondsOf(base.profession, base.bonds)) if (!bonds.includes(b)) bonds.push(b);
  return bonds.includes(bondId);
}

/**
 * 一条盟约在当前档位下的成员（chess id，数据顺序）。
 * 复合职业盟约 = 其两个组成单职业盟约成员之并集；其余 = 「生效盟约」含该盟约的干员。
 * 不属于该档位时返回 null（调用方按「不重建」处理）。
 * @param {any[]} records chess 记录（带 `chessId`，数据顺序）
 */
export function bondMemberIds(records, bondId, scope) {
  const list = Array.isArray(records) ? records : [];
  if (!scope || !inBondScope(bondId, scope)) return null;
  const parts = COMPOSITE_PARTS[bondId];
  if (parts?.length) {
    const set = new Set(list.filter((r) => parts.some((p) => carriesBond(r, p, scope))).map((r) => r.chessId));
    return list.filter((r) => set.has(r.chessId)).map((r) => r.chessId);
  }
  return list.filter((r) => carriesBond(r, bondId, scope)).map((r) => r.chessId);
}

/**
 * 按档位重建一批盟约记录的 `members` / `visibleMembers`。
 * 不属于该档位的盟约原样返回；无 scope 时整体原样返回。
 * @param {any[]} records chess 记录（带 `chessId`）
 * @param {any[]} bondRecs bonds 记录（带 `bondId`）
 * @param {'mod'|'official'} [scope]
 */
export function rebuildBondMembers(records, bondRecs, scope) {
  const list = Array.isArray(records) ? records : [];
  const src = Array.isArray(bondRecs) ? bondRecs : [];
  if (!scope || !list.length) return src;
  const hidden = new Map(list.map((r) => [r?.chessId, !!(r && (r.isHidden === true || r.visible === false))]));
  return src.map((b) => {
    const bid = b && b.bondId;
    if (!bid || !inBondScope(bid, scope)) return b;
    const members = bondMemberIds(list, bid, scope) || [];
    return { ...b, members, visibleMembers: members.filter((id) => !hidden.get(id)) };
  });
}

/**
 * 把一个「盟约 id → 记录」的表按档位重建（服务端 withBondScope 用）。
 * @param {Record<string, any>} bondMap
 * @param {any[]} records chess 记录
 */
export function rebuildBondMap(bondMap, records, scope) {
  if (!scope || !bondMap || typeof bondMap !== 'object') return bondMap;
  const rebuilt = rebuildBondMembers(records, Object.values(bondMap), scope);
  return Object.fromEntries(rebuilt.filter((b) => b && b.bondId).map((b) => [b.bondId, b]));
}
