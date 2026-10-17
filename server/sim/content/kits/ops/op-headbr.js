// server/sim/content/kits/ops/op-headbr.js — 凛冬 (char_115_headbr) 乌萨斯学生团 kit: 2★ 冲锋手 (先锋).
// Sources: data/chess.json chess_us_headbr_a/_b (talent bb), PRTS 凛冬; kit contract: ../README.md.
// - T1 冲锋领袖 "编入队伍时，所有【先锋】职业干员的部署费用-1": 在 install 时（以及之后每次部署时兜底）把她玩家
//   所有【先锋】干员的 base.cost 永久 -1（chess_char_1_19-wildmn.js 的 a.base.cost -= d 模式），覆盖开局初始部署。
// - S1 冲锋号令·γ型 "立即获得12点部署费用" (AUTO, cost 12): the generic spec covers it (generic.js dpGain) —
//   not authored here.
// - S2 乌萨斯战吼 (MANUAL, 10 s): every 1 s +1 DP (bb value 10 / interval 1); every PIONEER operator on the field
//   (her player's, including her) ATK / DEF +atk / +def while it runs; every kill by one of those pioneers gives
//   +1 DP (bb cost; the DP is the player's resource, so the killer's owner pays it).
import { num, talentBb, skillRec } from '../shared/tier1.js';

const S2 = 'skchr_headbr_2';
const isPioneer = (a) => !!a && a.kind === 'op' && a.def?.profession === 'PIONEER';

export default {
  char_115_headbr: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const b2 = skillRec(chess, S2)?.bb ?? {};
    const perKill = num(b2.cost, 1);
    return {
      talents: [
        { install(battle, unit) { // 冲锋领袖: 编入队伍时所有【先锋】干员部署费用 -1（永久生效）
          const cut = Math.abs(num(t0.cost, 1));
          if (!(cut > 0)) return;
          const apply = (a) => {
            if (!a || a.kind !== 'op' || a.ownerId !== unit.ownerId || !isPioneer(a) || a.mem.headbrCostCut) return;
            a.base.cost = Math.max(0, (a.base.cost || 0) - cut);
            a.mem.headbrCostCut = cut;
          };
          for (const a of battle.allyUnits) apply(a);
          battle.on('deploy', ({ unit: u }) => apply(u), { owner: unit });
        } },
      ],
      skills: {
        [S2]: {
          kind: 'duration',
          mods: {},
          onStart({ battle, unit, skill }) {
            const give = (a) => battle.addBuff(a, { key: 'skill:headbr:warcry', mods: { atkPct: num(b2.atk), defPct: num(b2.def) }, refresh: 'replace', tags: ['skill'] });
            for (const a of battle.allyUnits) if (a.ownerId === unit.ownerId && isPioneer(a) && a.alive && a.deployed) give(a);
            // pioneers deployed while the shout runs join it
            const poll = battle.every(0.5, () => {
              for (const a of battle.allyUnits) if (a.ownerId === unit.ownerId && isPioneer(a) && a.alive && a.deployed) give(a);
            }, { owner: unit });
            // 逐渐获得部署费用 (value / interval)
            const left = { n: Math.floor(num(b2.value, 0) / Math.max(0.1, num(b2.interval, 1))) };
            const dp = battle.every(Math.max(0.1, num(b2.interval, 1)), () => {
              if (left.n-- <= 0) { dp.cancel(); return; }
              battle.addDp(unit.ownerId, 1);
            }, { owner: unit });
            // 击杀敌人时额外获得 1 点部署费用 (by the buffed pioneers of her player)
            const onKill = (ctx) => {
              if (ctx.killer && ctx.killer.ownerId === unit.ownerId && ctx.killer.kind === 'op'
                && ctx.killer.findBuff('skill:headbr:warcry')) battle.addDp(unit.ownerId, perKill);
            };
            battle.on('kill', onKill, { owner: unit });
            unit.mem.headbrWarcry = { poll, dp, onKill };
          },
          onEnd({ battle, unit }) {
            const st = unit.mem.headbrWarcry;
            unit.mem.headbrWarcry = null;
            if (!st) return;
            if (st.poll) st.poll.cancel();
            if (st.dp) st.dp.cancel();
            for (const a of battle.allyUnits) {
              const b = a.findBuff('skill:headbr:warcry');
              if (b) battle.removeBuff(a, b);
            }
          },
        },
      },
    };
  },
};
