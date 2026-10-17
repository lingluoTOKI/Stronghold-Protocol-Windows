// server/sim/content/bands/meta.js — prep side of the 40 strategies (bands, data/bands.json).
//
// Every band handler is assembled from the band's buffs by their official buff key (numbers from bb / bbStr, never
// hard-coded); keys that only act in battle (env_gbuff_new_with_verify, auto_chess_change_map) live in battle.js.
// Starting LP (totalHp) and 坎诺特's leftover funds are the match's own rules.
//
//   prep_finish_char_bond_add_layer {layer}            华法琳   prep end: per distinct board tier, 1 random op → its bonds +layer (无需激活)
//   band_first_self_refresh_present_char {count,bond}  杜遥夜   first 2 manual refreshes/round: ≥count <bond> chess (tier ≤ shop level)
//   band_shop_refresh_copy_max_lv_char {count}         梓兰     every manual refresh: highest-tier shop chess copied into another slot, copy frozen
//   preparation_start_gain_chess_from_round {round}    梓兰/小贾斯汀/昆图斯/马克维茨/变形者集群/Pith/夕/杰西卡/缪尔赛思/芬  round start of `round`: bbStr.chess
//                                                              —— 无 bbStr.chess 时改用 bbStr.bond + bb.tier：随机一名该盟约、至多 `tier` 阶的干员（凯尔希策略）；
//                                                                 可再给 bbStr.pool（候选干员名单）+ bbStr.noRepeat（每人只发一次，位掩码存玩家 counters，跨回合记忆）
//   preparation_start_gain_chess_every_n_round {round} 杜宾     every `round` rounds (round % n = 0): bbStr.chess
//   give_coin_in_round {round,coin}                    老鲤     income of round `round` = coin (R1/R2 0, R3 15)
//   prep_start_gain_chess_from_pool_in_round {round}   老鲤     round start of `round`: 1 chess of pool
//   band_coin_cost_gain_random_char_by_shop_level      绮良     every coin_cnt funds spent → count random chess ≤ shop level
//   up_shop_next_refresh_must_present_bond_char        佩佩     level-up to a level of lvlist → the next manual refresh (its usual
//                                                               price) prefers <bond>
//   gain_bond_char_per_round {round,preround,bond}     哈洛德   rounds round, round+preround, …: a <bond> chess (≤ shop level, else any tier)
//   first_buy_in_round_char_price_change {price,bond}  休露丝   first <bond> chess of the round costs `price` (bought in the
//                                                               shop: onBuy — a free pick / grant never uses it up)
//   band_rodos_tier_char_price_change {price,tier,bond} 凯尔希   购买 `tier` 阶及以下的 <bond> 干员只需 `price` 资金（每一笔）
//   band_cost_coin_reach_cnt_gain_chess_from_pool      潘格尼尼 once coin_cnt funds spent in total: 1 chess of pool (elite 拉特兰 ≥ T4)
//   round_start_bond_check_gain_layer                  余       round start of `round`: exactly factioncount active bonds → +count1, else each active +count2
//                                                               — never to a bond without layers (noStack; the owner's decision of 2026-10-08)
//   up_shop_add_special_goods {count,choice,pool}      凯瑟琳   every level-up: pick 1 of `count` items of pool (free)
//   coin_carry_over {capital,interest,max}             坎诺特   leftover ≥ capital at round start → +min(max, ⌊left/capital⌋×interest) income
//   round_start_all_player_change_enemy_2              鸭爵     global: every alive player's battle from `round` (own + teammates;
//                                                                normal, Final Assault, Hidden Core — on the player's half of a
//                                                                pair field): 0–2 ground enemies → enemylist
//   round_start_activate_char_chess_effect_in_board    铃兰     round start: 获得时 traits of the right-most (then bottom-most) board op with one
//   first_sell_char_chess_exchange_char_chess_in_shop  巫恋     first sale of a normal op per round: swapped with a random shop chess (no funds)
//   round_start_gain_char_chess_in_shop_every_n_round  松桐     round % n = 0: a random shop chess for free (its slot empties)
//   round_start_gain_coin_by_bond_char_chess_buy       玛恩纳   each <bond> chess bought → +count funds next round (≤ max_count / round)
//   refresh_shop_count_gain_coin_bond_char_chess       贾维     every refresh_count manual refreshes (match total) → <bond> chess ≤ shop level (≤ max_count / round)
//   preparation_start_add_special_goods_every_n_round  娜仁图亚 round % n = 0: pick choice_cnt of refresh_cnt items of pool (free)
// "进入休整期时" / "回合开始时" = onRoundStart (research 01 §5 step 6).

import { GEO } from '../../../../shared/constants.js';
import { bbCap } from '../../../../shared/plugins/officialBounds.js';
import { burstLimit } from '../../../../shared/plugins/steps.js';
import { buffsOf, num, bandRecord, gameData } from '../support/index.js';
import { metaBonds } from '../support/meta.js';
import { msg } from '../../../../shared/i18n.js';
import { RODOS_BOND } from '../../../../shared/rodosIsland.js';
import * as garrisons from '../garrisons.js';

const int = (v, d = 0) => Math.trunc(num(v, d));
// [ASSUMED] DESIGN §32.5: bb.count grant and slot loops share the official `count` cap. Read at call time.
const timesOf = (v, d = 1) => Math.min(bbCap('count'), Math.max(1, int(v, d)));
const list = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const hasBond = (ctx, id, bond) => { const c = ctx.gd.chess(id); return !!(c && Array.isArray(c.bonds) && c.bonds.includes(bond)); };
const isNormalChess = (ctx, id) => { const c = ctx.gd.chess(id); return !!(c && !c.isGolden); };

/** Per-round counter: reset lazily when the round changes. */
function roundCounter(ctx, key) {
  if (ctx.counter(`${key}:r`) !== ctx.round) { ctx.setCounter(`${key}:r`, ctx.round); ctx.setCounter(key, 0); }
  return ctx.counter(key);
}
const bumpRound = (ctx, key, n = 1) => { roundCounter(ctx, key); return ctx.incCounter(key, n); };

/** Grant a chess or an item by id. */
function grant(ctx, id, opts = {}) {
  if (ctx.gd.item(id)) return ctx.grantItem(id, opts);
  if (ctx.gd.chess(id)) return ctx.grantChess(id, opts);
  return null;
}

/** Indices of unsold chess slots of the shop. */
const chessSlots = (ctx) => ctx.shopSlots().map((s, i) => (s && s.kind === 'chess' && !s.sold ? i : -1)).filter((i) => i >= 0);

/** Up to `n` distinct item ids of an equip pool. */
function rollItems(ctx, poolId, n) {
  const out = [];
  for (let k = 0; k < n * 6 && out.length < n; k++) {
    const r = ctx.rollPool(poolId);
    if (!r || r.kind !== 'item') break;
    if (!out.includes(r.id)) out.push(r.id);
  }
  return out;
}

/** Random chess of `bond`, tier ≤ shop level (fallback: any tier when `anyTier`). */
function rollBond(ctx, bond, { anyTier = false } = {}) {
  return ctx.rollChess({ bond, maxTier: Math.max(1, ctx.shopLevel()) }) || (anyTier ? ctx.rollChess({ bond, maxTier: 6 }) : null);
}

/**
 * 一件**精锐装备**的物品 id：先按 `maxTier` 抽一件普通装备（走 `ctx.rollItem`，即商店可售的 EQUIP 池），
 * 再取它记录里的 `goldenId` 换成精锐版（`…_e_a → …_e_b`）。
 *
 * 注意 engine 的 `gd.goldenIdOf` 只认 chess、对物品返回 null（实测：76 件可售装备全部返回 null），
 * 所以这里必须直接读物品记录的 `goldenId`。抽不到普通件 / 没有精锐版时返回 null（调用方跳过本次发放）。
 * @returns {string|null} 精锐装备 id
 */
function rollEliteEquip(ctx, maxTier) {
  const base = ctx.rollItem({ maxTier });
  if (!base) return null;
  const rec = ctx.gd.item(base);
  if (!rec) return null;
  const gid = rec.goldenId || String(base).replace(/_a$/, '_b');
  const g = gid ? ctx.gd.item(gid) : null;
  return g && g.isGolden ? gid : null;
}

// ---------------------------------------------------------------------------------------------------------------
// buff key → (params[], bandId) → hooks

const K = {};

K.prep_finish_char_bond_add_layer = (ps) => ({
  onPrepEnd(ctx) {
    const n = int(ps[0].layer, 0);
    if (n <= 0) return;
    const byTier = new Map();
    for (const p of ctx.board()) {
      if (!p || p.kind !== 'chess') continue;
      const t = p.tier ?? ctx.gd.tierOf(p.id);
      if (!byTier.has(t)) byTier.set(t, []);
      byTier.get(t).push(p);
    }
    for (const t of [...byTier.keys()].sort((a, b) => a - b)) {
      const p = ctx.rng.pick(byTier.get(t));
      for (const b of metaBonds(ctx, p)) ctx.addLayers(b, n, { requireActive: false, reason: 'band' });
    }
  },
});

K.band_first_self_refresh_present_char = (ps) => ({
  onRefresh(ctx) {
    const p = ps[0];
    if ((ctx.roundStats().refreshes || 0) > 2) return;
    const need = timesOf(p.count, 1);
    const idx = chessSlots(ctx);
    const slots = ctx.shopSlots();
    let have = idx.filter((i) => hasBond(ctx, slots[i].id, p.bond)).length;
    const others = ctx.rng.shuffle(idx.filter((i) => !hasBond(ctx, slots[i].id, p.bond)));
    for (const i of others) {
      if (have >= need) break;
      const id = rollBond(ctx, p.bond);
      if (!id) break;
      ctx.setShopSlot(i, { kind: 'chess', id });
      have++;
    }
  },
});

K.band_shop_refresh_copy_max_lv_char = () => ({
  onRefresh(ctx) {
    const slots = ctx.shopSlots();
    const idx = chessSlots(ctx);
    if (idx.length < 2) return;
    let best = -1;
    for (const i of idx) best = Math.max(best, ctx.gd.tierOf(slots[i].id));
    const src = ctx.rng.pick(idx.filter((i) => ctx.gd.tierOf(slots[i].id) === best));
    const dst = ctx.rng.pick(idx.filter((i) => i !== src));
    ctx.setShopSlot(dst, { kind: 'chess', id: slots[src].id, frozen: true });
  },
});

K.preparation_start_gain_chess_from_round = (ps, bandId) => ({
  onRoundStart(ctx) {
    for (const p of ps) {
      const id = p.chess ?? p.chess_id;
      // bbStr.bond (+ bb.tier) instead of a fixed chess: a random <bond> chess at most `tier` 阶 (凯尔希策略's
      // 「每个回合获得一名一阶【罗德岛】干员」). bbStr.pool narrows it to a fixed roster and bbStr.noRepeat gives
      // each of them out once per match — see rollBondChess.
      const bond = !id ? (p.bond ?? null) : null;
      if (ctx.round !== int(p.round, -1) || (!id && !bond)) continue;
      for (let k = 0; k < Math.max(1, int(p.count, 1)); k++) {
        const rid = id || rollBondChess(ctx, p, bandId);
        if (rid) grant(ctx, rid, { requirePool: false, source: 'band' });
      }
    }
  },
});

/**
 * A random chess for a `bond`-based `preparation_start_gain_chess_from_round` buff. With `bbStr.pool` the roster is
 * that fixed list of chess ids (each entry given out at most once per match with `bbStr.noRepeat` — a bitmask over
 * `bbStr.pool` in the player's persistent counters, keyed per band, so it survives rounds and resets per match);
 * without it the buff rolls the shared pool like the original 随机一名<bond>干员 form.
 *
 * 开局 BAN 掉的干员跳过（「所有策略中，发的干员被ban了就不用发了」）：名单里的被禁者不再进入候选，所以那一回合
 * 会发给名单中剩下的、随机的那一个；名单全被禁（或已发完）时该回合不发。grantChess 里另有一道统一拦截。
 */
function rollBondChess(ctx, p, bandId) {
  const roster = Array.isArray(p.pool) && p.pool.length ? p.pool.map((x) => ctx.gd.baseIdOf(x)) : null;
  if (!roster) {
    const r = ctx.rollChess({ bond: p.bond ?? null, maxTier: Math.max(1, int(p.tier, 6)) });
    return typeof r === 'string' ? r : ((r && r.id) || null);
  }
  const maskKey = `band:${bandId ?? p.bond ?? 'bond'}:granted`;
  const mask = p.noRepeat ? int(ctx.counter(maskKey), 0) : 0;
  const allow = roster.filter((x, i) => !(mask & (1 << i)) && !ctx.isChessBanned(x));
  if (!allow.length) return null;
  const id = ctx.rng.pick(allow);
  if (id && p.noRepeat) {
    const i = roster.indexOf(id);
    if (i >= 0) ctx.setCounter(maskKey, mask | (1 << i));
  }
  return id;
}

K.preparation_start_gain_chess_every_n_round = (ps) => ({
  onRoundStart(ctx) {
    for (const p of ps) {
      const n = int(p.round, 0);
      const id = p.chess ?? p.chess_id;
      if (n <= 0 || ctx.round % n !== 0 || !id) continue;
      for (let k = 0; k < timesOf(p.count, 1); k++) grant(ctx, id, { source: 'band' });
    }
  },
});

K.give_coin_in_round = (ps) => ({
  onIncome(ctx, ev) {
    for (const p of ps) if (ctx.round === int(p.round, -1)) ev.income = Math.max(0, int(p.coin, 0));
  },
});

K.prep_start_gain_chess_from_pool_in_round = (ps) => ({
  onRoundStart(ctx) {
    for (const p of ps) {
      if (ctx.round !== int(p.round, -1)) continue;
      for (let k = 0; k < timesOf(p.count, 1); k++) {
        const r = ctx.rollPool(p.pool);
        if (r) grant(ctx, r.id, { source: 'band' });
      }
    }
  },
});

K.band_coin_cost_gain_random_char_by_shop_level = (ps) => ({
  onSpend(ctx, ev) {
    const p = ps[0];
    const step = int(p.coin_cnt, 0);
    if (step <= 0 || !(ev.amount > 0)) return;
    let acc = ctx.incCounter('band:kirara:acc', ev.amount);
    let guard = 0;
    const limit = burstLimit(10000); // [ASSUMED] one spend cannot grant more than this many shop rolls
    while (acc >= step && guard++ < limit) { // loop-cap: coin_cnt
      acc = ctx.incCounter('band:kirara:acc', -step);
      for (let k = 0; k < timesOf(p.count, 1); k++) {
        const id = ctx.rollChess({ maxTier: Math.max(1, ctx.shopLevel()) });
        if (id) ctx.grantChess(id, { source: 'band' });
      }
    }
  },
});

// 佩佩 博学多通 "升级调度中心至2、4和6级后，获得1次特殊刷新：此次刷新出现的干员优先为<萨尔贡>干员": the special refresh is the
// player's next manual refresh, paid as usual — the text gives no 免费 (德克萨斯's trait says 「获得1次免费刷新」 for a free
// one), and the community report of 2026-10-06 「佩佩策略的特殊刷新也是要花钱的，不是免费」. Until 0.2.0 a free refresh came
// with it (blackboard `price` 0 read as its price) [ASSUMED: `cnt` / `price` 0 change nothing].
K.up_shop_next_refresh_must_present_bond_char = (ps) => ({
  onLevelUp(ctx, ev) {
    const p = ps[0];
    if (!list(p.lvlist).map(Number).includes(ev.level)) return;
    ctx.incCounter('band:pepe:special', 1);
  },
  onRefresh(ctx) {
    if (ctx.counter('band:pepe:special') <= 0) return;
    ctx.incCounter('band:pepe:special', -1);
    const bond = ps[0].bond;
    const slots = ctx.shopSlots();
    for (const i of chessSlots(ctx)) {
      if (hasBond(ctx, slots[i].id, bond)) continue;
      const id = rollBond(ctx, bond);
      if (!id) break;
      ctx.setShopSlot(i, { kind: 'chess', id });
    }
  },
});

K.gain_bond_char_per_round = (ps) => ({
  onRoundStart(ctx) {
    const p = ps[0];
    const r0 = int(p.round, 1), every = Math.max(1, int(p.preround, 1));
    if (ctx.round < r0 || (ctx.round - r0) % every !== 0) return;
    for (let k = 0; k < timesOf(p.count, 1); k++) {
      const id = rollBond(ctx, p.bond, { anyTier: true });
      if (id) ctx.grantChess(id, { source: 'band' });
    }
  },
});

K.first_buy_in_round_char_price_change = (ps) => ({
  onPrice(ctx, ev) {
    const p = ps[0];
    if (ev.kind !== 'chess' || !hasBond(ctx, ev.id, p.bond)) return;
    if (ctx.counter('band:sciurus:r') === ctx.round) return;
    ctx.setPrice(Math.min(num(ev.price, 0), int(p.price, 1)));
  },
  onBuy(ctx, ev) {
    if (ev.kind === 'chess' && hasBond(ctx, ev.slot.id, ps[0].bond)) ctx.setCounter('band:sciurus:r', ctx.round);
  },
});

/**
 * 凯尔希策略 · 罗德岛制药：购买 `tier` 阶及以下的 <bond> 干员只需 `price` 资金（每一笔都用这个价，不限次数）。
 */
K.band_rodos_tier_char_price_change = (ps) => ({
  onPrice(ctx, ev) {
    const p = ps[0];
    if (ev.kind !== 'chess' || ev.id == null || !p.bond) return;
    const rec = ctx.gd.chess(ev.id);
    if (!rec || int(rec.tier, 99) > int(p.tier, 1)) return;
    if (!hasBond(ctx, ev.id, p.bond)) return;
    ctx.setPrice(Math.min(num(ev.price, 0), int(p.price, 1)));
  },
});

/**
 * 凯尔希 策略【罗德岛制药】(2026-10-13 用户规格): "首次生命值低于20，低于10，等于1时，获得泥岩，史尔特尔，可露希尔".
 *
 * 三档阈值，每档**每局只发一次**（进度存在玩家 counters 里，跨回合记忆）。判定口径按 bbStr.tiers：
 *   • `below: true`  → 生命值**低于** `lp`（严格小于：20 → <20，即 19 及以下才发）
 *   • `below: false` → 生命值**等于** `lp`（此时为「等于 1」；注意引擎的契约「名刀」会把一次致命扣血钳到剩 1 点，
 *                      所以这一档同样可能被触发）
 *
 * 时点：目标生命值只在结算（SETTLE）里变化（match/settle.js `ps.lp -= effLoss`），因此用 `onBattleEnd` ——
 * 它在扣血之后、`onBattleResult` 之前派发，是唯一能看到「本次扣血后」生命值的 prep 侧钩子。
 * SETTLE 不是休整期，所以 `ctx.grantChess` 会把赠予**排队到下个休整期**兑现（用户裁定：非休整期赠予延后发放）。
 *
 * 记账规则：**只有真正发出去（或成功排队）才消费该档**。
 *   • 排队（SETTLE 阶段返回 null 但进了 deferredGrants）→ 消费；
 *   • 开局 BAN 拦下（`bannedChess` 含该干员，grantChess 直接 return null，不入队）→ **不消费**，该档保持未发；
 *   • 干员 id 不存在 → 不消费。
 * 反例是「先记账再发」的朴素写法：2026-10-13 实测 seed 1001 的 solo 局把 泥岩/史尔特尔/可露希尔 三人全部 BAN 掉，
 * 那种写法会让三档在第一次触发时就被永久烧掉，玩家此后即使生命值再低也拿不到任何东西。
 */
K.band_kalts_rodos_gift = (ps, bandId) => ({
  onBattleEnd(ctx) {
    const p = ps[0];
    const tiers = Array.isArray(p.tiers) ? p.tiers : [];
    if (!tiers.length) return;
    const lp = num(ctx.lp(), 0);
    const key = `band:${bandId || 'kalts'}:gift`;
    const mask = int(ctx.counter(key), 0);
    let next = mask;
    for (let i = 0; i < tiers.length; i++) {
      if (next & (1 << i)) continue; // 本档已发过
      const t = tiers[i] || {};
      const th = int(t.lp, 0);
      const hit = t.below === false ? lp === th : lp < th;
      if (!hit) continue;
      const id = t.chess ?? t.chess_id;
      const rec = id ? ctx.chessRecord(ctx.gd.baseIdOf(id)) : null;
      // 用「本档是否被消费掉」判断发放结果：排队成功 / 当场到手 = 消费；被 BAN 拦下 = 不消费，以后再试。
      // 延迟判据走 ctx.inPrep()（与 addFunds / grantChess / grantItem 的 inPrepPhase 同口径）——
      // 非休整期时 grantChess 返回 null 但会把赠予放进 deferredGrants。
      const defer = typeof ctx.inPrep === 'function' ? !ctx.inPrep() : false;
      const before = defer ? ctx.deferredCount() : 0;
      const got = id ? grant(ctx, id, { source: 'band', requirePool: false }) : null;
      const consumed = !!got || (defer && ctx.deferredCount() > before);
      if (!consumed) continue;
      next |= (1 << i);
      ctx.setCounter(key, next);
      if (typeof ctx.toast === 'function') {
        ctx.toast(msg('【罗德岛制药】获得{name}', { name: (rec && rec.name) || String(id) }), 'success');
      }
    }
    if (next !== mask) ctx.setCounter(key, next);
  },
});

K.band_cost_coin_reach_cnt_gain_chess_from_pool = (ps) => ({
  onSpend(ctx, ev) {
    const p = ps[0];
    if (ctx.counter('band:paganini:done') > 0) return;
    const spent = ctx.incCounter('band:paganini:spent', Math.max(0, int(ev.amount, 0)));
    if (spent < int(p.coin_cnt, 0)) return;
    const r = ctx.rollPool(p.pool);
    if (r && grant(ctx, r.id, { source: 'band' })) ctx.setCounter('band:paganini:done', 1);
  },
});

/**
 * 余 【文火慢炖】 「第8回合开始时，若仅激活了1个盟约，使其增加36层；否则使所有已激活盟约增加12层」. The owner's decision of 2026-10-08
 * overrides PRTS here (下半/PRTS盟约记录: layers of a bond that shows none 「仍然对其生效」): a bond without layers — bonds.json
 * `noStack`: 绝技, 独行, 调和, 协防干员 — gets none. The count stays the sentence's (every active bond), so one active bond
 * that is such a bond means nothing is added, and with two active bonds a layered one still gets count2. Only this
 * strategy: 协防's 「使所有已激活的盟约层数」 (bonds/addon/meta.js) and 华法琳's 【重点监护】 keep adding to every bond they name.
 */
K.round_start_bond_check_gain_layer = (ps) => ({
  onRoundStart(ctx) {
    const p = ps[0];
    if (ctx.round !== int(p.round, -1)) return;
    const active = Object.entries(ctx.bonds()).filter(([, b]) => b && b.active).map(([id]) => id);
    const n = active.length === int(p.factioncount, 1) ? int(p.count1, 0) : int(p.count2, 0);
    for (const b of active) {
      if (ctx.gd.bond(b)?.noStack) continue;
      ctx.addLayers(b, n, { requireActive: true, reason: 'band' });
    }
  },
});

K.up_shop_add_special_goods = (ps) => ({
  onLevelUp(ctx) {
    const p = ps[0];
    const ids = rollItems(ctx, p.pool, timesOf(p.count, 3));
    if (ids.length) ctx.offerItems(ids, { source: 'band' });
  },
});

K.coin_carry_over = (ps) => ({
  onIncome(ctx, ev) {
    const p = ps[0];
    const cap = int(p.capital, 0), left = ctx.funds();
    if (cap <= 0 || left < cap) return;
    const bonus = Math.min(int(p.max, Infinity), Math.floor(left / cap) * int(p.interest, 0));
    if (bonus > 0) ev.income = int(ev.income, 0) + bonus;
  },
});

K.round_start_activate_char_chess_effect_in_board = (ps) => ({
  onRoundStart(ctx) {
    const p = ps[0];
    const event = p.event_type || 'SERVER_GAIN';
    const cands = ctx.board().filter((v) => v && v.kind === 'chess' && ctx.garrisonsOf(v.uid).some((g) => g.eventType === event));
    if (!cands.length) return;
    cands.sort((a, b) => (b.col - a.col) || (a.row - b.row));
    for (const v of cands.slice(0, timesOf(p.count, 1))) {
      if (event === 'SERVER_GAIN' && typeof garrisons.triggerGainEffects === 'function') garrisons.triggerGainEffects(ctx, v);
      else ctx.triggerGarrisons(v.uid, event);
    }
  },
});

K.first_sell_char_chess_exchange_char_chess_in_shop = (ps) => ({
  onSold(ctx, ev) {
    const piece = ev.piece;
    if (!piece || piece.kind !== 'chess' || !isNormalChess(ctx, piece.id)) return;
    if (roundCounter(ctx, 'band:vodfox') >= Math.max(1, int(ps[0].count, 1))) return;
    const slots = ctx.shopSlots();
    const idx = chessSlots(ctx);
    if (!idx.length) return;
    const i = ctx.rng.pick(idx);
    const got = ctx.grantChess(slots[i].id, { source: 'band' });
    if (!got) return;
    ctx.setShopSlot(i, { kind: 'chess', id: piece.id });
    ev.gain = 0;
    bumpRound(ctx, 'band:vodfox');
  },
});

K.round_start_gain_char_chess_in_shop_every_n_round = (ps) => ({
  onRoundStart(ctx) {
    const p = ps[0];
    const n = int(p.round, 0);
    if (n <= 0 || ctx.round % n !== 0) return;
    for (let k = 0; k < timesOf(p.count, 1); k++) {
      const idx = chessSlots(ctx);
      if (!idx.length) return;
      const i = ctx.rng.pick(idx);
      if (ctx.grantChess(ctx.shopSlots()[i].id, { source: 'band' })) ctx.setShopSlot(i, null);
    }
  },
});

/**
 * 艾拉策略 · 团队合作：**每回合首次**购买【彩虹小队】干员时，额外获得一名「不大于当前商店等级」的彩虹小队干员。
 *
 * 用户 2026-10-14 规格。bbStr.bond 指定阵营（rainbowShip），bb.maxTierFromShop 存在时上限取「当前商店等级」
 * （0 = 不限），`noRepeat` 不在本策略里使用 —— 每次随机一名、不排除已有。
 * 幂等：以「回合号」记档（band:ela:teamBuyRound），同一回合只发一次。
 */
K.band_ela_team_buy_gift = (ps) => ({
  onBuy(ctx, ev) {
    const p = ps[0];
    if (!ev || ev.kind !== 'chess' || !ev.slot || ev.slot.id == null) return;
    const bond = p.bond || 'rainbowShip';
    // 只在买【彩虹小队】干员时触发
    if (!hasBond(ctx, ev.slot.id, bond)) return;
    // 每回合仅一次
    if (int(ctx.counter('band:ela:teamBuyRound'), -1) === ctx.round) return;
    ctx.setCounter('band:ela:teamBuyRound', ctx.round);
    const maxTier = p.maxTierFromShop ? Math.max(1, int(ctx.shopLevel ? ctx.shopLevel() : 6, 6)) : Math.max(1, int(p.tier, 6));
    const r = ctx.rollChess({ bond, maxTier });
    const rid = typeof r === 'string' ? r : ((r && r.id) || null);
    // grantChess 自己会发「获得{name}」的 toast，这里不再重复播报。
    if (rid) ctx.grantChess(rid, { requirePool: false, source: 'band', reason: 'band:ela_team' });
  },
});

K.round_start_gain_coin_by_bond_char_chess_buy = (ps) => ({
  onBuy(ctx, ev) {
    const p = ps[0];
    if (ev.kind !== 'chess' || !hasBond(ctx, ev.slot.id, p.bond)) return;
    const n = int(p.count, 1), max = int(p.max_count, Infinity);
    const used = roundCounter(ctx, 'band:mlynar');
    const add = Math.min(n, max - used);
    if (add <= 0) return;
    ctx.addPendingFunds(add);
    bumpRound(ctx, 'band:mlynar', add);
  },
});

K.refresh_shop_count_gain_coin_bond_char_chess = (ps) => ({
  onRefresh(ctx) {
    const p = ps[0];
    const every = int(p.refresh_count, 0);
    if (every <= 0) return;
    if (ctx.incCounter('band:chiave:refreshes', 1) % every !== 0) return;
    if (roundCounter(ctx, 'band:chiave') >= int(p.max_count, Infinity)) return;
    const id = rollBond(ctx, p.bond);
    if (id && ctx.grantChess(id, { source: 'band' })) bumpRound(ctx, 'band:chiave');
  },
});

K.preparation_start_add_special_goods_every_n_round = (ps) => ({
  onRoundStart(ctx) {
    const p = ps[0];
    const n = int(p.round, 0);
    if (n <= 0 || ctx.round % n !== 0) return;
    const ids = rollItems(ctx, p.pool, Math.min(bbCap('refresh_cnt'), Math.max(1, int(p.refresh_cnt, 2))));
    const choices = Math.min(bbCap('choice_cnt'), Math.max(1, int(p.choice_cnt, 1)));
    for (let k = 0; k < choices && ids.length; k++) ctx.offerItems(ids, { source: 'band' });
  },
});

/**
 * 凛冬 策略【冠军】 (2026-10-13 用户规格): "【乌萨斯学生自治团】干员首次为优胜者时，获得其本身"。
 *
 * 判定时点与数值与乌萨斯学生团自身的特质完全一致 —— 休整期结束时（onPrepEnd / SERVER_PREP_FIN），按 **基础攻击力**
 * 排名：7 阶（tier 3）取前二高，否则取最高（usStudent.js `winnersOf`，同一规则、同一数据来源，避免两处判定漂移）。
 *
 * 判定粒度是**每一名干员各自一次**（2026-10-13 用户澄清：「每个乌萨斯学生团干员首次成为优胜者都能获得其复制」）：
 * 一局里 早露、烈夏、苦艾… 可以先后各拿一次，不是全局限一次。进度按**干员 base id** 存位掩码于玩家 counters
 * （`band:winter:won`），跨回合记忆；同一名干员第二次成为优胜者不再发。
 *
 * 精英（tier 3，前二高）时两名优胜者都在首次之列 —— 每名各发一份。
 * 拿到的是该优胜干员的**普通副本**（`_b` → `_a` 由 baseIdOf 处理）；`grantChess` 走统一的整备区/合并流程，
 * 可能直接凑成精锐。被 BAN 或记录缺失时不消费该干员的「首次」名额（与凯尔希策略同口径）。
 */
K.band_winter_champion_copy = (ps, bandId) => ({
  onPrepEnd(ctx) {
    const p = ps[0];
    const bond = (p.bond && String(p.bond)) || 'usStudentShip';

    const board = ctx.board().filter((x) => x && x.kind === 'chess');
    const members = [];
    for (const piece of board) {
      const uid = piece.uid;
      if (!Number.isInteger(uid) || uid <= 0) continue;
      if (!ctx.pieceBonds(uid).includes(bond)) continue;
      const base = ctx.gd.baseIdOf(piece.id);
      const rec = ctx.chessRecord(base);
      const atk = rec && rec.stats ? num(rec.stats.atk) : 0;
      members.push({ uid, id: base, atk });
    }
    if (!members.length) return;

    const bs = ctx.bond(bond);
    const tier = bs && bs.active ? Math.max(1, Math.floor(num(bs.tier, 1))) : 1;
    const n = tier >= 3 ? 2 : 1;
    // 与 usStudent.winnersOf 同规则：按基础攻击力降序取前 n 名
    const ranked = members.slice().sort((a, b) => b.atk - a.atk || String(a.id).localeCompare(String(b.id)));
    const winners = ranked.slice(0, n);
    if (!winners.length) return;

    const count = Math.max(1, int(p.count, 1));
    // 已「首次」过的干员：逗号分隔的 base id 串（ctx.setCounter 只接受有限数字，数组存不进去）
    const seenKey = bandId ? `band:${bandId}:seen` : 'band:winter:seen';
    const seenRaw = ctx.counterText ? ctx.counterText(seenKey) : '';
    const seenSet = new Set(String(seenRaw).split(',').map((x) => x.trim()).filter(Boolean));

    const got = [];
    for (const w of winners) {
      if (seenSet.has(w.id)) continue; // 该干员已经拿过自己的「首次」
      let handed = 0;
      for (let k = 0; k < count; k++) {
        // 「获得其本身」：发该优胜干员的普通副本
        if (ctx.grantChess(w.id, { source: 'band' })) handed++;
      }
      if (!handed) continue; // 被 BAN / 记录缺失 → 不消费该干员的名额
      seenSet.add(w.id);
      got.push(w.id);
    }
    if (!got.length) return;
    ctx.setCounterText(seenKey, [...seenSet].join(','));
    if (typeof ctx.toast === 'function') {
      const names = got.map((id) => (ctx.chessRecord(id) || {}).name || id).join('、');
      ctx.toast(msg('【冠军】优胜者 {name}：获得其本身', { name: names }), 'success');
    }
  },
});

/**
 * 能天使 策略【送货上门】 (2026-10-13 用户规格): "第3回合开始，每2个回合获得一件不大于当前等级的精锐装备"。
 *
 * 回合 = `fromRound` 起每 `every` 回合（默认第 3 回合起、每 2 回合 → R3/R5/R7/…）。「不大于当前等级」= 阶数不超过
 * 当时的**调度中心等级**（`capByShopLevel`，与商店可售范围同口径）。发的是**精锐装备**（金色 `_b`），
 * 走 `ctx.grantItem` 的常规入袋流程，所以库存、整备区溢出、合成等规则与其它来源一致。
 * 时点是休整期开始（onRoundStart），因此赠予当场生效，不受「非休整期延后发放」规则影响。
 */
K.band_elite_equip_every_n_round = (ps) => ({
  onRoundStart(ctx) {
    const p = ps[0];
    const from = Math.max(1, int(p.fromRound, 3));
    const every = Math.max(1, int(p.every, 2));
    if (ctx.round < from || (ctx.round - from) % every !== 0) return;
    const maxTier = p.capByShopLevel ? Math.max(1, Math.min(6, ctx.shopLevel())) : 6;
    const n = Math.max(1, int(p.count, 1));
    let got = 0;
    for (let k = 0; k < n; k++) {
      const id = rollEliteEquip(ctx, maxTier);
      if (id && ctx.grantItem(id, { source: 'band' })) got++;
    }
    if (got > 0 && typeof ctx.toast === 'function') {
      ctx.toast(msg('【送货上门】获得{n}件精锐装备', { n: got }), 'info');
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------
// 煌 策略【预备支援】 (用户 2026-10-15): "第一回合开始，每回合获得芬、芙蓉、克洛丝、炎熔这四位干员其中一名（每个干员只能获得3次）".
//
// 每一回合（onRoundStart，从第一回合起）从固定名单随机发一名，每名最多发 3 次；四名各自的发放次数存在玩家
// counters（band:<bandId>:blaze:<i>，数字计数器，0–3），跨回合记忆、每局重置。开局 BAN 掉的不发。grantChess
// 走统一的整备区流程（非休整期排队到下个休整期，符合用户裁定）。
K.band_blaze_ready_support = (ps, bandId) => ({
  onRoundStart(ctx) {
    const roster = ['chess_rodos_fang_a', 'chess_rodos_hibisc_a', 'chess_rodos_kroos_a', 'chess_rodos_lava_a'];
    const cnts = roster.map((id, i) => int(ctx.counter(`band:${bandId}:blaze:${i}`), 0));
    const avail = roster.map((id, i) => ({ id, i })).filter((o) => cnts[o.i] < 3 && !ctx.isChessBanned(o.id));
    if (!avail.length) return;
    const pick = ctx.rng.pick(avail);
    const got = ctx.grantChess(pick.id, { source: 'band', requirePool: false });
    if (got) ctx.setCounter(`band:${bandId}:blaze:${pick.i}`, cnts[pick.i] + 1);
  },
});

// ---------------------------------------------------------------------------------------------------------------
// 凯尔希 策略【手术包扎】 (用户 2026-10-15): "每次因损失生命值使罗德岛层数提升，回复3点策略生命值（该策略生命值上限为41）".
//
// 触发口径：本场作战失败（ev.loss > 0）且【罗德岛】已激活、且本场失败确实让罗德岛层数上涨（onBattleStart 时记下
// 层数，onBattleEnd 比较），则回 3 点策略生命值，钳制在 41（即便该策略 totalHp 只有 31，上限按用户文本取 41）。
// 用 effectsMeta 的 ctx.setLp 直接改写玩家 lp（战斗结算后、prep 侧派发）。
K.band_kalts_heal_on_rodos_loss = (ps, bandId) => ({
  onBattleStart(ctx) {
    ctx.setCounter(`band:${bandId}:rodosBefore`, int(ctx.layers(RODOS_BOND), 0));
  },
  onBattleEnd(ctx, ev) {
    const loss = Math.max(0, Math.trunc(Number(ev?.loss) || 0));
    if (loss <= 0) return;
    if (!ctx.bondActive(RODOS_BOND)) return;
    const before = int(ctx.counter(`band:${bandId}:rodosBefore`), 0);
    if (int(ctx.layers(RODOS_BOND), 0) <= before) return; // 这次失败没让罗德岛叠层（如场上不足 3 名）
    const cur = int(ctx.lp(), 0);
    const next = Math.min(41, cur + 3);
    if (next > cur) {
      ctx.setLp(next);
      if (typeof ctx.toast === 'function') ctx.toast(msg('【手术包扎】回复{name}点策略生命值', { name: next - cur }), 'success');
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------
// 诗怀雅 策略【天选明星】 (用户 2026-10-15): "龙门首次激活时主动选择一位龙门干员和强化（参考2回合契约选择）"。
//   2026-10-15 二次裁定：**两步选择提前到第一回合**（不再等龙门激活）；「龙门不再随机强化干员」的口径改为
//   「选择本策略首次激活龙门时不会随机强化干员」。
//
// 持有本策略时，龙门盟约原有的「每场战斗随机一位获得随机强化」**被玩家的选择取代**（content/lungmen.js 的 rollEnhance
// 读 ps.lungmenPick —— 还没做出选择就不强化）；选择一旦做出即整局有效。四位候选与三种强化类型都取自龙门盟约自己的口径
// （content/lungmen.js ENHANCE_KEYS / ENHANCE_KINDS，读 data/bands.json band_swire 的 bb）。
//
// 触发点必须是 **onPrepStart**（不是 onRoundStart）：`offerLungmenChoice` 要求 `m.phase === PREP`，而 onRoundStart
// 是在 `startRound()` 里派发的、那一刻 phase 还是 ROUND_START（`afterRoundStart()` 之后才 enterPrep），会被
// `WRONG_PHASE` 直接拒掉 —— 2026-10-15 实测确认：改前 R1..R2 的 `ps.personalChoice` 始终是 null，即这个两步选择
// **从未真正弹出过**。onPrepStart 在 enterPrep 里（phase 已是 PREP）派发，才是可用的时机。
// counters 记「本局已选过」保证只开一次；已有别的个人选择在开时（教鞭）留到下个回合再试。
K.band_swire_choose_enhance = (ps, bandId) => ({
  onPrepStart(ctx) {
    // 持有本策略的标记：战斗侧 content/lungmen.js 靠它判断「龙门随机强化是否已被策略接管」（counter → battle.counters）。
    ctx.setCounter('lungmen:swire', 1);
    const seenKey = `band:${bandId}:chosen`;
    if (ctx.counter(seenKey)) return;                       // 本局已选过（整局只开一次）
    if (typeof ctx.offerLungmenChoice !== 'function') return;
    const r = ctx.offerLungmenChoice('op', {});
    if (r && r.error) return;                               // 已有别的个人选择在开 → 下个回合再试
    ctx.setCounter(seenKey, 1);
    if (typeof ctx.toast === 'function') ctx.toast(msg('【天选明星】选择一位龙门干员并为其挑选强化'), 'info');
  },
});

// ---------------------------------------------------------------------------------------------------------------
// 鸭爵 "神秘顾客": "从第5回合起，你和队友遭遇的部分敌人可能会替换为<鸭爵><高普尼克><流泪小子><圆仔>，击倒这些敌人者获得1资金奖励
// （包括联防阶段）". A global handler rewrites the battle spawn list of every alive player while the band is held by that
// player or a teammate: from round `round`, in the normal battle, the Final Assault and the Hidden Core (PRTS 卫戍协议：盟约
// 下半/PRTS盟约记录 鸭爵 备注 "每回合将有0~2名敌人被替换为上述敌人之一…且在最终回合和隐秘核心回合中仍然生效"; the 联防 phase
// replaces nothing: its enemies are leaks, which keep their bounty). min..max (0–2, uniform [ASSUMED]) of the player's
// ground enemies from the `minweight`–`maxweight` share of the player's enemies (time order) [ASSUMED reading of the two
// weights] — any wave enemy but the leader, its parts, bounties, earlier swaps and uncounted units. Elites are eligible
// too [ASSUMED: the text names no rank; one rule for every battle; about two thirds of the leader rounds' escorts in that
// share are elites, so a NORMAL-only rule would leave most Final Assault halves without a candidate — ≈ 80 % instead of
// ≈ 36 % of the R14 pair-field halves over 40 seeds]. Flyers are never swapped [ASSUMED: the four are ground units and a
// FLY action's route is a FLY route]. A swapped unit becomes a random enemylist enemy (the act2 `_2` versions) at the
// replaced unit's time and route, worth DUCK_COINS to its killer (bounty, also in 联防). A pair boss field has one spawn
// list that its two players' handlers edit in turn; each player's 0–2 come from the enemies whose route ends on that
// player's half (`ev.side` + `ev.routes`, the half rule of the field's bounties, server/match/waves.js routeByMotion), the
// share taken over that half [ASSUMED: "你和队友遭遇的敌人" — the enemies heading for the player's own protection point;
// each official client simulates its own battle, docs/research/08 appendix A]. The originals never exist, so none of
// their death / kill / leak effects happen. Reaching the protection point costs 1 LP ("但进入保护目标点将减少1点目标生命值":
// the enemies' data lpr, tools/build-data.mjs). The swaps carry the spawn tag 'duck': their 隐匿 (流泪小子) comes back no
// sooner than 1 s after a block ends, not the official 0 s (content/enemies/helpers.js DUCK_STEALTH_RESTORE — the owner's
// decision of 2026-10-07, a deliberate deviation).

export const DUCK_BAND = 'band_ducklord';
/** "击倒这些敌人者获得1资金奖励" (the blackboard's `count` is 1 too). */
export const DUCK_COINS = 1;
/** Battle kinds the swap applies to (PRTS: the Final Assault and the Hidden Core too). */
const DUCK_KINDS = new Set(['normal', 'boss', 'hidden']);
/** Boss-field column between the left ('L') and the right ('R') player's half (the goals are at cols 2–3 / 17). */
const BOSS_MID_COL = (GEO.BOSS_RECT.c0 + GEO.BOSS_RECT.c1) / 2;

function duckParams(bandId = DUCK_BAND) {
  for (const b of buffsOf(bandRecord(bandId))) if (b.key === 'round_start_all_player_change_enemy_2') return b.p;
  return null;
}

/**
 * Rewrite `spawns` in place (exported for tests). Returns the replaced spawn specs. `side` ('L' | 'R', a pair boss
 * field) limits the swap to the spawns whose route (`routes[routeIndex]`) ends on that half of the field.
 */
export function duckReplace(ctx, spawns, p, ownerPlayerId, { routes = null, side = null } = {}) {
  const gd = ctx.gd;
  const ducks = list(p.enemylist).filter((k) => gd.enemy(k));
  if (!ducks.length || !Array.isArray(spawns)) return [];
  const lo = Math.max(0, int(p.min, 0)), hi = Math.max(lo, int(p.max, lo));
  const want = lo + ctx.rng.int(hi - lo + 1);
  if (want <= 0) return [];
  const half = side === 'L' || side === 'R';
  const onHalf = (s) => {
    if (!half) return true;
    const r = Array.isArray(routes) ? routes[s.routeIndex] : null;
    const c = r && Array.isArray(r.end) ? Number(r.end[1]) : NaN;
    return side === 'R' ? c > BOSS_MID_COL : c < BOSS_MID_COL;
  };
  // one entry per enemy of the player (split multi-count specs), in spawn-time order
  const flat = [];
  for (let i = 0; i < spawns.length; i++) {
    const s = spawns[i];
    if (!s || !onHalf(s)) continue;
    const cnt = Math.max(1, int(s.count, 1));
    for (let k = 0; k < cnt; k++) flat.push({ i, k, t: num(s.time, 0) + k * num(s.interval, 0) });
  }
  flat.sort((a, b) => a.t - b.t || a.i - b.i || a.k - b.k);
  const w0 = num(p.minweight, 0), w1 = num(p.maxweight, 1);
  const n = flat.length;
  const ok = flat.filter((f, j) => {
    const s = spawns[f.i];
    const e = gd.enemy(s.enemyKey);
    const frac = n > 1 ? j / (n - 1) : 0;
    return !s.tag && s.countInTotal !== false && e && e.rank !== 'BOSS' && !e.notCountInTotal && e.stats?.motion !== 'FLY'
      && frac >= w0 - 1e-9 && frac <= w1 + 1e-9;
  });
  const picked = ctx.rng.shuffle(ok).slice(0, want);
  if (!picked.length) return [];
  const byIdx = new Map();
  for (const f of picked) { if (!byIdx.has(f.i)) byIdx.set(f.i, new Set()); byIdx.get(f.i).add(f.k); }
  const out = [];
  const add = [];
  for (const [i, ks] of byIdx) {
    const s = spawns[i];
    const cnt = Math.max(1, int(s.count, 1));
    const keep = cnt - ks.size;
    for (const k of ks) {
      const d = {
        ...s, mods: s.mods ? { ...s.mods } : undefined, count: 1, interval: 0,
        time: num(s.time, 0) + k * num(s.interval, 0), enemyKey: ctx.rng.pick(ducks), tag: 'duck',
        bounty: { coins: DUCK_COINS, ownerPlayerId },
      };
      if (d.mods) delete d.mods.slot;
      add.push(d);
      out.push(d);
    }
    if (keep <= 0) spawns[i] = null;
    else if (ks.size) {
      // keep the unreplaced copies of a multi-count spec as single specs at their original times
      const rest = [];
      for (let k = 0; k < cnt; k++) if (!ks.has(k)) rest.push({ ...s, mods: s.mods ? { ...s.mods } : undefined, count: 1, interval: 0, time: num(s.time, 0) + k * num(s.interval, 0) });
      spawns[i] = null;
      add.push(...rest);
    }
  }
  for (let i = spawns.length - 1; i >= 0; i--) if (spawns[i] == null) spawns.splice(i, 1);
  spawns.push(...add);
  return out;
}

const duckGlobal = {
  onBattleStart(ctx, ev) {
    if (!ev || !DUCK_KINDS.has(ev.kind) || !Array.isArray(ev.spawns)) return;
    const holder = [ctx, ...ctx.teammates()].find(t => (t.gd.band(t.bandId())?.effectRef ?? t.bandId()) === DUCK_BAND);
    if (!holder) return;
    const p = duckParams(holder.bandId());
    if (!p || ctx.round < int(p.round, 1)) return;
    duckReplace(ctx, ev.spawns, p, ctx.playerId, { routes: ev.routes, side: ev.side });
  },
};

// ---------------------------------------------------------------------------------------------------------------

/** Merge hook objects (same hook → called in order). */
function merge(parts) {
  const out = {};
  for (const h of parts) {
    for (const [name, fn] of Object.entries(h)) {
      if (typeof fn !== 'function') continue;
      const prev = out[name];
      out[name] = prev ? function merged(ctx, ev) { prev(ctx, ev); fn(ctx, ev); } : fn;
    }
  }
  return out;
}

/** Hooks of one band (null when it has no prep effect). */
export function bandMetaHandler(bandId) {
  const groups = new Map();
  for (const b of buffsOf(bandRecord(bandId))) {
    if (!b.key || !K[b.key]) continue;
    if (!groups.has(b.key)) groups.set(b.key, []);
    groups.get(b.key).push(b.p);
  }
  if (!groups.size) return null;
  return merge([...groups].map(([k, ps]) => K[k](ps, bandId)));
}

export function registerMeta(registry) {
  for (const id of Object.keys(gameData().bands || {})) {
    const h = bandMetaHandler(id);
    if (h) registry.band(id, h);
  }
  registry.global('bands_ducklord', duckGlobal);
}
