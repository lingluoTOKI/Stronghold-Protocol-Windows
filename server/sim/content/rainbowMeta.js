// server/sim/content/rainbowMeta.js — 彩虹小队 (Rainbow Six collab) prep-side (SERVER_*) 特质 (docs/META.md §2.3).
//
// 用户 2026-10-15 规格（本文件只保留 prep 侧特质；导火索改为战斗侧，见 rainbow.js）：
//   战车   <休整期结束时> **固定值**：已激活的【彩虹小队】+1、已激活的【近卫】+1（精锐各 +2）—— 不再按在场人数。
//   霜华   <休整期结束时> 两个盟约**各自独立**判定门槛：
//            场上【彩虹小队】人数 ≤ 4 → 【彩虹小队】+4（>4 → +8）；
//            场上【特种】人数     ≤ 2 → 【特种】+4（>2 → +8）。
//   灰烬   <休整期结束时> 同霜华结构，对象为【狙击】，数值 +8 / +16（精锐 +16 / +32）。
//   医生   <休整期结束时> 使自身、身前一格和身后一格干员的已激活盟约各增加 3 层（精锐 6）。
//
// 「实际在场」= 部署在棋盘上的棋子（ctx.board()），不含备战席。
// 精锐（+ 值翻倍）体现在 data 的 _b 记录上，代码一律读 bb，不在此重复翻倍。
//
// 双月 / 艾拉沿用引擎自身或战斗侧的实现（RAINBOW_IANA_GAIN_LAYER / RAINBOW_ELA_FULL_SQUAD）。
import { RAINBOW_BOND, RAINBOW_CHARACTERS } from '../../../shared/rainbowSquad.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d);

const RAINBOW_IDS = new Set(Object.values(RAINBOW_CHARACTERS));

/** 场上（棋盘）实际在场的棋子列表。 */
function boardPieces(ctx) {
  const out = [];
  for (const piece of ctx.board()) {
    if (piece && piece.kind === 'chess') out.push(piece);
  }
  return out;
}

/** 场上实到的【彩虹小队】干员名单（返回 piece 列表，便于再按其他盟约筛选）。 */
function rainbowOnBoard(ctx) {
  const out = [];
  for (const piece of boardPieces(ctx)) {
    const rec = ctx.chessRecord(piece.id);
    if (rec && rec.charId && RAINBOW_IDS.has(rec.charId)) out.push(piece);
  }
  return out;
}

/** 该棋子是否属于某盟约（按 piece.bonds，含职业附加盟约）。 */
const inBond = (ctx, piece, bondId) => (ctx.pieceBonds(piece.uid) || []).includes(bondId);

/**
 * 通用：数出「实际在场的某盟约干员」个数。bondId=RAINBOW_BOND 时等价于场上彩虹小队人数。
 * @param {string} bondId
 */
function countInBond(ctx, bondId) {
  let n = 0;
  for (const piece of boardPieces(ctx)) {
    if (inBond(ctx, piece, bondId)) n++;
  }
  return n;
}

// 每名干员的层数直接读 bb.layer —— 精锐副本（_b）的 garrison 记录里 layer 已经是 2，
// 所以**不能**在这里再按精锐翻倍，否则会变成 ×4。
// （「精锐+2」体现在 data 的 _b 记录上，与其它盟约特质的口径一致。）

const H = {};

/**
 * 通用：给「两个盟约」分别按**各自的门槛**叠层（用户 2026-10-15：霜华 / 灰烬 —— 两盟约各自独立判定）。
 *   某盟约场上人数 ≤ 该盟约门槛 → +low；> 门槛 → +high。
 * 两个盟约各自要求「自己已激活」（requireActive），且场上要有该盟约成员才结算。
 */
function addLayersByOwnThreshold(ctx, o) {
  const rows = [
    [o.bondId, countInBond(ctx, o.bondId), o.threshold, o.low],
    [o.secondId, countInBond(ctx, o.secondId), o.thresholdSecond, o.low],
  ];
  for (const [bondId, n, thr, low] of rows) {
    if (!bondId || !(n > 0)) continue;
    const add = n <= thr ? low : o.high;
    if (add > 0) ctx.addLayers(bondId, add, { requireActive: true, reason: o.reason });
  }
}

/**
 * 战车 <休整期结束时> **固定值**（用户 2026-10-15：不再按在场人数）：
 *   已激活的【彩虹小队】+N 层、已激活的【近卫】+N 层（两个盟约各自判「已激活」）。
 * bb.layer = 层数（普通记录 1 / 精锐记录 2）。
 */
H.RAINBOW_TACHANKA_BOND_LAYER = {
  run(ctx) {
    const per = num(ctx.source.bb?.layer, 1);
    if (!(per > 0)) return;
    const bondId = ctx.source.bbStr?.bond_id || RAINBOW_BOND;
    const secondId = ctx.source.bbStr?.second_bond_id || 'warriorShip';
    for (const id of [bondId, secondId]) {
      if (id) ctx.addLayers(id, per, { requireActive: true, reason: 'garrison:rainbow-tachanka' });
    }
  },
};

/**
 * 霜华 <休整期结束时> 两个盟约**各自独立**判定门槛：
 *   场上【彩虹小队】人数 ≤ bb.threshold        → 【彩虹小队】+bb.low，否则 +bb.high；
 *   场上【特种】人数     ≤ bb.threshold_second → 【特种】+bb.low，否则 +bb.high。
 */
H.RAINBOW_FROST_BOND_LAYER = {
  run(ctx) {
    addLayersByOwnThreshold(ctx, {
      bondId: ctx.source.bbStr?.bond_id || RAINBOW_BOND,
      secondId: ctx.source.bbStr?.second_bond_id || 'specialShip',
      threshold: num(ctx.source.bb?.threshold, 4),
      thresholdSecond: num(ctx.source.bb?.threshold_second, 2),
      low: num(ctx.source.bb?.low, 4),
      high: num(ctx.source.bb?.high, 8),
      reason: 'garrison:rainbow-frost',
    });
  },
};

/**
 * 灰烬 <休整期结束时> 同霜华结构，对象是【狙击】：+bb.low / +bb.high（默认 8 / 16）。
 */
H.RAINBOW_ASH_BOND_LAYER = {
  run(ctx) {
    addLayersByOwnThreshold(ctx, {
      bondId: ctx.source.bbStr?.bond_id || RAINBOW_BOND,
      secondId: ctx.source.bbStr?.second_bond_id || 'sniperShip',
      threshold: num(ctx.source.bb?.threshold, 4),
      thresholdSecond: num(ctx.source.bb?.threshold_second, 2),
      low: num(ctx.source.bb?.low, 8),
      high: num(ctx.source.bb?.high, 16),
      reason: 'garrison:rainbow-ash',
    });
  },
};

/** 双月: 获得时, 自身所有已激活盟约各 +N 层 (runs on the SERVER_GAIN hook). */
H.RAINBOW_IANA_GAIN_LAYER = {
  run(ctx) {
    const n = num(ctx.source.bb?.count);
    if (!(n > 0)) return;
    const self = ctx.source.piece;
    if (!self) return;
    for (const bondId of ctx.pieceBonds(self.uid)) {
      ctx.addLayers(bondId, n, { reason: 'garrison:rainbow-iana' });
    }
  },
};

/** 艾拉: 休整期结束时的满编判定；战斗侧读取同一 `size` 与干员是否在场。 */
H.RAINBOW_ELA_FULL_SQUAD = {
  run(ctx) {
    const bb = ctx.source.bb || {};
    const bondId = ctx.source.bbStr?.bond_id || RAINBOW_BOND;
    if (!ctx.bondActive(bondId)) return;
    const size = Math.max(1, num(bb.size, 8));
    void (rainbowOnBoard(ctx).length >= size);
  },
};

export function registerMeta(registry) {
  for (const [key, handler] of Object.entries(H)) registry.garrison(key, handler);
}
