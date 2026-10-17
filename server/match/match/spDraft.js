// server/match/match/spDraft.js — Match methods: the 机变 draft (SP_DRAFT: turn order, timers, AI picks, the card applied
// by choices.js applyCard), the personal bounty choice of the Art 教鞭 (offerBountyChoice / pickPersonalChoice /
// autoPickPersonalChoice: held by the player inside PREP — no phase, no timer of its own) and the rolls the meta effects
// ask for — bounties (addBounty), item ids (rollItemId) and choices.json pools (rollPool).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { generateDraft, applyCard, bountyBattles, isMultiRoundBounty, bountyCard } from '../choices.js';
import { onPickCard } from '../botEmotes.js';
import { contractBoard, contractBoardSelf, contractBoardNeutral, contractBoardEnemy } from '../contracts.js';
import { weightedPick } from '../waves.js';
import { botPickCard } from '../bot.js';
import { OK, fail, DELAYS } from './common.js';

/** Cards of the personal choice (PRTS 卫戍协议：盟约 下半 §法术 教鞭: "于3个战术特训的悬赏任务中选择一项"). */
const PERSONAL_OFFER_SIZE = 3;

// 诗怀雅策略【天选明星】 (data/bands.json band_swire, content/bands/meta.js band_swire_choose_enhance):
// **第一回合**（2026-10-15 起，原先要等龙门首次激活）让策略持有者主动选一位可强化的龙门干员，再选一种强化类型（两步选择）。
// 干员名单与两种「强化类型」都和 content/lungmen.js 的 ENHANCE_KEYS / ENHANCE_KINDS 同源。
const LUNGMEN_ENHANCE_OPS = ['chess_chen3_a', 'chess_char_3_04_a', 'chess_lm_hsgma2_a', 'chess_lm_lin_a'];
const LUNGMEN_ENHANCE_KINDS = ['skill', 'duration', 'trait'];
/** 强化类型的中文名（客户端 t() 会翻译；数据侧只给中文原文）。 */
const LUNGMEN_KIND_LABEL = { skill: '技能数值', duration: '技能持续时间', trait: '特质数值' };

/** 一张「选干员」卡（第一步）。name 用干员中文名，客户端 t() 按需翻译。 */
function lungmenOpCard(gd, opId, idx) {
  const c = gd.chess(opId);
  return { kind: 'lungmen', group: 'op', idx, opId, key: lungmenKeyOf(opId), name: (c && c.name) || opId, desc: '', effectId: opId };
}
/** 一张「选强化类型」卡（第二步）。 */
function lungmenKindCard(kindKey, idx) {
  return { kind: 'lungmen', group: 'kind', idx, kindKey, name: LUNGMEN_KIND_LABEL[kindKey] || kindKey, desc: '', effectId: `lungmen_${kindKey}` };
}
/** 干员 id → content/lungmen.js 的强化键（chen3 / linlangswire / hsgma2 / lin）。 */
function lungmenKeyOf(opId) {
  if (opId === 'chess_chen3_a') return 'chen3';
  if (opId === 'chess_char_3_04_a') return 'linlangswire';
  if (opId === 'chess_lm_hsgma2_a') return 'hsgma2';
  if (opId === 'chess_lm_lin_a') return 'lin';
  return null;
}

export class MatchSpDraft {
  /**
   * 进入卡牌选择阶段。kind 'sp' = 机变（官方 3/9/11 回合，共享牌桌按顺序选）；'contract' = 契约选择
   * （本作新增，2/8/12 回合）：**个人牌桌** —— 每人 3 张我方 + 3 张敌方，各选其一，互不占用，
   * 我方三张可免费刷新一次（g.contractRefresh）。流程/计时/AI 挂在同一个 SP_DRAFT 阶段上。
   */
  enterSpDraft(kind = 'sp') {
    if (kind === 'contract') { this.enterContractDraft(); return; }
    const draft = generateDraft(this.gd, this.rngDraft, this.round, { stageId: this.stageId, bondAvailable: (bondId) => this.bondLive(bondId), itemAvailable: id => this.itemPool.canGain(id) });
    const alive = this.alivePlayers();
    if (!draft || !alive.length) { this.enterPrep(); return; }
    this.phase = PHASE.SP_DRAFT;
    let order = alive.map((p) => p.playerId);
    // 机变（SP_DRAFT，第 3 / 9 / 11 回合）的选牌顺序：同盟模式平时乱序 —— 但房里除自己以外只有 AI 时
    // 不乱序，固定 1 号位（第一个座位）先选。
    const humans = alive.filter((p) => !p.isBot).length;
    if (!this.isSolo && humans > 1) this.rngDraft.shuffle(order);
    // 「AI 队友最后选择」 (GitHub #338): humans before AI seats, after the same shuffle (MatchPhases.humansFirst)
    order = this.humansFirst(order);
    // untimed: solo and any single-human match (soloUntimed); the co-op order / 6 cards stay
    const untimed = this.soloUntimed;
    this.sp = { ...draft, order, idx: 0, picks: {}, taken: {}, untimed, turnDeadline: 0 };
    this.setDeadline(0);
    this.startSpTurn();
    this.markPublic();
  }

  /**
   * 契约选择：个人牌桌（每人 3 我方 + 3 中立 + 3 敌方），**三组各选一个**才能继续；超时未选的随机补选。
   * 三组各可免费刷新一次（2026-10-11：我方，敌方，中立都可以刷新一次）。
   */
  enterContractDraft() {
    const alive = this.alivePlayers();
    if (!alive.length) { this.enterPrep(); return; }
    this.phase = PHASE.SP_DRAFT;
    const perPlayer = {};
    for (const ps of alive) perPlayer[ps.playerId] = contractBoard(this, ps);
    this.sp = {
      contract: true, family: 'contract', name: '契约选择', desc: '', eventId: null,
      order: alive.map((p) => p.playerId), picks: {}, taken: {}, untimed: this.soloUntimed, turnDeadline: 0, perPlayer,
    };
    this.setDeadline(0);
    if (!this.sp.untimed) {
      // 契约选择的思考时间：默认 60 s（用户 2026-10-14「持续时间延长至一分钟」）。
      // 房间里只有主机玩家时是**无限**的 —— 由 soloUntimed（isSolo || loneHuman）走上面那条不再挂计时器的分支。
      const secs = this.gd.timer('contractFirst');
      const token = ++this._turnToken;
      this.setDeadline(secs, () => {
        if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken || !this.sp?.contract) return;
        for (const pid of this.sp.order) {
          const ps = this.players.get(pid);
          const board = this.sp.perPlayer[pid];
          if (!ps || !board) continue;
          this._autoPickGroup(ps, board, 'self');
          this._autoPickGroup(ps, board, 'neutral');
          this._autoPickGroup(ps, board, 'enemy');
        }
        this.finishSpDraft();
      });
      this.sp.turnDeadline = this.deadline;
    }
    for (const ps of alive) {
      if (!ps.botControlled) continue;
      this.later(this.scaled(DELAYS.BOT_ACTION), () => {
        if (this.phase !== PHASE.SP_DRAFT || !this.sp?.contract) return;
        const board = this.sp.perPlayer[ps.playerId];
        if (!board) return;
        this._autoPickGroup(ps, board, 'self');
        this._autoPickGroup(ps, board, 'neutral');
        this._autoPickGroup(ps, board, 'enemy');
      });
    }
    // 契约卡面只在 m.private.sp 里（公共视图不带 cards）——进入阶段时必须把每个人的 private 视图推下去，
    // 否则客户端在第一次牌桌时只有无卡面的 m.public.sp，各组选择框是空的（实测报告 2026-10-10）
    for (const ps of alive) this.markPrivate(ps);
    this.markPublic();
    this.flush(true);
  }

  /** 某组没选就随机补选一张（idx 是该卡在扁平牌桌里的下标；该组没得选就跳过）。 */
  _autoPickGroup(ps, board, group) {
    const p = this.sp.picks[ps.playerId] || {};
    if (p[group] != null || !board[group]?.length) return;
    const offset = group === 'self' ? 0 : group === 'neutral' ? board.self.length : board.self.length + (board.neutral?.length || 0);
    this._applyContractPick(ps, offset + Math.floor(this.rngDraft() * board[group].length));
  }

  /** 一名玩家自己的契约牌桌视图（m.private.sp）。 */
  contractPrivateSp(ps) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp?.contract) return null;
    const board = this.sp.perPlayer[ps.playerId];
    if (!board) return null;
    const cards = [...board.self, ...(board.neutral || []), ...board.enemy].map((c, i) => ({ ...c, idx: i }));
    const p = this.sp.picks[ps.playerId] || {};
    return {
      contract: true, name: this.sp.name, cards,
      refreshed: board.refreshed || { self: false, neutral: false, enemy: false },
      myPick: p,
      done: p.self != null && p.neutral != null && p.enemy != null,
    };
  }

  /** 某一组的三张免费刷新一次（该组还没选才行）—— group: 'self' | 'neutral' | 'enemy'。 */
  contractRefresh(ps, group = 'self') {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp?.contract) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (group !== 'self' && group !== 'neutral' && group !== 'enemy') return fail(ERR.BAD_TARGET);
    if (this.sp.picks[ps.playerId]?.[group] != null) return fail(ERR.ALREADY);
    const board = this.sp.perPlayer[ps.playerId];
    if (!board) return fail(ERR.BAD_TARGET);
    // 刷新次数是**计数**（不是布尔）：我方（self）2 次，中立/敌方各 1 次 —— 用户 2026-10-14。
    // 旧记录可能是 true/false（布尔），这里统一折算成计数，保证存档/中途读档不炸。
    const LIMIT = { self: 2, neutral: 1, enemy: 1 };
    if (!board.refreshed || typeof board.refreshed !== 'object' || Array.isArray(board.refreshed)) {
      board.refreshed = { self: 0, neutral: 0, enemy: 0 };
    } else {
      for (const g of ['self', 'neutral', 'enemy']) {
        const v = board.refreshed[g];
        board.refreshed[g] = v === true ? 1 : (Number.isFinite(v) ? v : 0);
      }
    }
    if ((board.refreshed[group] || 0) >= (LIMIT[group] ?? 1)) return fail(ERR.ALREADY);
    if (group === 'self') board.self = contractBoardSelf(this, ps);
    else if (group === 'neutral') board.neutral = contractBoardNeutral(this, ps);
    else board.enemy = contractBoardEnemy(this, ps);
    board.refreshed[group] = (board.refreshed[group] || 0) + 1;
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /**
   * 选一张契约：idx 按扁平牌桌（我方 0..n1-1、中立 n1..n1+n2-1、敌方其后）。三组都定下后才结算并放行回合；
   * 在其它组还没定时，同一组可以改选。
   */
  pickContract(ps, idx) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp?.contract) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const board = this.sp.perPlayer[ps.playerId];
    if (!board) return fail(ERR.BAD_TARGET);
    const n = board.self.length + (board.neutral?.length || 0) + board.enemy.length;
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) return fail(ERR.BAD_TARGET);
    const group = idx < board.self.length ? 'self'
      : idx < board.self.length + (board.neutral?.length || 0) ? 'neutral' : 'enemy';
    const p = this.sp.picks[ps.playerId] || {};
    if (p[group] != null) return fail(ERR.ALREADY);
    this._applyContractPick(ps, idx);
    return OK;
  }

  _applyContractPick(ps, idx) {
    if (!this.sp?.contract || !ps) return;
    const board = this.sp.perPlayer[ps.playerId];
    if (!board) return;
    const flat = [...board.self, ...(board.neutral || []), ...board.enemy];
    const card = flat[idx];
    if (!card) return;
    const group = card.group === 'neutral' ? 'neutral' : idx < board.self.length ? 'self' : 'enemy';
    const p = (this.sp.picks[ps.playerId] = this.sp.picks[ps.playerId] || { self: null, neutral: null, enemy: null });
    if (p[group] != null) return;
    p[group] = idx;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyContract ${card.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    // 三组都定下（或该组没得选）的玩家才算完；全员完成 → 进休整期
    const done = (pid) => {
      const q = this.sp.picks[pid] || {};
      const b = this.sp.perPlayer[pid];
      if (!b || !this.players.get(pid)?.alive) return true;
      return (q.self != null || !b.self.length) && (q.neutral != null || !(b.neutral || []).length) && (q.enemy != null || !b.enemy.length);
    };
    if (!this.sp.order.some((pid) => !done(pid))) { this.setDeadline(0); this.later(0, () => this.finishSpDraft()); }
  }

  spTurn() {
    const s = this.sp;
    if (!s) return null;
    return s.order[s.idx] ?? null;
  }

  spCardAvailable(card) { return !!card && this.sp?.taken[card.idx] == null && (card.kind !== 'item' || this.itemPool.canGain(card.id)); }

  startSpTurn() {
    const s = this.sp;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    while (s.idx < s.order.length) { // loop-cap: draft order
      const ps = this.players.get(s.order[s.idx]);
      if (ps && ps.alive && s.picks[ps.playerId] == null) break;
      s.idx++;
    }
    const available = s.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
    if (s.idx >= s.order.length || !available.length) { this.setDeadline(0); this.later(0, () => this.finishSpDraft()); return; }
    const token = ++this._turnToken;
    if (!s.untimed) {
      const first = s.idx === 0;
      const secs = first ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
      this.setDeadline(secs, () => {
        if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken) return;
        const ps = this.players.get(this.spTurn());
        if (!ps) return;
        const avail = s.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
        if (!avail.length) { this.finishSpDraft(); return; }
        this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
      s.turnDeadline = this.deadline;
    } else {
      this.setDeadline(0);
    }
    const cur = this.players.get(this.spTurn());
    if (cur && cur.botControlled) this.scheduleSpBot();
    this.markPublic();
  }

  scheduleSpBot() {
    const token = this._turnToken;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken || !this.sp) return;
      const ps = this.players.get(this.spTurn());
      if (!ps || !ps.botControlled) return;
      const avail = this.sp.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
      if (!avail.length) return;
      this._applyCard(ps, botPickCard(this, ps, this.sp.cards, avail));
    });
  }

  pickCard(ps, idx) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp) return fail(ERR.WRONG_PHASE);
    if (this.sp.contract) return this.pickContract(ps, idx); // 契约选择：个人牌桌分支
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.sp.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    if (this.spTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.sp.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.spCardAvailable(this.sp.cards[idx])) return fail(ERR.SOLD_OUT);
    this._applyCard(ps, idx);
    return OK;
  }

  _applyCard(ps, idx) {
    const s = this.sp;
    if (!s || s.picks[ps.playerId] != null || !this.spCardAvailable(s.cards[idx])) return;
    const card = s.cards[idx];
    if (!card) return;
    s.picks[ps.playerId] = idx;
    s.taken[idx] = ps.playerId;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    onPickCard(this, ps, card); // AI bots say "思考" when they take a bounty (enabled by default; SP_BOT_EMOTES=0 silences it)
    this.startSpTurn();
  }

  finishSpDraft() {
    if (this.phase !== PHASE.SP_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    this.enterPrep();
  }

  /**
   * 教鞭 (content/items/meta.js, ctx.offerBountyChoice): the Art opens a PERSONAL choice (act2autochess choice event
   * `hunter_band_1`, choiceType PERSONAL_CHOOSE) between up to three of `candidates` — drawn once from the meta rng, kept in
   * `ps.personalChoice` (m.private only) until the owner confirms one with `g.choice { idx, choiceId }`. It lives inside
   * PREP: no phase of its own and no timer — the prep's deadline resolves it (prepDeadline), Ready is refused while it is
   * pending (PlayerPrep.setReady). Refused — before an rng draw or an id is used, so the Art stays in the hand — when it
   * is not the player's PREP, a choice is already open or no card is left to offer.
   * @param {import('../PlayerState.js').PlayerState} ps @param {any[]} candidates cards.bounty entries
   * @param {string} sourceItemId the Art
   */
  offerBountyChoice(ps, candidates, sourceItemId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    if (ps.personalChoice) return fail(ERR.BAD_TARGET, '请先完成当前教鞭选择'); // i18n-ignore: developer error detail
    if (!candidates.length) return fail(ERR.BAD_TARGET, '当前没有可用的战术特训'); // i18n-ignore: developer error detail
    const cards = this.rngMeta.shuffle(candidates.slice()).slice(0, PERSONAL_OFFER_SIZE);
    ps.personalChoice = { id: `${this.battlePrefix}.choice.${this.nextUid()}`, round: this.round, sourceItemId, cards };
    ps.dirty();
    return OK;
  }

  /**
   * 诗怀雅策略【天选明星】 (content/bands/meta.js band_swire_choose_enhance): **第一回合**开启的两步个人选择。
   * 与教鞭同一个「个人选择」载体（ps.personalChoice，prep 内叠层、无独立阶段/计时器，prep 结束由 prepDeadline 兜底），
   * 只是卡片不是悬赏：第一步从四位可强化的龙门干员里选一位，选完立刻续约第二步（三种强化类型选一），
   * 完成后把 { key, opId, kind } 记在 ps.lungmenPick（战斗侧 content/lungmen.js 用它取代「随机一位 + 随机类型」）。
   * @param {import('../PlayerState.js').PlayerState} ps
   * @param {'op'|'kind'} step
   * @param {{key?:string|null, opId?:string|null}} picked 第一步的选择（第二步用于回填）
   */
  offerLungmenChoice(ps, step = 'op', picked = {}) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    if (ps.personalChoice) return fail(ERR.BAD_TARGET, '请先完成当前选择'); // i18n-ignore: developer error detail
    const cards = step === 'kind'
      ? LUNGMEN_ENHANCE_KINDS.map((k, i) => lungmenKindCard(k, i))
      : LUNGMEN_ENHANCE_OPS.map((id, i) => lungmenOpCard(this.gd, id, i));
    ps.personalChoice = {
      id: `${this.battlePrefix}.lm.${this.nextUid()}`, round: this.round,
      kind: 'lungmen', step, picked: { ...picked }, cards,
    };
    ps.dirty();
    return OK;
  }

  /** 第二步：选定强化类型后收尾，把选择落到 ps.lungmenPick 并关闭个人选择。 */
  _finishLungmenChoice(ps, pending, kindKey) {
    ps.lungmenPick = {
      key: (pending.picked && pending.picked.key) || null,
      opId: (pending.picked && pending.picked.opId) || null,
      kind: kindKey || null,
      round: this.round,
    };
    // 战斗侧 content/lungmen.js 只能看到 battle player 的 counters 克隆，所以选择另存一份（键与 LUNGMEN_PICK_KEY 一致）。
    if (!ps.counters || typeof ps.counters !== 'object') ps.counters = {};
    ps.counters['lungmen:pick'] = JSON.stringify({ key: ps.lungmenPick.key, opId: ps.lungmenPick.opId, kind: ps.lungmenPick.kind });
    ps.personalChoice = null;
    ps.dirty();
    return OK;
  }

  /** g.choice { idx, choiceId }: the owner's pick of its open personal choice — a bounty on its next battles, or 天选明星's two steps. */
  pickPersonalChoice(ps, idx, choiceId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    const pending = ps.personalChoice;
    if (!pending || pending.id !== choiceId || pending.round !== this.round) return fail(ERR.BAD_TARGET);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pending.cards.length) return fail(ERR.BAD_TARGET);
    const card = pending.cards[idx];
    if (pending.kind === 'lungmen') {
      if (pending.step === 'op') {
        const rest = { key: card.key, opId: card.opId };
        ps.personalChoice = null;                 // 先关闭，offerLungmenChoice 会拒绝已开启的选择
        ps.lungmenPick = { key: card.key, opId: card.opId, kind: null };
        ps.dirty();
        return this.offerLungmenChoice(ps, 'kind', rest);
      }
      return this._finishLungmenChoice(ps, pending, card.kindKey);
    }
    if (!this.addBounty(ps, card)) return fail(ERR.BAD_TARGET);
    ps.personalChoice = null;
    ps.dirty();
    return OK;
  }

  /**
   * The pick made for a player who did not make it. 'bot': an AI seat or a human under AI 托管 — the bounty scorer of the
   * 机变 draft (bot.js botPickCard: the expected pay minus the expected LP lost against the own board, the bots' seeded rng
   * only breaks ties); 'random': the prep's deadline and a seat the engine finishes by other means — one of the cards at
   * random from the meta rng, like a 机变 turn that runs out. Nothing pending: nothing happens, no rng draw.
   * 天选明星的两步选择在这里一次走完（每一步都随机取一张）。
   */
  autoPickPersonalChoice(ps, mode) {
    const pending = ps.personalChoice;
    if (!pending) return undefined;
    if (pending.kind === 'lungmen') {
      // 两步连做：每步随机选一张，直到个人选择关闭（防御性上限 4 次，正常两轮即结束）。
      for (let guard = 0; guard < 4 && ps.personalChoice && ps.personalChoice.kind === 'lungmen'; guard++) {
        const p = ps.personalChoice;
        const idx = this.rngMeta.pick(p.cards.map((_, i) => i));
        const r = this.pickPersonalChoice(ps, idx, p.id);
        if (!r || r.error) break;
      }
      return OK;
    }
    const indices = pending.cards.map((c, i) => i);
    const idx = mode === 'bot'
      ? botPickCard(this, ps, pending.cards.map((c) => bountyCard(this.gd, c)), indices)
      : this.rngMeta.pick(indices);
    return this.pickPersonalChoice(ps, idx, pending.id);
  }

  addBounty(ps, card) {
    if (!ps || !card || !this.gd.enemy(card.enemyKey)) return null;
    // a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES battles (choices.js; the user's call after playtest #6)
    const rounds = bountyBattles(card);
    const b = {
      id: `bounty:${this.nextUid()}`,
      card: { effectId: card.effectId ?? card.id ?? null, name: card.name ?? '悬赏', desc: card.desc ?? '', tier: card.tier ?? 1, coin: Math.max(0, Math.trunc(Number(card.coin) || 0)), payout: card.payout === 'perfect' ? 'perfect' : 'kill', rounds, multiRound: isMultiRoundBounty(card), enemyKey: card.enemyKey, count: Math.max(1, Math.min(20, Number.isInteger(card.count) ? card.count : 1)) }, // i18n-ignore: a data-less card's fallback name
      roundsLeft: rounds,
    };
    ps.bounties.push(b);
    ps.dirty();
    return b.id;
  }

  /** Random item id: a choices.json server pool ({ pool }), a tier, or ≤ maxTier shop-eligible items.
   * `also` (pool_equip_kathe: 突变细胞) joins the draw even though it is shopExcluded. The shop item slot does not
   * read it. `pick` still drops ids that `canGain` refuses, so an empty shop item stays out and an uncapped `also`
   * id can still be drawn. */
  rollItemId({ pool = null, tier = null, maxTier = 6, shopLevel = 6 } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof pool === 'string' && Object.hasOwn(pools, pool) ? pools[pool] : null;
    const rng = this.rngMeta;
    const tierList = (lo, hi) => { const out = []; for (let t = lo; t <= hi; t++) for (const id of this.gd.shopItemsByTier[t] || []) out.push(id); return out; };
    const also = p && Array.isArray(p.also) ? p.also.filter((id) => typeof id === 'string' && this.gd.item(id)) : [];
    const withAlso = (list) => {
      const out = list.slice();
      for (const id of also) if (!out.includes(id)) out.push(id);
      return out;
    };
    if (p && p.kind === 'equip') {
      if (Array.isArray(p.weighted) && p.weighted.length) {
        const pairs = p.weighted.filter((x) => Array.isArray(x) && this.gd.item(x[0]) && this.itemPool.canGain(x[0]));
        for (const id of also) if (!pairs.some((x) => x[0] === id)) pairs.push([id, 1]);
        return this.itemPool.pick(rng, pairs.map(x => x[0]), new Map(pairs));
      }
      if (Array.isArray(p.items) && p.items.length) {
        const items = p.items.filter((id) => this.gd.item(id));
        return this.itemPool.pick(rng, withAlso(items));
      }
      let list;
      if (Array.isArray(p.tiers) && p.tiers.length) list = p.tiers.flatMap((t) => this.gd.shopItemsByTier[t] || []);
      // `maxTier: 'shopLevel'` caps a pool at the 调度中心 level. A pool that names NO tier spec draws from ALL tiers
      // I–VI **by design** — 凯瑟琳 分队【定向投放】「每次升级调度中心时，在调度中心刷新随机3件装备」 uses
      // `pool_equip_kathe`, which carries no `tiers` / `maxTier` and therefore ignores the level. The owner's ruling
      // 2026-10-10: 「凯瑟琳不要改啊，他就是这样的」 — a 三阶 调度中心 offering 五/六阶 equipment through it is
      // intended, NOT a bug. Do not give that pool a `maxTier` (`_verify-shop-item-cap.mjs` ⑤/⑥ pins this down).
      else list = tierList(1, p.maxTier === 'shopLevel' ? Math.max(1, Math.min(6, shopLevel)) : 6);
      return this.itemPool.pick(rng, withAlso(list));
    }
    const list = Number.isInteger(tier) ? tierList(tier, tier) : tierList(1, Math.max(1, Math.min(6, maxTier)));
    return this.itemPool.pick(rng, list);
  }

  /**
   * Roll a choices.json pool (ctx.rollPool). Equip pools → rollItemId. Chess pools: an `items` (uniform) or `weighted`
   * list — only chess with a free pool copy (or outside the pool) qualify — else a copy-weighted draw from the shared
   * pool filtered by `tier` / `minTier` / `maxTier` (number or 'shopLevel') / `bond`; `golden: true` yields the elite id.
   * `extra` (the drawing player's 自选 stock, player/diy.js diyStockEntries) joins that shared-pool draw, `chessOf` reads the
   * bonds (the player's data view: a slotted slot's operator) — 0.2.0 WE2.
   * `rule: 'shopEligible'` (the field every shipped pool carries) is honored for chess pools from 2026-10-16: only chess
   * the shop sells (`gd.shopEligible`) qualify — see the note on `shopOnly` below. Equip pools need nothing: rollItemId
   * draws from `gd.shopItemsByTier`, which only ever holds shop-eligible equipment.
   * @returns {{ kind: 'item'|'chess', id: string, golden?: boolean } | null}
   */
  rollPool(poolId, { shopLevel = 6, extra = null, chessOf = null } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof poolId === 'string' && Object.hasOwn(pools, poolId) ? pools[poolId] : null;
    if (!p || typeof p !== 'object') return null;
    const lvl = Math.max(1, Math.min(6, Number.isInteger(shopLevel) ? shopLevel : 6));
    if (p.kind === 'equip') {
      const id = this.rollItemId({ pool: poolId, shopLevel: lvl });
      return id ? { kind: 'item', id } : null;
    }
    if (p.kind !== 'chess') return null;
    const rng = this.rngMeta;
    // `rule: 'shopEligible'`（choices.json 池定义，官方语义「只在商店可购买的干员里抽」）——2026-10-16 落地。
    // 此前这条规则没有进代码（effectsMeta 的注释声称支持，实际查无实现），于是带该规则的池会照抽共享池里的
    // 非卖品：`pool_chess_shop_6_reward`（卫戍协议 116 的 SERVER_SELL_CHESS_GAIN_SPECIAL_GOODS、老鲤的
    // pool_chess_shop_2/4_reward）会抽出伊芙利特，1 阶池抽出罗德岛 starter 的芬 / 炎熔 / 克洛丝 / 芙蓉。
    // 判定统一走 gd.shopEligible（与商店槽、晋升奖励同一口径）；岁干员 2026-10-16 改回商店可购，照常入池。
    const shopOnly = p.rule === 'shopEligible';
    const shopOk = (id) => !shopOnly || this.gd.shopEligible(id);
    const free = (id) => {
      if (typeof id !== 'string' || !this.gd.chess(id)) return false;
      if (!shopOk(id)) return false;
      const base = this.gd.baseIdOf(id);
      return !this.pool.has(base) || this.pool.left(base) > 0;
    };
    let id = null;
    if (Array.isArray(p.weighted) && p.weighted.length) {
      const pairs = p.weighted.filter((x) => Array.isArray(x) && free(x[0]));
      id = pairs.length ? weightedPick(rng, pairs) : null;
    } else if (Array.isArray(p.items) && p.items.length) {
      const list = p.items.filter(free);
      id = list.length ? list[Math.floor(rng() * list.length)] : null;
    } else {
      const maxTier = p.maxTier === 'shopLevel' ? lvl : Number.isInteger(p.maxTier) ? p.maxTier : 6;
      const minTier = Number.isInteger(p.minTier) ? p.minTier : 1;
      const bond = typeof p.bond === 'string' ? p.bond : null;
      const recOf = typeof chessOf === 'function' ? chessOf : (cid) => this.gd.chess(cid);
      id = this.pool.roll(rng, {
        tier: Number.isInteger(p.tier) ? p.tier : null,
        maxTier,
        filter: (cid, e) => e.tier >= minTier && shopOk(cid) && (!bond || (Array.isArray(recOf(cid)?.bonds) && recOf(cid).bonds.includes(bond))),
        extra,
      });
    }
    if (!id) return null;
    const golden = !!p.golden;
    return { kind: 'chess', id: golden ? this.gd.goldenIdOf(id) || id : id, golden };
  }
}
