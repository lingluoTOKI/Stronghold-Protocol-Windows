// server/match/match/factions.js — Match methods of this fork's fan expansions that live on the PREP/SETTLE side
// (莱茵生命's 伊芙利特 free grant, 罗德岛's battle-fed layers and milestone payouts). The battle-side
// halves live in server/sim/content/{rhine,rodos}.js; the constants in shared/{rhineResearch,rodosIsland}.js.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).
//
// Hook points (the two PlayerState callbacks, mirroring the mod):
//   • player/round.js  recompute()        → this.m.rhineIfritCheck(this)        (on-board 莱茵 count changed)
//   • player/economy.js addLayers()       → this.m.rodosPrepMilestones(this, …) (a 罗德岛 milestone crossed in prep)
// and the two Match-side calls:
//   • match/prep.js  at prep entry        → this._flushRodosRewards(ps)
//   • match/settle.js after onBattleResult→ this._rodosBattleLayers(ps, perfect, lifeLost)

import { PHASE, layerGainRoom } from '../../../shared/constants.js';
import { RODOS_BOND, RODOS_TIERS, rodosCrossedMilestones } from '../../../shared/rodosIsland.js';
import { RHINE_BOND, RHINE_BALANCE } from '../../../shared/rhineResearch.js';

// ---------------------------------------------------------------------------------------------------------------------
// 岁 suiShip — 如意红包（数据项 chess_item_6_sui_m）。发放点（口径 = bonds.json suiShip.effectDesc）：
//   1 名【岁】立刻 1 个，此后每 2 次「完美作战 / 成功协防」再 1 个（4 名起协防不论成败都计入这一次计数器）；
//   7 名【岁】立刻再 2 个、且每回合开始 +1 个；层数里程碑 25（4 名起 20）层 1 个，首达 100 层额外 +2。
// 红包走 grantItem → ps.acquireItem → recompute，所以每个发放入口都必须**先记账再发**（见 _suiThresholdPackets）；
// 否则 recompute 会重入同一个入口，把手牌一路灌满（2026-10-12 修）。
const SUI_BOND = 'suiShip';
const SUI_PACKET_ITEM = 'chess_item_6_sui_m';

export class MatchFactions {
  /** 发 n 个如意红包给 ps（toast 一次）。 */
  _suiGrantPackets(ps, n) {
    if (!(n > 0)) return 0;
    let got = 0;
    for (let i = 0; i < n; i++) if (this.grantItemTo?.(ps, SUI_PACKET_ITEM) ?? (() => { const r = ps.acquireItem(SUI_PACKET_ITEM, { source: 'sui:packet' }); return !!r; })()) got++;
    if (got > 0) this.toast(ps, 'info', '获得如意红包 ×' + got);
    return got;
  }

  /** 岁盟约 tier（1=1岁、2=4岁、3=7岁）—— 按 ps.bonds[SUI_BOND].count 对照 thresholds [1,4,7]。 */
  _suiTier(ps) {
    const bond = this.gd.bond?.(SUI_BOND);
    if (!bond || !ps.bonds?.[SUI_BOND]?.active) return 0;
    const count = ps.bonds[SUI_BOND].count | 0;
    let t = 0;
    for (const th of bond.thresholds || []) if (count >= th) t++;
    return t;
  }

  /**
   * 层数里程碑红包：跨过 floor(after/step) − floor(before/step) 个步 → 每步 1 红包。
   *
   * 步长从 bonds.json suiShip.bb 读（用户 2026-10-14：5 岁档改成 35）：
   *   `packet_layer_step`       常态（1 岁档）步长 = 50
   *   `packet_layer_step_tier4` 5 岁档起「层数需求降低」后的步长 = 35
   * 缺失时回落到 50 / 35。
   */
  _suiLayerPackets(ps, before, after) {
    const t = this._suiTier(ps);
    if (t <= 0) return 0;
    const bb = this.gd.bond?.(SUI_BOND)?.bb ?? {};
    const norm = Math.max(1, Math.floor(Number(bb.packet_layer_step) || 50));
    const low = Math.max(1, Math.floor(Number(bb.packet_layer_step_tier4) || 35));
    const step = t >= 2 ? low : norm;
    const n = Math.floor(Math.max(0, after) / step) - Math.floor(Math.max(0, before) / step);
    ps.suiFlags ||= {};
    return this._suiGrantPackets(ps, n);
  }

  /**
   * 阈值一次性红包 —— 严格按 bonds.json 的描述（effectDesc）：
   *   1 名【岁】：立刻获得 1 个；5 名【岁】：只降层数需求，**不发红包**；7 名【岁】：立刻再获得 2 个。
   * 发放前先把 `suiFlags.tier` 记账：发红包会走 acquireItem → recompute → suiTierCheck，
   * 先发后记会原地重入，手牌每空一个格子就再灌一个（实测一次补满 10 格）。
   */
  _suiThresholdPackets(ps, prevTier, tier) {
    let n = 0;
    if (prevTier < 1 && tier >= 1) n += 1;
    if (prevTier < 3 && tier >= 3) n += 2;
    return this._suiGrantPackets(ps, n);
  }

  /**
   * settle 端（onBattleEnd 后）：协防/完美计数 → 红包；再走一次层里程碑（特质加层发生在 dispatch 里，这里兜底）。
   * @param {object} ps player state
   * @param {{ perfect: boolean, helpedUnite: boolean, uniteSuccess: boolean }} ev
   */
  _suiSettle(ps, ev) {
    const t = this._suiTier(ps);
    if (t <= 0) return;
    ps.suiCounters ||= { assists: 0 };
    const c = ps.suiCounters;
    let n = 0;
    // 7 岁：**每 1 次完美作战或 1 次协防**（无论成败）立刻发 1 个 —— 用户 2026-10-14 规格，
    // 不再走「每 2 次计一个」的计数器，也不再是「每回合开始 +1」。
    if (t >= 3) {
      if (ev.perfect || ev.helpedUnite) n += 1;
    } else if (ev.perfect || (ev.helpedUnite && (t >= 2 || ev.uniteSuccess))) {
      // 1 岁：完美作战 或 成功协防 计一次，每满 2 次 → 1 个红包。
      // 5 岁起：协防**无论是否成功**也计入同一个计数器（effectDesc「帮助队友协防（无论是否成功）也计入红包的获得
      // 条件」）—— 是「计入条件」，不是「每次协防立刻发 1 个」。
      c.assists++;
      if (c.assists >= 2) { c.assists -= 2; n += 1; }
    }
    this._suiGrantPackets(ps, n);
    // 特质在 dispatch 里已加层并触发 economy.addLayers（红包在那边发）；这里只兜底一次里程碑对账
    this._suiLayerPackets(ps, (ps.layers?.[SUI_BOND] || 0) - 1, ps.layers?.[SUI_BOND] || 0);
  }

  /** 每回合开始：阈值红包补发（tier 变化常发生在 recompute 后的 prep）。7 岁不再每回合白送 1 个。 */
  _suiRoundStart(ps) {
    const t = this._suiTier(ps);
    if (t <= 0) return;
    ps.suiFlags ||= {};
    if (ps.suiFlags.busy) return;                 // 发放过程里被 recompute 再次召用时不必再兜一轮
    const prev = ps.suiFlags.tier ?? 0;
    ps.suiFlags.tier = Math.max(prev, t);         // 先记账再发（见 _suiThresholdPackets 的重入说明）
    ps.suiFlags.busy = true;
    try { this._suiThresholdPackets(ps, prev, t); } finally { ps.suiFlags.busy = false; }
  }

  /** recompute 后即时检查：岁 tier 升档（首次激活也含）立刻补发阈值红包（幂等：suiFlags.tier 记档）。 */
  suiTierCheck(ps) {
    const t = this._suiTier(ps);
    if (t <= 0) return;
    ps.suiFlags ||= {};
    if (ps.suiFlags.busy) return;                 // 阈值红包的发放自身会触发 recompute → 再来一次 suiTierCheck
    const prev = ps.suiFlags.tier ?? 0;
    if (t <= prev) return;
    ps.suiFlags.tier = t;                         // 先记账，否则重入会把红包一直发到手牌塞满
    ps.suiFlags.busy = true;
    try { this._suiThresholdPackets(ps, prev, t); } finally { ps.suiFlags.busy = false; }
  }

  /**
   * 休整期结束（prep.js endPrep，onPrepEnd 之后）：先锋医疗 T1 —— 使当前所有已激活盟约的层数
   * +4（每（先锋层数+医疗层数）/2 层额外 +0.1）。层恒为整数：小数部分累积在 suiFlags.vangmedFrac，
   * 与下次的合起来取整发放（例如连续两回合 4.5 → 各发 4，剩余 1 攒着）。只发已激活的盟约（含自身）。
   */
  _suiPrepEnd(ps) {
    const VM = 'vangmedShip';
    if (!ps.bonds?.[VM]?.active) return;
    const bb = this.gd.bond?.(VM)?.bb ?? {};
    const half = ((ps.layers?.vanguardShip || 0) + (ps.layers?.medicShip || 0)) / 2;
    const total = (bb.t1_layers ?? 4) + half * (bb.t1_extra_per_half ?? 0.1);
    ps.suiFlags ||= {};
    const pool = (ps.suiFlags.vangmedFrac || 0) + total;
    const n = Math.floor(pool);
    ps.suiFlags.vangmedFrac = pool - n;
    if (!(n > 0)) return;
    for (const [bondId, b] of Object.entries(ps.bonds)) {
      if (!b?.active) continue;
      ps.addLayers(bondId, n, { requireActive: true, reason: 'sui:vangmed' });
    }
  }

  /**
   * 罗德岛 (罗德岛 bond): a settled battle feeds the bond — a win adds its tier's win value, a loss adds the
   * tier's per-life-lost value for every point of target life lost. The bond itself sets no layer cap (the
   * engine's 999 still applies), and every milestone crossed for the FIRST time this match pays out once.
   * @param {object} ps player state
   * @param {boolean} won the player's own phase was perfect (no leaks)
   * @param {number} lifeLost target life lost in this battle
   */
  _rodosBattleLayers(ps, won, lifeLost) {
    const bond = this.gd.bond?.(RODOS_BOND);
    if (!bond || !ps.bonds?.[RODOS_BOND]?.active) return 0;
    const members = ps.bonds[RODOS_BOND].count | 0;
    let tier = null;
    for (const t of RODOS_TIERS) if (members >= t.count) tier = t;
    if (!tier) return 0;
    const want = won ? tier.win : tier.perLifeLost * Math.max(0, Math.floor(lifeLost || 0));
    if (!(want > 0)) return 0;
    const before = ps.layers[RODOS_BOND] || 0;
    const add = layerGainRoom(before, want, this.layerCap);
    if (!(add > 0)) return 0;
    ps.layers[RODOS_BOND] = before + add;
    this.dispatch(ps, 'onLayers', { bondId: RODOS_BOND, from: before, to: ps.layers[RODOS_BOND], reason: won ? 'rodos:win' : 'rodos:loss' });
    // Milestone rewards: claimed once per match, checked against the total before/after this gain.
    // A battle result is settled OUTSIDE the prep, so its payouts are deferred to the next prep (like
    // 维多利亚's 战栗维式重锤). Layers gained DURING a prep (traits, bands, cards) are paid out at once.
    ps.rodosClaimed ||= new Set();
    ps.rodosPending ||= [];
    this._checkRodosMilestones(ps, before, ps.layers[RODOS_BOND], { immediate: false });
    ps.dirty();
    return add;
  }

  /**
   * Pay out every 罗德岛 milestone the layer total has newly crossed.
   *
   * @param {object} ps player state
   * @param {number} before layer total before the gain
   * @param {number} after layer total after the gain
   * @param {{ immediate?: boolean }} [opts] `immediate` hands the reward over now (used for gains made during a
   *   prep phase); otherwise it is queued for the next prep (`_flushRodosRewards`), which is the right timing
   *   for a battle result settled between rounds.
   * @returns {number} how many milestones fired
   */
  _checkRodosMilestones(ps, before, after, { immediate = false } = {}) {
    ps.rodosClaimed ||= new Set();
    ps.rodosPending ||= [];
    let fired = 0;
    // 400 层之后每 20 层还有一笔资金，所以这里问的是"这一段跨过了哪些里程碑"，不是一张固定表。
    for (const m of rodosCrossedMilestones(before, after, ps.rodosClaimed)) {
      const key = m.at + ':' + m.kind;
      if (ps.rodosClaimed.has(key)) continue;
      ps.rodosClaimed.add(key);
      fired++;
      // 奇迹 layers are not inventory, so they always land at once.
      if (m.kind === 'layers' || immediate) {
        this._grantRodosReward(ps, m);
      } else {
        ps.rodosPending.push(m);
        this.toast(ps, 'info', '【罗德岛】' + m.at + ' 层奖励将在下回合发放：' + m.name);
      }
    }
    return fired;
  }

  /**
   * Public entry for the prep-side layer gains (player/economy.js addLayers): a milestone reached while the player is
   * in 休整期 is handed over immediately, since they can use it right there.
   */
  rodosPrepMilestones(ps, before, after) {
    return this._checkRodosMilestones(ps, before, after, { immediate: true });
  }

  /**
   * Hand out the 罗德岛 milestone rewards queued by `_rodosBattleLayers` at the start of the next prep phase.
   * @param {object} ps player state
   */
  _flushRodosRewards(ps) {
    const queue = ps.rodosPending;
    if (!queue || !queue.length) return 0;
    ps.rodosPending = [];
    let n = 0;
    for (const m of queue) {
      if (this._grantRodosReward(ps, m)) n++;
    }
    ps.dirty();
    return n;
  }

  /**
   * Deliver one 罗德岛 milestone reward (never throws into the settlement).
   * @returns {boolean} whether it was actually handed over
   */
  _grantRodosReward(ps, m) {
    try {
      if (m.kind === 'chess') {
        const rec = this.gd.chess(m.id);
        if (!rec) {
          this.log?.warn?.('rodos reward ' + m.at + ': chess ' + m.id + ' does not exist');
          return false;
        }
        const piece = ps.acquireChess(m.id, { source: 'rodos', fromPool: false });
        if (piece) { this.toast(ps, 'success', '【罗德岛】' + m.at + ' 层奖励：' + m.name); return true; }
        return false;
      }
      if (m.kind === 'item') {
        let any = false;
        for (let i = 0; i < (m.count ?? 1); i++) if (ps.acquireItem?.(m.id, { source: 'rodos' })) any = true;
        if (any) this.toast(ps, 'success', '【罗德岛】' + m.at + ' 层奖励：' + m.name + ' ×' + (m.count ?? 1));
        return any;
      }
      if (m.kind === 'layers') {
        // 100 层 also grants a pile of 奇迹 layers.
        const bondId = m.bondId ?? 'miraShip';
        const from = ps.layers[bondId] || 0;
        ps.layers[bondId] = from + (m.count ?? 0);
        this.dispatch(ps, 'onLayers', { bondId, from, to: ps.layers[bondId], reason: 'rodos:milestone' });
        this.toast(ps, 'success', '【罗德岛】' + m.at + ' 层奖励：' + m.name);
        return true;
      }
      if (m.kind === 'funds') {
        ps.pendingFunds += m.count ?? 0;
        this.toast(ps, 'success', '【罗德岛】' + m.at + ' 层奖励：' + m.name);
        return true;
      }
    } catch (e) {
      this.log?.warn?.('rodos reward ' + m.at + ' failed: ' + (e && e.message));
    }
    return false;
  }

  /**
   * 莱茵生命 · 伊芙利特：在场 3 / 6 名不同【莱茵生命】干员时免费获得伊芙利特 / 把她升为精锐，9 名时获得莱茵实验终端
   * 与联合研究主机（各一件普通品阶，每局一次）。伊芙利特无法通过商店购买，仅由本条提供。
   * 每次休整期棋盘变化（PlayerState.recompute）后检查一次；`ps._rhineCheck` 防止获得/晋升触发的 recompute 递归。
   * @param {object} ps player state
   */
  rhineIfritCheck(ps) {
    if (this.phase !== PHASE.PREP || ps._rhineCheck) return;
    const count = ps.bonds?.[RHINE_BOND]?.count | 0;
    const [getAt, eliteAt, equipAt] = RHINE_BALANCE.thresholds;
    if (count < getAt) return;
    ps._rhineCheck = true;
    try {
      const normal = 'chess_rhine_ifrit_a';
      const owned = typeof ps._chessLocations === 'function' ? ps._chessLocations() : [];
      const mine = owned.filter((l) => ps.gd.baseIdOf(l.piece.id) === normal);
      if (!mine.length) {
        // 每局只免费发放一次：卖掉伊芙利特不会再次获得（否则可反复卖 1 资金）。
        if (!ps.rhineIfritGiven && ps.acquireChess(normal, { source: 'rhine', fromPool: false })) {
          ps.rhineIfritGiven = true;
          this.toast(ps, 'success', `【莱茵生命】在场的莱茵干员达到 ${getAt} 名：获得伊芙利特`);
        }
      } else if (count >= eliteAt) {
        for (const l of mine) {
          if (ps.promote(l.piece)) { this.toast(ps, 'success', `【莱茵生命】在场的莱茵干员达到 ${eliteAt} 名：伊芙利特升为精锐`); break; }
        }
      }
      // 9 名：发放莱茵实验终端与联合研究主机（同样每局一次，卖掉不会重新发放）。
      if (count >= equipAt && !ps.rhineEquipGiven) {
        let any = false;
        for (const id of RHINE_BALANCE.thresholdItems) if (ps.acquireItem?.(id, { source: 'rhine' })) any = true;
        if (any) {
          ps.rhineEquipGiven = true;
          const names = RHINE_BALANCE.thresholdItems.map((id) => ps.gd.item(id)?.name).filter(Boolean).join('与');
          this.toast(ps, 'success', `【莱茵生命】在场的莱茵干员达到 ${equipAt} 名：获得${names}`);
        }
      }
    } catch (e) {
      this.log?.warn?.('rhine ifrit check failed: ' + (e && e.message));
    } finally {
      ps._rhineCheck = false;
    }
  }
}
