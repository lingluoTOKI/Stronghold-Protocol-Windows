// server/match/player/round.js — PlayerState methods: the round lifecycle the match calls — startRound (income, pending
// coins, the shop, summon stacks topped up), endPrep, eliminate (every copy back to the pool), recompute (legality,
// out-of-range summons, temp pieces into free hand slots, bonds), the bond views — and battleInput (the player's
// PlayerBattleInput: board units with their loadout, their 补位 mark or their 自选 pick, carried 联防 state, the reached
// layers).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { boardOrder, pieceDir } from '../board.js';
import { computeBonds, bondSnapshot, activatedLayers, bondsWithGains } from '../bondsMeta.js';
import { RHINE_BOND, RHINE_BALANCE, RHINE_DEVICES, rhineCapacity, rhineDevice, rhineStage, advanceRhineResearch } from '../../../shared/rhineResearch.js';   // 本扩展

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
    // Likewise reward offers of the last prep already expired at its end; what is still queued was earned after it —
    // a merge completed during SETTLE / the Final Assault (突变细胞, battle-result grants) — and is shown in this prep
    this.ready = false;
    // summon stacks removed from temp at the last prep deadline come back (PRTS 卫戍协议/帮助 §手牌区); full hand ⇒ temp
    for (const p of [...this.board.values()]) if (p.kind === 'chess') this.grantTokensFor(p);
    this.rollShop({ keepFrozen: true });
    this.shop.frozen = false;
    for (const s of this.shop.slots) if (s) s.frozen = false;
    this.recompute();
  }

  /**
   * Prep deadline (Match.endPrep, after the <休整期结束时> onPrepEnd effects): the temp pieces due at this prep are
   * resolved; what overflowed after Ready or during onPrepEnd stays for the next prep, which `prepsEnded` now names.
   */
  endPrep() {
    this.resolveTemp();
    this.prepsEnded++;
    for (const uid of [...this._tempDue.keys()]) if (!this.temp.some((p) => p && p.uid === uid)) this._tempDue.delete(uid);
    this.offers = [];
    this.clearUnfrozenShop();
    if (!this.gd.leftoverKeptBands.includes(this.bandId)) this.funds = 0;
    this.ready = true;
    this.dirty();
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
    for (const p of all) this.returnCopies(p);
    this.board.clear();
    this.hand.fill(null);
    this.temp.fill(null);
    this._tempDue.clear();
    this.offers = [];
    this.bounties = [];
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
    this.bonds = computeBonds(this.gd, this);
    this._syncResearch();   // 本扩展：盟约层数变了就同步科研装置的解锁与容量
    this.dirty();
  }

  activatedLayers() { return activatedLayers(this.bonds); }

  // ---- 本扩展：莱茵科研装置 --------------------------------------------------

  /** 科研容量即三人莱茵生命盟约解锁的装置上限；解锁时发放固定槽位的装置，容量变小就收回超出的。 */
  _syncResearch() {
    const cap = this.alive ? rhineCapacity(this.bonds[RHINE_BOND]) : 0;
    if (cap && !this.research.unlocked) {
      this.research.unlocked = true;
      for (const [idx, d] of RHINE_DEVICES.entries()) {
        this.research.points[d.key] = 0;
        this.research.stages[d.key] = 0;
        this.research.hand[idx] = this.newPiece('token', d.tokenId, { research: true, researchKey: d.key, ownerUid: null });
      }
    }
    let kept = 0;
    for (const [key, p] of this.board) {
      if (!p.research) continue;
      if (kept++ < cap) continue;
      this.board.delete(key);
      this._returnResearch(p);
    }
  }

  /** 科研视图（m.private.research 与 battleInput 的 research）：容量、层数、备牌区与每台装置。 */
  researchView() {
    const capacity = this.alive ? rhineCapacity(this.bonds[RHINE_BOND]) : 0;
    const all = [...this.board.values(), ...this.research.hand.filter(Boolean)];
    const deployed = new Set([...this.board.values()].filter((p) => p.research).map((p) => p.uid));
    return {
      unlocked: this.research.unlocked, active: capacity > 0, capacity,
      layers: this.layers[RHINE_BOND] || 0,
      hand: this.research.hand.map((p) => (p ? this.pieceView(p) : null)),
      devices: RHINE_DEVICES.map((d) => {
        const p = all.find((x) => x.research && x.id === d.tokenId);
        const points = this.research.points[d.key] || 0;
        return { key: d.key, tokenId: d.tokenId, uid: p?.uid ?? null, points, stage: rhineStage(this.research.stages[d.key]),
          onBoard: !!p && deployed.has(p.uid) };
      }),
    };
  }

  /** 只由真实的主战斗构造调用，预览 / 辅助战斗 / 重连都不算。 */
  freezeResearch(input, kind = 'normal') {
    if (!['normal', 'boss', 'hidden'].includes(kind) || this.research.battleRound === this.m.round) return;
    this.research.battleRound = this.m.round;
    const uids = new Set((input?.units || []).filter((u) => u.research).map((u) => u.uid));
    this.research.participants = input?.research?.active
      ? input.research.devices.filter((d) => d.onBoard && uids.has(d.uid) && rhineDevice(d.key)).map((d) => d.key)
      : [];
  }

  /** 本回合作战结算：参战的装置按成败加研究点，每回合只结算一次。 */
  settleResearch(success) {
    const round = this.m.round;
    if (this.research.battleRound !== round || this.research.settled.has(round)) return false;
    this.research.settled.add(round);
    const gain = success ? RHINE_BALANCE.successPoints : RHINE_BALANCE.failurePoints;
    for (const key of new Set(this.research.participants)) {
      const next = advanceRhineResearch({ stage: this.research.stages[key], points: this.research.points[key] }, gain);
      this.research.stages[key] = next.stage;
      this.research.points[key] = next.points;
    }
    this.dirty();
    return true;
  }

  /**
   * The bond states the views show (m.private bonds, m.public players[].bonds): the computed states plus the pending
   * in-battle gains of this round's finished normal battle (bondsMeta.bondsWithGains). The 联防 field fights with them too
   * (battleInput `reached`); no other rule reads them.
   */
  bondsView() { return bondsWithGains(this.bonds, this.pendingLayerGains); }

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
        id: e.id, key: e.key ?? null, source: e.iconKind ?? null, params: e.params ?? null, counter: e.counter ?? null, data: e.data ?? null,
      })),
      deviceOverrides: { ...this.deviceOverrides },
      research: this.researchView(),   // 本扩展：科研装置与进度
    };
  }
}
