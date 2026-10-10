// shared/openingBans.js — 改编版独有：开局禁用（BAN）数量随「开局玩家数」缩放。
//
// 基础值与官服 data/config.json 的 `bans` 完全一致（FUNNY 0/1，NORMAL/HARD/ABYSS 3/4，TRAINING 0/0）；
// 本文件只在官服基础值上做减免：开局坐满五人时少禁一个核心阵营、六人少禁两个，最少为 0。
// addon（支线阵营）禁用数与教鞭引导不受人数影响。这是纯函数视图，运行时不会改写构建数据。

export const OPENING_BANS = Object.freeze({
  FUNNY: Object.freeze({ core: 0, addon: 1 }),
  NORMAL: Object.freeze({ core: 3, addon: 4 }),
  HARD: Object.freeze({ core: 3, addon: 4 }),
  ABYSS: Object.freeze({ core: 3, addon: 4 }),
  TRAINING: Object.freeze({ core: 0, addon: 0 }),
});

/**
 * 某难度在指定开局人数下实际生效的开局禁用数量（人机座位同等计入）。
 * @param {string} difficulty 难度键（FUNNY/NORMAL/HARD/ABYSS/TRAINING）
 * @param {number} [startingPlayerCount=1] 对局开始时占用的座位数（不是仍存活的人数）
 * @param {object} [configuredBans=OPENING_BANS] config.bans，缺省项回落到官服基础值
 * @returns {{ core: number, addon: number }}
 */
export function openingBanCounts(difficulty, startingPlayerCount = 1, configuredBans = OPENING_BANS) {
  const defaults = Object.hasOwn(OPENING_BANS, difficulty) ? OPENING_BANS[difficulty] : { core: 0, addon: 0 };
  const configured = configuredBans && typeof configuredBans === 'object' && Object.hasOwn(configuredBans, difficulty)
    ? configuredBans[difficulty] : null;
  const core = Number.isInteger(configured?.core) && configured.core >= 0 ? configured.core : defaults.core;
  const addon = Number.isInteger(configured?.addon) && configured.addon >= 0 ? configured.addon : defaults.addon;
  // 五人少禁一个核心、六人少禁两个；训练模式不减免；最终不低于 0。
  const coreReduction = difficulty === 'TRAINING' ? 0 : startingPlayerCount === 6 ? 2 : startingPlayerCount === 5 ? 1 : 0;
  return { core: Math.max(0, core - coreReduction), addon };
}
