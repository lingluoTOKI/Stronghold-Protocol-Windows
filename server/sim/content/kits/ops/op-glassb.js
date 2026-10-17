// server/sim/content/kits/ops/op-glassb.js — 真理 (char_195_glassb) 乌萨斯学生团 kit: 3★ 削弱者 (辅助).
// Sources: data/chess.json chess_us_glassb_a/_b, PRTS 真理; kit contract: ../README.md.
// - Trait "攻击使目标停顿" (trait bb sluggish 0.8): her hits slow (停顿) for 0.8 s — the trait onHitStatus shape
//   of chess_char_1_11-skgoat.js (sluggish = −80 % move speed, sim/buffs.js) [ASSUMED: the bb is the slow duration,
//   the official trait text is not in the data].
// - T 探知者 "防御力-35%，但攻击速度+21（+3）": unconditional, but genericTalents' stat clause cannot read the
//   negative / 但 phrasing — authored here as a persistent buff.
// - S1 专心致志 "攻击间隔较大幅度缩短" (bb base_attack_time −0.9): batPct −0.9 (the generic mapping, units.js
//   interval = bat × (1 + ΣbatPct) × 100/aspd, floored at −0.9).
// - S2 文学风暴 "攻击力+25%，攻击范围扩大，额外攻击两个目标": ATK +atk, rangeExtend 1 (babel.js's 「攻击范围扩大」
//   shape), maxTargets 3.
import { num, talentBb, traitBb, skillRec, statBuff } from '../shared/tier1.js';

const S1 = 'skchr_glassb_1';
const S2 = 'skchr_glassb_2';

export default {
  char_195_glassb: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const b1 = skillRec(chess, S1)?.bb ?? {};
    const b2 = skillRec(chess, S2)?.bb ?? {};
    return {
      trait: { onHitStatus: { key: 'sluggish', duration: num(traitBb(chess).sluggish, 0.8) } },
      talents: [
        { install(battle, unit) { // 探知者: def −35 %, aspd +21 (persist)
          const def = -Math.abs(num(t0.def, 0.35));
          statBuff(battle, unit, 'talent:glassb:knower', { defPct: def, aspd: num(t0.attack_speed, 21) });
        } },
      ],
      skills: {
        [S1]: { kind: 'duration', mods: { batPct: Math.max(-0.9, num(b1.base_attack_time, -0.9)) } },
        [S2]: {
          kind: 'duration',
          mods: { atkPct: num(b2.atk) },
          targeting: { maxTargets: Math.max(1, Math.floor(num(b2['attack@max_target'], 3))), rangeExtend: 1 },
        },
      },
    };
  },
};
