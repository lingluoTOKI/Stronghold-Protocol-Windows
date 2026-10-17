// server/sim/content/usStudent.js — 乌萨斯学生自治团 (bondId usStudentShip) battle 侧 + prep 侧 (休整期特质).
//
// 用户 2026-10-14 规格（data/bonds.json usStudentShip.bb，全部读数据，不再硬编码）：
//   * 优胜者：在场乌萨斯学生团干员中基础攻击力最高者；7 阶（tier 3）时前二高均为优胜者（两位）。
//   * 2 阶：优胜者 攻击力 +(20 + 层数×0.5)%。
//   * 4 阶：优胜者 防御力 +(20 + 层数×0.5)%；其余乌萨斯学生团干员获得优胜者加成的 35%。
//   * 7 阶：优胜者 生命值 +(20 + 层数×0.5)%，且优胜者加成 ×1.25；非优胜者获得两名优胜者加成的 70%。
//   * 烈夏特例：自身为优胜者时额外 +10%（即 (30 + 层数×0.5)%）；非优胜者时额外获得优胜者们的 30% 加成。
//   * 优胜者脚下常驻一圈金色光环（客户端 fx 'winnerMark'，0.5s 一轮原地更新，见 updateWinnerMarks）。
//   * 谷米：治疗中额外 +100 平板治疗。
//   * 怒潮凛冬：乌萨斯学生团每叠 3 层→自身攻击力 +1%；若自身优胜者→每叠 3 层→自身攻速 +1%；若非优胜者→自身获得优胜者
//     100% 属性加成（battle 侧判定，无 prep 特质）。
//
// 注意：新规格里**没有庇护**（旧版 4/7 阶的 shelterAura 已删除），4/7 阶改为纯属性加成，且 2/4/7 阶
// 分别只给 攻 / 防 / 生，不再三者同时给。加成对精锐翻倍（官方口径 _b）。
//
// prep 侧 (registerMeta): 凛冬/真理/苦艾/早露 的 SERVER_PREP_FIN 休整期结束特质，按「自身是否优胜者」派发
//   乌萨斯学生团 + 职业层数（USSTU_PREP_FIN 共用 handler，金额读各自 garrisons.json 的 bb）。
//
// 优胜者判定（battle 与 prep 共用同一规则：按 base atk 排名，7 阶取前二，否则取最高）。

import * as S from './support/index.js';

const num = S.num;
const BASE = 'usStudentShip';

// 干员 base id（chess.json 中 a 版；b 版 baseId 指向 a 版）
const ID_GUMI = 'chess_char_1_10_a';   // 谷米（古米）
const ID_LETO = 'chess_us_leto_a';     // 烈夏
const ID_HEADB2 = 'chess_us_headb2_a'; // 怒潮凛冬

/** 单位基础攻击力（用于优胜者排名，部署前后恒定）。 */
function baseAtk(u) {
  const st = u && (u.def && u.def.stats) ? u.def.stats : null;
  return num(st ? st.atk : (u && u.def && u.def.raw && u.def.raw.stats ? u.def.raw.stats.atk : 0));
}

/**
 * 计算某玩家乌萨斯学生团干员的优胜者 uid 集合。
 * @param {{uid:string|number, atk:number}[]} members 已带 base atk 的成员列表
 * @param {number} tier 盟约档位（1/2/3）
 * @returns {Set<*>} 优胜者 uid
 */
function winnersOf(members, tier) {
  const ranked = members.slice().sort((a, b) => b.atk - a.atk);
  const n = tier >= 3 ? 2 : 1;
  return new Set(ranked.slice(0, n).map((m) => m.uid));
}

/** 盟约 bb（buffs[0].bb，键 usstudent_covenant）；缺字段时回退到规格数值。 */
function bbOf() {
  return S.buffParams(S.bondRecord(BASE), 'usstudent_covenant') || {};
}

export function install(battle) {
  if (!battle || !Array.isArray(battle.players)) return;
  for (const p of battle.players) {
    const pid = p.playerId;
    if (!p.bonds || typeof p.bonds !== 'object') continue;
    if (!S.bondActive(battle, pid, BASE)) continue;
    installPlayer(battle, pid);
  }
}

function installPlayer(battle, pid) {
  const bb = bbOf();
  const atkBase = num(bb.winner_atk_base, 0.20);
  const perLayer = num(bb.winner_atk_per_layer, 0.005);
  const tier7Mul = num(bb.tier7_winner_mult, 1.25);
  const ratio4 = num(bb.nonwinner_ratio_4, 0.35);
  const ratio7 = num(bb.nonwinner_ratio_7, 0.70);
  const letoBonus = num(bb.liexia_win_bonus, 0.20);
  // 烈夏非优胜者：获得优胜者 30% 的加成（精锐 60%）；连同上面那条基础 30% 一起 = 60% / 120%
  const letoNonWinner = num(bb.liexia_nonwinner_ratio, 0.30);

  const apply = () => {
    const L = S.bondLayers(battle, pid, BASE);
    const tier = S.bondTier(battle, pid, BASE); // 1/2/3
    const winnerPct = (atkBase + L * perLayer) * (tier >= 3 ? tier7Mul : 1);
    const nonWinnerPct = tier >= 3 ? winnerPct * ratio7 : tier >= 2 ? winnerPct * ratio4 : 0;

    // ---- 成员与优胜者 ----
    const members = S.bondMembers(battle, pid, BASE, { fieldOnly: false })
      .map((u) => ({ uid: u.uid, atk: baseAtk(u), u }));
    const winners = winnersOf(members, tier);

    // ---- 每成员属性加成 ----
    //   2 阶给攻 / 4 阶给防 / 7 阶给生：属性按档位逐个开启，数值都是 winnerPct。
    for (const m of members) {
      const u = m.u;
      const isWin = winners.has(m.uid);
      const id = S.baseChessId(u);
      const k = S.isElite(u) ? 2 : 1; // 精锐加成翻倍

      // 用户 2026-10-14「头顶挂一个『优胜者』标签」：把优胜者身份写到单位上，snapshot.flagsOf 转成 UF.WINNER，
      // 客户端在头顶画标签。原先只有脚下一圈很暗的地面光环，看不出谁中了。
      // 注意每次 apply() 都会重跑（换人 / 升阶 / 加层），所以这里既置位也**清位**，不然换了优胜者标签会留在旧单位上。
      u.usWinner = isWin;

      let pct;
      let letoExtra = 0;
      if (id === ID_HEADB2) {
        // 怒潮凛冬：非优胜者也拿优胜者 100% 属性加成；优胜者同样是 winnerPct
        pct = winnerPct;
      } else if (id === ID_LETO) {
        // 烈夏（用户 2026-10-14 文本）：若自身为优胜者，加成额外提高 20%；否则获得优胜者 30% 的加成。
        // 精锐翻倍走下面的 `k`（+20%→+40%，30%→60%），与文本「精锐 40% 60%」一致。
        pct = isWin ? winnerPct : winnerPct * letoNonWinner;
        letoExtra = isWin ? letoBonus : winnerPct * letoNonWinner;
      } else {
        pct = isWin ? winnerPct : nonWinnerPct;
      }
      pct = (pct + letoExtra) * k;

      // 属性按档位渐进：2 阶攻、4 阶防、7 阶生。烈夏的「额外」跟着同一组属性走。
      //
      // 注意必须走 S.directMods()：引擎的 buff 只认 atkPct / defPct / hpPct（sim/buffs.js ADD_KEYS，
      // 合成公式见 sim/units.js `_recalc`），而 directMods 的入参才是 atk / def / hp 比值。
      // 这里曾经直接把 { atk, def, hp } 丢给 passiveBuff —— 引擎读到的是不存在的键，**静默丢弃**，
      // 于是乌萨斯学生团的攻/防/生三档加成全部没生效（用户 2026-10-14「没有加成」）。
      // 同函数下方怒潮凛冬那条一直是对的（用了 directMods），可以作为对照。
      const pctMods = {};
      if (tier >= 1 && pct !== 0) pctMods.atk = pct;
      if (tier >= 2 && pct !== 0) pctMods.def = pct;
      if (tier >= 3 && pct !== 0) pctMods.hp = pct;
      const attrKey = `bond:usStudent:attr:${u.uid}`;
      const attrMods = S.directMods(pctMods);
      if (Object.keys(attrMods).length) S.passiveBuff(battle, u, attrKey, attrMods);
      else battle.removeBuff(u, attrKey);

      // 怒潮凛冬：【乌萨斯学生自治团】+【近卫】每叠 3 层 → 攻击力 +1%（精锐翻倍）；
      // 优胜者：乌萨斯学生团每叠 3 层 → 攻速 +1%（精锐翻倍）
      if (id === ID_HEADB2) {
        const step = Math.floor(L / 3) + Math.floor(S.bondLayers(battle, pid, 'warriorShip') / 3);
        const atkKey = 'bond:usStudent:headb2:atk';
        if (step > 0) S.passiveBuff(battle, u, atkKey, S.directMods({ atk: step * 0.01 * k }));
        else battle.removeBuff(u, atkKey);
        const winStep = Math.floor(L / 3);
        const aspdKey = 'bond:usStudent:headb2:aspd';
        if (isWin && winStep > 0) S.passiveBuff(battle, u, aspdKey, { aspd: winStep * k });
        else battle.removeBuff(u, aspdKey);
      }
    }

    // ---- 优胜者脚下标记（客户端特效，「乌萨斯优胜者脚底下给个特效」）----
    updateWinnerMarks(battle, pid, winners);
  };

  apply();
  // 层数变化（含换人/升阶）后重算：攻防生与优胜者加成都是 live 的
  const st = S.battleStore(battle, 'usStudent:refresh', () => ({ hooked: false }));
  if (!st.hooked) {
    st.hooked = true;
    battle.on('layerGain', (c) => { if (S.bondActive(battle, c.playerId, BASE)) battle.after(0, () => installPlayer(battle, c.playerId)); }, { priority: -100 });
  }

  // ---- 优胜者光环跟随（0.5s 一轮；换人/阵亡时收掉）----
  battle.every(0.5, () => {
    const t = S.bondTier(battle, pid, BASE);
    const ms = S.bondMembers(battle, pid, BASE, { fieldOnly: false }).map((u) => ({ uid: u.uid, atk: baseAtk(u) }));
    updateWinnerMarks(battle, pid, winnersOf(ms, t));
  });

  // ---- 谷米：治疗量额外 +100（精锐翻倍 +200）----
  if (!st.healHooked) {
    st.healHooked = true;
    battle.on('heal', (ctx) => {
      const src = ctx && ctx.source;
      if (!src || src.kind !== 'op') return;
      if (!S.bondActive(battle, src.ownerId, BASE)) return;
      if (S.baseChessId(src) === ID_GUMI) {
        ctx.amount = num(ctx.amount) + (S.isElite(src) ? 200 : 100);
      }
    });
  }
}

// =====================================================================================================================
// 优胜者脚下光环（客户端特效）

/** 光环半径（格）与整场寿命（游戏秒）。 */
const MARK_R = 0.7;
const MARK_LIFE = 600;
/** 收尾用的极短 duration：客户端 zone 有 0.6s 下限，那一圈会先淡到看不见再被回收。 */
const MARK_KILL = 0.001;
const markKeyOf = (uid) => `usStudent:winner:${uid}`;

/**
 * 给每位**在场**优胜者挂一圈地面光环（0.5s 一轮，`battle.fx('winnerMark')`）。
 *
 * 客户端 `zone` 是按 key 原地更新的（render/fx/simfx.js → zones.js，引星棘刺 S2 同款）：同一个 key 只有一圈，
 * 所以这里可以按轮重发来跟随位移/换人，而不是每轮堆一层。停发后靠 `duration` 自己消失。
 * 不再是优胜者 / 离场 / 阵亡时，用同一个 key 发一个极短 duration，让那一圈立刻收掉。
 */
function updateWinnerMarks(battle, pid, winnerUids) {
  const cur = battle._usStudentMark ?? (battle._usStudentMark = new Map());
  const live = new Set();
  for (const u of battle.allyUnits) {
    if (u.ownerId !== pid || !S.onField(u) || !winnerUids.has(u.uid)) continue;
    live.add(u.uid);
    cur.set(u.uid, u);
    battle.fx('winnerMark', { x: u.x, y: u.y, id: u.id, key: markKeyOf(u.uid), r: MARK_R, duration: MARK_LIFE });
  }
  for (const [uid, u] of cur) {
    if (live.has(uid)) continue;
    battle.fx('winnerMark', { x: u.x, y: u.y, id: u.id, key: markKeyOf(uid), r: MARK_R, duration: MARK_KILL });
    cur.delete(uid);
  }
}

// =====================================================================================================================
// 共享查询（被 items/battle.js 的哑弹 handler 等复用）

/** 某玩家乌萨斯学生团当前的优胜者 uid 集合（battle 侧，依赖盟约已激活）。 */
export function usStudentWinners(battle, pid) {
  if (!S.bondActive(battle, pid, BASE)) return new Set();
  const tier = S.bondTier(battle, pid, BASE);
  const members = S.bondMembers(battle, pid, BASE, { fieldOnly: false }).map((u) => ({ uid: u.uid, atk: baseAtk(u) }));
  return winnersOf(members, tier);
}

/** 某单位是否为乌萨斯学生团优胜者（battle 侧）。 */
export function isUsStudentWinner(battle, u) {
  if (!S.isOp(u)) return false;
  return usStudentWinners(battle, u.ownerId).has(u.uid);
}

// =====================================================================================================================
// prep 侧

const H = {};

/**
 * 乌萨斯学生团·休整期结束（USSTU_PREP_FIN）：依「自身是否优胜者」派发乌萨斯学生团 + 职业层数。
 * 金额读各自 garrisons.json 的 bb：usWin/usNoWin（乌萨斯学生团）、pfWin/pfNoWin（职业），职业 bond id 默认取干员自身
 * 职业盟约（bbStr.profBondWin / profBondNoWin 可覆盖，苦艾非优胜者写 supportShip）。
 *
 * 用户 2026-10-14 两条裁定：
 *   1) 「不是优胜者的也能叠层」—— 非优胜者以前**照样发**（走 usNoWin/pfNoWin），这一点本来就成立；
 *      真正被跳过的是「乌萨斯未激活」时那份额外的**附加盟约**层数（见下）。
 *   2) 「我拿他叠附加盟约、没激活乌萨斯也是视为不是优胜者」—— 玩家常把凛冬当成「附加盟约的叠层器」：
 *      乌萨斯没激活时，文本写的「【乌萨斯学生自治团】层数+N」无处可去（叠一个没激活的核心盟约没意义），
 *      这份层数改叠到**该干员自己的职业附加盟约**上，也就是玩家实际在叠的那个。
 *      判定口径：乌萨斯盟约**未激活** ⇒ 视同非优胜者（拿 usNoWin/pfNoWin 那一档），且 usN 转投职业盟约。
 */
H.USSTU_PREP_FIN = {
  run(ctx) {
    const me = ctx.source && ctx.source.piece;
    if (!me || me.kind !== 'chess') return;
    const myView = Number.isInteger(me.uid) && me.uid > 0 ? ctx.piece(me.uid) : null;
    const self = myView || me;
    if (self.kind !== 'chess') return;

    // 在场乌萨斯学生团成员（board 视图带 row/col，自身须上场才可能是优胜者）
    const board = ctx.board();
    const members = [];
    for (const p of board) {
      if (p.kind !== 'chess') continue;
      if (!ctx.pieceBonds(p.uid).includes(BASE)) continue;
      const rec = ctx.chessRecord(p.id);
      const atk = rec && rec.stats ? num(rec.stats.atk) : 0;
      members.push({ uid: p.uid, atk });
    }
    const bs = ctx.bond(BASE);
    const usActive = !!(bs && bs.active);
    // 用户 2026-10-14：「没激活乌萨斯也是视为不是优胜者」—— 盟约没开就没有优胜者可言。
    const tier = usActive ? Math.max(1, Math.floor(num(bs.tier, 1))) : 0;
    const winners = usActive ? winnersOf(members, tier) : new Set();
    const isWin = usActive && winners.has(self.uid);

    // 职业 bond：自身职业（默认），可按 bbStr 覆盖（苦艾非优胜者→supportShip）
    const ownBonds = ctx.pieceBonds(self.uid);
    const profDefault = ownBonds.find((b) => b && b !== BASE && /Ship$/.test(b)) || null;
    const { bb, bbStr } = ctx.source;
    const profWin = bbStr && bbStr.profBondWin ? bbStr.profBondWin : profDefault;
    const profNoWin = bbStr && bbStr.profBondNoWin ? bbStr.profBondNoWin : profWin;

    const usN = isWin ? num(bb.usWin) : num(bb.usNoWin);
    const pfN = isWin ? num(bb.pfWin) : num(bb.pfNoWin);
    const pfBond = isWin ? profWin : profNoWin;

    // 乌萨斯那一份额：盟约已激活 → 照文本叠到乌萨斯；未激活 → 转投该干员的职业**附加盟约**
    // （用户「我拿他叠附加盟约」，那份层数不该因为核心盟约没开就白丢）。
    const usTarget = usActive ? BASE : (pfBond || profDefault || null);
    if (usN > 0 && usTarget) ctx.addLayers(usTarget, usN, { requireActive: false, reason: 'garrison:usStudent' });
    // 职业那一份额：目标是**另一个**盟约时才另发一份；与上面同目标时已经并入上一行，不重复发。
    if (pfN > 0 && pfBond && pfBond !== usTarget) {
      ctx.addLayers(pfBond, pfN, { requireActive: false, reason: 'garrison:usStudent' });
    }
  },
};

export function registerMeta(registry) {
  for (const [key, handler] of Object.entries(H)) registry.garrison(key, handler);
}

export default { install, registerMeta };
