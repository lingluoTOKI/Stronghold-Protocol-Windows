// server/sim/content/kits/ops/chess_char_3_myrtle.js — 桃金娘 (char_151_myrtle) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.
//
// 特质（用户 2026-10-15 原文）：
//   「<战斗中>开启技能使已激活的先锋层数+1且身前一格干员攻击力+10%，阻挡数+1」
//   —— 精锐只翻倍这条特质里的 +10%（+20%），层数 +1 与阻挡数 +1 不翻倍。
// 天赋「浮光跃金」（wiki）：在场时，所有【先锋】干员每秒回复 25 点生命。
// 技能（wiki 7 级）：S1 支援号令·β型 8 秒内每 0.57 秒回 1 点、共 14 点；
//   S2 治愈之翼 16 秒内共回 16 点，并每秒治疗 x-4 范围一名友方攻击力 50% 的生命。

import { num, talentBb, alliesInGridOf, up } from '../shared/tier1.js';
import * as S from '../../support/index.js';

const VANGUARD = 'vanguardShip';

/**
 * 正前方一格的**其他**我方干员（与 garrisons/battle.js 的 isFrontOf 同口径）。
 *
 * ⚠ `support/index.js` 没有 `inFrontOf` / `up`：几何只有 `frontTile(u, k)`（tile 对，非布尔判定），
 * 而 `up` 在 `shared/tier1.js`。早先这里写成 `S.inFrontOf` / `S.up`，两者都是 undefined ——
 * 前者让这个函数永远抛 TypeError（身前一格的 buff 一次都没挂上），后者让天赋与技能里的每个
 * tick 回调都抛异常（被守卫处理器吞掉，表现为「桃金娘什么都不做」）。2026-10-15 修正。
 */
function frontAlly(battle, unit) {
  if (!S.onField(unit)) return null;
  const [fr, fc] = S.frontTile(unit);
  for (const a of battle.allyUnits) {
    if (!S.isOp(a) || a === unit || a.ownerId !== unit.ownerId) continue;
    if (!S.onField(a)) continue;
    if (a.tileR === fr && a.tileC === fc) return a;
  }
  return null;
}

/**
 * 本干员 MYRTLE_FRONTIER 驻防里的数值（`bb.layers` / `bb.atk` / `bb.block`）。
 * 精锐 `_b` 与 `_a` 共用同一个 kit 工厂，只有驻防的 bb 不同 —— 所以每次都要按 `unit.def.raw.garrisonIds` 现读。
 * 读不到时退回普通档的文案值（+1 / +10% / +1），至少不静默变成 0。
 */
function traitNumbers(unit) {
  const FALLBACK = { layers: 1, atk: 0.10, block: 1 };
  const list = unit?.def?.raw?.garrisonIds ?? unit?.def?.garrisonIds;
  if (!Array.isArray(list)) return FALLBACK;
  for (const gid of list) {
    const g = S.garrisonRecord(gid);
    if (!g || g.effectType !== 'MYRTLE_FRONTIER') continue;
    const gb = g.bb || {};
    return {
      layers: Math.trunc(num(gb.layers, FALLBACK.layers)),
      atk: num(gb.atk, FALLBACK.atk),
      block: Math.trunc(num(gb.block, FALLBACK.block)),
    };
  }
  return FALLBACK;
}

/** 「开启技能使已激活的【先锋】层数 +N」+ 身前一格干员 攻击力 / 阻挡数 buff。 */
function installTrait(battle, unit, bb) {
  const layers = Math.trunc(num(bb.layers, 1));
  const atkPct = num(bb.atk, 0.10);
  const block = Math.trunc(num(bb.block, 1));

  battle.on('skillStart', (ctx) => {
    if (ctx.unit !== unit) return;
    // ① 已激活的【先锋】层数 +N
    if (layers > 0 && S.bondActive(battle, unit.ownerId, VANGUARD)) {
      S.gainLayers(battle, { playerId: unit.ownerId, bonds: [VANGUARD], n: layers, requireActive: true, source: unit, reason: 'garrison' });
    }
    // ② 身前一格干员 攻击力 +X% / 阻挡数 +1（技能期间）
    const key = `gar:myrtleFront:${unit.id}`;
    const target = frontAlly(battle, unit);
    if (!target) return;
    const mods = {};
    if (atkPct > 0) mods.atkPct = atkPct;
    if (block > 0) mods.blockCnt = block;
    battle.addBuff(target, { key, persist: true, allowDead: true, visible: true, tags: ['trait'], mods });
  }, { owner: unit });
  // 技能结束 / 撤退时撤掉身前一格的 buff
  battle.on('skillEnd', (ctx) => { if (ctx.unit !== unit) return; removeFrontBuff(battle, unit); }, { owner: unit });
  battle.on('retreat', (ctx) => { if (ctx.unit !== unit) return; removeFrontBuff(battle, unit); }, { owner: unit });
}

function removeFrontBuff(battle, unit) {
  const key = `gar:myrtleFront:${unit.id}`;
  for (const a of battle.allyUnits) {
    if (!S.isOp(a)) continue;
    const old = a.findBuff(key);
    if (old) battle.removeBuff(a, old);
  }
}

/**
 * 「支援号令·β型」/「治愈之翼」的回费：wiki 7 级 —— S1 8 秒内**每 0.57 秒回 1 点**、共 14 点；S2 16 秒内每秒 1 点、共 16 点。
 * 实现按**时间比例**给（rate = value / duration 点每秒），tick 粒度变化也不丢点：累计 dt × rate，够了就发。
 */
function installDpRecovery(battle, unit, bb, durationSec) {
  const value = Math.max(0, num(bb.value, 0));
  const duration = Math.max(0.01, num(bb.duration, durationSec) || durationSec || 1);
  if (!(value > 0)) return;
  const rate = value / duration;                 // 点 / 秒
  let left = value;
  battle.on('tick', (ctx) => {
    if (!up(unit) || !unit.skill?.active) return;
    const dt = ctx.dt ?? 0;
    if (left <= 0 || !(dt > 0)) return;
    const gain = Math.min(left, rate * dt);
    left -= gain;
    battle.addDp(unit.ownerId, gain);
    battle.fx('dp', { x: unit.x, y: unit.y, n: Math.round(gain), id: unit.id });
  }, { owner: unit });
}

/** 两个技能的 id（`data/chess.json` chess_char_3_myrtle_*）。 */
const S1 = 'skchr_myrtle_1';
const S2 = 'skchr_myrtle_2';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  chess_char_3_myrtle_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const selectedId = def?.skill?.skillId || def?.skills?.[0]?.skillId || null;

    // 引擎只读 kit 的 `skills[选中技能]` 或 `skill`（server/sim/content/index.js selectSkillSpec）；
    // 所选技能的 bb 由 bb 传入 —— 两种技能共用「回费」，S2 多一个治疗。
    // `trigger: 'SP_FULL'`（用户 2026-10-16「桃金娘，琴柳改成技能好了就自动开」）：战斗是纯自动的、客户端没有开技能的操作，
    // 而尖兵的 DEFAULT 规则要求「即将攻击时范围内有目标」才开 —— 回费技能本就不该等敌人走进射程，所以 SP 满即开。
    // `attack.noAttack`：两个技能都写了「停止攻击」（与 generic 从 desc 推出的结果一致）。
    const spec = {
      kind: 'duration',
      trigger: 'SP_FULL',
      attack: { noAttack: true },
      onStart({ battle, unit }) {
        installDpRecovery(battle, unit, bb, bb.duration);
        // S2 治愈之翼：每秒治疗 x-4 范围内血量比例最低的一名友方（wiki 7 级 50%）。
        const scale = num(bb['attack@heal_scale'], 0);
        if (!(scale > 0)) return;
        const grid = def?.skills?.find?.((s) => s?.skillId === selectedId)?.rangeGrid ?? def?.skill?.rangeGrid;
        battle.on('tick', (ctx) => {
          if (!up(unit) || !unit.skill?.active) return;
          if ((ctx.dt ?? 0) < 1) return;
          const allies = alliesInGridOf(battle, unit, grid)
            .filter((a) => a.alive && a !== unit && a.hp < a.s.maxHp);
          if (!allies.length) return;
          let target = allies[0];
          for (const a of allies) if (a.hpRatio < target.hpRatio) target = a;
          const amount = unit.s.atk * scale;
          target.hp = Math.min(target.s.maxHp, target.hp + amount);
          battle.fx('heal', { x: target.x, y: target.y, n: Math.round(amount), id: unit.id });
        }, { owner: unit });
      },
    };

    return {
      // ---- 特质：MYRTLE_FRONTIER 的数值取自**本干员自己那条驻防**（精锐 `_b` 的 atk=0.20），
      //      不能写死 `_a` 的值 —— `kitOf` 会把 `_b` 回落成 `_a` 的 kit，写死就等于精锐只有 +10%。
      install(battle, unit) {
        installTrait(battle, unit, traitNumbers(unit));
        void bb;
      },

      // ⚠ 两个键都要写：**桃金娘的 chess 记录没有 `skills[].isDefault`、`skill` 里也没有 `index`**，
      // 于是 `selectSkillSpec` 的 `skillIsDefault` 分支判不出来（`loadout.skillIndex` 恒为 0 而
      // `rec.skill.index` 缺失 ⇒ skillIsDefault=false）—— 只写 `skill` 会被换成 generic spec
      // （generic 的回费要求 desc 命中「获得N点部署费用」，桃金娘写的是「回复总共14点」⇒ 一个字都不回、
      //  治疗也没有，2026-10-16 修）；只写 `skills` 则在 `skillIsDefault` 为 true 时拿到 undefined。
      // 两者同指一个 spec：`skills[选中技能]` 是主路径，`skill` 是兜底。
      skill: spec,
      skills: { [S1]: spec, [S2]: spec },

      // ---- 天赋「浮光跃金」：在场时所有【先锋】干员每秒回复 25 点生命
      talents: [{
        install(battle, unit) {
          const regen = num(t.hp_regen, 0);
          if (!(regen > 0)) return;
          battle.on('tick', (ctx) => {
            if (!up(unit)) return;
            const dt = ctx.dt ?? 0;
            for (const a of battle.allyUnits) {
              if (!S.isOp(a) || !up(a) || a.ownerId !== unit.ownerId) continue;
              if (!S.unitBonds(a).includes(VANGUARD)) continue;
              if (a.hp >= a.s.maxHp) continue;
              a.hp = Math.min(a.s.maxHp, a.hp + regen * dt);
            }
          }, { owner: unit });
        },
      }],
    };
  },
};