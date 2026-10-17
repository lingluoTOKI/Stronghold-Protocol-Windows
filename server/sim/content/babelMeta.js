// 巴别塔 (Babel) prep side: the bond's layer economy (资金 spend), its milestone payouts, the permanent
// ATK / HP bonus it banks, and 伊内丝's 回合结束 trait. Battle-side traits live in babel.js.
//
// Layer source is SPENDING, not battle results (unlike 罗德岛): every 资金 paid out in a round feeds both the
// layer total and a permanent bonus step, at a rate that depends on how many members are on the board.
import { BABEL_BOND, BABEL_ADDON_BONDS, BABEL_TIERS, BABEL_BALANCE as B, BABEL_MILESTONES,
  babelCrossedMilestones } from '../../../shared/babelTower.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));

/**
 * Permanent-bonus steps banked per player id, keyed outside the battle so babel.js can read them too.
 * A step is "每回合每花费 N 资金 → 巴别塔在场的干员永久 +1% 攻击力与生命值".
 */
const BUFF_STEPS = new Map();
/** @param {string|number} playerId */
export function buffStepsOf(playerId) { return Math.max(0, BUFF_STEPS.get(playerId) ?? 0); }
export function setBuffSteps(playerId, n) { BUFF_STEPS.set(playerId, Math.max(0, num(n))); }

/**
 * Last round a spend was seen at, per player: the bank lives in a module-level map (the battle reads it
 * outside the match object), so a NEW match must start from zero — only a round that goes BACKWARD (a fresh
 * match reusing the same player ids) resets the bank.
 *
 * 注意不能用 `r <= last`：同一回合里的第 2 次消费，回合号并没有「前进」，旧写法会把本局的永久加成清零，
 * 表现为「花钱给巴别塔加数值不起作用 / 不叠加」（每次消费只有最后一笔生效）。
 */
const LAST_ROUND = new Map();
function rolloverIfNeeded(ctx) {
  const pid = ctx.playerId;
  const r = Math.max(1, num(ctx.round, 1));
  const last = LAST_ROUND.get(pid);
  if (last != null && r < last) {
    if (buffStepsOf(pid) > 0) setBuffSteps(pid, 0);
  }
  LAST_ROUND.set(pid, r);
}

/** Deployed 巴别塔 members of the player. */
function babelMembers(ctx) {
  let n = 0;
  for (const piece of ctx.board()) {
    if (piece.kind !== 'chess') continue;
    if (ctx.pieceBonds(piece.uid).includes(BABEL_BOND)) n++;
  }
  return n;
}

/** The tier the current member count unlocks (highest whose `count` is met). */
function tierFor(members) {
  let tier = null;
  for (const t of BABEL_TIERS) if (members >= t.count) tier = t;
  return tier;
}

/**
 * 6 人档「并立刻获得维什戴尔」（BABEL_TIERS[2].immediate —— 旧实现从未读过这个字段，6 人档从不发干员）。
 * 每局一次：在场巴别塔干员达到 6 名时发放 chess_babel_wisdel_a（tpl 由 grantChess 的 id 直接给普通版）。
 */
function grantImmediateTier(ctx, members) {
  const tier = tierFor(members);
  if (!tier || !tier.immediate || ctx.counter('babel:immediate')) return;
  ctx.setCounter('babel:immediate', 1);
  try { ctx.grantChess?.(tier.immediate, { source: 'bond:babelShip' }); } catch { /* 不可发放不阻断结算 */ }
}

/** Layers a ROUND's total spend of `amount` 资金 is worth at the current member count. */
export function babelLayersFromSpend(amount, members) {
  const tier = tierFor(members);
  if (!tier) return 0;
  // 1 人档按自己的 5 资金步长结算（`fundsPerLayer`），其余档沿用 B.spendUnit = 3 资金。
  return Math.floor(Math.max(0, num(amount)) / (tier.fundsPerLayer ?? B.spendUnit)) * tier.layersPerSpend;
}

/** Permanent-bonus steps a ROUND's total spend of `amount` 资金 is worth. */
export function babelStepsFromSpend(amount, members) {
  const tier = tierFor(members);
  if (!tier) return 0;
  return Math.floor(Math.max(0, num(amount)) / tier.fundsPerBuffPct);
}

/**
 * Milestone rewards: a layer total that first reaches a threshold pays out once per match.
 * `claimed` state is kept on the ctx counters so it survives without the caller holding a Set.
 * @returns {Array<object>} the rewards granted
 */
export function babelMilestones(ctx, before, after) {
  const claimed = new Set();
  for (const m of BABEL_MILESTONES) if (ctx.counter(`babel:claimed:${m.at}`)) claimed.add(m.at + ':' + m.kind);
  const out = babelCrossedMilestones(before, after, claimed);
  for (const m of out) {
    ctx.setCounter(`babel:claimed:${m.at}`, 1);
    try {
      if (m.kind === 'chess') ctx.grantChess?.(m.id);
      else if (m.kind === 'item') ctx.grantItem?.(m.id, m.count ?? 1);
      else if (m.kind === 'funds') ctx.addPendingFunds?.(m.count ?? 0);
    } catch { /* an undeliverable reward must not break the settlement */ }
  }
  return out;
}

/**
 * Called whenever the player spends 资金. Feeds layers (and the milestone payouts) plus the permanent
 * bonus the 巴别塔 operators on the field keep for the rest of the match.
 *
 * 「每回合每花费 N 资金」按回合**累计**结算（shared/babelTower.js 的 babelLayersFromFunds /
 * babelBuffStepsFromFunds 注释即 "funds spent in a round"）：这里读本回合累计消费，只补发「本次新增的档位」。
 * 旧实现按**单笔付款**算，买一个 3 资金的干员在 1 人档（5 资金/档）下永远 floor(3/5)=0 ——
 * 表现就是「花钱给巴别塔加数值不起作用 / 也不叠层」。
 */
export function babelOnSpend(ctx, amount) {
  if (!ctx.bondActive(BABEL_BOND)) return { layers: 0, steps: 0 };  rolloverIfNeeded(ctx);
  const spent = Math.max(0, num(amount));
  if (!(spent > 0)) return { layers: 0, steps: 0 };
  const members = babelMembers(ctx);
  grantImmediateTier(ctx, members);
  const roundSpent = Math.max(0, num(ctx.roundStats().spent)); // 本回合累计消费
  // 本回合已发放的档位（回合变化时清零，与 rodosMeta 的 roundCap 同一手法）。
  const R = 'babel:roundAward';
  if (ctx.counter(`${R}:r`) !== ctx.round) {
    ctx.setCounter(`${R}:r`, ctx.round);
    ctx.setCounter(`${R}:layers`, 0);
    ctx.setCounter(`${R}:steps`, 0);
  }
  let layers = 0;
  let steps = 0;
  const wantLayers = babelLayersFromSpend(roundSpent, members);
  const haveLayers = ctx.counter(`${R}:layers`);
  if (wantLayers > haveLayers) {
    layers = ctx.addLayers(BABEL_BOND, wantLayers - haveLayers, { requireActive: true, reason: 'babel:spend' });
    ctx.setCounter(`${R}:layers`, haveLayers + layers);
    // 里程碑发放交给 babelGlobal.onLayers（任何加层来源都过那一道），这里不再自算一次。
  }
  const wantSteps = babelStepsFromSpend(roundSpent, members);
  const haveSteps = ctx.counter(`${R}:steps`);
  if (wantSteps > haveSteps) {
    steps = wantSteps - haveSteps;
    setBuffSteps(ctx.playerId, buffStepsOf(ctx.playerId) + steps);
    ctx.setCounter(`${R}:steps`, wantSteps);
  }
  return { layers, steps };
}

const H = {};

/** 伊内丝: 回合结束时 使自身已激活盟约 +N（精锐翻倍）。 */
H.BABEL_ROUND_OWN_BOND = {
  onPrepEnd(ctx) {
    const n = num(ctx.source.bb?.own, B.inesRound[0]);
    if (!(n > 0)) return;
    // 「使自身已激活盟约+N」: 取本干员自身的盟约（ctx.pieceBonds = 自身 bonds + 变形同构体 grants）。
    // 旧代码写的是 ctx.sourceBonds?.()，但 makeCtx 从来没有这个成员 → ?? [] 让循环空转，本条特质一直无效。
    const piece = ctx.source.piece;
    if (!piece) return;
    for (const bondId of ctx.pieceBonds(piece.uid)) {
      if (!ctx.bondActive(bondId)) continue;
      ctx.addLayers(bondId, n, { requireActive: true, reason: 'garrison:babel-round' });
    }
  },
};

/**
 * 升变（1 名）needs to know which of the three 阿米娅 sit on the 备战席 (hand): a battle only ever sees the board
 * units, so the prep side publishes the bench here. `contentInfo.babelBench` = { [traitEffectKey]: { elite } } of
 * every 阿米娅 (术士 / 近卫 / 医疗) piece in the hand, keyed by the effectKey of its 升变 trait (content/babel.js
 * AMIYA_TRAITS). The handler is a global, registered after support/meta.js's `contentb_info`, so `contentInfo` exists.
 */
const AMIYA_TRAIT_EFFECT_KEYS = Object.freeze(['BABEL_FRONT_SKILL_LAYER', 'BABEL_BACK_SKILL_LAYER', 'BABEL_ANY_SKILL_LAYER']);

const babelBenchInfo = {
  onBattleStart(ctx, ev) {
    if (!ev || !ev.input || typeof ev.input !== 'object') return;
    const ci = ev.input.contentInfo && typeof ev.input.contentInfo === 'object'
      ? ev.input.contentInfo : (ev.input.contentInfo = {});
    const bench = {};
    let hand = [];
    try { hand = ctx.hand() || []; } catch { hand = []; }
    for (const p of hand) {
      if (!p || p.kind !== 'chess') continue;
      const rec = ctx.chessRecord(p.id);
      if (!rec) continue;
      for (const gid of (Array.isArray(rec.garrisonIds) ? rec.garrisonIds : [])) {
        const g = ctx.gd.garrison(gid);
        if (g && AMIYA_TRAIT_EFFECT_KEYS.includes(g.effectKey)) bench[g.effectKey] = { elite: !!rec.isGolden };
      }
    }
    ci.babelBench = bench;
    // 同形态阿米娅现在可以在场多名（placement.js 只禁「不同形态」），所以「三形态是否都齐了」不能只看备战席 ——
    // 场上已有的形态要一并算进去。babel.js 的 allAmiyaElite / 形态折算都读这个集合。
    const field = new Set();
    let board = [];
    try { board = ctx.board() || []; } catch { board = []; }
    for (const p of board) {
      if (!p || p.kind !== 'chess') continue;
      const rec = ctx.chessRecord(p.id);
      if (!rec) continue;
      for (const gid of (Array.isArray(rec.garrisonIds) ? rec.garrisonIds : [])) {
        const g = ctx.gd.garrison(gid);
        if (g && AMIYA_TRAIT_EFFECT_KEYS.includes(g.effectKey)) {
          field.add(g.effectKey);
          if (!bench[g.effectKey]) bench[g.effectKey] = { elite: !!rec.isGolden, onField: true };
        }
      }
    }
    ci.babelFieldForms = [...field];
  },
};

/** Global handler: the 资金 → 层数 / 永久加成 pipeline, and the layer milestones. */
const babelGlobal = {
  onSpend(ctx, ev) { babelOnSpend(ctx, ev?.amount); },
  /**
   * 层数首次到达 50 / 100 / 150 / 200 → 发对应干员（赫德雷 / 伊内丝 / W / 维什戴尔，BABEL_MILESTONES）。
   *
   * 2026-10-12 修（用户「巴别塔层数到了不发干员」）：原先只在「消费 → 加层」那条管线里查一次里程碑，
   * 而加层的来源远不止消费 —— 伊内丝的回合结束特质、战斗里的 BABEL_*_LAYER 特质都由 settle.js
   * **直接写 ps.layers**（不经过 ps.addLayers），跨过 50/100/150/200 时永远不发奖。
   * 改挂 onLayers 派发：addLayers / settle / factions 三条加层路径都会 dispatch 它。
   * 幂等由 babelMilestones 的 `babel:claimed:<层>` 计数器保证，所以与任何其它调用点都不会重复发。
   */
  onLayers(ctx, ev) {
    if (!ev || ev.bondId !== BABEL_BOND) return;
    if (!ctx.bondActive(BABEL_BOND)) return;
    const from = Math.max(0, num(ev.from));
    const to = Math.max(from, num(ev.to, from));
    if (to > from) babelMilestones(ctx, from, to);
    // 3 人档新增（用户 2026-10-16）：巴别塔每叠满 `layerFundEvery` 层 → 下回合 +`layerFundAmount` 资金。
    // 跨过的整 30 层档位用 `babel:layerFund:max` 记峰值（无论是否处于 3 人档都推进，避免重复发放），
    // 但只在该档（≥ layerFundTier 名不同巴别塔干员在场）时才真正发钱；低于该档跨过的档位不计、也不补发。
    const every = Math.max(1, num(B.layerFundEvery, 30));
    const tier = Math.max(0, num(B.layerFundTier, 3));
    const amount = Math.max(0, num(B.layerFundAmount, 1));
    if (amount > 0) {
      const newMax = Math.floor(to / every) * every;
      const stored = ctx.counter('babel:layerFund:max');
      if (newMax > stored) {
        if (babelMembers(ctx) >= tier) ctx.addPendingFunds?.((newMax - stored) / every * amount);
        ctx.setCounter('babel:layerFund:max', newMax);
      }
    }
  },
};

/** Bond-level meta: 6 人档「立刻获得维什戴尔」在进入休整期时也补发一次（不消费也发）。 */
const babelBond = {
  onPrepStart(ctx) { grantImmediateTier(ctx, babelMembers(ctx)); },
};

/**
 * 升变（1 名）：**三名阿米娅都为精锐时，在休整区（备战席）的阿米娅也可叠层**。
 *
 * 「叠层」指的是三条阿米娅特质的开技能叠层（BABEL_*_SKILL_LAYER，战斗侧 babel.js 的 amiyaSkillLines 实现）。
 * 战斗只看得见场上的干员，所以这条规则必须在 prep 侧把备战席的精锐阿米娅也补进来：
 * 每次进入休整期（onPrepStart）时，若场上那名阿米娅 + 备战席两名都是精锐，就给**备战席**的阿米娅
 * 补发与在场阿米娅同等的层数（巴别塔 / 魔王 / 升变，按各自 garrison 的 bb 数值与该回合已用额度）。
 *
 * 幂等：以「回合」为单位记在 ctx.counter（babel:benchlayer:<回合>），同一回合重复进入休整期不重复发。
 */
const AMIYA_BENCH_LAYER_KEYS = Object.freeze(['BABEL_FRONT_SKILL_LAYER', 'BABEL_BACK_SKILL_LAYER', 'BABEL_ANY_SKILL_LAYER']);

const babelBenchLayers = {
  onPrepStart(ctx) {
    const EVOLVE_BOND = BABEL_ADDON_BONDS.evolve;
    if (!ctx.bondActive(EVOLVE_BOND)) return;
    const board = ctx.board();
    let fieldAmiya = null;
    const benchAmiyas = [];
    const seen = new Set();
    for (const p of board) {
      if (!p || p.kind !== 'chess') continue;
      const rec = ctx.chessRecord(p.id);
      if (!rec) continue;
      const gid = (Array.isArray(rec.garrisonIds) ? rec.garrisonIds : []).find((x) => {
        const gg = ctx.gd.garrison(x);
        return gg && AMIYA_BENCH_LAYER_KEYS.includes(gg.effectKey);
      });
      if (!gid) continue;
      seen.add(p.uid);
      if (!fieldAmiya) fieldAmiya = { uid: p.uid, id: p.id, gid, elite: !!rec.isGolden };
    }
    let hand = [];
    try { hand = ctx.hand() || []; } catch { hand = []; }
    for (const p of hand) {
      if (!p || p.kind !== 'chess' || seen.has(p.uid)) continue;
      const rec = ctx.chessRecord(p.id);
      if (!rec) continue;
      const gid = (Array.isArray(rec.garrisonIds) ? rec.garrisonIds : []).find((x) => {
        const gg = ctx.gd.garrison(x);
        return gg && AMIYA_BENCH_LAYER_KEYS.includes(gg.effectKey);
      });
      if (gid) benchAmiyas.push({ uid: p.uid, id: p.id, gid, elite: !!rec.isGolden });
    }
    if (!fieldAmiya || benchAmiyas.length === 0) return;
    // 三名阿米娅都为精锐：在场那名 + 备战席每一名都必须是精锐
    if (!fieldAmiya.elite || !benchAmiyas.every((b) => b.elite)) return;

    const round = Math.max(1, num(ctx.round, 1));
    const stamp = `babel:benchlayer:${round}`;
    if (ctx.counter(stamp) > 0) return;   // 本回合已发过
    ctx.setCounter(stamp, 1);

    // 每个备战席阿米娅补发与在场阿米娅同等的层数（按各自 trait 的 bb）
    for (const b of benchAmiyas) {
      const g = ctx.gd.garrison(b.gid);
      if (!g) continue;
      const n = Math.max(0, num(g.bb.babel, 0));
      if (n <= 0) continue;
      ctx.addLayers(g.bbStr?.babel_bond_id || BABEL_BOND, n, { requireActive: false, reason: 'babel:bench_amiya' });
      const addon = Math.max(0, num(g.bb.visi ?? g.bb.preci ?? g.bb.demon, 0));
      if (addon > 0) {
        ctx.addLayers(g.bbStr?.demon_bond_id || BABEL_ADDON_BONDS.demon, addon, { requireActive: false, reason: 'babel:bench_amiya' });
      }
      const ev = Math.max(0, num(g.bb.evolve, 0));
      if (ev > 0) ctx.addLayers(g.bbStr?.evolve_bond_id || EVOLVE_BOND, ev, { requireActive: false, reason: 'babel:bench_amiya' });
    }
  },
};

export function registerMeta(registry) {
  for (const [key, handler] of Object.entries(H)) registry.garrison(key, handler);
  registry.global('babel_tower', babelGlobal);
  registry.global('babel_bench', babelBenchInfo);
  registry.global('babel_bench_layers', babelBenchLayers);
  registry.bond(BABEL_BOND, babelBond);
}

export default { registerMeta, babelOnSpend, babelMilestones, babelLayersFromSpend, babelStepsFromSpend, buffStepsOf };
