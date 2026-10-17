// server/match/player/round.js — PlayerState methods: the round lifecycle the match calls — startRound (income, pending
// coins, the shop, summon stacks topped up), endPrep, eliminate (every copy back to the pool), recompute (legality,
// out-of-range summons, temp pieces into free hand slots, bonds; onActiveBonds when the set of active bonds changed),
// the bond views — and battleInput (the player's PlayerBattleInput: board units with their loadout, their 补位 mark or
// their 自选 pick, carried 联防 state, the reached layers).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { boardOrder, pieceDir } from '../board.js';
import { computeBonds, bondSnapshot, activatedLayers, bondsWithGains } from '../bondsMeta.js';

export class PlayerRound {
  startRound(r) {
    this.round = { refreshes: 0, buys: 0, sells: 0, spent: 0, gainedChess: 0, arts: 0 };
    this.pendingLayerGains = null; // settled (or lapsed) at the last SETTLE
    if (r > 1) this.shop.upgradePrice = Math.max(0, this.shop.upgradePrice - 1);
    // onIncome handlers may rewrite ev.income / ev.pending (e.g. 老鲤 withholds R1–R2 income until R3)
    const ev = { round: r, income: this.gd.income(r), pending: this.pendingFunds };
    this.pendingFunds = 0;
    this.m.dispatch(this, 'onIncome', ev);
    const nonNeg = (v) => (Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
    this.addFunds(nonNeg(ev.income) + nonNeg(ev.pending), { reason: 'income' });
    // temp is NOT wiped here: the last prep's deadline resolved what the player could act on (endPrep); what overflowed
    // after it (battle-result grants, SETTLE merges, returned equipment) is shown and usable in this prep (tempDue).
    // Queued reward offers (a promotion's pick, a strategy's special refresh, an item offer) are kept until picked —
    // they do not lapse at the prep deadline (PRTS 卫戍协议/帮助: the temporary shop leaves its state when one is bought;
    // community report relayed by the maintainer on 2026-10-15) — so an offer left with 稍后 is shown again in this prep
    this.ready = false;
    // summon stacks removed from temp at the last prep deadline come back (PRTS 卫戍协议/帮助 §手牌区); full hand ⇒ temp
    for (const p of [...this.board.values()]) if (p.kind === 'chess') this.grantTokensFor(p);
    this.rollShop({ keepFrozen: true });
    this.shop.frozen = false;
    for (const s of this.shop.slots) if (s) s.frozen = false;
    this.recompute();
    // 非休整期发出的盟约/策略/特质/装备赠予（资源、干员、道具）在这里兑现 —— 2026-10-13 用户裁定：
    // 「所有盟约给的道具、资金、干员，如果在休整期则立刻发放，如果不在休整期则下个休整期发放」。
    // 放在 recompute() 之后、收入入账之后：兑现本身可能改变棋盘/盟约（例如发的干员触发了新的盟约），
    // 所以再 recompute 一次，让本回合的商店与盟约视图看到最终状态。
    if (this.flushDeferredGrants) this.flushDeferredGrants();
  }

  /**
   * Prep deadline (Match.endPrep, after the <休整期结束时> onPrepEnd effects): the temp pieces due at this prep are
   * resolved; what overflowed after Ready or during onPrepEnd stays for the next prep, which `prepsEnded` now names.
   */
  endPrep() {
    this.resolveTemp();
    this.prepsEnded++;
    for (const uid of [...this._tempDue.keys()]) if (!this.temp.some((p) => p && p.uid === uid)) this._tempDue.delete(uid);
    // (queued reward offers stay: they last until picked, startRound)
    this.clearUnfrozenShop();
    if (!this.gd.leftoverKeptBands.includes(this.bandId) && !this.m.dev) this.funds = 0;
    this.ready = true;
    this.dirty();
  }

  /**
   * 兑现排队中的「非休整期赠予」（PlayerState.deferredGrants）。在 startRound 的 recompute() 之后调用。
   *
   * 每一项按 kind 走回与当次相同的入账路径（资金 addFunds、干员 grantChess、道具 grantItem），所以合并 /
   * 整备区溢出 / 库存等规则与即时发放完全一致，只是时间点被推迟。逐项处理是刻意的：一个干员的入账可能
   * 触发新的盟约或合并，后面的项要看到那个结果。结束后 recompute 一次，让本回合视图反映最终状态。
   * 排队为空时是零开销的 no-op（绝大多数回合都是这样）。
   */
  flushDeferredGrants() {
    const q = this.deferredGrants;
    if (!Array.isArray(q) || !q.length) return 0;
    this.deferredGrants = [];
    let n = 0;
    for (const g of q) {
      if (!g || !this.alive) continue;
      try {
        if (g.kind === 'funds') {
          const v = Math.trunc(Number(g.n) || 0);
          if (v > 0) { this.addFunds(v, { reason: g.reason || 'deferred' }); n++; }
        } else if (g.kind === 'chess') {
          if (g.id && this.gd.chess(g.id)) {
            const p = this.acquireChess(g.id, { source: g.source || 'deferred', ...(g.opts || {}) });
            // 龙门的盟约奖励在非休整期排的队（用户 2026-10-16「激活了就立刻送」）：真实 uid 到这一刻才有，
            // 内容层把它记在 opts.lungmenEnhanceMode 上等这儿回填，战斗侧据此给这名干员叠加强化
            // （server/sim/content/lungmen.js recordGranted / grantedOps）。
            if (p && g.opts && (g.opts.lungmenEnhanceMode === 'partial' || g.opts.lungmenEnhanceMode === 'full')) {
              const KEY = 'lungmen:grantedOps';
              let rec = {};
              try { rec = JSON.parse(this.counters[KEY] || '{}') || {}; } catch { rec = {}; }
              const arr = Array.isArray(rec[g.opts.lungmenEnhanceMode]) ? rec[g.opts.lungmenEnhanceMode] : [];
              if (!arr.includes(p.uid)) arr.push(p.uid);
              rec[g.opts.lungmenEnhanceMode] = arr;
              this.counters[KEY] = JSON.stringify(rec);
            }
            n++;
          }
        } else if (g.kind === 'item') {
          if (g.id && this.gd.item(g.id)) { this.acquireItem(g.id, { source: g.source || 'deferred', ...(g.opts || {}) }); n++; }
        }
      } catch (e) {
        this.m?.reportError?.('deferred grant', e);
      }
    }
    if (n) { this.recompute(); this.dirty(); }
    return n;
  }

  // `effects` are kept: a 信标 gift still pending is delivered to the teammate at the next round start (builtin_gift is
  // flagged afterElimination — GitHub #86); nothing else of an eliminated player is dispatched.
  eliminate(round) {
    this.alive = false;
    this.ready = false;
    this.eliminatedRound = round;
    const all = [];
    for (const p of this.board.values()) all.push(p);
    for (const p of this.hand) if (p) all.push(p);
    for (const p of this.temp) if (p) all.push(p);
    for (const p of all) {
      this.returnCopies(p);
      if (p.kind === 'item') this.releaseItemStock(p);
      for (const it of p.items || []) this.releaseItemStock(it);
    }
    this.board.clear();
    this.hand.fill(null);
    this.temp.fill(null);
    this._tempDue.clear();
    this.offers = [];
    this.bounties = [];
    this.personalChoice = null;
    this.shop.slots = [];
    this.funds = 0;
    this.pendingFunds = 0;
    this.recompute();
  }

  recompute() {
    this.deployMap(); // a change of the deploy field (a boss round's prep) marks the legality stale
    if (this._legalityStale) this._evictIllegal();
    this._liftOutOfRange();
    // a free regular hand slot pulls a temp piece in (PRTS 卫戍协议/帮助 §手牌区 "常规手牌区出现空位时自动移入")
    this._fillHandFromTemp();
    // the states the last recompute stored: the change since then is reported once (_reportActiveBonds)
    const before = this.bonds;
    this.bonds = computeBonds(this.gd, this);
    this.dirty();
    // 莱茵生命: the on-board count drives 伊芙利特's free grant / elite promotion (Match.rhineIfritCheck, match/factions.js).
    try { this.m.rhineIfritCheck?.(this); } catch { /* never break a recompute */ }
    // 岁: 激活/升档立刻发阈值红包（不用等下一回合的 prep 入口；幂等，靠 suiFlags.tier 去重）。
    try { this.m.suiTierCheck?.(this); } catch { /* never break a recompute */ }
    this._reportActiveBonds(before, this.bonds);
  }

  /**
   * onActiveBonds (docs/META.md §2.2): the set of active bonds differs between `before` and `after` — every path that
   * changes what the bonds count ends in recompute (a board edit in prep: place, move, swap, withdraw; buys, sells,
   * merges, transformations, temp moves, equipment, effects, an eviction). Bonds that light up pay their owed layer
   * milestones at once (维多利亚's hammers, 远见 / 奇迹's funds — the maintainer's report of 2026-10-15). Each recompute
   * reports the difference to the previous computed state, so a handler's own recompute (a hammer's onGain) reports
   * only what changed after it, and nothing twice. Never for an eliminated player (eliminate clears the board) nor a
   * detached copy (preview.js previewPlayer).
   */
  _reportActiveBonds(before, after) {
    if (!this.alive || typeof this.m.dispatch !== 'function') return;
    if (this.m.players && this.m.players.get(this.playerId) !== this) return;
    const activated = [];
    const deactivated = [];
    for (const id of this.gd.bondIds) {
      const was = !!(before && before[id] && before[id].active);
      const is = !!(after && after[id] && after[id].active);
      if (is && !was) activated.push(id);
      else if (was && !is) deactivated.push(id);
    }
    if (activated.length || deactivated.length) this.m.dispatch(this, 'onActiveBonds', { activated, deactivated });
  }

  activatedLayers() { return activatedLayers(this.bonds); }

  /**
   * The bond states the views show (m.private bonds, m.public players[].bonds): the computed states plus the pending
   * in-battle gains of this round's finished normal battle (bondsMeta.bondsWithGains), under the match's own layer cap
   * (m.layerCap: 999 normally, off in a dev / endless run — settle() reads the same number). The 联防 field fights with
   * them too (battleInput `reached`); no other rule reads them.
   */
  bondsView() { return bondsWithGains(this.bonds, this.pendingLayerGains, this.m.layerCap); }

  /**
   * `reached`: the bonds carry the layers this round's own combat reached (bondsView: the pending in-battle gains, capped
   * like settle()) — the 联防 field (unite.js; PRTS 卫戍协议/帮助 §联防阶段 "将以其阵地当前的状态", [ASSUMED] the current
   * state includes those layers, as the strip shows them). The gains stay pending: settle() adds them once.
   */
  battleInput({ side = 'L', colOffset = 0, carry = null, reached = false } = {}) {
    // a terrain change not yet followed by a recompute (a content hook at the prep end) never fields an illegal board
    this.deployMap();
    if (this._legalityStale) this.recompute();
    const units = [];
    for (const { r, c, piece } of boardOrder(this.board)) {
      if (piece.kind === 'chess') {
        const u = { uid: piece.uid, kind: 'chess', chessId: piece.id, row: r, col: c, dir: pieceDir(piece), items: (piece.items || []).map((i) => i.id) };
        const pick = this.diyPickOf(piece.id);
        if (pick) {
          // 0.2.0 自选编队: a slotted DIY slot fights as its pick (sim getChess(id, { diy }): the operator's body, the pick's
          // skill and module — no loadout fields, docs/SIM.md §12)
          u.diy = { charId: pick.charId, skillIndex: pick.skillIndex, uniEquipId: pick.uniEquipId };
        } else if (this.fieldsStandIn(piece.id)) {
          // 0.2.0 补位: a chess this player does not own fights as its stand-in (sim getChess(id, { standIn: true }): the
          // backup skill / module — no loadout fields, docs/SIM.md §12)
          u.standIn = true;
        } else {
          // DESIGN §16: the equipped skill / module (elite only) from the loadout (defaults when absent)
          const lo = this.loadoutFor(this.gd.chess(piece.id));
          u.skillIndex = lo.skillIndex;
          u.moduleId = lo.moduleId;
        }
        // 0.2.2: the potential / 练度 of an operator the player owns (the chess as itself, an owned 自选 pick — the player's
        // 干员调配 settings, 潜能 6 / 精英2 Lv.60 by default and for bots; never a stand-in's nor a prototype pick's)
        const cv = u.standIn ? null : this.cultivationFor(this.gd.chess(piece.id));
        if (cv) { u.potential = cv.potential; u.cultivate = cv.cultivate; }
        // 干员皮肤 (docs/SKINS.md): the 时装 the owner picked for this chess (base id, so an elite keeps the choice);
        // the sim passes it to the unit (Unit.skin → unitInfo → the renderer's spineEntry)
        const skinBase = (this.gd.chess(piece.id) || {}).baseId || piece.id;
        const skin = this.skins[skinBase] || this.skins[piece.id];
        if (skin) u.skin = skin;
        // 开发者功能扩展（dev-ext 移植）：面板改过的干员数值随战斗输入进 u.devExt，由 sim 在 battleStart 挂成属性 buff
        const dv = piece.meta && piece.meta.data && typeof piece.meta.data.devExt === 'object' ? piece.meta.data.devExt : null;
        if (dv) u.devExt = dv;
        if (carry && carry.has(piece.uid)) u.carryState = carry.get(piece.uid);
        units.push(u);
      } else if (piece.kind === 'token') {
        const u = { uid: piece.uid, kind: 'token', tokenId: piece.id, row: r, col: c, dir: pieceDir(piece), ownerUid: piece.ownerUid };
        if (carry && carry.has(piece.uid)) u.carryState = carry.get(piece.uid); // 联防: { sp } (unite.js)
        units.push(u);
      }
    }
    return {
      playerId: this.playerId,
      seat: this.seat,
      side,
      colOffset,
      units,
      bonds: bondSnapshot(reached ? this.bondsView() : this.bonds),
      bandId: this.bandId,
      playerEffects: this.effects.filter((e) => e.battle !== false).map((e) => ({
        id: e.id, key: e.key ?? null, source: e.iconKind ?? null,
        // 契约「孤军 / 联合」需要本场战斗的存活玩家数（每回合战斗构建时刷新）
        params: e.key?.startsWith('contract:') ? { ...(e.params ?? {}), alive: this.m ? this.m.alivePlayers().length : null, round: this.m ? this.m.round : null } : (e.params ?? null),
        counter: e.counter ?? null, data: e.data ?? null,
      })),
      deviceOverrides: { ...this.deviceOverrides },
      counters: { ...this.counters },
      /**
       * 已损失生命值 (user 2026-10-14): the target life this player has already lost this match — starting LP minus
       * current LP. 罗德岛's 6-member line reads it ("罗德岛干员造成伤害提高（15+已损失生命值*4）%"), so the sim must
       * see it. `startLp` comes from the band (gd.startLp), never a literal, so a custom band total is honoured.
       */
      lifeLost: this.lpLost(),
    };
  }

  /**
   * Target life already lost this match (0 … the band's starting LP). Negative results are not possible: the
   * ceiling clamps to 0, and a match that never had an LP total (a stub / a bot rehearsal) reads 0.
   */
  lpLost() {
    const start = Number(this.m && this.m.gd ? this.m.gd.startLp(this.bandId) : 0);
    if (!(start > 0)) return 0;
    return Math.max(0, start - Math.max(0, Number(this.lp) || 0));
  }
}
