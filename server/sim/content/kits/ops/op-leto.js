// server/sim/content/kits/ops/op-leto.js — 烈夏 (char_194_leto) 乌萨斯学生团 kit: 2★ 收割者 (近卫).
// Sources: data/chess.json chess_us_leto_a/_b, PRTS 烈夏; kit contract: ../README.md.
// - Trait "攻击造成相当于攻击力80%的伤害" (trait bb atk_scale 0.8, desc empty in data): every main attack hit is
//   dealt at 80% ATK (chess_char_1_09-caper.js's trait-scale pattern) [ASSUMED: the bb is her whole attack scale —
//   the official trait text is not in the data].
// - T 快点快点！ "开启技能时，【乌萨斯学生自治团】干员攻击速度+24（+3），持续至技能结束": while HER skill runs,
//   every 【乌萨斯学生自治团】 operator on the field gets +aspd (a fresh buff per cast, removed at skillEnd).
// - S1 迅捷打击·γ型 "攻击力+27%，攻击速度+25": the generic spec covers it — not authored here.
// - S2 一呼百应 (MANUAL, 25 s): at the cast, every 【乌萨斯学生自治团】 operator of her player whose skill is
//   READY (SP full, not running) casts it at once (unit.skill.activate — chess_char_4_04-ines.js's pattern);
//   she herself ATK +atk and attacks attack@max_target (2) targets. "远程攻击不再降低攻击力" has no engine-side
//   ranged penalty in this sim — nothing to lift [ASSUMED].
import { num, talentBb, traitBb, skillRec, statBuff, isMainHit } from '../shared/tier1.js';

const S2 = 'skchr_leto_2';
/** 【乌萨斯学生自治团】 charIds (kits/ops/op-poca.js STUDENTS). */
const STUDENTS = new Set(['char_196_sunbr', 'char_115_headbr', 'char_194_leto', 'char_405_absin', 'char_195_glassb',
  'char_197_poca', 'char_1051_headb2']);
const isStudent = (a) => !!a && a.kind === 'op' && STUDENTS.has(a.def?.charId);

export default {
  char_194_leto: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const tb = traitBb(chess);
    const scale = num(tb.atk_scale, 1);
    const aspd = num(t0.attack_speed, 24);
    const b2 = skillRec(chess, S2)?.bb ?? {};
    return {
      install(battle, unit) { // trait 攻击倍率 0.8: every main attack hit at 80% ATK
        if (scale !== 1) {
          battle.on('hit', ({ source, dmg }) => {
            if (source === unit && isMainHit(dmg)) dmg.amount *= scale;
          }, { owner: unit });
        }
      },
      talents: [
        { install(battle, unit) { // 快点快点！: while her skill runs, field students +aspd
          const give = () => {
            for (const a of battle.allyUnits) {
              if (a.ownerId !== unit.ownerId || !isStudent(a) || !a.alive) continue;
              statBuff(battle, a, 'talent:leto:hurry', { aspd });
            }
          };
          const take = () => {
            for (const a of battle.allyUnits) {
              const b = a.findBuff('talent:leto:hurry');
              if (b && b.source === unit) battle.removeBuff(a, b);
            }
          };
          battle.on('skillStart', (c) => { if (c.unit === unit) give(); }, { owner: unit });
          battle.on('skillEnd', (c) => { if (c.unit === unit) take(); }, { owner: unit });
        } },
      ],
      skills: {
        [S2]: {
          kind: 'duration',
          mods: { atkPct: num(b2.atk) },
          targeting: { maxTargets: Math.max(1, Math.floor(num(b2['attack@max_target'], 2))) },
          onStart({ battle, unit }) {
            for (const a of battle.allyUnits) {
              if (a === unit || a.ownerId !== unit.ownerId || !isStudent(a)) continue;
              const sk = a.skill;
              if (!sk || sk.active || !sk.isTimed && sk.kind === 'passive') continue;
              if (Number.isFinite(sk.spCost) && sk.sp >= sk.spCost) sk.activate('LETO_RALLY');
            }
          },
        },
      },
    };
  },
};
