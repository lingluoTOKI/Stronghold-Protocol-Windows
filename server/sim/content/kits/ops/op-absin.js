// server/sim/content/kits/ops/op-absin.js — 苦艾 (char_405_absin) 乌萨斯学生团 kit: 4★ 扩散术师 (术师).
// Sources: data/chess.json chess_us_absin_a/_b, PRTS 苦艾; kit contract: ../README.md.
// - T 执法者 "攻击生命值低于40%的敌人伤害提高30%（+6%）": every attack hit on an enemy below hp_ratio deals
//   ×damage_scale (chess_char_1_05-vigna.js's shape).
// - S1 执法模式 (AUTO, cost 84, 持续时间无限): ATK +atk, and she targets the lowest HP-ratio enemy first
//   (targeting.priority 'lowestHpRatio'). The skill runs forever once cast: spec kind 'duration' + onStart
//   skill.extend(1e9) (the Skill duration comes from the data's 0 — skills.js clamps to 0.01 s — so the cast
//   extends itself to effectively infinite).
// - S2 终结连射 (MANUAL, 26 s): her attacks become attack@times (4) shots at attack@atk_scale (0.65) × ATK
//   (chess_char_3_01-angel.js's attack { atkScale, hits }); "不再选择生命值高于50%的敌人" — the sim's target
//   pipeline has no hard exclude, so she aims at the lowest HP-ratio enemy first [ASSUMED: a priority
//   approximation of the 半血以下 harvest wording].
import { num, talentBb, skillRec } from '../shared/tier1.js';

const S1 = 'skchr_absin_1';
const S2 = 'skchr_absin_2';

export default {
  char_405_absin: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const b1 = skillRec(chess, S1)?.bb ?? {};
    const b2 = skillRec(chess, S2)?.bb ?? {};
    return {
      talents: [
        { install(battle, unit) { // 执法者: attacks on enemies below hp_ratio deal more
          const ratio = num(t0.hp_ratio, 0.4);
          const scale = num(t0.damage_scale, 1);
          if (scale !== 1) {
            battle.on('hit', ({ source, target, dmg }) => {
              if (source === unit && dmg.isAttack && target && target.hpRatio < ratio) dmg.amount *= scale;
            }, { owner: unit });
          }
        } },
      ],
      skills: {
        [S1]: {
          kind: 'duration',
          mods: { atkPct: num(b1.atk) },
          targeting: { priority: 'lowestHpRatio' },
          onStart({ skill }) { skill.extend(1e9); }, // 持续时间无限
        },
        [S2]: {
          kind: 'duration',
          attack: { atkScale: num(b2['attack@atk_scale'], 0.65), hits: Math.max(1, Math.floor(num(b2['attack@times'], 4))) },
          targeting: { priority: 'lowestHpRatio' },
        },
      },
    };
  },
};
