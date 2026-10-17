// server/sim/content/kits/ops/chess_char_3_yuki.js — 白雪 (char_118_yuki) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.
//
// 天赋「重型手里剑」（wiki 精英2）：**攻击间隔略微增大(+0.2)**，但攻击力 +20%。
//   ⚠ 这条天赋原先是空的 `install(){}`，从来没生效过 —— 攻击力 +20% 与攻击间隔增大一个都没加上。
//   数值口径：`bb.base_attack_time` 在仓库里是**绝对秒数增量**（tier1.js 的 batMod、tier4.js / tier5.js 的注释），
//   wiki 写 +0.2 秒 ⇒ 数据应为 0.2（原为 0.5，且 generic.js 会把 base_attack_time 当成比例用，两种读法都不对）。
//   这里用 batMod 按本干员的基础攻击间隔把秒数换算成 batPct。
// 模组：本作不实现白雪模组（uniequip_002_yuki「手里剑」的 Y 模组给第二天赋「风旭」）。

import { num, skillBbOf, enemiesInGrid, talentBb, batMod, statBuff } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1 阶 白雪（aoesniper / 群射狙击）
  //   S1 敌飙：攻击范围 +`ability_range_forward_extend` 格（官方 2）。范围由引擎的 rangeKeys 重算，无需 buff。
  //   S2 凝武：攻击变为投掷回旋的大飞镖 —— 命中目标移动速度 -`attack@move_speed`（官方 0.35 = 35%），
  //       并每秒受到 `attack@atk_scale × 攻击力` 的法术伤害（官方 0.8 = 80%），持续 `attack@duration` 秒。
  //       技能型（duration）buff：mods 里用 aspd 保持普通攻击节奏；减速走 status，伤害走 tick 钩子。
  //   天赋 / 模组：见文件头的说明。
  chess_char_3_yuki_a: (bb, chess, def) => ({
    skills: {
      'skchr_yuki_1': {
        kind: 'duration',
        mods: { rangeExtend: num(skillBbOf(chess, 'skchr_yuki_1').ability_range_forward_extend, 2) },
      },
      'skchr_yuki_2': {
        kind: 'duration',
        onStart({ battle, unit }) {
          const b = skillBbOf(chess, 'skchr_yuki_2');
          const slow = num(b['attack@move_speed'], 0);          // 负数（官方 -0.35）
          const scale = num(b['attack@atk_scale'], 0);
          const dur = num(b['attack@duration'], 1);
          const key = 'yuki:condense';
          if (!(slow < 0)) return;
          // 每命中一次给目标挂 moveSpeed 减速；命中判定走 onHitOn（仅自己的攻击伤害）。
          const attach = (target) => {
            if (!target || target.side !== 'enemy') return;
            battle.addBuff(target, { key, duration: 2, allowDead: false, mods: { moveSpeed: 1 + slow } });
          };
          battle.on('hit', (c) => {
            if (c?.dmg?.source !== unit || !c.dmg.isSkill) return;
            attach(c.target ?? c.dmg.target);
          }, { owner: unit });
          if (!(scale > 0)) return;
          // 每秒一次灼烧：官方 bb.attack@duration = 1（秒）
          battle.on('tick', (ctx) => {
            if (!unit.alive || !unit.deployed || !unit.skill?.active) return;
            if ((ctx.dt ?? 0) < dur) return;
            const foes = enemiesInGrid(battle, unit, def?.skills?.find?.((s) => s?.skillId === 'skchr_yuki_2')?.rangeGrid
              ?? def?.skill?.rangeGrid);
            for (const e of foes) {
              if (!e.alive) continue;
              battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, tags: ['skill'] });
            }
          }, { owner: unit });
        },
      },
    },
    skill: { kind: 'duration' },
    // 天赋「重型手里剑」：攻击力 +atk（20%），攻击间隔 +base_attack_time 秒（0.2）—— batMod 按本干员
    // 的基础攻击间隔换算成 batPct。一次性的常驻 buff（非技能期），精英化前后同值。
    talents: [{
      install(battle, unit) {
        const t = talentBb(chess, 0);
        const mods = {};
        const atk = num(t.atk, 0);
        if (atk > 0) mods.atkPct = atk;
        const bat = num(t.base_attack_time, 0);
        if (bat > 0) mods.batPct = batMod(bat, chess);
        if (!Object.keys(mods).length) return;
        statBuff(battle, unit, 'yuki:heavyShuriken', mods);
      },
    }],
  }),
};