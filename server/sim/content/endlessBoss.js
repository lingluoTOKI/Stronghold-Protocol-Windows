// server/sim/content/endlessBoss.js — 「无限模拟」R15+ 额外携带的 R9 悬赏首领，击败 ⇒ 所有已激活盟约层数 +10。
//
// 用户 2026-10-17 口径：「只有无限模拟 r15 回合后出的 9 回合悬赏怪击败会叠层，其余所有模式 r9 回合选择的
// boss 悬赏还是给资金」。
//
// 为什么单独一个模块、而不是改 enemyeffect_b_*：
//   那张卡（effects.json `enemyeffect_b_1` 等）的 buffs 是 `add_enemy_kill_gain_coin`（击倒给资金），
//   **R9 悬赏在所有模式都走它**。改它 = 让所有模式的 R9 BOSS 悬赏变成叠层，正是用户明确不要的。
//   所以这里只认 waves.js buildEndlessWave 写进那一只 BOSS spawn `mods` 的专属键
//   （shared/constants.js ENDLESS_BOSS_BOND_KEY），其它任何来源的敌人身上都没有这个键 ⇒ 一点不受影响。
//
// 叠层口径：`requireActive: true` —— 只加**已激活**的盟约（与「已激活盟约层数 +N」的既有写法一致）。

import { ENDLESS_BOSS_BOND_KEY, ENDLESS_BOSS_BOND_GAIN } from '../../../shared/constants.js';
import { gainLayers, num, activeBondIds } from './support/index.js';

/**
 * 本场击败「R15+ 额外携带的 R9 悬赏首领」⇒ 所有已激活盟约层数 +N。
 *
 * 判定只看那只敌人自己身上的 `mods[ENDLESS_BOSS_BOND_KEY]`（waves.js buildEndlessWave 写进去的），
 * 所以普通出怪 / R9 本体悬赏 / 其它模式都不可能命中。
 */
export function install(battle) {
  battle.on('kill', ({ killer, victim }) => {
    if (!victim || victim.side !== 'enemy') return;
    const mods = victim.mods;
    if (!mods || typeof mods !== 'object') return;
    const gain = num(mods[ENDLESS_BOSS_BOND_KEY], 0);
    if (!(gain > 0)) return;

    // 归属玩家：击杀者优先；没有击杀者（被地图 / 流失打死）时，单人局归唯一玩家
    let pid = killer && killer.ownerId != null ? killer.ownerId : null;
    if (pid == null) {
      const only = battle.players && battle.players.length === 1 ? battle.players[0] : null;
      pid = only ? only.playerId : null;
    }
    if (pid == null) return;

    const bonds = activeBondIds(battle, pid);
    if (!bonds || !bonds.length) return;
    gainLayers(battle, {
      playerId: pid,
      bonds: bonds.slice(),
      n: gain || ENDLESS_BOSS_BOND_GAIN,
      requireActive: true,
      source: killer ?? null,
      reason: 'endlessBoss',
    });
  });
}
