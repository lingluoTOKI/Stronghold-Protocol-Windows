// server/match/contracts.js — 契约选择（CONTRACT_DRAFT，2/8/12 回合）：卡牌生成、效果结算与持续状态。
// 界面/流程完全复用机变（SP_DRAFT）的流水线 —— server/match/match/spDraft.js enterSpDraft('contract') 用
// generateContractDraft 的牌桌走同一套选牌顺序 / 计时 / AI；本模块只负责「有哪些契约可出」与「选了做什么」。
//
// 数据：data/choices.json `contracts[]`（id/name/desc/rounds/exclusive），模式回合 data/config.json
// modes[].contractRounds（gamedata contractRounds()）。玩家已选契约记在 ps.contracts（本局持久），
// 持续型效果的状态在 ps.contractState；战斗侧效果走 ps.effects 的 battle EffectRef（key `contract:<id>`），
// 由 server/sim/content/contracts.js 的 install(battle) 读取。

import { OK } from './match/common.js';

const CONTRACT_DEPLOY_CAP = 10;             // 扩容的上限

const recOf = (gd, id) => (Array.isArray(gd.choices?.contracts) ? gd.choices.contracts.find((c) => c && c.id === id) : null);

const CONTRACT_ROUND_HINT = '随着回合数提升';

const HINT_RE = /[（(]([^）)]*)[）)]\s*$/;

/**
 * 契约文本里的 `{i:fmt}` 占位符求值（与盟约同一套写法，public/js/ui/richText.js formatBondEffect）。
 *
 * 盟约那条链是「base + perStack × 层数」，契约这条链是「base + perStep × **当前回合**」——
 * 敌方 10 条（强攻/狂暴/强袭/强韧/强坚 及其 + 版）与中立领袖都按回合线性，所以卡面要显示
 * 「敌方攻击力提升+15%」这样的**具体结果**，而不是把「（5×当前回合)%」的公式甩给玩家。
 * 括号里追加「随着回合数提升」，让玩家知道选完还会继续涨。
 *
 * @param {object} rec choices.json 的一条契约
 * @param {number} round 当前回合
 * @returns {string} 数值已算好的文本（没有 descParams 时原样返回）
 */
export function contractDesc(rec, round) {
  const src = rec?.desc;
  if (typeof src !== 'string' || !src) return '';
  const params = Array.isArray(rec.descParams) ? rec.descParams : [];
  if (!params.length) return src;
  const vals = rec.params && typeof rec.params === 'object' ? rec.params : {};
  const R = Number.isFinite(Number(round)) ? Math.max(0, Number(round)) : 0;
  let filled = src.replace(/\{(\d+):([^}]+)\}/g, (_m, i, fmt) => {
    const p = params.find((q) => q && q.index === Number(i));
    if (!p) return _m;
    const v = (Number(vals[p.base]) || 0) + (Number(vals[p.perStep]) || 0) * R;
    if (fmt === '0%') return Math.round(v * 100) + '%';
    if (fmt === '0.0%') return (Math.round(v * 1000) / 10) + '%';
    if (fmt === '0.00%') return (Math.round(v * 10000) / 100) + '%';
    return String(Math.round(v));
  });
  // 提示插进**末尾的括号**里（用户 2026-10-16 的口径）：
  // 「敌方攻击速度+10（随着回合数提升，与狂暴互斥，加加成持续一整局）」
  HINT_RE.lastIndex = 0;
  filled = filled.replace(HINT_RE, (m, inner) => m.replace(inner, CONTRACT_ROUND_HINT + '，' + inner));
  return filled;
}

/** 玩家是否拥有某条契约。 */
export const hasContract = (ps, id) => !!(ps.contracts || []).some((x) => x.id === id);

/**
 * 玩家是否**仍在该契约的生效窗口内**：hasContract + `rec.valid` 区间 [lo, hi]。
 * 没有 `valid` 的契约恒为 true（我方/结算侧契约、以及 2 / 8 回合那些写明「加成持续一整局」的中立）。
 * 用户 2026-10-12：「所有 12 回合生效的中立契约变成了持续到游戏结束了」→ 加 valid [12,13]，
 * 与敌方 12 回合契约（闪避/自爆/影舞/点燃）同口径，contractExpire 在 14 回合开始前回收。
 * 用户 2026-10-15：**例外** —— 复活 / 残血 去掉了 valid，改为**持续到游戏结束**（不再回收）。
 */
export function contractActive(ps, id, round) {
  const x = (ps.contracts || []).find((e) => e.id === id);
  if (!x) return false;
  const v = x.rec?.valid;
  if (!Array.isArray(v)) return true;
  const r = Number(round);
  if (!Number.isFinite(r)) return true; // 调用方拿不到回合就不设限（防御性）
  return r >= v[0] && r <= v[1];
}

/** 玩家的契约状态（惰性初始化）。 */
export function stateOf(ps) {
  if (!ps.contractState) ps.contractState = { pendingFunds: 0, conqStreak: 0, conqPaid: [], spend: 0, since: {}, gamble: 0 };
  if (!ps.contracts) ps.contracts = [];
  return ps.contractState;
}

/** 互斥组是否被占（金钱/财富）。 */
function exclusiveBlocked(ps, rec) {
  if (!rec.exclusive) return false;
  for (const x of ps.contracts || []) {
    const r = typeof x.rec === 'object' ? x.rec : null;
    if (r && r.exclusive === rec.exclusive) return true;
  }
  return false;
}

/** 本回合对 `ps` 可出的**我方**契约（回合匹配 + 互斥 + 已选过的不重出 + 神罚条件）。 */
export function eligibleSelf(m, ps, round) {
  return eligibleGroup(m, ps, round, 'self');
}

/** 本回合可出的**中立**契约（同样受互斥/已选约束；用户 2026-10-11：做成和我方敌方一样的选择 UI）。 */
export function eligibleNeutral(m, ps, round) {
  return eligibleGroup(m, ps, round, 'neutral');
}

function eligibleGroup(m, ps, round, group) {
  const gd = m.gd;
  const out = [];
  for (const rec of (Array.isArray(gd.choices?.contracts) ? gd.choices.contracts : [])) {
    if (rec.group !== group) continue;
    if (!Array.isArray(rec.rounds) || !rec.rounds.includes(round)) continue;
    if (hasContract(ps, rec.id)) continue;           // 已选过的不重出（金钱/财富互斥随之自动成立）
    if (exclusiveBlocked(ps, rec)) continue;
    out.push(rec);
  }
  return out;
}

/**
 * 本回合可出的**敌方**契约（回合匹配 + 互斥 —— 强袭+/自爆 同组不能同时拿到，用户 2026-10-11；
 * 已选过的另一条敌方契约不影响——每档最多一条，跨档可叠加）。
 */
export function eligibleEnemy(m, round, ps = null) {
  return (Array.isArray(m.gd.choices?.contracts) ? m.gd.choices.contracts : []).filter((rec) => {
    if (rec.group !== 'enemy' || !Array.isArray(rec.rounds) || !rec.rounds.includes(round)) return false;
    if (ps && exclusiveBlocked(ps, rec)) return false;
    return true;
  });
}

const cardOf = (rec, idx, round = 0) => ({ kind: 'contract', id: rec.id, name: rec.name, desc: contractDesc(rec, round), tier: null, group: rec.group || 'self', rounds: rec.rounds || null, idx });

function draw3(m, list) {
  const pool = m.rngDraft.shuffle(list.slice());
  return pool.slice(0, 3);
}

/**
 * 一名玩家的个人契约牌桌：3 我方 + 3 中立 + 3 敌方（可出的不足 3 张就出几张）。
 * 三组各自能免费刷新一次（board.refreshed[group]）—— 用户 2026-10-11「我方，敌方，中立都可以刷新一次」。
 * @returns {{ self: object[], neutral: object[], enemy: object[], refreshed: object }}
 */
export function contractBoard(m, ps) {
  return {
    self: contractBoardSelf(m, ps),
    neutral: contractBoardNeutral(m, ps),
    enemy: draw3(m, eligibleEnemy(m, m.round, ps)).map((rec, i) => cardOf(rec, i + 6, m.round)),
    refreshed: { self: false, neutral: false, enemy: false },
  };
}

/** 我方三张（刷新重抽用，idx 固定 0..2）。 */
export function contractBoardSelf(m, ps) {
  return draw3(m, eligibleSelf(m, ps, m.round)).map((rec, i) => cardOf(rec, i, m.round));
}

/** 中立三张（刷新重抽用，idx 固定 3..5）。 */
export function contractBoardNeutral(m, ps) {
  return draw3(m, eligibleNeutral(m, ps, m.round)).map((rec, i) => cardOf(rec, i + 3, m.round));
}

/** 敌方三张（刷新重抽用，idx 固定 6..8）。 */
export function contractBoardEnemy(m, ps) {
  return draw3(m, eligibleEnemy(m, m.round, ps)).map((rec, i) => cardOf(rec, i + 6, m.round));
}

// ==============================================================================================================
// 选取与即时效果

/**
 * 应用一张契约卡（choices.js applyCard 对 kind 'contract' 的分派）。即时效果立刻结算；
 * 持续型效果记入 ps.contractState / ps.effects（战斗侧）。
 */
export function applyContract(m, ps, card) {
  const rec = recOf(m.gd, card.id) || { id: card.id, name: card.name, desc: card.desc, rounds: card.rounds };
  const st = stateOf(ps);
  ps.contracts.push({ id: rec.id, round: m.round, rec });

  switch (rec.id) {
    case 'contract_supply2': // 补充：随机两个 2 阶装备
    case 'contract_supply3': { // 补给：随机两个 3 阶装备
      const tier = rec.id === 'contract_supply2' ? 2 : 3;
      for (let i = 0; i < 2; i++) {
        const id = m.rollItemId({ tier });
        if (id) ps.acquireItem(id, { source: 'contract' });
      }
      break;
    }
    case 'contract_elite5':   // 精英：已激活盟约层数最多者的 5 阶干员
    case 'contract_elite6': { // 精锐：同上的 6 阶干员
      const tier = rec.id === 'contract_elite5' ? 5 : 6;
      grantTopBondChess(m, ps, tier);
      break;
    }
    case 'contract_fund_slow': // 金钱（用户 2026-10-14）：立刻 +2，此后每两回合 +1
      ps.addFunds(2, { reason: 'contract' });
      st.since.fund_slow = m.round;
      break;
    case 'contract_fund_fast': // 财富（用户 2026-10-14）：立刻 +4，此后每回合 +1
      ps.addFunds(4, { reason: 'contract' });
      st.since.fund_fast = m.round;
      break;
    case 'contract_lp10': // 急救：策略生命值 +10
      ps.lp += 10;
      ps.dirty();
      break;
    case 'contract_deploy1': { // 扩容：可部署人数 +1（上限 10）
      if (m.gd.deployCap + ps.deployCapBonus < CONTRACT_DEPLOY_CAP) ps.deployCapBonus += 1;
      ps.dirty();
      break;
    }
    case 'contract_seek': { // 寻访：随机 1-6 阶干员 + 补偿/上场回合限制
      const id = m.pool.roll(m.rngMeta, { minTier: 1, maxTier: 6, extra: typeof ps.diyStockEntries === 'function' ? ps.diyStockEntries() : null })
        || m.pool.roll(m.rngMeta, { minTier: 1, maxTier: 6 });
      if (id) {
        const chess = m.gd.chess(id);
        const tier = chess ? chess.tier || 0 : 0;
        const piece = ps.acquireChess(id, { source: 'contract' });
        if (tier >= 5 && piece && m.round < (tier >= 6 ? 6 : 5)) {
          piece.lockRound = tier >= 6 ? 6 : 5; // 5 阶第 5 回合 / 6 阶第 6 回合才能上场
          ps.dirty();
        }
        if (tier < 4) ps.addFunds(1, { reason: 'contract' });
      }
      break;
    }
    case 'contract_smite': { // 神罚：第12回合选取时立刻获得一个异客（第8回合拿则没有）
      if (m.round === 12) {
        const isPasngr = (cid) => { const c = m.gd.chess(cid); return !!(c && (c.charId === 'char_472_pasngr' || (c.backup && c.backup.charId === 'char_472_pasngr'))); };
        const extra = typeof ps.diyStockEntries === 'function' ? ps.diyStockEntries() : null;
        const id = m.pool.roll(m.rngMeta, { minTier: 1, maxTier: 6, filter: isPasngr, extra })
          || m.pool.roll(m.rngMeta, { minTier: 1, maxTier: 6, filter: isPasngr });
        if (id) ps.acquireChess(id, { source: 'contract' });
      }
      break;
    }
    case 'contract_n_greed': { // 贪婪：策略生命值 -10（不低于 1），立刻 +4 资金（用户 2026-10-14：原 +6）
      ps.lp = Math.max(1, ps.lp - 10);
      ps.addFunds(4, { reason: 'contract' });
      ps.dirty();
      break;
    }
    case 'contract_n_brawl': // 群殴：可部署人数 +2（战斗侧生效；不受 扩容 的 10 上限约束）
      ps.deployCapBonus += 2;
      ps.dirty();
      break;
    case 'contract_n_gamble': // 赌局：战斗侧生效；mod 每场结算后更新（contractSettle）
      stateOf(ps).gamble = 0;
      break;
    default:
      break; // 名刀/完美/飞升/城墙/通缉/勇者/勇士/暴击/征服/协防/返利/孤军/联合 + 全部中立：战斗侧或结算侧
  }
  // 战斗侧 / 结算侧的契约挂一个可见的 EffectRef（key `contract:<id>`），sim/content/contracts.js install() 读。
  // 效果列排序（用户口径）：我方 → 中立 → 敌方。
  const group = rec.group === 'enemy' || rec.id.startsWith('contract_e_') ? 'enemy' : rec.group === 'neutral' || rec.id.startsWith('contract_n_') ? 'neutral' : 'self';
  const ref = {
    id: `contract:${rec.id}#${ps.m?.nextUid?.() ?? ''}`,
    key: `contract:${rec.id}`,
    name: rec.name,
    // 效果栏（战斗内 / 契约报告）同样要具体数值：「敌方攻击力提升+15%」而不是公式
    desc: contractDesc(rec, m.round),
    iconKind: 'choice',
    iconId: rec.id,
    battle: true,
    counter: null,
    params: contractParams(m, ps, rec.id),
    data: { contractId: rec.id, used: false, group },
  };
  if (group === 'enemy') ps.effects.push(ref);
  else {
    const firstEnemy = ps.effects.findIndex((e) => e.data?.group === 'enemy' || e.key?.startsWith('contract:contract_e_'));
    const insertAt = group === 'neutral'
      ? (firstEnemy >= 0 ? firstEnemy : ps.effects.length)
      : (() => { // self：插到第一个中立/敌方之前
        const i = ps.effects.findIndex((e) => e.data?.group === 'neutral' || e.data?.group === 'enemy' || e.key?.startsWith('contract:contract_e_') || e.key?.startsWith('contract:contract_n_'));
        return i >= 0 ? i : ps.effects.length;
      })();
    ps.effects.splice(insertAt, 0, ref);
  }
  // 联合：全队生效（"你们每个人"）—— 给每名存活队友也挂一份
  if (rec.id === 'contract_alliance') {
    for (const other of m.alivePlayers()) {
      if (other === ps) continue;
      other.effects.push({ ...ref, id: `contract:${rec.id}#${ps.m?.nextUid?.() ?? ''}` });
      other.dirty();
    }
  }
  ps.dirty();
  return OK;
}

function contractParams(m, ps, id) {
  // 孤军/联合需要「本回合存活玩家数」，回合视图生成时刷新（player/round.js）
  return id === 'contract_lone' || id === 'contract_alliance' ? { alive: m.alivePlayers().length } : {};
}

/** 精英/精锐：已激活盟约里层数最多的一条，抽它的一名对应阶干员（自选库存一起抽）。 */
function grantTopBondChess(m, ps, tier) {
  let best = null;
  for (const [bondId, b] of Object.entries(ps.bonds || {})) {
    if (!b || !b.active) continue;
    const layers = (ps.layers && ps.layers[bondId]) || 0;
    if (!best || layers > best.layers) best = { bondId, layers };
  }
  if (!best) return;
  const gd = m.gd;
  const hasBond = (cid) => { const c = gd.chess(cid); return !!(c && Array.isArray(c.bonds) && c.bonds.includes(best.bondId)); };
  const extra = typeof ps.diyStockEntries === 'function' ? ps.diyStockEntries() : null;
  const id = m.pool.roll(m.rngMeta, { tier, filter: hasBond, extra })
    || m.pool.roll(m.rngMeta, { minTier: tier, maxTier: 6, filter: hasBond, extra })
    || m.pool.roll(m.rngMeta, { tier, extra });
  if (id) ps.acquireChess(id, { source: 'contract' });
}

// ==============================================================================================================
// 每回合 / 结算钩子（phases.afterRoundStart / settle 调用）

/** 回合开始（进回合的卡牌阶段之前）：金钱/财富的每回合资金 + 协防的下回合资金。 */
export function contractRoundStart(m, ps) {
  const st = stateOf(ps);
  const round = m.round;
  if (st.since.fund_slow != null && round > st.since.fund_slow && (round - st.since.fund_slow) % 2 === 0) {
    ps.addFunds(1, { reason: 'contract:fund_slow' });
  }
  if (st.since.fund_fast != null && round > st.since.fund_fast) {
    ps.addFunds(1, { reason: 'contract:fund_fast' });
  }
  if (st.pendingFunds > 0) {
    ps.addFunds(st.pendingFunds, { reason: 'contract:coop' });
    st.pendingFunds = 0;
  }
}

/**
 * 契约到期回收（match 级，afterRoundStart 调用）：生效区间 valid [lo, hi] 过了 hi 就把战斗侧
 * EffectRef 摘掉（图标随之消失 = 用户口径「失效」）；ps.contracts 保留作记录（互斥/图鉴）。
 * 2026-10-12 扩展：不再只回收敌方组 —— 带 `valid` 的**中立**契约同样回收（12 回合的
 * 单挑/群殴/通厕 valid [12,13]，在 14 回合开始前失效，用户口径）。
 * 2026-10-15：复活 / 残血 去掉了 valid（持续整局），因此**不经这里回收**（`!Array.isArray(valid)` → false）。
 */
export function contractExpire(m) {
  const round = m.round;
  const isExpired = (x) => {
    const g = x.rec?.group;
    // 我方/结算侧契约、以及没有 valid 的中立（持续整局）不回收
    if (g !== 'enemy' && g !== 'neutral') return false;
    return Array.isArray(x.rec?.valid) && round > x.rec.valid[1];
  };
  for (const ps of m.alivePlayers()) {
    const expired = (ps.contracts || []).filter(isExpired);
    if (!expired.length) continue;
    const ids = new Set(expired.map((x) => x.id));
    ps.effects = ps.effects.filter((e) => !(e.key?.startsWith('contract:') && ids.has(e.data?.contractId)));
    // 群殴的「可部署人数 +2」是选牌时一次性加到 deployCapBonus 的，失效时按同口径收回（一次）。
    if (ids.has('contract_n_brawl')) {
      const st = stateOf(ps);
      if (!st.brawlRefunded) {
        ps.deployCapBonus = Math.max(0, (ps.deployCapBonus || 0) - 2);
        st.brawlRefunded = true;
      }
    }
    ps.dirty();
  }
}

/**
 * 结算侧（settle.js 每个存活玩家调用一次）：名刀 / 征服 / 协防 / 完美 的计数与发钱。
 * 通缉的赏金翻倍在 settle.js 的 coins 计算处直接做（hasContract(ps,'contract_wanted')）。
 * @returns {number|null} 名刀改写后的实际扣血（调用方用它覆写 loss），null = 不改写
 */
export function contractSettle(m, ps, { loss, perfect, helpedUnite, uniteSuccess }) {
  const st = stateOf(ps);

  // 名刀：生命值不会低于 1（整场一次）
  if (hasContract(ps, 'contract_knife') && loss > 0) {
    const entry = (ps.contracts || []).find((x) => x.id === 'contract_knife');
    const eff = (ps.effects || []).find((e) => e.key === 'contract:contract_knife');
    if (entry && !entry.used && ps.lp - loss < 1) {
      entry.used = true;
      if (eff) eff.data = { ...(eff.data || {}), used: true };
      ps.dirty();
      return Math.max(0, ps.lp - 1); // 只扣到剩 1 点
    }
  }
  // 征服：连续完美 2/3/4 次 → +3/4/5（各一次）
  if (hasContract(ps, 'contract_conquer')) {
    st.conqStreak = perfect ? (st.conqStreak || 0) + 1 : 0;
    const table = { 2: 3, 3: 4, 4: 5 };
    const pay = table[st.conqStreak];
    if (perfect && pay && !st.conqPaid.includes(st.conqStreak)) {
      st.conqPaid.push(st.conqStreak);
      ps.pendingFunds += pay;
      ps.stats.fundsGained += pay;
    }
  }
  // 协防：完美 / 帮助队友协防（无论是否成功）→ 下回合 +1（用户 2026-10-11：是否成功都 +1）
  if (hasContract(ps, 'contract_coop')) {
    if (perfect) st.pendingFunds += 1;
    if (helpedUnite) st.pendingFunds += 1;
  }
  // 赌局：本场完美 → 下一场 −20%；非完美 → +20%（输了保持 120%，直到打出完美才回 —— 用户 2026-10-11 拍板）
  if (hasContract(ps, 'contract_n_gamble')) st.gamble = perfect ? -0.2 : 0.2;
  // 完美：完美作战 → 战斗侧攻速 +10（可叠加，写进 EffectRef 的 params 供 battle 读）
  if (hasContract(ps, 'contract_perfect_aspd') && perfect) {
    st.perfectN = (st.perfectN || 0) + 1;
    const eff = (ps.effects || []).find((e) => e.key === 'contract:contract_perfect_aspd');
    if (eff) eff.params = { ...(eff.params || {}), perfectN: st.perfectN };
    ps.dirty();
  }
  return null;
}

/** 返利：每花费 4 资金 +1（economy._afterSpend 调用）。 */
export function contractOnSpend(ps, amount) {
  if (!(amount > 0) || !(ps.contracts || []).some((x) => x.id === 'contract_rebate')) return;
  const st = stateOf(ps);
  st.spend += amount;
  while (st.spend >= 4) {
    st.spend -= 4;
    ps.pendingFunds += 1;
    ps.stats.fundsGained += 1;
  }
}

// ==============================================================================================================
// 出怪计划修改（combat.js _normalOpts 在 onBattleStart 派发之后调用；ev.spawns 可就地改写）

/**
 * 中立契约的出怪侧：赌局（普通单位 ±20%）、群殴（全部 ×2）、单挑（只剩 1 名）、通厕（清空只出 3 只杰斯顿）。
 * @param ev {{ spawns: object[] }} onBattleStart 的事件载荷（spawns 可编辑）
 */
export function contractSpawnMods(m, ps, ev) {
  const spawns = Array.isArray(ev?.spawns) ? ev.spawns : null;
  if (!spawns) return;
  const st = stateOf(ps);
  const rankOf = (s) => String(m.gd.enemy(s.enemyKey)?.rank ?? 'NORMAL').toUpperCase();

  // 群殴：敌方出怪数量 +100%（valid [12,13]：14 回合开始前失效，用户 2026-10-12）
  if (contractActive(ps, 'contract_n_brawl', m.round)) {
    for (const s of spawns) if (s && typeof s.enemyKey === 'string') s.count = Math.max(1, Math.round((Number(s.count) || 1) * 2));
  }
  // 赌局：普通单位 ±20%（精英/首领不动）
  if (hasContract(ps, 'contract_n_gamble') && st.gamble) {
    for (const s of spawns) {
      if (!s || typeof s.enemyKey !== 'string' || rankOf(s) !== 'NORMAL') continue;
      s.count = Math.max(1, Math.round((Number(s.count) || 1) * (1 + st.gamble)));
    }
  }
  // 单挑（用户 2026-10-15 数值调整）：敌方出怪清空，只出现 1 只**锏**（enemy_1525_blkswb，第9回合悬赏的那个），
  //   生命值/攻击力/防御力 +50%（= hpMul/atkMul/defMul 各 ×1.5，读 data 的 `duelEnemyMul`）；
  //   若锏进入保护目标点则策略生命 -10（lpr 10）。我方攻最高者 +100%（sim 侧 mods 1.0，与 data 的 `duelSelfPct` 对齐）。
  if (contractActive(ps, 'contract_n_duel', m.round)) {
    const rec = (m.gd.choices?.contracts || []).find((c) => c.id === 'contract_n_duel') || {};
    const key = rec.duelEnemyKey || 'enemy_1525_blkswb';
    const mul = Number(rec.duelEnemyMul) || 1.5;
    const lpr = Number(rec.duelLeakLp) || 10;
    ev.spawns = m.gd.enemy(key)
      ? [{ enemyKey: key, count: 1, mods: { hpMul: mul, atkMul: mul, defMul: mul }, lpr }]
      : [];
    return; // 单挑替换整场，后面的擂台不叠加（同回合二选一本来也拿不到）
  }
  // 通厕（原擂台）：敌方出怪计划清空，只出现三只杰斯顿·威廉姆斯（生命/防御/攻击 +100%，每漏一只策略血量 -3）
  if (contractActive(ps, 'contract_n_arena', m.round)) {
    ev.spawns = [{
      enemyKey: 'enemy_1516_jakill',
      count: 3,
      mods: { hpMul: 2, defMul: 2, atkMul: 2 },
      lpr: 3,
    }];
  }
}
