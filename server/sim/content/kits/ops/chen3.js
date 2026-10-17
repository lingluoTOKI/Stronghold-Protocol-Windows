// 赤刃明霄陈 (Ch'en the Dawnstreak) — faction kit.
//
// 上游 [炎] 层数每 3 层 = 攻击力 +1%（精锐翻倍），挂在 install() 末。其它一切（技能 1/2/3、天赋 1/2、
// 模组未阻挡 +8、S3 wave walker + 范围扩大 + addTriggerRange + 弱点击退、S2 10 次斩击 + 阻回 +
// 移动、闪避优先级 -1000、留闪）都委托给 op-chen3.js 的同一份实现 —— 从龙门/商店（chess_chen3_a）放下
// 与从自选（char_1050_chen3）放下表现完全一致（用户 2026-10-14：之前 faction 版是简化版，
// 缺范围扩大 + 龙剑气 + 没有召唤物）。
import { up } from '../shared/tier1.js';
import { CHEN_CHAR_ID } from '../../../../../shared/chen3.js';
import opChen3 from './op-chen3.js';

const YAN_BOND = 'yanShip';
/** 完整版 kit 来自 op-chen3.js。原 faction 版是「S3 8 tile 直线 + rhinePulse」简化版。 */
const fullKit = opChen3[CHEN_CHAR_ID];

export function chen3(bb, chess, def) {
  const kit = fullKit(bb, chess, def);
  // 原作 [炎] 层数加成：每 3 层 +1% 攻击（精锐翻倍）
  const origInstall = kit.install;
  kit.install = function installChen3Yan(battle, unit) {
    if (typeof origInstall === 'function') origInstall.call(this, battle, unit);
    const refresh = () => {
      if (!up(unit)) return;
      const per = 1 + (unit.def?.golden || unit.def?.raw?.isGolden ? 1 : 0);
      const steps = Math.floor((Math.max(0, Number(battle.getPlayer(unit.ownerId)?.bonds?.[YAN_BOND]?.layers) || 0)) / 3);
      const pct = (steps * per) / 100;
      const old = unit.findBuff('chen3:yan');
      if (steps <= 0) { if (old) battle.removeBuff(unit, old); return; }
      if (old && old.mods?.atkPct === pct) return;
      battle.addBuff(unit, { key: 'chen3:yan', persist: true, allowDead: true, mods: { atkPct: pct } });
    };
    battle.on('battleStart', refresh);
    battle.on('deploy', ({ unit: u }) => { if (u === unit) refresh(); }, { owner: unit });
    battle.on('layerGain', ({ bondId }) => { if (bondId === YAN_BOND) battle.after(0, refresh); }, { owner: unit });
    battle.on('tick', refresh, { owner: unit, priority: 90 });
  };
  return kit;
}

/** baseChessId → kit (content/index.js merges these into KITS; both grades share one function). */
export const CHEN3_KITS = Object.freeze({ chess_chen3_a: chen3, chess_chen3_b: chen3 });
export default CHEN3_KITS;
