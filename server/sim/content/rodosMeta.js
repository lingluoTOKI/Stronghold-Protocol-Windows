// 罗德岛 prep 侧 —— 用户 2026-10-15 全量重写。
// 战斗结果（胜/负）→ RODOS_TIERS 叠层；层数跨过新档位 → 赠予（顺延）。
// 2026-10-16 全量恢复个体特质：用户「所有盟约效果和干员特质是否全部生效，失效则修复」→ 同族的 24 条记录
// （RODOS_BATTLE_END / RODOS_ROUND_TOP_LAYER / RODOS_STARTER_ADDON / RODOS_STARTER_TOP / RODOS_TOP_BOND_LAYER）
// 原本只剩文本（2026-10-15 重写时 registerMeta 被改成空实现），现在全部接回处理器；数值一律读各自 garrison 的
// bb / bbStr，代码里不写死（详见文件末尾的 H 表）。
import { RODOS_BOND, RODOS_TIERS, RODOS_BALANCE, RODOS_OPERATOR_MILESTONES, rodosCrossedMilestones } from '../../../shared/rodosIsland.js';
import { gameData } from './support/index.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));

/** 在场不同【罗德岛】干员数（按基础棋子 baseId 去重）。 */
function rodosOnField(ctx) {
  const seen = new Set();
  for (const piece of ctx.board()) {
    if (piece.kind !== 'chess') continue;
    if (!ctx.pieceBonds(piece.uid).includes(RODOS_BOND)) continue;
    seen.add(piece.baseId || piece.chessId);
  }
  return seen.size;
}

/**
 * 本场战斗的罗德岛叠层：胜 +win，负 +perLifeLost × 已损生命。
 * 按在场人数取最高档（3/6/9），不足 3 人不叠。
 */
export function rodosBattleLayers(ctx, { won, lifeLost = 0 }) {
  if (!ctx.bondActive(RODOS_BOND)) return 0;
  const n = rodosOnField(ctx);
  let tier = null;
  for (const t of RODOS_TIERS) if (n >= t.count) tier = t;
  if (!tier) return 0;
  const add = won ? tier.win : tier.perLifeLost * Math.max(0, lifeLost);
  if (!(add > 0)) return 0;
  return ctx.addLayers(RODOS_BOND, add, { requireActive: true, reason: won ? 'rodos:win' : 'rodos:loss' });
}

/** 该干员是否"已精锐"：通过 grantChess 返回 null / 玩家已拥有 _b 来判断。 */
function isOperatorAlreadyElite(ctx, chessId) {
  const rec = gameData().chess(chessId);
  if (!rec) return false;
  // 1) 干员记录本身就是精锐（_b）
  if (rec.isGolden) return true;
  // 2) 玩家已拥有 _b 精锐版
  const goldenId = gameData().goldenIdOf?.(chessId);
  if (goldenId && goldenId !== chessId && ctx.ownsChess?.(goldenId)) return true;
  return false;
}

/** 赠予（带顺延）；不递归下调档位（不回头），仅在数组内往前推进。 */
function grantOperatorWithSkip(ctx, startIdx) {
  for (let i = startIdx; i < RODOS_OPERATOR_MILESTONES.length; i++) {
    const m = RODOS_OPERATOR_MILESTONES[i];
    if (!ctx.ownsChess || isOperatorAlreadyElite(ctx, m.id)) continue; // 跳过精锐
    const got = ctx.grantChess?.(m.id);
    if (got) return { idx: i, milestone: m };
  }
  return null;
}

/** 跨过的新档位全部发放；operator 档应用"精锐顺延"（连续跳过已精锐并 claim 整段）。 */
export function rodosMilestones(ctx, before, after, claimed) {
  const out = [];
  const crossed = rodosCrossedMilestones(before, after, claimed);
  for (const m of crossed) {
    if (m.kind === 'chess') {
      const startIdx = RODOS_OPERATOR_MILESTONES.findIndex((x) => x.at === m.at);
      if (startIdx < 0) continue;
      const result = grantOperatorWithSkip(ctx, startIdx);
      // claim 从原档位到最终发放档（含顺延掉的）
      const endIdx = result ? result.idx : startIdx;
      for (let k = startIdx; k <= endIdx; k++) claimed.add(RODOS_OPERATOR_MILESTONES[k].at + ':chess');
      if (result) out.push(result.milestone);
    } else if (m.kind === 'item') {
      try { ctx.grantItem?.(m.id, m.count ?? 1); } catch { /* */ }
      claimed.add(m.at + ':item');
      out.push(m);
    } else if (m.kind === 'funds') {
      try { ctx.addPendingFunds?.(m.count ?? 0); } catch { /* */ }
      claimed.add(m.at + ':funds');
      out.push(m);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// garrison 特质处理器（2026-10-16 部分恢复）。
//
// 罗德岛「战斗结束 · 层数」一族在 2026-10-15 全量重写时被整体停用（本文件的 registerMeta 当时改成了空实现），
// 可是 settle.js 仍然照常在结算里 `dispatch(ps, 'onBattleEnd', …)` 派发这批 garrison（那里的注释就写着
// 「战斗结束 traits (罗德岛 5 本 / 6 本): 完美作战 pays the flat amount, anything else pays once per point of
// target life lost」）—— 于是它们变成了"只有文本、不生效"。
//
// 2026-10-16 第二次裁定（用户：「所有盟约效果和干员特质是否全部生效，失效则修复」）→ **同族全部接回**：
//   · 可露希尔 `RODOS_END_LAYERS`       战斗结束：完美 / 按已损生命 给【罗德岛】与【先锋】加层
//   · 迷迭香   `RODOS_LAYER_EXTRA_STEP` 休整期结束时：【罗德岛】与【狙击】各「每叠 5 层额外 +1」（级联，
//                                        两个盟约各自整局累计封顶：普通 +10 / 精锐 +20）
//   · `RODOS_BATTLE_END`        ×10  战斗结束：炎狱炎熔 / 濯尘芙蓉 / 承曦格雷伊 / 历阵锐枪芬 / 撷英调香师
//   · `RODOS_ROUND_TOP_LAYER`   ×2   休整期结束时：调香师 —— 最高盟约 + 罗德岛
//   · `RODOS_STARTER_ADDON`     ×6   休整期结束时：芬 / 炎熔 / 克洛丝 —— 自身攻防血 + 对应盟约
//   · `RODOS_STARTER_TOP`       ×2   休整期结束时：芙蓉 —— 自身攻防血 + 最高盟约
//   · `RODOS_TOP_BOND_LAYER`    ×4   售出时：格雷伊 / 泥岩 —— 最高盟约 + 下回合资金
// 「自身攻击力、防御力、生命值 +X%」在 prep 侧没有直接的干员属性通道，走 counters 带出去
// （`rodos:selfStat:<uid>` → JSON），战斗侧在 content/rodos.js 的 install 里按 uid 落到单位上。
const H = {};

/** 该干员自己已激活的盟约（piece 的 bonds ∩ 当前激活）；历阵锐枪芬的「自身已激活的盟约」用它。 */
function ownActiveBonds(ctx) {
  const piece = ctx.source && ctx.source.piece;
  if (!piece || !Number.isInteger(piece.uid)) return [];
  const out = [];
  for (const id of ctx.pieceBonds(piece.uid)) if (ctx.bondActive(id)) out.push(id);
  return out;
}

/** 「当前激活层数最多的盟约」——并列取 bondIds 里的靠前者（与 support/meta.js 的 topActiveBondMeta 同口径）。 */
function topActiveBond(ctx) {
  const ids = ctx.gd && Array.isArray(ctx.gd.bondIds) ? ctx.gd.bondIds : Object.keys((ctx.data && ctx.data.bonds) || {});
  let best = null, bestLayers = -1;
  for (const id of ids) {
    if (!ctx.bondActive(id)) continue;
    const l = Math.max(0, Math.floor(num(ctx.layers(id), 0)));
    if (l > bestLayers) { bestLayers = l; best = id; }
  }
  return best;
}

/**
 * 「自身攻击力、防御力、生命值 +X%」—— 累加到 counters 的 `rodos:selfStat:<uid>`（JSON），跨回合持久，
 * 战斗侧 content/rodos.js 读它并按 uid 给单位挂 passiveBuff（同一块干员每回合 +20% 会累加）。
 */
function addSelfStat(ctx, bb) {
  const piece = ctx.source && ctx.source.piece;
  if (!piece || !Number.isInteger(piece.uid) || piece.uid <= 0) return;
  const add = { atkPct: num(bb.atk, 0), defPct: num(bb.def, 0), hpPct: num(bb.max_hp, 0) };
  if (!(add.atkPct > 0) && !(add.defPct > 0) && !(add.hpPct > 0)) return;
  const key = `rodos:selfStat:${piece.uid}`;
  let prev = {};
  try { prev = JSON.parse(ctx.counterText?.(key) || '{}') || {}; } catch { prev = {}; }
  const next = {
    atkPct: num(prev.atkPct, 0) + add.atkPct,
    defPct: num(prev.defPct, 0) + add.defPct,
    hpPct: num(prev.hpPct, 0) + add.hpPct,
  };
  ctx.setCounterText?.(key, JSON.stringify(next));
}

/** 一场战斗结算后的一条「完美 / 按已损生命」付款：完美给 flat，否则每损失 1 点给 per。 */
const battleEndPay = (bb, flatKey, perKey, perfect, lifeLost) =>
  (perfect ? num(bb[flatKey], 0) : num(bb[perKey], 0) * lifeLost);

/**
 * 可露希尔（罗德岛 6 本）战斗结束叠层 —— `RODOS_END_LAYERS`，eventType `SERVER_BATTLE_END`。
 *
 *   完美作战 →【罗德岛】+bb.rodos、【先锋】+bb.addon；
 *   非完美   → 每损失 1 点目标生命 →【罗德岛】+bb.rodos_per_life、【先锋】+bb.addon_per_life。
 *
 * 数值全部读 bb / bbStr（普通档与精锐档各带一份），代码里不写死。
 * 「每人每回合最多叠10层罗德岛」= 本特质这一发给【罗德岛】的加层上限（bb.rodos_cap，默认 10）—— 完美档的 +10
 * 正好顶在上限上；【先锋】那半没有上限（文案里也只给【罗德岛】写了上限）。
 * 两个盟约各自 requireActive：没激活的那条不加（与整族口径一致）。
 */
H.RODOS_END_LAYERS = {
  onBattleEnd(ctx, ev) {
    const bb = ctx.source.bb || {};
    const bbStr = ctx.source.bbStr || {};
    const rodosId = typeof bbStr.rodos_bond_id === 'string' ? bbStr.rodos_bond_id : RODOS_BOND;
    const addonId = typeof bbStr.addon_bond_id === 'string' ? bbStr.addon_bond_id : null;
    const perfect = !!(ev && (ev.perfect ?? ev.won));
    const lifeLost = Math.max(0, Math.floor(num(ev && (ev.lifeLost ?? ev.loss), 0)));
    const cap = Math.max(0, Math.floor(num(bb.rodos_cap, 10)));
    let rodos = perfect ? num(bb.rodos) : num(bb.rodos_per_life) * lifeLost;
    if (cap > 0) rodos = Math.min(cap, rodos);
    const addon = perfect ? num(bb.addon) : num(bb.addon_per_life) * lifeLost;
    let out = 0;
    if (rodos > 0) out += ctx.addLayers?.(rodosId, Math.round(rodos), { requireActive: true, reason: 'garrison:rodos-end' }) || 0;
    if (addon > 0 && addonId) out += ctx.addLayers?.(addonId, Math.round(addon), { requireActive: true, reason: 'garrison:rodos-end' }) || 0;
    return out;
  },
};

/**
 * 单条盟约的「每叠 `step` 层 → 额外 +`per` 层」结算（级联），返回实际加层数。
 *
 * `rodos:step:<bondId>`（玩家级、跨回合持久）＝ 本特质累计已发出去的层数（下面循环里的起点 `due` 就是它）；
 * `rodos:step:<bondId>:extra` 另记"本特质累计给这条盟约加了多少层"，只用来夹 `cap`。
 * `cap <= 0` = 不限。
 */
function payExtraStep(ctx, bondId, step, per, cap) {
  if (!bondId) return 0;
  if (typeof ctx.bondActive === 'function' && !ctx.bondActive(bondId)) return 0;
  const key = `rodos:step:${bondId}`;
  const extraKey = `${key}:extra`;
  const paid = Math.max(0, Math.floor(num(ctx.counter?.(key), 0)));
  const extraPaid = Math.max(0, Math.floor(num(ctx.counter?.(extraKey), 0)));
  if (cap > 0 && extraPaid >= cap) return 0; // 整局累计加满 → 不再给
  const cur = Math.max(0, Math.floor(num(ctx.layers?.(bondId), 0)));
  let total = cur, due = paid;
  for (let i = 0; i < 64; i++) {
    const want = Math.floor(total / step) * per;
    if (want > due) { total += want - due; due = want; }
    else break;
  }
  let add = total - cur;
  if (cap > 0) add = Math.min(add, cap - extraPaid);
  if (!(add > 0)) return 0;
  const added = ctx.addLayers?.(bondId, add, { requireActive: true, reason: 'garrison:rosmon-step' }) || 0;
  if (added > 0) {
    ctx.setCounter?.(key, paid + added);
    ctx.setCounter?.(extraKey, extraPaid + added);
  }
  return added;
}

/**
 * 迷迭香（罗德岛 6 本）—— `RODOS_LAYER_EXTRA_STEP`，eventType `SERVER_PREP_FIN`。
 *
 * 「【罗德岛】每叠 `layers_per_step`（默认 5）层，层数额外 +`extra_per_step`（默认 1）；
 *   **额外加上去的层数也计入下一档**（用户 2026-10-16 的「额外+5也视为每叠5层」）；
 *   【狙击】同样一份（用户 2026-10-16 第二次调整：「狙击层数也额外+1，额外层数最多+10，精锐为20」）」
 *
 * 两个目标各按一次 `payExtraStep`：
 *   · 主目标 = `bbStr.bond_id`（默认【罗德岛】），额外上限 `bb.extra_cap`
 *   · 第二目标 = `bbStr.addon_bond_id`（迷迭香 =【狙击】），额外上限 `bb.addon_extra_cap`
 *   `*_cap` 是 **整局累计上限**（本特质给该盟约总共加过多少层），0 / 缺省 = 不限。
 *   两个目标是两条独立账（各自的 `rodos:step:*` 与 `:extra`），互不影响。
 *
 * 口径：本特质对某条盟约的"应发总量"= ⌊当前层数 / step⌋ · per 的级联不动点
 * （每轮把新发的层数再计入下一档）。**已发过多少记在 counter 里**（`rodos:step:<bondId>`）—— 于是
 *   · 首次：25 层 → 应发 5 → 发完 30 层 → 应发 6 → 再发 1 → 31 层（合计 +6，就是级联）；
 *   · 再跑一次：31 层应发 6、已发 6 → 不发（幂等）；
 *   · 之后盟约又长了 10 层（41）：应发 8、已发 6 → 补 +2；
 *   · 累计额外到 cap（普通 10 / 精锐 20）→ 此后这条盟约不再给。
 * 只用"当前层数"做不动点而不记 counter 的话，第二回合会把自己上一回合发的层当成新的底数，一路滚雪球
 * （实测 25 → 31 之后第二次派发又 +7），所以必须记账。
 * 目标盟约没激活就不发（requireActive）。
 */
H.RODOS_LAYER_EXTRA_STEP = {
  onPrepEnd(ctx) {
    const bb = ctx.source.bb || {};
    const bbStr = ctx.source.bbStr || {};
    const step = Math.max(1, Math.floor(num(bb.layers_per_step, 5)));
    const per = Math.max(0, Math.floor(num(bb.extra_per_step, 1)));
    if (!(per > 0)) return 0;
    const mainId = typeof bbStr.bond_id === 'string' && bbStr.bond_id ? bbStr.bond_id : RODOS_BOND;
    let out = payExtraStep(ctx, mainId, step, per, Math.max(0, Math.floor(num(bb.extra_cap, 0))));
    const addonId = typeof bbStr.addon_bond_id === 'string' && bbStr.addon_bond_id ? bbStr.addon_bond_id : null;
    if (addonId && addonId !== mainId) {
      out += payExtraStep(ctx, addonId, step, per, Math.max(0, Math.floor(num(bb.addon_extra_cap, 0))));
    }
    return out;
  },
};

/**
 * 罗德岛 5 / 6 本的「战斗结束时」叠层 —— `RODOS_BATTLE_END`，eventType `SERVER_BATTLE_END`（10 条记录）。
 *
 *   主目标：`bb.rodos` / `bb.rodos_per_life`（完美 / 每损 1 点），目标 = `bbStr.rodos_bond_id`（默认【罗德岛】）。
 *     例外：desc 写「使自身已激活的盟约层数」的那条（历阵锐枪芬）→ 目标是**该干员自己的全部已激活盟约**。
 *   `bb.rodos_cap`（默认 10）只截【罗德岛】那一份（文案「每人每回合最多叠10层罗德岛」）。
 *   第二目标（可选，三种取其一）：
 *     · `top`  / `top_per_life`    →「当前激活层数最多的盟约」（在加层**之前**取，cap `top_cap`）
 *     · `addon`/ `addon_per_life`  → `bbStr.addon_bond_id`（cap `addon_cap`）
 *     · `second`/`second_per_life` → `bbStr.second_bond_id`（cap `second_cap`）
 *   所有加层都 requireActive（没激活的盟约不加）。
 */
H.RODOS_BATTLE_END = {
  onBattleEnd(ctx, ev) {
    const bb = ctx.source.bb || {};
    const bbStr = ctx.source.bbStr || {};
    const perfect = !!(ev && (ev.perfect ?? ev.won));
    const lifeLost = Math.max(0, Math.floor(num(ev && (ev.lifeLost ?? ev.loss), 0)));
    // 最高盟约必须在加层之前算（加【罗德岛】可能改变最高盟约）
    const topId = topActiveBond(ctx);

    const rodosId = typeof bbStr.rodos_bond_id === 'string' && bbStr.rodos_bond_id ? bbStr.rodos_bond_id : RODOS_BOND;
    const desc = String((ctx.source.garrison && ctx.source.garrison.desc) || '');
    const targets = /自身已激活的盟约/.test(desc) ? (ownActiveBonds(ctx).length ? ownActiveBonds(ctx) : [rodosId]) : [rodosId];
    const cap = Math.max(0, Math.floor(num(bb.rodos_cap, 10)));
    const main = battleEndPay(bb, 'rodos', 'rodos_per_life', perfect, lifeLost);
    for (const bondId of targets) {
      let n = main;
      if (bondId === rodosId && cap > 0) n = Math.min(cap, n);
      if (n > 0) ctx.addLayers?.(bondId, Math.round(n), { requireActive: true, reason: 'garrison:rodos-battle-end' });
    }

    let secondId = null, secondN = 0, secondCap = 0;
    if (num(bb.top, 0) > 0 || num(bb.top_per_life, 0) > 0) {
      secondId = topId; secondN = battleEndPay(bb, 'top', 'top_per_life', perfect, lifeLost); secondCap = num(bb.top_cap, 0);
    } else if (num(bb.addon, 0) > 0 || num(bb.addon_per_life, 0) > 0) {
      secondId = typeof bbStr.addon_bond_id === 'string' ? bbStr.addon_bond_id : null;
      secondN = battleEndPay(bb, 'addon', 'addon_per_life', perfect, lifeLost); secondCap = num(bb.addon_cap, 0);
    } else if (num(bb.second, 0) > 0 || num(bb.second_per_life, 0) > 0) {
      secondId = typeof bbStr.second_bond_id === 'string' ? bbStr.second_bond_id : null;
      secondN = battleEndPay(bb, 'second', 'second_per_life', perfect, lifeLost); secondCap = num(bb.second_cap, 0);
    }
    if (secondId && secondN > 0) {
      if (secondCap > 0) secondN = Math.min(secondCap, secondN);
      ctx.addLayers?.(secondId, Math.round(secondN), { requireActive: true, reason: 'garrison:rodos-battle-end' });
    }
  },
};

/**
 * 调香师 5 本 —— `RODOS_ROUND_TOP_LAYER`，eventType `SERVER_PREP_FIN`（2 条）。
 *   <休整期结束时> 当前激活层数最多的盟约 +`bb.top`，【罗德岛】+`bb.rodos`（此干员在备战席也有效）。
 *   「每人每回合最多叠10层罗德岛」→ bb.rodos_cap（默认 10）只截【罗德岛】那一份。最高盟约先取、后加层。
 */
H.RODOS_ROUND_TOP_LAYER = {
  onPrepEnd(ctx) {
    const bb = ctx.source.bb || {};
    const bbStr = ctx.source.bbStr || {};
    const rodosId = typeof bbStr.rodos_bond_id === 'string' && bbStr.rodos_bond_id ? bbStr.rodos_bond_id : RODOS_BOND;
    const topId = topActiveBond(ctx);
    const topN = num(bb.top, 0);
    if (topId && topN > 0) ctx.addLayers?.(topId, Math.round(topN), { requireActive: true, reason: 'garrison:rodos-round-top' });
    const cap = Math.max(0, Math.floor(num(bb.rodos_cap, 10)));
    let n = num(bb.rodos, 0);
    if (cap > 0) n = Math.min(cap, n);
    if (n > 0) ctx.addLayers?.(rodosId, Math.round(n), { requireActive: true, reason: 'garrison:rodos-round-top' });
  },
};

/**
 * 芬 / 炎熔 / 克洛丝 1 本 —— `RODOS_STARTER_ADDON`，eventType `SERVER_PREP_FIN`（6 条）。
 *   <休整期结束时> 自身 攻/防/血 +`bb.atk`/`bb.def`/`bb.max_hp`（累加），并给 `bbStr.addon_bond_id`
 *   （先锋 / 术师 / 狙击）加 `bb.addon` 层（还有 `bb.rodos`，数据里为 0）。
 */
H.RODOS_STARTER_ADDON = {
  onPrepEnd(ctx) {
    const bb = ctx.source.bb || {};
    const bbStr = ctx.source.bbStr || {};
    addSelfStat(ctx, bb);
    const rodosId = typeof bbStr.rodos_bond_id === 'string' && bbStr.rodos_bond_id ? bbStr.rodos_bond_id : RODOS_BOND;
    const n = num(bb.rodos, 0);
    if (n > 0) ctx.addLayers?.(rodosId, Math.round(n), { requireActive: true, reason: 'garrison:rodos-starter' });
    const addonId = typeof bbStr.addon_bond_id === 'string' ? bbStr.addon_bond_id : null;
    const m = num(bb.addon, 0);
    if (addonId && m > 0) ctx.addLayers?.(addonId, Math.round(m), { requireActive: true, reason: 'garrison:rodos-starter' });
  },
};

/**
 * 芙蓉 1 本 —— `RODOS_STARTER_TOP`，eventType `SERVER_PREP_FIN`（2 条）。
 *   <休整期结束时> 自身 攻/防/血 +`bb.atk`/`bb.def`/`bb.max_hp`（累加），当前激活层数最多的盟约 +`bb.top`。
 */
H.RODOS_STARTER_TOP = {
  onPrepEnd(ctx) {
    const bb = ctx.source.bb || {};
    addSelfStat(ctx, bb);
    const n = num(bb.top, 0);
    if (n > 0) {
      const topId = topActiveBond(ctx);
      if (topId) ctx.addLayers?.(topId, Math.round(n), { requireActive: true, reason: 'garrison:rodos-starter-top' });
    }
  },
};

/**
 * 格雷伊 / 泥岩 —— `RODOS_TOP_BOND_LAYER`，eventType `SERVER_CHESS_SOLD`（4 条）。
 *   售出时 当前激活层数最多的盟约 +`bb.top`，下回合资金 +`bb.funds`。
 */
H.RODOS_TOP_BOND_LAYER = {
  onSold(ctx) {
    const bb = ctx.source.bb || {};
    const n = num(bb.top, 0);
    if (n > 0) {
      const topId = topActiveBond(ctx);
      if (topId) ctx.addLayers?.(topId, Math.round(n), { requireActive: true, reason: 'garrison:rodos-sell' });
    }
    const funds = num(bb.funds, 0);
    if (funds > 0) ctx.addPendingFunds?.(Math.round(funds));
  },
};

export function registerMeta(registry) {
  for (const [key, handler] of Object.entries(H)) registry.garrison(key, handler);
}
export default { registerMeta, rodosBattleLayers, rodosMilestones };
void RODOS_BALANCE; // 留作可读性 / 外部计算
