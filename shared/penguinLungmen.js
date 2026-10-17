// 企鹅物流 / 龙门 —— 本 fork 的第五、第六个扩展阵营（用户 2026-10-10 规格）。
//
// 与巴别塔/乌萨斯一样：核心盟约按 chess.bonds 计数（server/match/bondsMeta.js pieceBonds）；
// 干员同时按职业自动归属附加盟约（shared/profBonds.js PROF_BOND_FACTIONS 已加入 penguinShip / lungmenShip）。
// 企鹅物流的层数来源：购买/获得企鹅物流干员等（盟约效果文本见 data/bonds.json penguinShip —— 数值都在那里的 bb）。
// 龙门：成员=核心盟约龙门+按职业附加（「1本暗锁 核心盟约龙门 附加盟约特种，以此类推」）；档位效果文本待用户补充，
// 本模块先只负责成员数据与标识，效果模块 lungmen.js 等 effectDesc 定稿后再实现。

export const PENGUIN_BOND = 'penguinShip';
export const LUNGMEN_BOND = 'lungmenShip';

/** 企鹅物流 bb 键（data/bonds.json penguinShip.bb / buffs[0].bb —— 支持侧 buffParams 读取）。 */
export const PENGUIN_BB_KEY = 'penguin_covenant';
export const LUNGMEN_BB_KEY = 'lungmen_covenant';

/**
 * 企鹅物流干员（本数顺序）。`idPrefix` = chessId 去掉 _a/_b 后缀 —— 判定「是否该干员」用它对
 * piece.chessId/baseId 做前缀匹配（覆盖精锐副本）。`present` = 数据里已有 chess 记录（缺失的先占位，
 * 等用户从 wiki/包内补数据后加进 data/chess.json 即自动生效，无需改代码）。
 */
export const PENGUIN_ROSTER = Object.freeze([
  Object.freeze({ key: 'texas', idPrefix: 'chess_char_1_08', charId: 'char_102_texas', name: '德克萨斯', tier: 1, profession: 'PIONEER', present: true }),
  Object.freeze({ key: 'bison', idPrefix: 'chess_pg_bison', charId: 'char_325_bison', name: '拜松', tier: 2, profession: 'TANK', present: true }),
  // 能天使 2026-10-13 由 4 阶改为 3 阶（用户规格）
  Object.freeze({ key: 'exusiai', idPrefix: 'chess_char_3_01', charId: 'char_1001_exusiai', name: '能天使', tier: 3, profession: 'SNIPER', present: true }),
  // 菲亚梅塔 2026-10-13 新增（3 阶，狙击）：数据来自 backups.json char_300_phenxi
  Object.freeze({ key: 'phenxi', idPrefix: 'chess_pg_phenxi', charId: 'char_300_phenxi', name: '菲亚梅塔', tier: 3, profession: 'SNIPER', present: true }),
  Object.freeze({ key: 'sora', idPrefix: 'chess_pg_sora', charId: 'char_101_sora', name: '空', tier: 3, profession: 'SUPPORT', present: true }),
  // 莫斯提马 2026-10-13 加入企鹅物流（4 阶，术师）：接替能天使原有的叠层特质
  Object.freeze({ key: 'mostma', idPrefix: 'chess_char_4_02', charId: 'char_213_mostma', name: '莫斯提马', tier: 4, profession: 'CASTER', present: true }),
  Object.freeze({ key: 'omertosa', idPrefix: 'chess_char_4_16', charId: 'char_1030_omertosa', name: '缄默德克萨斯', tier: 5, profession: 'SPECIAL', present: true }),
  Object.freeze({ key: 'ncovenant', idPrefix: 'chess_char_6_13', charId: 'char_2023_ncovenant', name: '新约能天使', tier: 6, profession: 'SPECIAL', present: true }),
  // 雷缪安 2026-10-13 加入企鹅物流（6 阶，狙击）
  Object.freeze({ key: 'lemuen', idPrefix: 'chess_char_6_01', charId: 'char_4193_lemuen', name: '雷缪安', tier: 6, profession: 'SNIPER', present: true }),
]);

/** 按 id 前缀找企鹅物流花名册成员（piece.chessId 或 baseId）。 */
export function penguinRosterOf(id) {
  const s = String(id || '');
  return PENGUIN_ROSTER.find((r) => s === r.idPrefix || s.startsWith(r.idPrefix + '_')) ?? null;
}

/**
 * 龙门干员（用户 2026-10-10 完整规格：核心盟约龙门+按职业附加；tier=本数）。
 * `present` = 数据里已有 chess 记录；缺失的占位（chess_lm_*），建好记录即自动生效。
 */
export const LUNGMEN_ROSTER = Object.freeze([
  Object.freeze({ key: 'anlock', idPrefix: 'chess_lm_anlock', charId: 'char_236_rope', name: '暗索', tier: 1, profession: 'SPECIAL', present: true }),
  Object.freeze({ key: 'axue', idPrefix: 'chess_lm_axue', charId: 'char_277_sqrrel', name: '阿消', tier: 1, profession: 'SPECIAL', present: true }),
  Object.freeze({ key: 'shitie', idPrefix: 'chess_lm_shitie', charId: 'char_241_panda', name: '食铁兽', tier: 2, profession: 'SPECIAL', present: true }),
  Object.freeze({ key: 'mou', idPrefix: 'chess_lm_mou', charId: 'char_226_hmau', name: '吽', tier: 2, profession: 'TANK', present: true }),
  Object.freeze({ key: 'swire', idPrefix: 'chess_char_3_03', charId: 'char_2023_swire', name: '诗怀雅', tier: 3, profession: 'WARRIOR', present: true }),
  Object.freeze({ key: 'chen', idPrefix: 'chess_lm_chen', charId: 'char_010_chen', name: '陈', tier: 3, profession: 'WARRIOR', present: true }),
  Object.freeze({ key: 'hoshiguma', idPrefix: 'chess_char_4_17', charId: 'char_136_hoshiguma', name: '星熊', tier: 4, profession: 'TANK', present: true }),
  Object.freeze({ key: 'a', idPrefix: 'chess_lm_a', charId: 'char_225_haak', name: '阿', tier: 4, profession: 'SPECIAL', present: true }),
  Object.freeze({ key: 'laoli', idPrefix: 'chess_lm_laoli', charId: 'char_322_lmlee', name: '老鲤', tier: 5, profession: 'SPECIAL', present: true }),
  Object.freeze({ key: 'linlangswire', idPrefix: 'chess_char_3_04', charId: 'char_1035_chan', name: '琳琅诗怀雅', tier: 5, profession: 'SPECIAL', present: true }),
  Object.freeze({ key: 'lin', idPrefix: 'chess_lm_lin', charId: 'char_4080_lin', name: '林', tier: 5, profession: 'CASTER', present: true }),
  Object.freeze({ key: 'hsgma2', idPrefix: 'chess_lm_hsgma2', charId: 'char_1044_hsgma2', name: '斩业星熊', tier: 6, profession: 'TANK', present: true }),
  Object.freeze({ key: 'chen3', idPrefix: 'chess_chen3', charId: 'char_1050_chen3', name: '赤刃明霄陈', tier: 6, profession: 'WARRIOR', present: true }),
]);

/** 按 id 前缀找龙门花名册成员（piece.chessId 或 baseId，_a/_b 通吃）。 */
export function lungmenRosterOf(id) {
  const s = String(id || '');
  return LUNGMEN_ROSTER.find((r) => s === r.idPrefix || s.startsWith(r.idPrefix + '_')) ?? null;
}
