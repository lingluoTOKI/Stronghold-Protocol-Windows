// server/sim/content/contracts.js — 契约选择的战斗侧（server/match/contracts.js 的 EffectRef 消费者）。
// 每名玩家的 playerEffects 带 key `contract:<id>`（params: { alive, round, perfectN }，player/round.js 每回合刷新）。
//
// 我方契约：
//   contract_perfect_aspd 完美  自己每完美作战一次，全体干员攻击速度 +10（战斗开始，可叠加）
//   contract_ascend       升华  本场战斗己方干员每击败一个敌人 → 全体造成伤害 ×120%（首杀触发，持续全场）
//   contract_wall         城墙  战斗开始：场上生命值最高的干员获得其生命值 100% 的护盾
//   contract_brave1/2     勇者/勇士  场上只剩最后一位干员时：攻击/防御 +30%/90%，阻挡数 +1/2
//   contract_crit         暴击  己方干员造成的伤害 25% 概率 ×150%
//   contract_lone         孤军  场上只有自己存活：对 boss 伤害 +50%
//   contract_alliance     联合  还有其他玩家存活：对 boss 伤害 +25%（team：选它时全队都拿，见 match/contracts.js）
//   contract_smite        神罚  异客每对一个目标造成伤害回复2技力（第12回合选取时立刻获得一个异客 —— match 侧 applyContract）
// 敌方契约（只作用于自己半场的敌人；**协防/联防战同样生效** —— 半场 ownerId 口径）：
//   contract_e_atk2/8     强攻  敌人攻击力 +（5/10 ×当前回合）%（按敌人**默认**攻击力平加）
//   contract_e_aspd2/8    狂暴  敌人攻击速度 +（5/10 ×当前回合）点
//   contract_e_move2/8    强袭  敌人移动速度 +（5/10 ×当前回合）%（按默认移动速度平加）
//   contract_e_hp2/8      强韧  敌人生命值 +（7/15 ×当前回合）%（按敌人**默认**生命值平加）
//   contract_e_def2/8     强坚  敌人防御力和法术抗性 +（5/10 ×当前回合）%（按敌人**默认**防御/法抗平加；
//                         + 档第8回合拿的敌方契约生效整场 —— choices.json valid [8,99]，contractExpire 不回收）
//   contract_e_dodge      闪避  敌人 20% 闪避物理与法术伤害（原生 dodgePhys/dodgeArts）
//   contract_e_boom       自爆  敌人死亡时自爆：3×3 内我方单位受 1500 物理 + 1500 法术
//   contract_e_stealth    影舞  无隐匿的敌人获得隐匿；本就隐匿的阻挡数 +1（引擎没有「需 2 人阻挡」概念，按字面折算）
//   contract_e_burn       点燃（原侵蚀）  敌人的攻击附加其 5% 伤害的灼燃损伤（element）
//
// 中立契约（**全场生效**：我方单位 battleStart 上、敌人 enemySpawn 上；rank 精英扫描走 battle._pending +
// battle.data.getEnemy —— 出怪计划在战斗构造时就全部可知，契约装到场上时逐条查 rank）：
//   contract_n_leader     领袖  有精英敌人在场：普通敌人平加「最强精英 生命/攻击 ×80%」；无精英：全部敌人
//                         +（3×当前回合)% 生命/攻击（按默认属性平加，同敌方契约口径）。我方：场上攻最高干员在场 →
//                         我方全体在场单位 +其攻击 30%（battleStart 一次性 persist）
//   contract_n_heal       愈合  敌我双方每秒回复 1% 最大生命值（hpRegenRatio persist）
//   contract_n_gamble     赌局  出怪 ±20%（match 侧 contractSpawnMods，每场结算更新）
//   contract_n_greed      贪婪  即时效果（match 侧 applyContract）
//   contract_n_miasma     清图  60s 后毒雾：全场所有单位每秒流失「生命上限 1%→20%/s（20 秒线性爬升封顶）」，
//                         无来源真实（loseHp：无视防御/法抗/闪避/护盾，不可解）—— 多人同持只挂一条钩
//   contract_n_dawn       破晓  敌我双方攻击时无视对方 20% 防御与法术抗性（defIgnorePct/resIgnorePct）
//   contract_n_masoch     自残  敌我双方最大生命值 -30%（hpMul 是 _recalc 最外层乘区 = 所有加成算完后再 ×0.7）
//   contract_n_duel       单挑  我方除「攻击力最高」干员外全部开战立刻死亡；攻最高者 生命/攻击/防御 +100%
//                         （用户 2026-10-15：我方 +50%→+100%，敌方锏 +100%→+50%）
//                         （敌方侧：只出 1 只锏，其 生命/攻击/防御 ×1.5 —— match 侧 contractSpawnMods）
//   contract_n_brawl      群殴  敌方出怪数量 ×2、我方这场战斗可额外上 2 名干员（match 侧）
//   contract_n_arena      通厕  我方只留 攻击力/生命值/防御力 最高 3 名干员（各 +100% 对应属性），其余开战即死
//                         （敌方侧：出怪清空，只出 3 只杰斯顿·威廉姆斯，生命/防御/攻击 +100%，每漏一只 -3 策略血量 —— match 侧）

const isEnemyRef = (id) => String(id || '').startsWith('contract_e_');
const isNeutralRef = (id) => String(id || '').startsWith('contract_n_');

// 复活契约复用引擎的 reviveNow（items/battle.js）：它要求 c.reason === 'killed'，并走 battle.redeploy(u, {free:true})。
import { reviveNow } from './items/battle.js';
import { isHitCount } from './enemies/helpers.js';

/** 敌人（或出怪计划里的 def）默认属性统一取值：normalizeEnemy 后 stats 在 def.raw.stats（2026-10-11 实测口径）。 */
const statOf = (o, k, d = 0) => o?.stats?.[k] ?? o?.raw?.stats?.[k] ?? o?.[k] ?? d;

/** 敌方契约的「按默认属性平加」值表：{ atkPct, hpPct, aspdPts, movePct } —— × 当前回合。 */
function enemyPlanOf(id) {
  switch (id) {
    case 'contract_e_atk2': return { atkPct: 0.05 };
    case 'contract_e_aspd2': return { aspdPts: 5 };
    case 'contract_e_move2': return { movePct: 0.05 };
    case 'contract_e_hp2': return { hpPct: 0.07 };
    case 'contract_e_def2': return { defPct: 0.05, resPct: 0.05 };
    case 'contract_e_atk8': return { atkPct: 0.10 };
    case 'contract_e_aspd8': return { aspdPts: 10 };
    case 'contract_e_move8': return { movePct: 0.10 };
    case 'contract_e_hp8': return { hpPct: 0.15 };
    case 'contract_e_def8': return { defPct: 0.10, resPct: 0.10 };
    // 闪避（12 回合）：敌人 80% 闪避物理与法术伤害 —— 用户 2026-10-14：
    // 这条契约此前**从未实现**（choices.json 有卡、代码里只有注释），这里补上。
    case 'contract_e_dodge': return { dodge: DODGE_PCT };
    default: return null;
  }
}

const rankOf = (e) => String(e?.def?.rank ?? e?.def?.raw?.rank ?? 'NORMAL').toUpperCase();
const isOwnOp = (u, pid) => !!u && u.kind === 'op' && u.side === 'ally' && u.ownerId === pid;

/** 契约数值（可按需改成从 choices.json 读；用户 2026-10-14 规格）。 */
const DODGE_PCT = 0.80;   // 闪避：敌人 80% 闪避物理与法术伤害
const BURN_PCT = 0.30;    // 点燃：敌人攻击附加其 30% 伤害的灼燃损伤
// 清图毒雾：60s 起 1%/s 起算、20 秒内爬到 10%/s 封顶；精英固定 1%/s、领袖固定 0.5%/s。
const MIASMA_BASE = 0.01;
const MIASMA_CAP = 0.10;
const MIASMA_ELITE = 0.01;
const MIASMA_LEADER = 0.005;

export function install(battle) {
  /** pid → { self:Set<id>, neutral:Set<id>, enemy:Set<id>, params } */
  const per = new Map();
  for (const ps of battle.players || []) {
    const entry = { self: new Set(), neutral: new Set(), enemy: new Set(), params: {} };
    for (const ref of ps.playerEffects || []) {
      if (!ref || typeof ref.key !== 'string' || !ref.key.startsWith('contract:')) continue;
      const id = ref.data?.contractId || ref.key.slice('contract:'.length);
      // 归组：match 侧 applyContract 已在 data.group 里写好；兜底按 id 前缀
      const group = ref.data?.group || (isNeutralRef(id) ? 'neutral' : isEnemyRef(id) ? 'enemy' : 'self');
      (entry[group] || entry.self).add(id);
      entry.params = { ...entry.params, ...(ref.params || {}) };
    }
    if (entry.self.size || entry.neutral.size || entry.enemy.size) per.set(ps.playerId, entry);
  }
  if (!per.size) return;
  const has = (pid, id) => { const e = per.get(pid); return !!e && (e.self.has(id) || e.neutral.has(id) || e.enemy.has(id)); };
  const anySelf = [...per.values()].some((e) => e.self.size);
  const enemyOwners = [...per.entries()].filter(([, e]) => e.enemy.size).map(([pid]) => pid);

  // —— 敌方契约：spawn 时按自己半场（ownerId）上buff —— 平加值按敌人默认属性 × 当前回合 ——
  const enemyPlans = new Map(); // pid → [{ id, plan }]
  for (const [pid, entry] of per) {
    for (const id of entry.enemy) {
      const plan = enemyPlanOf(id);
      if (plan) {
        if (!enemyPlans.has(pid)) enemyPlans.set(pid, []);
        enemyPlans.get(pid).push({ id, plan, round: Math.max(1, entry.params.round || 1) });
      }
    }
  }
  const stealthPid = enemyOwners.find((pid) => per.get(pid)?.enemy.has('contract_e_stealth')) ?? null;

  if (enemyPlans.size || stealthPid != null) {
    battle.on('enemySpawn', (ctx) => {
      const e = ctx && ctx.enemy;
      if (!e || !e.alive || !e.def) return;
      const pid = e.ownerId ?? (battle.players.length === 1 ? battle.players[0].playerId : null);
      // 频次（hit-count）单位：maxHp 即「击倒数」，每受一次伤害扣 1 点（helpers.js 的 hitCount flag），
      // 任何生命值加成都会改变其所需攻击次数（例如红木瑞印「需要 3 点攻击击倒」会凭空变成 4+）。
      // 强韧 / 强韧+ 的生命值上限平加对它们一律不生效 —— 无论它是出怪计划里的主怪，还是击杀 / 死亡召唤出来的小怪。
      // 旧规则（用户 2026-10-14）只排除「死亡召唤出来的新怪」，但 spawnChildren 传给子单位的 sourcePlayerId 来自
      // 父单位（通常为 null），导致死亡掉落的频次怪仍被加血；这里直接按单位的 hitCount 性质判定更稳妥。
      // 频次单位在 spawn 时（content 的 enemySpawn priority 100，早于本 handler 的 -5）已挂上 hitCount buff。
      const isTimes = isHitCount(e);
      // 影舞：无隐匿的敌人获得隐匿；本就隐匿的（原生 stealth 或已带 ab:stealth）阻挡数 +1。
      // 新增（2026-10-11）：阻挡数为 0 的敌人**获得**隐匿时，其阻挡数变为 1。
      if (pid != null && per.get(pid)?.enemy.has('contract_e_stealth')) {
        const native = !!(e.s?.flags?.stealth) || (e.buffs || []).some((b) => b.flags?.stealth);
        if (native) battle.addBuff(e, { key: 'contract:e_stealth_block', persist: true, mods: { blockCnt: 1 } });
        else {
          const zeroBlock = ((e.s && e.s.blockCnt) ?? (((e.def.stats || (e.def.raw && e.def.raw.stats) || {}).blockCnt) ?? 0)) <= 0;
          battle.addBuff(e, {
            key: 'contract:e_stealth', persist: true, flags: { stealth: true }, data: { stealthRestore: 3 },
            ...(zeroBlock ? { mods: { blockCnt: 1 } } : {}),
          });
        }
      }
      const plans = enemyPlans.get(pid);
      if (!plans) return;
      // 敌人默认属性：normalizeEnemy 之后 stats 在 def.raw.stats（def.stats 一直是 undefined —— 2026-10-11
      // 冒烟抓到的既有 bug：强攻/狂暴/强袭/强韧 的 spawn 平加此前从未生效）。
      const st = e.def.stats || (e.def.raw && e.def.raw.stats) || {};
      for (const { id, plan, round } of plans) {
        const mods = {};
        if (plan.atkPct) mods.atkFlat = (st.atk || 0) * plan.atkPct * round;
        // 强韧 / 强韧+：生命值上限不加到频次（hit-count）单位身上（其余加成都照给）
        if (plan.hpPct && !isTimes) mods.hpFlat = (st.maxHp || 0) * plan.hpPct * round;
        if (plan.defPct) mods.defFlat = (st.def || 0) * plan.defPct * round;
        if (plan.resPct) mods.resFlat = (st.res || 0) * plan.resPct * round;
        if (plan.aspdPts) mods.aspd = plan.aspdPts * round;
        if (plan.movePct) mods.moveFlat = (st.moveSpeed || 0) * plan.movePct * round;
        if (plan.dodge) { mods.dodgePhys = plan.dodge; mods.dodgeArts = plan.dodge; }
        if (Object.keys(mods).length) battle.addBuff(e, { key: `contract:${id}`, persist: true, mods });
      }
    }, { priority: -5 });
  }

  // —— 中立契约（全场生效；见文件头注释）——
  const roundOf = (pid) => Math.max(1, per.get(pid)?.params.round || battle.round || 1);

  // 领袖：精英扫描 = 已场上的 + 出怪计划（_pending 在战斗构造时已全部可知；联防时只认自己半场的精英）
  const leaderPlans = new Map(); // pid → { elite:{hp,atk} | null, pct }
  for (const [pid, e] of per) {
    if (!e.neutral.has('contract_n_leader')) continue;
    let best = null;
    const scan = (def) => {
      const rank = String(def?.rank ?? def?.raw?.rank ?? 'NORMAL').toUpperCase();
      if (rank !== 'ELITE') return;
      const hp = statOf(def, 'maxHp'), atk = statOf(def, 'atk');
      if (!best || hp > best.hp) best = { hp, atk };
    };
    for (const u of battle.enemies) if (u.alive) scan(u.def);
    for (const p of battle._pending) {
      if (p.ownerPlayerId != null && p.ownerPlayerId !== pid) continue;
      scan(battle.data.getEnemy(p.enemyKey));
    }
    leaderPlans.set(pid, best ? { elite: best } : { pct: 0.03 * roundOf(pid) });
  }

  // 愈合 / 破晓 / 自残：同一套「我方 battleStart + 敌人 enemySpawn persist」的 mods
  // 用户 2026-10-14：中立契约是**全场**效果，不止我方 —— 只要**任何一个**玩家拿了，
  // 场上所有单位（含每个玩家半场的敌人）都吃到；不能按 `e.ownerId` 去查「那个玩家有没有拿」
  // （那会让没拿契约的玩家半场上的敌人漏掉）。
  const unitMods = {};
  for (const [, e] of per) {
    if (e.neutral.has('contract_n_heal')) unitMods.hpRegenRatio = (unitMods.hpRegenRatio || 0) + 0.01;
    if (e.neutral.has('contract_n_dawn')) {
      unitMods.defIgnorePct = (unitMods.defIgnorePct || 0) + 0.2;
      unitMods.resIgnorePct = (unitMods.resIgnorePct || 0) + 0.2;
    }
    if (e.neutral.has('contract_n_masoch')) unitMods.hpMul = (unitMods.hpMul ?? 1) * 0.7;
  }
  const hasUnitMods = Object.keys(unitMods).length > 0;

  const miasmaOn = [...per.values()].some((e) => e.neutral.has('contract_n_miasma'));
  const duelPids = [...per.keys()].filter((pid) => per.get(pid).neutral.has('contract_n_duel'));
  const arenaPids = [...per.keys()].filter((pid) => per.get(pid).neutral.has('contract_n_arena'));
  // 领袖：同样是全场效果 —— 精英扫描取**所有**拿了领袖的玩家，敌方平加对全场敌人一致。
  const leaderAny = [...per.values()].some((e) => e.neutral.has('contract_n_leader'));

  if (leaderPlans.size || hasUnitMods || miasmaOn || duelPids.length || arenaPids.length) {
    battle.on('enemySpawn', (ctx) => {
      const e = ctx && ctx.enemy;
      if (!e || !e.alive || !e.def) return;
      const pid = e.ownerId ?? (battle.players.length === 1 ? battle.players[0].playerId : null);
      // 领袖 / 愈合·破晓·自残 是全场效果：取任一拿了该契约的玩家的计划即可（同一场战斗里口径一致）。
      const plan = leaderAny
        ? (leaderPlans.get(pid) || [...leaderPlans.values()][0] || null)
        : null;
      // 频次（hit-count）单位：maxHp 即击倒数，任何生命值缩放都会改变所需攻击次数（例如红木瑞印「需要 3 点攻击击倒」）。
      // 领袖的生命值平加、自残的 hpMul 对其一律不生效；攻击力 / 回血 / 破晓（无视防御）等不受影响，照给。
      const times = isHitCount(e);
      if (plan) {
        if (plan.elite) {
          if (rankOf(e) === 'NORMAL') {
            const mods = times ? { atkFlat: plan.elite.atk * 0.8 } : { hpFlat: plan.elite.hp * 0.8, atkFlat: plan.elite.atk * 0.8 };
            battle.addBuff(e, { key: 'contract:n_leader', persist: true, mods });
          }
        } else {
          const st = { maxHp: statOf(e.def, 'maxHp'), atk: statOf(e.def, 'atk') };
          const mods = times ? { atkFlat: st.atk * plan.pct } : { hpFlat: st.maxHp * plan.pct, atkFlat: st.atk * plan.pct };
          battle.addBuff(e, { key: 'contract:n_leader', persist: true, mods });
        }
      }
      if (hasUnitMods) {
        // 频次单位去掉 hpMul（自残），hpRegenRatio / defIgnorePct / resIgnorePct 仍照给
        const mods = times
          ? { hpRegenRatio: unitMods.hpRegenRatio, defIgnorePct: unitMods.defIgnorePct, resIgnorePct: unitMods.resIgnorePct }
          : { ...unitMods };
        battle.addBuff(e, { key: 'contract:n_unit', persist: true, mods });
      }
    }, { priority: -4 }); // 敌方契约平加（-5）之后：领袖/自残叠在其上
  }

  if (miasmaOn) {
    // 清图毒雾：60s 起全场每秒流失 生命上限×rate。
    // 用户 2026-10-14：普通单位仍 1%/s 且 20 秒线性爬升，但**封顶 10%/s**（原 20%）；
    //   精英（ELITE）固定 1%/s、领袖（BOSS/LEADER）固定 0.5%/s，**不参与爬升**。
    // 无来源真实（loseHp，不可解）。
    battle.on('tick', ({ dt }) => {
      const t = battle.time;
      if (!(dt > 0) || t < 60) return;
      const ramp = Math.min(MIASMA_CAP, MIASMA_BASE + (MIASMA_CAP - MIASMA_BASE) / 20 * (t - 60));
      for (const u of battle.units) {
        if (!u.alive || !u.deployed) continue;
        let rate = ramp;
        if (u.side === 'enemy') {
          const r = rankOf(u);
          if (r === 'ELITE') rate = MIASMA_ELITE;
          else if (r === 'BOSS' || r === 'LEADER') rate = MIASMA_LEADER;
        }
        const n = (u.s?.maxHp || 0) * rate * dt;
        if (n > 0) battle.loseHp(u, n, { tags: ['contract:miasma'] });
      }
    });
  }

  // 中立的我方侧：领袖全场 +30% 攻 / 愈合·破晓·自残 persist / 单挑·擂台的开战裁汰
  battle.on('battleStart', () => {
    for (const [pid, entry] of per) {
      const ops = ownDeployed(pid);
      if (!ops.length) continue;
      const plan = leaderPlans.get(pid);
      if (plan) {
        const best = ops.reduce((a, u) => (!a || u.s.atk > a.s.atk ? u : a), null);
        if (best) for (const u of ops) battle.addBuff(u, { key: 'contract:n_leader_self', persist: true, mods: { atkFlat: best.s.atk * 0.3 } });
      }
      const mods = hasUnitMods ? unitMods : null;
      if (mods) for (const u of ops) battle.addBuff(u, { key: 'contract:n_unit', persist: true, mods: { ...mods } });
      // 愈合 / 破晓 / 自残 也覆盖我方**后来**部署的干员与召唤物（不只是开场那批）
      if (mods) {
        battle.on('deploy', ({ unit: u }) => {
          if (!u || !u.alive || u.side !== 'ally' || !isOwnOp(u, pid)) return;
          battle.addBuff(u, { key: 'contract:n_unit', persist: true, mods: { ...mods } });
        }, { priority: -6 });
      }
      // 单挑（用户 2026-10-15）：除攻最高者外全部开战立刻死亡；攻最高者 生命值/攻击力/防御力 +100%
      //   （数值与 data/choices.json 的 `contract_n_duel.duelSelfPct` 对齐；敌方锏侧在 match 侧 duelEnemyMul）
      if (duelPids.includes(pid)) {
        const best = ops.reduce((a, u) => (!a || u.s.atk > a.s.atk ? u : a), null);
        for (const u of ops) {
          if (u === best) battle.addBuff(u, { key: 'contract:n_duel', persist: true, mods: { atkPct: 1, hpPct: 1, defPct: 1 } });
          else battle.loseHp(u, 1e9, { tags: ['contract:duel'] });
        }
      }
      // 通厕（原擂台）我方侧：只留 攻/血/防 最高的至多 3 人（一人可兼多项、每项都 +100%），其余开战立刻死亡
      if (arenaPids.includes(pid)) {
        const top = (k) => ops.reduce((a, u) => (!a || u.s[k] > a.s[k] ? u : a), null);
        const byAtk = top('atk'), byHp = top('maxHp'), byDef = top('def');
        for (const u of ops) {
          const mods = {};
          if (u === byAtk) mods.atkPct = 1;
          if (u === byHp) mods.hpPct = 1;
          if (u === byDef) mods.defPct = 1;
          if (Object.keys(mods).length) battle.addBuff(u, { key: 'contract:n_arena', persist: true, mods });
          else battle.loseHp(u, 1e9, { tags: ['contract:arena'] });
        }
      }
    }
  });

  // —— 我方契约 ——
  const critPids = [...per.entries()].filter(([, e]) => e.self.has('contract_crit')).map(([pid]) => pid);
  const bossPids = new Map(); // pid → { lone, alliance }
  for (const [pid, e] of per) {
    const lone = e.self.has('contract_lone');
    const alliance = e.self.has('contract_alliance');
    if (lone || alliance) bossPids.set(pid, { lone, alliance });
  }
  const burnPids = new Set();
  for (const [pid, e] of per) if (e.enemy.has('contract_e_burn')) burnPids.add(pid);
  const boomPids = new Set();
  for (const [pid, e] of per) if (e.enemy.has('contract_e_boom')) boomPids.add(pid);
  // 神罚：异客每对一个目标造成伤害回复2技力
  const smitePids = new Set();
  for (const [pid, e] of per) if (e.self.has('contract_smite')) smitePids.add(pid);
  // 升华的首杀标记与勇者的「只剩一人」判定
  const ascended = new Set();
  const brave = new Map(); // pid → { pct, block }
  for (const [pid, e] of per) {
    if (e.self.has('contract_brave1')) brave.set(pid, { pct: 0.3, block: 1 });
    else if (e.self.has('contract_brave2')) brave.set(pid, { pct: 0.9, block: 2 });
  }

  // 战斗开始：完美攻速 / 城墙护盾 / 勇者判定
  battle.on('battleStart', () => {
    for (const [pid, entry] of per) {
      // 完美：全部干员攻击速度 +10×完美次数
      const perfectN = entry.params.perfectN || 0;
      if (entry.self.has('contract_perfect_aspd') && perfectN > 0) {
        for (const u of battle.allyUnits) if (isOwnOp(u, pid) && u.alive) battle.addBuff(u, { key: 'contract:perfect_aspd', persist: true, mods: { aspd: 10 * perfectN } });
      }
      // 城墙：场上生命值最高的干员获得其生命值 100% 的护盾
      if (entry.self.has('contract_wall')) {
        let best = null;
        for (const u of battle.allyUnits) if (isOwnOp(u, pid) && u.alive && u.deployed) if (!best || u.s.maxHp > best.s.maxHp) best = u;
        if (best) battle.addBuff(best, { key: 'contract:wall', persist: true, shield: best.s.maxHp });
      }
      // 勇者/勇士：只剩最后一位干员
      if (brave.has(pid)) updateBrave(pid);
    }
  }, { priority: -10 });

  function ownDeployed(pid) {
    return battle.allyUnits.filter((u) => isOwnOp(u, pid) && u.alive && u.deployed);
  }

  /** 勇者/勇士：场上只剩最后一位干员时给它加成，否则摘掉。 */
  function updateBrave(pid) {
    const cfg = brave.get(pid);
    if (!cfg) return;
    const ops = ownDeployed(pid);
    for (const u of battle.allyUnits) if (isOwnOp(u, pid)) {
      const has = !!u.findBuff('contract:brave');
      if (ops.length === 1 && u === ops[0] && !has) battle.addBuff(u, { key: 'contract:brave', persist: true, mods: { atkPct: cfg.pct, defPct: cfg.pct, blockCnt: cfg.block } });
      else if ((ops.length !== 1 || u !== ops[0]) && has) battle.removeBuff(u, 'contract:brave');
    }
  }

  // 击败：升华首杀 / 勇者人数复查 / 自爆
  battle.on('kill', ({ killer, victim }) => {
    // 升华：己方干员击败一个敌人 → 全体伤害 ×120%
    if (killer && isOwnOp(killer, killer.ownerId) && per.get(killer.ownerId)?.self.has('contract_ascend') && !ascended.has(killer.ownerId)) {
      ascended.add(killer.ownerId);
      for (const u of battle.allyUnits) if (isOwnOp(u, killer.ownerId) && u.alive) battle.addBuff(u, { key: 'contract:ascend', persist: true, mods: { dmgDealtMul: 1.2 } });
    }
    // 勇者/勇士：己方干员阵亡后人数变化
    if (victim && victim.side === 'ally' && victim.kind === 'op' && brave.has(victim.ownerId)) updateBrave(victim.ownerId);
    // 自爆：敌人死亡 → 3×3 内我方单位 1500 物理 + 1500 法术
    if (victim && victim.side === 'enemy' && boomPids.has(victim.ownerId ?? (battle.players.length === 1 ? battle.players[0].playerId : null))) {
      const r = Math.round(victim.y), c = Math.round(victim.x);
      for (const u of battle.allyUnits) {
        if (!u.alive || !u.deployed) continue;
        if (Math.abs(Math.round(u.y) - r) > 1 || Math.abs(Math.round(u.x) - c) > 1) continue;
        battle.dealDamage(victim, u, { amount: 1500, type: 'physical', canDodge: false, tags: ['contract:boom'] });
        battle.dealDamage(victim, u, { amount: 1500, type: 'magic', canDodge: false, tags: ['contract:boom'] });
      }
    }
  });

  // 伤害管线。加伤类（暴击 / 孤军·联合）必须挂在 **'hit'**（可变 DamageInfo，dmg.mul 在减免/护盾之前生效）——
  // 'damaged' 在扣血之后才触发，在那里改 amount 只是改了面板数字、真实伤害纹丝不动（实测报告 2026-10-10）；
  // 侵蚀是「攻击**附加**一段灼燃损伤」，天然是事后独立一段，留在 'damaged' 但要挡住自递归。
  if (critPids.length || bossPids.size || burnPids.size) {
    // 暴击：己方干员造成伤害 25% ×150%；孤军/联合：对 boss 伤害提升 —— 都走 dmg.mul
    battle.on('hit', (c) => {
      const src = c.source, tgt = c.target, dmg = c.dmg;
      if (!src || !isOwnOp(src, src.ownerId) || !tgt || tgt.side !== 'enemy' || !dmg) return;
      if (dmg.type === 'element') return; // 元素损伤不吃加伤
      if (critPids.includes(src.ownerId) && battle.rng() < 0.25) dmg.mul = (dmg.mul ?? 1) * 1.5;
      if (rankOf(tgt) === 'BOSS') {
        const cfg = bossPids.get(src.ownerId);
        if (cfg) {
          if (cfg.lone && (per.get(src.ownerId)?.params.alive ?? 1) === 1) dmg.mul = (dmg.mul ?? 1) * 1.5;
          else if (cfg.alliance && (per.get(src.ownerId)?.params.alive ?? 1) > 1) dmg.mul = (dmg.mul ?? 1) * 1.25;
        }
      }
    });
    // 点燃：敌人的攻击附加其 30% 伤害的灼燃损伤（用户 2026-10-14：5% → 30%）—— 只挂「本次伤害本身不是
    // 元素/不是点燃灼燃」，否则灼燃的 dealDamage 会再次触发 damaged → 30% 的 30% … 无限套娃；
    // element 键必带：浮字管道 shown = dmg.element，缺了会按「真实」渲染
    battle.on('damaged', (ctx) => {
      if (!ctx || !(ctx.amount > 0)) return;
      const src = ctx.source, tgt = ctx.target;
      if (src && src.side === 'enemy' && tgt && tgt.side === 'ally' && ctx.type !== 'element' && !(ctx.dmg?.tags || []).includes('contract:burn')
        && burnPids.has(src.ownerId ?? (battle.players.length === 1 ? battle.players[0].playerId : null))) {
        const n = ctx.amount * BURN_PCT;
        if (n > 0) battle.dealDamage(src, tgt, { amount: n, type: 'element', element: 'burn', canDodge: false, tags: ['contract:burn'] });
      }
    });
  }

  // 神罚：异客每对一个目标造成伤害 → 回复2技力。'hit' 每次「对一个目标」的伤害实例各触发一次
  //（连锁/溅射打中几个目标就回几份）；元素损伤不是攻击伤害，不计。
  if (smitePids.size) {
    battle.on('hit', ({ source, target, dmg }) => {
      if (!source || !isOwnOp(source, source.ownerId) || !target || target.side !== 'enemy' || !dmg) return;
      if (dmg.type === 'element' || !smitePids.has(source.ownerId)) return;
      const cid = source.def?.raw?.charId || source.def?.charId || '';
      if (cid !== 'char_472_pasngr') return;
      source.skill?.gainSp?.(2, 'contract:smite');
    });
  }

  installNewNeutral(battle, per);
}

// =====================================================================================================================
// 新增 9 条中立契约（用户 2026-10-14）：频率 / 斩杀 / 屠戮 / 锁血 / 反伤 / 嗜血 / 复活 / 残血 / 寒冷
//
// 全部是「所有单位」（敌我通吃）的规则，且多数是**一次性 / 触发型**，所以各自挂事件钩子并在
// unit 上打标记（`u.mem`）保证「仅一次」语义。
// =====================================================================================================================
const NEUTRAL_NEW = Object.freeze([
  'contract_n_freq', 'contract_n_execute', 'contract_n_slaughter', 'contract_n_laststand',
  'contract_n_reflect', 'contract_n_vampire', 'contract_n_revive', 'contract_n_lowhp', 'contract_n_cold',
]);

function installNewNeutral(battle, per) {
  const anyPid = () => [...per.keys()];
  const has = (id) => anyPid().some((pid) => per.get(pid).neutral.has(id));
  const on = NEUTRAL_NEW.filter((id) => has(id));
  if (!on.length) return;

  // 用户 2026-10-14 口径：**中立契约对所有单位生效，不止我方单位**。
  // 所以每条都用同一个「全单位挂 buff」入口 —— 三个时机都要覆盖，缺一不可：
  //   battleStart  开场就在场的（我方干员 + 装置 / 已出场的敌人）
  //   deploy       我方后来部署的干员（含召唤出来的 token）
  //   enemySpawn   敌方后来出场的怪（含死亡召唤出来的小怪、分裂体）
  // 早期版本漏了「敌方后来出场的怪」这一路（残血 / 寒冷 / 频率 / 锁血 / 屠戮 都中招），
  // 并且用 `u.side === 'ally'` 把敌方整体排除了 —— 那与「所有单位」矛盾。
  const forEachUnit = (fn) => { for (const u of battle.units) if (u && u.alive) fn(u); };
  /** 三条钩子一起挂：全单位 buff 的标准接法。 */
  const onEveryUnit = (fn) => {
    battle.on('battleStart', () => forEachUnit(fn));
    battle.on('deploy', ({ unit: u }) => { if (u && u.alive) fn(u); }, { priority: -6 });
    battle.on('enemySpawn', ({ enemy: e }) => { if (e && e.alive) fn(e); }, { priority: -6 });
  };

  // 残血：所有单位出场/部署时最大生命值限制为 50%（boss 75%）
  if (has('contract_n_lowhp')) {
    const apply = (u) => {
      const isBoss = u.side === 'enemy' && (u.isBoss || u.tag === 'boss' || rankOf(u) === 'BOSS');
      battle.addBuff(u, { key: 'contract:n_lowhp', persist: true, mods: { hpMul: isBoss ? 0.75 : 0.5 } });
    };
    onEveryUnit(apply);
  }

  // 寒冷：所有单位攻击速度 -100（valid [12,13] ⇒ 14 回合开始前由 contractExpire 回收，这里只挂钩子）
  if (has('contract_n_cold')) {
    onEveryUnit((u) => battle.addBuff(u, { key: 'contract:n_cold', persist: true, mods: { aspd: -100 } }));
  }

  // 频率：所有单位部署/出场时获得「免疫 3 次任何伤害」的护盾
  if (has('contract_n_freq')) {
    onEveryUnit((u) => battle.addBuff(u, { key: 'contract:n_freq', persist: true, shieldHits: 3, shield: 1 }));
  }

  // 锁血：所有单位仅一次「生命值不会低于 1」，持续 5 秒（每单位一次）
  // 引擎的「不受致命伤」= 'fatal' 事件 hook 里置 c.prevented（见 kits/ops/chess_char_2_07-ghost.js）；
  // 单位自身有 5 秒窗口（u.mem.laststandUntil），窗口内首次致命伤被挡下后即失效（仅一次）。
  if (has('contract_n_laststand')) {
    const arm = (u) => {
      if (!u || !u.alive) return;
      if (u.mem?.laststandArmed) return;
      if (!u.mem) u.mem = {};
      u.mem.laststandArmed = true;
      u.mem.laststandUntil = battle.time + 5;
      battle.on('fatal', (c) => {
        if (c.unit !== u) return;
        if (battle.time > u.mem.laststandUntil) return;
        if (u.mem.laststandUsed) return;
        u.mem.laststandUsed = true;
        c.prevented = true;
      }, { owner: u, priority: 10 });
    };
    onEveryUnit(arm);
  }

  // 斩杀：所有单位攻击对方时，若对方当前生命值低于 30% 则立即死亡
  if (has('contract_n_execute')) {
    battle.on('hit', ({ source, target, dmg }) => {
      if (!source || !target || !target.alive || !dmg) return;
      if (dmg.type === 'element' || dmg.tags?.includes('contract:execute')) return;
      if (source.side === target.side) return;
      if (!(target.hpRatio < 0.3)) return;
      battle.dealDamage(source, target, { amount: target.hp + target.s.maxHp, type: 'true', canDodge: false, tags: ['contract:execute'] });
    }, { priority: -30 });
  }

  // 反伤：所有单位受到伤害时，对造成伤害的目标还击该伤害 50% 的真实伤害
  if (has('contract_n_reflect')) {
    battle.on('damaged', (c) => {
      const tgt = c && c.target, src = c && c.source;
      if (!tgt || !src || !tgt.alive || !src.alive || src.side === tgt.side) return;
      if (!(c.amount > 0)) return;
      if ((c.dmg?.tags || []).includes('contract:reflect')) return;
      const n = c.amount * 0.5;
      if (!(n > 0)) return;
      battle.dealDamage(tgt, src, { amount: n, type: 'true', canDodge: false, sourceless: true, tags: ['contract:reflect'] });
    });
  }

  // 嗜血：所有单位造成伤害时回复自身最大生命值 3%（每 0.2 秒一次）
  // 用户 2026-10-15：10% → 3%。
  if (has('contract_n_vampire')) {
    battle.on('damaged', (c) => {
      const src = c && c.source;
      if (!src || !src.alive) return;
      if (!(c.amount > 0)) return;
      if ((c.dmg?.tags || []).includes('contract:vampire')) return;
      const last = src.mem?.vampireAt ?? -Infinity;
      if (battle.time - last < 0.2 - 1e-9) return;
      if (src.mem) src.mem.vampireAt = battle.time;
      const heal = src.s.maxHp * 0.03;
      if (heal > 0 && src.hp < src.s.maxHp) battle.heal(src, src, heal, { id: 'contract:vampire' });
    });
  }

  // 屠戮：场上每有一个单位死亡 → 我方全部 +10% 攻击、敌方全部 +20% 攻击（累加，持续整场）
  // 「所有单位」：死亡的**任何**单位都计数（敌我通吃），加成分发给场上**全部**单位；
  // 死亡之后才出场 / 召唤出来的单位也要带上已累计的层数 —— 否则后出的召唤物吃不到（2026-10-14 修）。
  if (has('contract_n_slaughter')) {
    const st = { ally: 0, enemy: 0 };
    const pctOf = (u) => (u.side === 'ally' ? st.ally : st.enemy);
    const applyTo = (u) => {
      if (!u || !u.alive) return;
      const pct = pctOf(u);
      if (pct > 0) battle.addBuff(u, { key: 'contract:n_slaughter', persist: true, refresh: 'replace', mods: { atkPct: pct } });
    };
    const reapply = () => { for (const u of battle.units) applyTo(u); };
    battle.on('death', () => {
      st.ally += 0.10;
      st.enemy += 0.20;
      reapply();
    });
    // 后来出场 / 部署的也补上当前累计值
    battle.on('deploy', ({ unit: u }) => applyTo(u), { priority: -6 });
    battle.on('enemySpawn', ({ enemy: e }) => applyTo(e), { priority: -6 });
  }

  // 复活：所有单位仅一次被击倒时复活并回复 50% 血量（包括 boss）
  if (has('contract_n_revive')) {
    battle.on('death', (c) => {
      const u = c && c.unit;
      if (!u || u.mem?.reviveContractDone || c.revivedBy) return;
      if (c.reason !== 'killed') return;
      if (u.mem) u.mem.reviveContractDone = true;
      if (typeof reviveNow === 'function') {
        reviveNow(battle, c, 'contract:n_revive');
      }
      battle.after(0, () => {
        if (!u.alive) return;
        const target = u.s.maxHp * 0.5;
        if (u.hp < target) battle.heal(u, u, target - u.hp, { id: 'contract:n_revive', ignoreHealCap: true });
      });
    }, { priority: -900 });
  }
}
