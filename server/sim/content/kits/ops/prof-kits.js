// server/sim/content/kits/ops/prof-kits.js — 契约档新增干员（附加职业盟约 / 罗德岛）的 kit 注册表。
//
// 本作的 8 名 4★/5★ 新干员（坚雷 / 暴行 / 夜烟 / 红云 / 爱丽丝 / 末药 / 但书 / 灰喉）**不带 kit 文件**：
// 和上一批（拜松 / 空 / 暗索 / 阿消 / 食铁兽 / 吽）一样走通用 kit（content/generic.js），
// 它们的差异全部由「特质 = 驻防记录」（data/garrisons.json）承载。
//
// 逻各斯是例外：本作已经有一份完整的「自选」实现（op-logos.js，按 charId 注册给 6★ 自选位），
// 契约档这只 `chess_rodos_logos_a/_b` 直接复用同一份函数，避免第二份实现漂移。
// 注意：那一份会读模组隐藏天赋（CCR-Δ 的 ep_damage_ratio / CCR-Y 的 sp）；本批生成的 chess 记录
// **不含模组天赋**（与本作既有自建干员的写法一致），所以那两个模组效果在契约档这只上不生效 ——
// 见 REBASE-0.2.1-STATUS.md 的「2026-10-10 (17)」备注。
//
// 2026-10-16 修复（用户报「6阶凯尔希和予愿安洁莉娜起飞会阻挡敌人」）：
//   罗德岛「干员档」里还有三只棋子**漏接线** —— `chess_rodos_huang_a/_b`（煌，120 层）、
//   `chess_rodos_cerber_a/_b`（刻俄柏，200 层）、`chess_rodos_aglna2_a/_b`（予愿安洁莉娜，360 层），
//   见 shared/rodosIsland.js RODOS_OPERATOR_MILESTONES。三者都已有完整实现（op-huang / op-cerber /
//   op-aglna2，按 charId 注册给自选位），但既不在 rodos.js 的 KEYS 里、也不在这里，于是
//   content/index.js kitOf 找不到 → skillSpecSource = 'none' → 掉进通用 kit：
//     * 予愿安洁莉娜的 6 个技能**全部没有实现**，而且她的「起飞」（liftoff + blockFly）写在 kit 的技能 /
//       天赋里 → 起飞从来没发生，她带着「巡空者」职业的常驻 blockFly 与 blockCnt 2 站在地上，
//       **会把地面敌人挡住**（实测：地面木桩第 18 步被挡）。
//     * 煌 / 刻俄柏 同理，技能全部无效。
//   修复方式与逻各斯一致：转发 op-*.js 的那一份，不另写实现。
import logos from './op-logos.js';
import aglna2 from './op-aglna2.js';
import cerber from './op-cerber.js';
import huang from './op-huang.js';

export default Object.freeze({
  chess_rodos_logos_a: logos.char_4133_logos,
  chess_rodos_logos_b: logos.char_4133_logos,
  chess_rodos_aglna2_a: aglna2.char_1015_aglna2,
  chess_rodos_aglna2_b: aglna2.char_1015_aglna2,
  chess_rodos_cerber_a: cerber.char_2013_cerber,
  chess_rodos_cerber_b: cerber.char_2013_cerber,
  chess_rodos_huang_a: huang.char_017_huang,
  chess_rodos_huang_b: huang.char_017_huang,
});
