// server/sim/content/kits/ops/usstudent.js — 乌萨斯学生自治团 (usStudentShip) 阵营算子 kit, 按 chess base id 注册。
//
// 乌萨斯干员是普通商店棋子 (chess_us_*)，由 kitOf 按 baseId 解析；而 op-*.js 按 charId 注册、仅供「自选/补位」体使用。
// 因此这里把 op-*.js 的 builder 重新挂到 chess base id 上，让棋子出战时也能拿到手写 kit（与 rodos.js / babel.js 同款做法）。
// builder 逻辑全部来自 op-*.js，本文件只做「重键」，不重复实现。
import opHeadbr from './op-headbr.js'; // char_115_headbr  → chess_us_headbr_a
import opLeto from './op-leto.js';     // char_194_leto   → chess_us_leto_a
import opGlassb from './op-glassb.js'; // char_195_glassb → chess_us_glassb_a
import opAbsin from './op-absin.js';  // char_405_absin  → chess_us_absin_a
import opPoca from './op-poca.js';    // char_197_poca   → chess_us_poca_a
import opHeadb2 from './op-headb2.js';// char_1051_headb2→ chess_us_headb2_a

/** 取一个 op 模块的唯一切子 builder（默认导出即 { charId: builder } 对象），挂到给定的 chess base id。 */
const rekey = (defObj, baseId) => {
  const builder = Object.values(defObj ?? {})[0];
  if (typeof builder !== 'function') throw new Error(`usstudent: ${baseId} 找不到 builder`);
  return { [baseId]: builder };
};

export default {
  ...rekey(opHeadbr, 'chess_us_headbr_a'),
  ...rekey(opLeto, 'chess_us_leto_a'),
  ...rekey(opGlassb, 'chess_us_glassb_a'),
  ...rekey(opAbsin, 'chess_us_absin_a'),
  ...rekey(opPoca, 'chess_us_poca_a'),
  ...rekey(opHeadb2, 'chess_us_headb2_a'),
};
