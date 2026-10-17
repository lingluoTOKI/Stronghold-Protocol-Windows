// server/match/player/views.js — PlayerState methods: the views — pieceView, effectsView (the effects column: 策略 / 机变 /
// 悬赏 …) and m.private (privateView).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { PHASE } from '../../../shared/constants.js';
import { boardOrder, pieceDir } from '../board.js';
import { bondList, offBondCounts } from '../bondsMeta.js';
import { bountyText, bountyCard } from '../choices.js';

export class PlayerViews {
  pieceView(p, rc = null) {
    const rec = p.kind === 'item' ? this.gd.item(p.id) : p.kind === 'token' ? this.gd.token(p.id) : this.gd.chess(p.id);
    // 干员皮肤 (docs/SKINS.md): the 时装 the owner picked for this piece's chess. Keyed by the base id so an elite /
    // promoted piece keeps the choice the player made for the chess (the server echoes it; the client renders it)
    const skinBase = p.kind === 'chess' ? ((rec && rec.baseId) || p.id) : null;
    const skin = (skinBase && (this.skins[skinBase] || this.skins[p.id])) || null;
    const v = {
      uid: p.uid,
      kind: p.kind,
      id: p.id,
      golden: !!(rec && rec.isGolden),
      tier: rec && Number.isInteger(rec.tier) ? rec.tier : null,
      items: p.kind === 'chess' ? (p.items || []).map((it) => ({ uid: it.uid, id: it.id })) : [],
      count: p.kind === 'token' ? (p.count || 1) : 1,
      ownerUid: p.kind === 'token' ? p.ownerUid ?? null : null,
      ...(skin ? { skin } : null),
    };
    if (rc) { v.row = rc[0]; v.col = rc[1]; v.dir = pieceDir(p); }
    return v;
  }

  effectsView() {
    const out = [];
    const band = this.bandId ? this.gd.band(this.bandId) : null;
    if (band) out.push({ id: band.effectId || band.bandId, name: band.effectName || band.name, desc: band.desc || '', iconKind: 'band', iconId: band.iconId || band.bandId });
    for (const e of this.effects) {
      if (e.hidden) continue;
      const v = { id: e.id, name: e.name || e.id, desc: e.desc || '', iconKind: e.iconKind || 'choice', iconId: e.iconId || e.id };
      if (e.counter != null) v.counter = e.counter;
      // 契约必须把 key / 分组带到客户端：右侧效果列靠 `contract:` 前缀把契约摘出去，
      // 「查看契约」页靠它按 我方/中立/敌方 分组。之前这里只发 id/name/desc/icon，
      // 客户端的 e.key 恒为 undefined —— 顺手也修好了「敌方契约加成」那行（detailPanel enemyBonus）不出数的问题。
      if (e.key) v.key = e.key;
      if (e.data && e.data.group) v.group = e.data.group;
      out.push(v);
    }
    for (const b of this.bounties) {
      // the battles the bounty's enemies still come for (an official multi-round card: every battle, no counter) and
      // the card's official rich text (blue "下场作战" / "两场作战", red "每场"; a multi-round card reads as long as it
      // lasts — choices.js bountyText, MULTI_ROUND_BOUNTY_BATTLES) — user playtest #6 item 4
      const left = b.roundsLeft >= 90 ? null : b.roundsLeft;
      const eff = b.card.effectId ? this.gd.effect(b.card.effectId) : null;
      out.push({
        id: b.id, name: b.card.name || '悬赏', desc: bountyText((eff && eff.descRaw) || b.card.desc || '', b.card), iconKind: 'choice', iconId: b.card.effectId || 'bounty', // i18n-ignore: a data-less card's fallback name
        counter: left, counterText: left == null ? '之后的每场作战' : `还剩 ${left} 场作战`, // i18n-ignore: older clients (ui/effectsList.js builds it from counter)
      });
    }
    return out;
  }

  privateView() {
    const slots = this.shop.slots.map((s) => (s ? { kind: s.kind, id: s.id, price: this.priceOf(s), basePrice: s.basePrice, sold: !!s.sold, frozen: !!s.frozen } : null));
    const offer = this.offers[0] || null;
    const free = this.shop.freeRefreshes > 0;
    const board = [];
    for (const { r, c, piece } of boardOrder(this.board)) board.push(this.pieceView(piece, [r, c]));
    // a boss round's prep: the partner's board on its half of the boss field (Match.bossMateView, item 51)
    const bossMate = typeof this.m.bossMateView === 'function' ? this.m.bossMateView(this) : null;
    return {
      t: 'm.private',
      playerId: this.playerId,
      seat: this.seat,
      alive: this.alive,
      lp: this.lp,
      funds: this.funds,
      bandId: this.bandId,
      ready: this.ready,
      canReady: this.alive && this.tempEmpty && !this.personalChoice && this.m.phase === PHASE.PREP,
      personalChoice: this.personalChoice ? {
        id: this.personalChoice.id,
        round: this.personalChoice.round,
        // 教鞭的悬赏选择没有 kind；天选明星带 kind/step（客户端据此换标题与图标）
        kind: this.personalChoice.kind || null,
        step: this.personalChoice.step || null,
        sourceItemId: this.personalChoice.sourceItemId,
        cards: this.personalChoice.kind === 'lungmen'
          ? this.personalChoice.cards.map((c) => ({ kind: 'lungmen', group: c.group, idx: c.idx, opId: c.opId || null, key: c.key || null, kindKey: c.kindKey || null, name: c.name, desc: c.desc || '' }))
          : this.personalChoice.cards.map((c) => bountyCard(this.gd, c)),
      } : null,
      shop: {
        level: this.shop.level,
        maxLevel: this.gd.maxShopLevel,
        upgradePrice: this.shop.level >= this.gd.maxShopLevel ? 0 : this.shop.upgradePrice,
        refreshPrice: free ? 0 : this.gd.refreshPrice,
        freeRefreshes: this.shop.freeRefreshes,
        frozen: this.shop.frozen,
        slots,
        // `source` 'merge' = the promotion reward (晋升奖励); any other offer (a strategy, an item, a 特质) carries the
        // `label` the bar shows instead; `queued` = offers waiting behind it (player report #6 after 0.1.0)
        rewardOffer: offer ? { tier: offer.tier, source: offer.source === 'merge' ? 'merge' : 'special', label: offer.label || null, queued: this.offers.length - 1, slots: offer.slots.map((s) => ({ kind: s.kind === 'item' ? 'item' : 'chess', id: s.id, price: s.price, sold: !!s.sold })) } : null,
      },
      hand: this.hand.map((p) => (p ? this.pieceView(p) : null)),
      temp: this.temp.map((p) => (p ? this.pieceView(p) : null)),
      board,
      // The stage's 外勤医疗 reserve medic is present during prep, but is not a draggable board piece.
      prepMapChars: this.m.prepMapChars(this),
      deployCap: this.deployCap,
      deployCount: this.deployCount,
      // + the mode-off bonds it has members of (`off: true`, the strip's grey 本局禁用 discs — bondsMeta.offBondCounts)
      bonds: bondList(this.gd, this.bondsView(), { full: true, off: offBondCounts(this.gd, this) }),
      effects: this.effectsView(),
      nextEnemies: this.m.nextEnemiesFor(this),
      // 契约选择（2/8/12 回合）：自己的牌桌（3 我方 + 3 敌方）、刷新状态与已定槽位 —— m.private.sp
      sp: typeof this.m.contractPrivateSp === 'function' ? this.m.contractPrivateSp(this) : null,
      // DESIGN §16: the effective operator loadout ({ [baseChessId]: { skill, module } }; chess not listed use defaults)
      loadout: this.loadout,
      // 0.2.2: the effective per-operator 潜能 / 练度 ({ [charId]: { potential, cultivate } }; operators not listed: 潜能 6,
      // 精英2 Lv.60) — the client's cards compose the numbers from it (shared/potential.js)
      ops: this.ops,
      // 0.2.0 补位: the base chess ids this player fields as their stand-ins in this match (the not-owned list the seat had
      // at the match start; [] = every operator owned) — the client shows these as their stand-ins (cards, pieces, the
      // detail card, with a small 「替补」 mark)
      standIns: this.standIns,
      // 0.2.0 自选编队: this player's 自选 picks in this match ({ [slotBaseId]: { charId, skillIndex, uniEquipId } } — the seat's
      // when the match started; {} = none) — the client composes the operator's record for its own cards and pieces
      // (shared/diy.js diyRecord); `diyBanned`: the slotted slots out of the shop this match (every bond of the operator
      // switched off)
      diy: this.diy,
      diyBanned: this.diyBanned,
      // 最终攻势 / 隐秘核心 prep (community report of 2026-10-06, item 51): `{ playerId, side, units }` — the pair partner's
      // board pieces as UnitInfo on its half of the boss field (mirrored on the right half, as the battle places them);
      // the own prep view draws them beside the own half, read-only. Absent otherwise.
      ...(bossMate ? { bossMate } : {}),
      stats: {
        dmgDealt: Math.round(this.stats.dmgDealt), kills: this.stats.kills, leaks: this.stats.leaks, gold: this.stats.gold,
        refreshes: this.stats.refreshes, merges: this.stats.merges,
      },
    };
  }
}
