// server/match/builtinMeta.js — engine built-in prep effects registered BEFORE content (content overrides a key by
// registering it again). They cover the purely meta, data-driven pieces the match needs to be playable before the
// content phase lands: consume-on-equip items, Arts, a few persistent EffectRefs used by 机变 defaults.
//
// Items are matched by their official buff key (data/items.json buffs[].key), numbers come from the item's params
// (normal `_a` / golden `_b` record), never hard-coded:
//   equip_destory_gain_random_coin {min,max}              盟约之币 / 骑士储蓄罐   funds += rand[min,max]
//   use_equip_reward_char_chess_bond_layer {layer}        随身身份牌             layers of the target's bonds (无需激活)
//   use_equip_reward_random_char_chess_in_shop {count}    紧急调度券             take `count` random chess from the shop
//   gain_coin_when_round_start {count}                    精打细算玩偶           +count funds every round start
//   use_equip_reward_char_chess_with_same_bond {count}    简易通讯机             `count` random chess sharing a bond
//   use_equip_gain_coin_when_next_round_start {count}     见钱眼开玩偶           +count funds next round
//   equip_destory_deployment_cnt_add {count}              人事部文档             deploy cap += count
//     (was equip_destory_deployment_cnt_change: deploy cap = count — an ABSOLUTE set, which the 契约 「扩容」 strategy's
//      deployCapBonus made worthless: max(8 + 1, 9) = 9. Changed to an ADDITIVE bonus 2026-10-10 on the owner's word;
//      the 12-部署位 口径 then reads 12 + 1 = 13.)
//   use_equip_upgrade_char / equip_round_start_upgrade_char 博士投影             promote (golden: now, normal: next round)
//   use_equip_reward_char_chess                           拟态物质               3rd copy (none when the pool is
//                                                                                out), or with < 2 a same-bond chess
//   use_equip_reward_special_goods_char_chess {refresh_cnt} 寻呼模块             offer N same-bond chess (≤ shop level)
//   use_equip_recruit_new_char_and_give_char_to_player_most_bond {refresh_cnt} 信标 destroy target, offer N same-tier
//                                                                                chess, gift the original (an elite stays
//                                                                                elite) next prep, sender eliminated or not
//   sell_char_count_gain_equip_owner_bond {count}         商业包装方案           every `count` sells → same-bond chess
//   char_chess_transformation_equip                       突变细胞               after battle: holder destroyed, its equipment
//                                                                                (the cell included — not consumed) back to
//                                                                                the hand, then a random NORMAL tier+1 (max 6)
//                                                                                operator gained into the hand
//   trap_copy_front_char                                  画卷 (Art)            copy the chess on the tile / in front
//   trap_create_self_choice {choice_event}                教鞭 / 神秘顾客 (Art)  add a random bounty to your next battle
// This builtin picks a random bounty by default; content/items/meta.js overrides Pointing Stick with a private choice.

import { getData } from '../data.js';
import { itemKey } from './gamedata.js';
import { msg, dn } from '../../shared/i18n.js';

const int = (v, d = 0) => (Number.isFinite(v) ? Math.trunc(v) : d);

/** 如意红包的固定发放顺序：年→重岳→令→黍→夕→余→望（用户 2026-10-12 裁定；集齐后走 10% 随机 / 90% 1~3 资金）。 */
const SUI_PACKET_ORDER = Object.freeze([
  'chess_sui_nian_a',    // 年
  'chess_sui_chyue_a',   // 重岳
  'chess_sui_ling_a',    // 令
  'chess_sui_shu_a',     // 黍
  'chess_char_5_12_a',   // 夕
  'chess_char_6_03_a',   // 余
  'chess_sui_wang_a',    // 望
]);

/** item record params of the concrete (normal/golden) item */
const paramsOf = (ctx, item) => {
  const rec = item ? ctx.gd.item(item.id) : null;
  return rec && rec.params && typeof rec.params === 'object' ? rec.params : {};
};

/**
 * The item gave nothing — the copies are all owned (the shared pool, research 06 §7) or no operator shares the bond — but
 * it is still destroyed ("装备时销毁"): say why instead of swallowing it (GitHub #401, the owner's OK of 2026-10-09).
 */
function toastNothing(ctx, ev, chessName = null) {
  const who = ctx.gd.item(ev.item?.id)?.name || '';
  ctx.toast(chessName ? msg('{who}：卡池中已没有{name}', { who: dn(who), name: dn(chessName) }) : msg('{who}：没有可获得的同盟约干员', { who: dn(who) }), 'warn');
}

/** random chess sharing at least one bond with `bonds`, tier ≤ maxTier */
function rollSameBond(ctx, bonds, maxTier, exclude = null) {
  const set = new Set(bonds);
  return ctx.rollChess({ maxTier, filter: (id) => { const c = ctx.gd.chess(id); return !!(c && Array.isArray(c.bonds) && c.bonds.some((b) => set.has(b))) && !(exclude && exclude.includes(id)); } });
}

/**
 * random chess sharing at least one bond of the requested **class** with the carrier
 * （寻呼模块 / 简易通讯机，用户 2026-10-14：「出现 N 名与该干员**核心**盟约相同的干员 + N 名与该干员**附加**盟约相同的干员」）。
 *
 * 分类取 bonds.json 的 `isCore`（与 sim 的 `support/index.js isCoreBond` 同一口径）：
 *   核心 = 官方 8 阵营 + 本作新增的 9 个核心（罗德岛 / 巴别塔 / 岁 / 龙门 / 企鹅物流 / 乌萨斯学生团 / 莱茵生命 / 彩虹小队 …）
 *   附加 = 职业盟约（先锋 / 近卫 / 医疗 …）、精准 / 迅捷 / 灵巧 那一批、以及魔王 / 升变。
 *
 * @param {object} ctx
 * @param {string[]} bonds 携带者的盟约（ctx.pieceBonds）
 * @param {boolean} wantCore true = 只要核心盟约相同的；false = 只要附加盟约相同的
 * @param {number} maxTier 不高于当前调度中心等级
 * @param {string[]|null} exclude 已经抽到的（同一次 offer 不重复出同一名）
 * @returns {string|null} chessId
 */
function rollSameBondClass(ctx, bonds, wantCore, maxTier, exclude = null) {
  const set = new Set(bonds);
  const isCore = (bid) => !!ctx.gd.bond(bid)?.isCore;
  return ctx.rollChess({
    maxTier,
    filter: (id) => {
      const c = ctx.gd.chess(id);
      if (!c || !Array.isArray(c.bonds)) return false;
      if (exclude && exclude.includes(id)) return false;
      // 该干员的盟约里，**属于这一档**的那些与携带者相同的盟约
      return c.bonds.some((b) => set.has(b) && isCore(b) === wantCore);
    },
  });
}

/**
 * 寻呼模块 / 简易通讯机共用的「特殊刷新 + 免费拿一名」流程：
 *   core_cnt 名与携带者**核心**盟约相同的 + addon_cnt 名**附加**盟约相同的 → 一次 offerChess，
 *   玩家免费获得其中一名。不高于当前调度中心等级；同一次 offer 不出重复干员。
 * @returns {string[]} 实际给出的候选（可能因卡池/无同类而少于请求数）
 */
function offerSameBondByClass(ctx, bonds, coreN, addonN, maxTier) {
  const ids = [];
  for (let k = 0; k < coreN; k++) {
    const id = rollSameBondClass(ctx, bonds, true, maxTier, ids);
    if (id) ids.push(id);
  }
  for (let k = 0; k < addonN; k++) {
    const id = rollSameBondClass(ctx, bonds, false, maxTier, ids);
    if (id) ids.push(id);
  }
  if (ids.length) ctx.offerChess(ids, { source: 'item' });
  return ids;
}

/** 信标: the living teammate (not the caller) with the most members of `bonds` ("相应盟约人数最多"), ties at random; null without one. */
function mostBondMate(ctx, bonds) {
  const mates = ctx.teammates();
  if (!mates.length) return null;
  let best = -1;
  let pick = [];
  for (const t of mates) {
    const score = bonds.reduce((s, b) => s + t.bondCount(b), 0);
    if (score > best) { best = score; pick = [t]; } else if (score === best) pick.push(t);
  }
  return ctx.rng.pick(pick) || null;
}

/**
 * 量子二踢脚 × 岁过华灯 的组合效果：携带者两件都戴着、（盟约里含【岁】—— 含变形同构体赠予的那条，
 * ctx.pieceBonds 已算进去）时，发 `packets` 个如意红包（普通 2 / 金色 4，见 items.json 的 params）。
 *
 * 两件装备**任一件装上时**都调用一次，装备顺序不影响结果；每件二踢脚只发一次（`quantum:<uid>` 计数器）。
 * 攻击力那半不在这里 —— 在战斗侧随携带者身份实时取（sim/content/items/battle.js）。
 * @returns {number} 发出的红包数
 */
function quantumKickPackets(ctx, holder) {
  const uid = holder && holder.uid;
  if (!uid) return 0;
  const piece = ctx.piece(uid);
  if (!piece || !Array.isArray(piece.items)) return 0;
  const kick = piece.items.find((it) => itemKey(it.id) === 'chess_item_6_quantum_kick');
  if (!kick) return 0;
  if (!piece.items.some((it) => itemKey(it.id) === 'chess_item_3_sui_lamp')) return 0;
  if (!ctx.pieceBonds(uid).includes('suiShip')) return 0;
  const rec = ctx.gd.item(kick.id);
  const p = rec && rec.params && typeof rec.params === 'object' ? rec.params : {};
  const n = Math.max(0, int(p.packets, 0));
  if (n <= 0) return 0;
  if (ctx.incCounter(`quantum:${kick.uid}`) > 1) return 0;   // 已发过
  const gift = typeof p.grant_item_id === 'string' ? p.grant_item_id : 'chess_item_6_sui_m';
  for (let k = 0; k < n; k++) ctx.grantItem(gift, { source: 'item:quantum_kick' });
  return n;
}

const ITEM_HANDLERS = {
  equip_destory_gain_random_coin: {
    onEquip(ctx, ev) {
      const p = paramsOf(ctx, ev.item);
      const lo = int(p.min, 1);
      const hi = Math.max(lo, int(p.max, lo));
      ctx.addFunds(lo + ctx.rng.int(hi - lo + 1), 'item');
    },
  },
  use_equip_reward_char_chess_bond_layer: {
    onEquip(ctx, ev) {
      const n = int(paramsOf(ctx, ev.item).layer, 3);
      for (const b of ctx.pieceBonds(ev.target.uid)) ctx.addLayers(b, n, { requireActive: false, reason: 'item' });
    },
  },
  use_equip_reward_random_char_chess_in_shop: {
    onEquip(ctx, ev) {
      const n = Math.max(1, int(paramsOf(ctx, ev.item).count, 1));
      for (let k = 0; k < n; k++) {
        const slots = ctx.shopSlots();
        const idx = slots.map((s, i) => (s && s.kind === 'chess' && !s.sold ? i : -1)).filter((i) => i >= 0);
        if (!idx.length) break;
        const i = ctx.rng.pick(idx);
        const id = slots[i].id;
        ctx.setShopSlot(i, null);
        ctx.grantChess(id);
      }
    },
  },
  gain_coin_when_round_start: {
    onEquip(ctx, ev) {
      const n = int(paramsOf(ctx, ev.item).count, 1);
      const rec = ctx.gd.item(ev.item.id);
      ctx.addEffect({
        id: `doll:${ev.item.uid}`, key: 'effect:builtin_round_coin', name: rec ? rec.name : '精打细算玩偶', desc: rec ? rec.desc : '', // i18n-ignore: the item's data name
        iconKind: 'item', iconId: rec ? rec.iconId || rec.id : ev.item.id, battle: false, params: { count: n },
      });
    },
  },
  // 简易通讯机（用户 2026-10-14 重做）：装备时销毁，立即特殊刷新一次调度中心，
  //   出现 1 名与该干员**核心**盟约相同的 + 1 名**附加**盟约相同的，免费获得其中一名（≤ 当前调度中心等级）。
  // 旧版是「随机直接送 1/2 名同盟约干员」，没有选择、也没有核心/附加之分。
  use_equip_reward_char_chess_with_same_bond: {
    onEquip(ctx, ev) {
      const p = paramsOf(ctx, ev.item);
      const coreN = Math.max(0, int(p.core_cnt, 1));
      const addonN = Math.max(0, int(p.addon_cnt, 1));
      if (!coreN && !addonN) return;
      const bonds = ctx.pieceBonds(ev.target.uid);
      if (!offerSameBondByClass(ctx, bonds, coreN, addonN, ctx.shopLevel()).length) toastNothing(ctx, ev);
    },
  },
  use_equip_gain_coin_when_next_round_start: {
    onEquip(ctx, ev) { ctx.addPendingFunds(int(paramsOf(ctx, ev.item).count, 2)); },
  },
  equip_destory_deployment_cnt_add: {
    onEquip(ctx, ev) { ctx.addDeployCap(int(paramsOf(ctx, ev.item).count, 1)); },
  },
  use_equip_upgrade_char: {
    onEquip(ctx, ev) {
      if (ctx.gd.isGolden(ev.target.id)) { ev.error = 'BAD_TARGET'; ev.detail = 'already elite'; return; }
      ctx.promote(ev.target.uid);
    },
  },
  equip_round_start_upgrade_char: {
    onEquip(ctx, ev) {
      if (ctx.gd.isGolden(ev.target.id)) { ev.error = 'BAD_TARGET'; ev.detail = 'already elite'; return; }
      ev.keep = true; // stays equipped until the next round start
    },
    onRoundStart(ctx) {
      const { piece, holder } = ctx.source;
      if (!piece || !holder) return;
      ctx.destroyPiece(piece.uid);
      ctx.promote(holder.uid);
    },
  },
  // 拟态物质 「若已拥有至少2名该初始干员，则再获得1名该初始干员；否则随机获得1名同盟约初始干员」: the 否则 is the owned < 2
  // case only. The original experiment BV1eLXXBqEgF (3:00) distinguishes this item from pool-weighted grants:
  // it samples eligible operator identities and can grant beyond stock. All obtained copies still occupy the pool.
  use_equip_reward_char_chess: {
    onEquip(ctx, ev) {
      const base = ctx.gd.baseIdOf(ev.target.id);
      const owned = [...ctx.board(), ...ctx.hand(), ...ctx.temp()].filter((p) => p && p.kind === 'chess' && !p.golden && ctx.gd.baseIdOf(p.id) === base).length;
      if (owned >= 2) {
        if (!ctx.grantChess(base, { requirePool: false })) toastNothing(ctx, ev);
        return;
      }
      const bonds = new Set(ctx.pieceBonds(ev.target.uid));
      const id = ctx.rollChess({ maxTier: 6, ignoreCounts: true,
        filter: cid => ctx.gd.chess(cid)?.bonds?.some(b => bonds.has(b)) });
      if (!id || !ctx.grantChess(id, { requirePool: false })) toastNothing(ctx, ev);
    },
  },
  // 寻呼模块（用户 2026-10-14 重做）：装备时销毁，立即特殊刷新一次调度中心，
  //   出现 2 名与该干员**核心**盟约相同的 + 2 名**附加**盟约相同的，免费获得其中一名（≤ 当前调度中心等级）。
  // 旧版是「出现三名与有相同盟约的」，不分核心/附加。
  use_equip_reward_special_goods_char_chess: {
    onEquip(ctx, ev) {
      const p = paramsOf(ctx, ev.item);
      const coreN = Math.max(0, int(p.core_cnt, 2));
      const addonN = Math.max(0, int(p.addon_cnt, 2));
      if (!coreN && !addonN) return;
      const bonds = ctx.pieceBonds(ev.target.uid);
      if (!offerSameBondByClass(ctx, bonds, coreN, addonN, ctx.shopLevel()).length) toastNothing(ctx, ev);
    },
  },
  // 信标 (act2autochess eff_acarm109 / eff_acgarm109 "装备时，目标干员和本装备销毁并进行一次特殊刷新，出现两名与携带者同等阶的
  // 干员，免费获取其中一名 / 若在同盟模拟中且存在其他队友，下个休整期向相应盟约人数最多的队友发送1个原干员 / 相应盟约人数相同则
  // 随机发送"; 芬 band_fang "原干员在下回合传递给对应盟约人数最多的队友"). The gift is the ORIGINAL operator: an elite carrier
  // is sent as that elite (community report #6 after 0.1.2: it arrived as the normal card — the gift carried baseIdOf).
  // Destroying the carrier returns its pool copies (an elite's 3) at once; the gift takes them again when it is granted
  // (effect:builtin_gift: grantChess → acquireChess, an elite takes up to goldenCopies, as every effect grant).
  use_equip_recruit_new_char_and_give_char_to_player_most_bond: {
    onEquip(ctx, ev) {
      const target = ctx.piece(ev.target.uid);
      if (!target) return;
      const tier = ctx.gd.tierOf(target.id);
      const n = Math.max(1, int(paramsOf(ctx, ev.item).refresh_cnt, 2));
      const bonds = ctx.pieceBonds(target.uid);
      const original = target.id; // the elite id for an elite (report #6)
      ctx.destroyPiece(target.uid);
      const ids = [];
      // different operators of the target's tier, topped up from the tier below like the promotion reward (item 19)
      for (let k = 0; k < n; k++) {
        let id = null;
        for (let t = tier; t >= 1 && !id; t--) id = ctx.rollChess({ tier: t, filter: (x) => !ids.includes(x) });
        if (id) ids.push(id);
      }
      if (ids.length) ctx.offerChess(ids, { source: 'item', tier });
      // co-op: next prep, send the original chess to the teammate with the most members of its bonds — except a 自选
      // piece (0.2.0): its DIY slot is bound to this player's roster (no teammate's shop or slot can hold that operator),
      // so nothing is sent [ASSUMED: the official text names no 自选 case]
      const to = ctx.chessRecord(original)?.diyFor ? null : mostBondMate(ctx, bonds);
      if (to) ctx.addEffect({ id: `gift:${ev.item.uid}`, key: 'effect:builtin_gift', hidden: true, battle: false, params: { toPlayerId: to.playerId, chessId: original, bonds } });
    },
  },
  sell_char_count_gain_equip_owner_bond: {
    onSold(ctx) {
      const { piece, holder } = ctx.source;
      if (!piece || !holder) return;
      const need = Math.max(1, int(paramsOf(ctx, piece).count, 8));
      const k = `pack:${piece.uid}`;
      if (ctx.incCounter(k) >= need) {
        ctx.setCounter(k, 0);
        const id = rollSameBond(ctx, ctx.pieceBonds(holder.uid), ctx.shopLevel());
        if (id) ctx.grantChess(id);
      }
    },
  },
  // 突变细胞 "战斗结束后，装备者替换为高一阶的随机干员": PRTS 卫戍协议：盟约 下半/PRTS盟约记录 备注 "生效时，原干员销毁，获得
  // 一名高一阶的随机初始干员（最高六阶）" — the carrier (deployed or on the bench) is destroyed and a random NORMAL operator
  // one tier higher (at most 6; an elite carrier too) is gained like any gained operator: into the 整备区 (overflow temp),
  // never onto the carrier's tile — official footage (bilibili BV1vzyVBuEN9 ≈ 8:24, BV1Qkw1zMEoR ≈ 7:25): at the next
  // prep the tile is empty, one more deployment is left and the new operator waits on the bench (pointed out in PR #2).
  // The destroyed operator's equipment, the cell included, returns to the hand first (PRTS 卫戍协议/帮助 "佩戴的装备无法
  // 手动卸除，在失去该干员（干员出售、销毁、合并等）或装备合并为进阶品质时自动卸除"; the official text never says 销毁 for the
  // cell — unlike every consumable item —, and players re-inject it every round: "之后就是一直打针，扎到核心卡…就换人扎",
  // bilibili cv47000418; player feedback after 0.1.0). PlayerState.transformChess.
  char_chess_transformation_equip: {
    onBattleResult(ctx) {
      const { piece, holder } = ctx.source;
      if (!piece || !holder || !ctx.piece(holder.uid)) return;
      const tier = Math.min(6, ctx.gd.tierOf(holder.id) + 1);
      const id = ctx.rollChess({ tier });
      if (!id) return;
      ctx.transform(holder.uid, ctx.gd.baseIdOf(id));
    },
  },
  trap_copy_front_char: {
    onArt(ctx, ev) {
      const target = ev.targets.find((p) => p.kind === 'chess');
      if (!target) { ev.error = 'BAD_TARGET'; ev.detail = 'no operator in range'; return; }
      const copy = ctx.grantChess(target.id, { requirePool: false });
      if (!copy) { ev.error = 'HAND_FULL'; return; }
      for (const it of target.items || []) {
        const itemPiece = ctx.grantItem(it.id);
        if (itemPiece) ctx.equipDirect(itemPiece.uid, copy.uid);
      }
    },
  },
  trap_create_self_choice: {
    onArt(ctx, ev) {
      const rec = ctx.gd.item(ev.item.id);
      const perfectOnly = !!(rec && typeof rec.desc === 'string' && rec.desc.includes('完美'));
      const cards = ((ctx.data.choices && ctx.data.choices.cards && ctx.data.choices.cards.bounty) || [])
        .filter((c) => c && c.tier <= 2 && (perfectOnly ? c.payout === 'perfect' : c.payout === 'kill') && ctx.gd.enemy(c.enemyKey) && !ctx.gd.inactiveEnemies.has(c.enemyKey));
      const card = ctx.rng.pick(cards);
      if (!card) { ev.error = 'BAD_TARGET'; ev.detail = 'no bounty available'; return; }
      ctx.addBounty(card);
    },
  },
  // 如意红包（岁）：使用后**按固定顺序**获得岁干员 年→重岳→令→黍→夕→余→望（跳过已拥有的，含被 BAN 拿不到的）；
  // 七名集齐后 → 10% 概率随机获得一名岁干员（可为重复），90% 概率获得 1~3 资金。
  // 用户 2026-10-12 裁定。每次使用 +1 `sui:redpackets` 计数器（岁盟约的伤害加成读它，见 sim/content/bonds/core.js）。
  sui_redpacket_art: {
    onArt(ctx, ev) {
      ctx.incCounter('sui:redpackets', 1);
      const owned = new Set([...ctx.hand(), ...ctx.temp(), ...ctx.board()]
        .filter(Boolean).filter((p) => p.kind === 'chess').map((p) => ctx.gd.baseIdOf(p.id)));
      const grant = (id) => {
        const granted = ctx.grantChess(id, { requirePool: false });
        if (!granted) { ev.error = 'HAND_FULL'; }
      };
      // 固定顺序：第一个「既没拥有、也没被 BAN」的
      const next = SUI_PACKET_ORDER.find((id) => !ctx.isChessBanned(id) && !owned.has(id));
      if (next) { grant(next); return; }
      // 集齐 → 10% 随机岁 / 90% 获得 1 资金（用户 2026-10-13：原为 1~3 资金）
      if (ctx.rng.int(100) < 10) {
        const pool = SUI_PACKET_ORDER.filter((id) => !ctx.isChessBanned(id));
        grant(ctx.rng.pick(pool) || SUI_PACKET_ORDER[0]);
      } else {
        ctx.addFunds(1, 'sui_redpacket');
      }
    },
  },
  // 岁过华灯（岁盟约，5 阶装备）: 装备时向整备区发放 `packets` 个如意红包（普通 1 / 精锐 2，见 items.json 的
  // `sui_lamp_packet` buff）。携带者自己的 ATK +15%（精锐 +30%）不在这里 —— 那是同一记录里 attr_common_global_buff
  // 的常规属性通道（sim/content/items/battle.js STAT_BUFFS）；与变形同构体同携视为【岁】成员由 giveBondId 给出。
  //
  // 发放口径（用户 2026-10-15：「获得如意红包（每件岁过华灯仅一次）」）：计数器按**装备自身的 uid** 记，
  // 同一件 岁过华灯 只发一次红包 —— 换人重戴 / 同一件反复上身不再发；**合成出的精锐是一件新装备**，
  // 按它自己的 uid 再发一次（数量仍是它的 `packets` = 2）。
  sui_lamp_packet: {
    onEquip(ctx, ev) {
      const p = paramsOf(ctx, ev.item);
      const uid = ev.item ? ev.item.uid : null;
      const k = uid != null ? `sui:lamp:${uid}` : '';
      // 每件仅一次：第一次 incCounter 返回 1 → 发；同一件再来（> 1）→ 跳过。
      if (!k || ctx.incCounter(k) <= 1) {
        const n = Math.max(0, int(p.packets, 1));
        const gift = typeof p.grant_item_id === 'string' ? p.grant_item_id : 'chess_item_6_sui_m';
        for (let i = 0; i < n; i++) ctx.grantItem(gift, { source: 'item:sui_lamp' });
      }
      // 岁过华灯先上身、量子二踢脚后上身时，靠这里补一次组合检查（见 quantumKickPackets）
      quantumKickPackets(ctx, ctx.piece(ev.target.uid));
    },
  },
  // 量子二踢脚（6 阶装备）: 攻击力那半在战斗侧（sim/content/items/battle.js 的 chess_item_6_quantum_kick，
  // 按携带者是不是【岁】盟约干员取 +atk 或 +atk_strong）；休整期这半只发如意红包。
  quantum_kick_buff: {
    onEquip(ctx, ev) { quantumKickPackets(ctx, ctx.piece(ev.target.uid)); },
  },
  // 终极企鹅勋章（企鹅物流，5 阶装备）: 装备时立刻获得 `count` 件随机 1~2 阶装备（普通 2 / 金色 3）。
  // 携带者**自身**盟约含【企鹅物流】→ 发精锐（金色）装备；变形同构体赠予的盟约**不触发**这一条
  // （用户 2026-10-10 裁定：「本装备和变形同构体携带时装备者视为企鹅物流干员，但是不会触发获得精锐装备」），
  // 所以这里读棋子自身的 bonds（ctx.gd.chess），不用 ctx.pieceBonds（那个已含变形同构体的赠予）。
  penguin_medal_draw: {
    onEquip(ctx, ev) {
      const p = paramsOf(ctx, ev.item);
      const n = Math.max(1, int(p.count, 2));
      const maxTier = Math.max(1, int(p.max_tier, 2));
      const rec = ctx.gd.chess(ev.target.id);
      const own = rec && Array.isArray(rec.bonds) ? rec.bonds : [];
      const elite = own.includes('penguinShip');
      for (let k = 0; k < n; k++) {
        const id = ctx.rollItem({ maxTier });
        if (!id) continue;
        const got = ctx.grantItem(id, { source: 'item:penguin_medal' });
        if (got && elite) ctx.upgradeItem(got.uid);
      }
    },
  },
};

/** Persistent EffectRef handlers used by built-ins and 机变 defaults. */
const EFFECT_HANDLERS = {
  builtin_round_coin: {
    onRoundStart(ctx) {
      const n = int(ctx.source.ref && ctx.source.ref.params && ctx.source.ref.params.count, 0);
      if (n > 0) ctx.addFunds(n, 'doll');
    },
  },
  // 信标's gift: at the next round start (下个休整期) the original operator goes to the teammate picked at equip time. It
  // hangs on the SENDER and runs even when the sender was eliminated in between (`afterElimination`: Match.startRound →
  // EffectDispatcher.dispatchEliminated) — an eliminated player gets no onRoundStart, so the gift was lost (GitHub #86).
  // A receiver eliminated meanwhile is replaced by the living teammate with the most members of the operator's bonds
  // (ties at random) [ASSUMED]; with no teammate left alive the gift is dropped. The effect is removed only after the
  // operator was granted: a grant that fails (no copy of it left in the shared pool, the receiver's 整备区 and temp
  // full) keeps it for the next round start — the official text names no refund [ASSUMED].
  builtin_gift: {
    afterElimination: true,
    onRoundStart(ctx) {
      const ref = ctx.source.ref;
      const p = ref.params || {};
      const rec = p.chessId ? ctx.gd.chess(p.chessId) : null;
      if (!rec) { ctx.removeEffect(ref.id); return; }
      const to = ctx.player(p.toPlayerId) || mostBondMate(ctx, Array.isArray(p.bonds) ? p.bonds : rec.bonds || []);
      if (!to) { ctx.removeEffect(ref.id); return; }
      if (!to.grantChess(p.chessId)) return;
      ctx.removeEffect(ref.id);
      to.giftTicker(ctx.name, p.chessId, ctx.playerId);
    },
  },
  // 整备: the next purchased item becomes advanced (golden). upgradeItem leaves it normal, and this
  // charge unspent, when the shared stock has no room for the golden's second copy.
  builtin_next_buy_golden_item: {
    onBuy(ctx, ev) {
      const ref = ctx.source.ref;
      if (ev.kind !== 'item' || !ev.piece || ctx.gd.isGolden(ev.piece.id)) return;
      if (ctx.upgradeItem(ev.piece.uid)) {
        ref.counter = Math.max(0, (ref.counter || 1) - 1);
        if (ref.counter <= 0) ctx.removeEffect(ref.id);
      }
    },
  },
  // 升华: the next purchased operator becomes elite
  builtin_next_buy_elite: {
    onBuy(ctx, ev) {
      const ref = ctx.source.ref;
      if (ev.kind !== 'chess' || !ev.piece || ctx.gd.isGolden(ev.piece.id)) return;
      if (ctx.promote(ev.piece.uid)) {
        ref.counter = Math.max(0, (ref.counter || 1) - 1);
        if (ref.counter <= 0) ctx.removeEffect(ref.id);
      }
    },
  },
};

/**
 * Register the built-ins on a registry. Item keys are resolved from the loaded data by buff key.
 * @param {import('./effectsMeta.js').MetaRegistry} reg
 * @param {Readonly<Record<string, any>>} [data]
 */
export function registerBuiltins(reg, data = null) {
  let d = data;
  if (!d) { try { d = getData({ log: { warn() {}, error() {}, info() {} } }); } catch { d = {}; } }
  const items = d && d.items && typeof d.items === 'object' ? d.items : {};
  const done = new Set();
  for (const [id, rec] of Object.entries(items)) {
    if (!rec || !Array.isArray(rec.buffs)) continue;
    const key = itemKey(id);
    if (done.has(key)) continue;
    // golden and normal share the key; prefer the normal record's buff (博士投影 differs: handled by a merged handler)
    const buffKeys = new Set();
    for (const sib of [items[`${key}_a`], items[`${key}_b`], items[key]]) {
      if (sib && Array.isArray(sib.buffs)) for (const b of sib.buffs) if (b && typeof b.key === 'string') buffKeys.add(b.key);
    }
    const handlers = [...buffKeys].map((k) => ITEM_HANDLERS[k]).filter(Boolean);
    if (!handlers.length) continue;
    done.add(key);
    reg.register(`item:${key}`, mergeHandlers(handlers, buffKeys));
  }
  for (const [k, h] of Object.entries(EFFECT_HANDLERS)) reg.register(`effect:${k}`, h);
  return reg;
}

/**
 * Combine several buff-key handlers of one item family (e.g. 博士投影 normal = delayed, golden = immediate): each hook
 * dispatches to the handler whose buff key belongs to the concrete item (normal/golden) in the event.
 */
function mergeHandlers(handlers, buffKeys) {
  if (handlers.length === 1) return handlers[0];
  const byKey = [...buffKeys].filter((k) => ITEM_HANDLERS[k]).map((k) => [k, ITEM_HANDLERS[k]]);
  const out = {};
  const hooks = new Set();
  for (const [, h] of byKey) for (const name of Object.keys(h)) hooks.add(name);
  for (const hook of hooks) {
    out[hook] = function (ctx, ev) {
      const item = (ev && ev.item) || (ctx.source && ctx.source.piece);
      const rec = item ? ctx.gd.item(item.id) : null;
      const own = new Set(rec && Array.isArray(rec.buffs) ? rec.buffs.map((b) => b.key) : []);
      for (const [k, h] of byKey) if (own.has(k) && typeof h[hook] === 'function') h[hook](ctx, ev);
    };
  }
  return out;
}

export const BUILTIN_ITEM_BUFF_KEYS = Object.freeze(Object.keys(ITEM_HANDLERS));
export const BUILTIN_EFFECT_KEYS = Object.freeze(Object.keys(EFFECT_HANDLERS).map((k) => `effect:${k}`));
