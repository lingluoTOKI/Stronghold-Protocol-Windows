// server/sim/content/kits/babel.js — 巴别塔 expansion 的手写 kit。
//
// 凯尔希 (char_003_kalts)：三个「指令」技能都**同时**作用于自身与她的召唤物 Mon3tr（手动放置的召唤物，
// 本体与两条天赋见 content/babel.js 的 tokenKits）。数值全部来自 data/chess.json 的技能黑板
// （转写在 tools/babel-operators.mjs 的 BABEL_SKILLS，与 PRTS 一致）：
//   S1 指令：结构加固   自身与 Mon3tr 防御力 +120%，且自身获得 40% 物理格挡
//   S2 指令：战术协同   自身攻击速度 +60，Mon3tr 攻击力 +50%，且 Mon3tr 可攻击其阻挡的所有敌人
//   S3 指令：熔毁       Mon3tr 防御力 +140%，攻击力从 +190% 线性降至 +0%，伤害类型变为真实，
//                       并按自身攻击力的 50% / 秒 治疗自身
import { num, skillBbOf, enemiesInGrid, statBuff } from '../shared/tier1.js';
import { normalizeSkill } from '../../../simdata.js';
import { genericSkillSpec } from '../../generic.js';

const MON3TR = 'token_10002_kalts_mon3tr';
const KALTS_S1 = 'skchr_kalts_1', KALTS_S2 = 'skchr_kalts_2', KALTS_S3 = 'skchr_kalts_3';
/** Mon3tr 的阻挡数 —— S2 的「可攻击阻挡的所有敌人」用它作上限。 */
const MON3TR_BLOCK = 3;
/** 指令刷新周期 / 短 buff 的存活时间（Mon3tr 会中途上场、退场，所以持续刷新而不是一次性加）。 */
const PULSE = 0.25, HOLD = 0.4;

const selectedId = (chess, def) => chess?.skill?.skillId ?? def?.skill?.id ?? null;

export function kalts(bb, chess, def) {
  const s1 = skillBbOf(chess, KALTS_S1), s2 = skillBbOf(chess, KALTS_S2), s3 = skillBbOf(chess, KALTS_S3);
  /** 凯尔希场上活着的 Mon3tr。 */
  const live = (b, u) => b.allyUnits.filter((t) => t.kind === 'token' && t.defId === MON3TR && t.ownerUnit === u && t.alive && !t.removed);
  /** 把 `mods` 刷到每一只 Mon3tr 上（短 buff，随指令持续续期）。 */
  const command = (b, u, mods) => {
    if (!mods || !Object.keys(mods).length) return;
    for (const t of live(b, u)) b.addBuff(t, { key: 'kalts:command', duration: HOLD, refresh: 'extend', source: u, mods });
  };
  /** 某条指令对 Mon3tr 的效果；`progress` 是技能进度（0→1，仅熔毁用到）。 */
  const monMods = (mode, progress) => {
    if (mode === KALTS_S1) return { defPct: num(s1['attack@def'], 1.2) };
    if (mode === KALTS_S2) return { atkPct: num(s2['attack@atk'], 0.5), maxTargets: MON3TR_BLOCK };
    if (mode === KALTS_S3) {
      const base = num(s3['attack@atk'], 1.9);
      return { defPct: num(s3['attack@def'], 1.4), atkPct: base * (1 - Math.min(1, Math.max(0, progress))) };
    }
    return null;
  };

  /** 技能 spec：自身 mods + 记录「当前是哪条指令」（install 里的刷新据此工作）。 */
  const spec = (mode) => {
    if (mode === KALTS_S1) return {
      kind: 'duration',
      mods: { defPct: num(s1.def, 1.2), dodgePhys: num(s1.prob, 0.4) },
      onStart({ unit }) { unit.mem.kalts = KALTS_S1; },
      onEnd({ unit }) { if (unit.mem.kalts === KALTS_S1) unit.mem.kalts = null; },
    };
    if (mode === KALTS_S2) return {
      kind: 'duration',
      mods: { aspd: num(s2.attack_speed, 60) },
      onStart({ unit }) { unit.mem.kalts = KALTS_S2; },
      onEnd({ unit }) { if (unit.mem.kalts === KALTS_S2) unit.mem.kalts = null; },
    };
    return {   // 熔毁：攻击力随时间衰减，所以进度由 onTick 累计
      kind: 'duration',
      onStart({ unit }) { unit.mem.kalts = KALTS_S3; unit.mem.kaltsT = 0; },
      onTick({ unit, dt }) { unit.mem.kaltsT = num(unit.mem.kaltsT, 0) + num(dt, 0); },
      onEnd({ unit }) { if (unit.mem.kalts === KALTS_S3) unit.mem.kalts = null; unit.mem.kaltsT = 0; },
    };
  };

  const s3Dur = num(skillBbOf(chess, KALTS_S3).duration, 18);
  const selfHeal = num(s3['attack@hp_ratio'], 0.5);

  return {
    skills: { [KALTS_S1]: spec(KALTS_S1), [KALTS_S2]: spec(KALTS_S2), [KALTS_S3]: spec(KALTS_S3) },
    skill: spec(selectedId(chess, def) === KALTS_S2 || selectedId(chess, def) === KALTS_S3 ? selectedId(chess, def) : KALTS_S1),
    talents: [{ install(b, u) {
      // ---- 把当前「指令」持续刷到 Mon3tr 身上（它可能在中途才部署 / 已被击倒）------------------------
      b.every(PULSE, () => {
        const mode = u.mem.kalts;
        if (!mode || !u.alive) return;
        const progress = mode === KALTS_S3 && s3Dur > 0 ? num(u.mem.kaltsT, 0) / s3Dur : 0;
        command(b, u, monMods(mode, progress));
      }, { owner: u });

      // ---- 熔毁：Mon3tr 的普攻伤害类型变为真实 -------------------------------------------------------
      b.on('beforeAttack', (c) => {
        const t = c.attacker;
        if (!t || t.ownerUnit !== u || t.defId !== MON3TR) return;
        if (u.mem.kalts !== KALTS_S3) return;
        c.profile.dmgType = 'true';
      }, { owner: u });

      // ---- 熔毁：Mon3tr 每秒治疗自身（攻击力 × hp_ratio）--------------------------------------------
      if (selfHeal > 0) b.every(1, () => {
        if (u.mem.kalts !== KALTS_S3 || !u.alive) return;
        for (const t of live(b, u)) if (t.hp < t.s.maxHp) b.heal(u, t, t.s.atk * selfHeal, { regen: true });
      }, { owner: u });
    } }],
  };
}

// =================================================================================================================
// 阿米娅（术士 / 近卫 / 医疗）—— 三条形态都没有别的 kit：非标志技交给通用 kit（content/generic.js），标志技
// （真伤技）在这里手写。
//
// 为什么必须手写：data 的 `true_dmg` 只是「每场战斗只能释放一次」的标记（content/babel.js:241 的升变逻辑），
// 通用 kit **不消费**它 —— generic.js 只在文本写「伤害类型变为法术」时覆盖 per-attack 的 dmgType，真伤一律
// 由各干员自己的 kit 给出（凯尔希·熔毁 / 司霆惊蛰 / 阿米娅 这三条就是）。
//
//   奇美拉     攻击力+160%、生命上限+75%、攻击范围扩大、伤害类型变为真实
//   影霄·绝影  立即寻找前方生命值最低的目标，10 次攻击力 160% 的真实斩击（最后一击系数加倍）
//   慈悲愿景   立刻对攻击范围内所有敌人一次攻击力 170% 的真实伤害攻击并使其减速

/** 标志技 id → 手写 spec 的键。 */
const AMIYA_SIG = Object.freeze({ skchr_amiya_3: 'amiya', skchr_amiya2_2: 'amiya2', skchr_amiya3_2: 'amiya3' });
/** 「使目标减速」的停顿时长（秒）—— 数据的黑板里没有这个键，取通用 kit 对文本型 debuff 的惯例值。 */
const AMIYA_SLOW_SECONDS = 5;
const AMIYA_TAG = 'amiya:true';

/** 奇美拉：增伤 / 加生命上限 + 攻击范围扩大 + 普攻伤害类型变为真实。 */
function amiCaster(sk, bb) {
  return {
    id: sk.id, name: sk.name,
    kind: 'duration', duration: num(sk.duration, 30),
    mods: { atkPct: num(bb.atk, 1.6), hpPct: num(bb.max_hp, 0.75) },
    targeting: { rangeExtend: 1 },            // 「攻击范围扩大」（数据没有范围网格，按向前 +1 处理）
    attack: { dmgType: 'true' },              // 「伤害类型变为真实」
  };
}

/** 影霄·绝影：立刻锁定攻击范围内生命值最低的敌人，打 `times` 段 160% 真伤，最后一击系数加倍（3.2）。 */
function amiGuard(sk, bb) {
  const times = Math.max(1, Math.floor(num(bb.times, 10)));
  const scale = num(bb.atk_scale, 1.6);
  const lastScale = num(bb.atk_scale_2, scale * 2);
  return {
    id: sk.id, name: sk.name,
    kind: 'duration', duration: num(sk.duration, 31),
    onStart({ battle, unit }) {
      const tgt = enemiesInGrid(battle, unit, null, { n: 1, priority: 'lowestHp' })[0];
      if (!tgt) return;
      const hit = (s) => { if (tgt.alive) battle.dealDamage(unit, tgt, { amount: unit.s.atk * s, type: 'true', isSkill: true, tags: ['skill', AMIYA_TAG] }); };
      for (let i = 0; i < times - 1; i++) hit(scale);
      hit(lastScale);
    },
  };
}

/** 慈悲愿景：立刻对攻击范围内所有敌人打一次 170% 真伤，并使其减速（停顿）。 */
function amiMedic(sk, bb) {
  const scale = num(bb.atk_scale, 1.7);
  return {
    id: sk.id, name: sk.name,
    kind: 'duration', duration: num(sk.duration, 32),
    mods: { atkPct: num(bb.atk, 0.25) },
    onStart({ battle, unit }) {
      for (const e of enemiesInGrid(battle, unit, null, { n: 0 })) {
        battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'true', isSkill: true, tags: ['skill', AMIYA_TAG] });
        if (e.alive) battle.applyStatus(e, 'sluggish', { duration: AMIYA_SLOW_SECONDS, source: unit });
      }
    },
  };
}

const AMIYA_SIG_SPECS = { amiya: amiCaster, amiya2: amiGuard, amiya3: amiMedic };

/**
 * 阿米娅三条形态共用的 kit：`skills` 里每个技能都由通用 kit 生成，标志技换成上面手写的 spec。
 * content/index.js 的 selectSkillSpec 会按当前选择的技能 id 从 `skills` 取用（没选中的技能也保留）。
 */
export function amiyaKit(bb, chess, def) {
  void bb;
  const list = Array.isArray(chess && chess.skills) ? chess.skills : [];
  const skills = {};
  for (const raw of list) {
    const sk = normalizeSkill({ ...chess, skill: raw });
    if (!sk) continue;
    const make = AMIYA_SIG_SPECS[AMIYA_SIG[sk.id]];
    skills[sk.id] = make ? make(sk, sk.bb ?? {}) : (genericSkillSpec(sk, sk.bb ?? {}, def) ?? { kind: 'passive' });
  }
  const picked = skills[def && def.skill && def.skill.id] ?? skills[chess && chess.skill && chess.skill.skillId]
    ?? Object.values(skills)[0] ?? null;
  // 天赋（本作把三形态的天赋简化成单条属性加成，黑板 key 是自定义驼峰名）：
  //   心胜于物 spRecovery+0.2 / 影刃 atkPct+4% / 慈悲的施行 healPct+6%。
  // 只有职业技能 spec 到这里被覆盖，天赋必须自己挂 —— 原实现返回 `talents: []` 且 `void bb`，三个天赋全不生效。
  const t0 = (chess?.talents ?? []).find((t) => t && t.index === 0)?.bb ?? {};
  const mods = {};
  if (num(t0.atkPct)) mods.atkPct = num(t0.atkPct);
  if (num(t0.healPct)) mods.healingDealtMul = 1 + num(t0.healPct);
  if (num(t0.spRecovery)) mods.spRecoveryFlat = num(t0.spRecovery);
  const talents = Object.keys(mods).length
    ? [{ install(battle, unit) { statBuff(battle, unit, 'talent:amiya', mods); } }]
    : [];
  return { skills, skill: picked, talents };
}

export const KITS = {
  char_003_kalts: kalts, chess_babel_kalts_a: kalts, chess_babel_kalts_b: kalts,
  chess_babel_amiya_a: amiyaKit, chess_babel_amiya_b: amiyaKit,
  chess_babel_amiya2_a: amiyaKit, chess_babel_amiya2_b: amiyaKit,
  chess_babel_amiya3_a: amiyaKit, chess_babel_amiya3_b: amiyaKit,
};
export default KITS;
