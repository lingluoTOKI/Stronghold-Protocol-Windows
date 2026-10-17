// ui/contractGlyphs.js — 契约选择的专属图标（实测 2026-10-10「每条契约专属图标」口径）：
// 47 条契约每条一个字形（GLYPHS / ICONS 名），不再同组共用一张 icon_player_buff / icon_enemy_debuff。
// 纯映射：图标本体在 gameComponents.js GLYPHS（新增 box/gift/star/coins/heart/heartplus/atk/wind/burst/flame/medal/crit）。
// 「强攻+/狂暴+/强袭+/强韧+」四条加强档与基础档同字形，卡面上叠一个金色「+」角标（contractPlus）。

const MAP = {
  // ---- 我方增益（23）----
  contract_supply2: 'box',        // 补充：两个 2 阶装备 → 装备箱
  contract_supply3: 'gift',       // 补给：两个 3 阶装备 → 礼包
  contract_elite5: 'star',        // 精英：5 阶干员
  contract_elite6: 'crown',       // 精锐：6 阶干员（最高档 → 皇冠）
  contract_fund_slow: 'sell',     // 金钱：慢速资金 → 金币
  contract_fund_fast: 'coins',    // 财富：每回合资金 → 双币
  contract_knife: 'sword',        // 名刀：保命一刀
  contract_perfect_aspd: 'check', // 完美：✓ 完美作战触发
  contract_lp10: 'heartplus',     // 急救：策略生命 +10（红十字）
  contract_deploy1: 'expand',     // 扩容：可部署 +1
  contract_ascend: 'dp',          // 升华：击败即增伤 ⚡
  contract_wall: 'shield',        // 城墙：最高 HP 干员的护盾
  contract_wanted: 'target',      // 通缉：悬赏目标 ◎
  contract_brave2: 'medal',       // 勇士：最后一员 +90%（军功章）
  contract_brave1: 'user',        // 勇者：最后一员 +30%（孤身一人）
  contract_crit: 'crit',          // 暴击：准星
  contract_conquer: 'flag',       // 征服：连续完美 → 旗帜
  contract_coop: 'users',         // 协防：两人并肩
  contract_rebate: 'rotate',      // 返利：花费回流
  contract_lone: 'wifiOff',       // 孤军：只剩自己（断线 = 无人与共）
  contract_alliance: 'link',      // 联合：队友联结
  contract_seek: 'search',        // 寻访：招募 🔍
  contract_smite: 'crit',         // 神罚：异客逐目标伤害回技力（12回合送异客）
  // ---- 敌方增益（14）----
  contract_e_atk2: 'atk',         // 强攻：攻击 ↑
  contract_e_aspd2: 'bolt',       // 狂暴：攻速 ⚡
  contract_e_move2: 'chevrons',   // 强袭：移速 »
  contract_e_hp2: 'heart',        // 强韧：生命 ♥
  contract_e_def2: 'shield',      // 强坚：防御/法抗 🛡
  contract_e_atk8: 'atk',         // 强攻+
  contract_e_aspd8: 'bolt',       // 狂暴+
  contract_e_move8: 'chevrons',   // 强袭+
  contract_e_hp8: 'heart',        // 强韧+
  contract_e_def8: 'shield',      // 强坚+
  contract_e_dodge: 'wind',       // 闪避：风一样掠过
  contract_e_boom: 'burst',       // 自爆：爆炸
  contract_e_stealth: 'eye',      // 影舞：隐匿
  contract_e_burn: 'flame',       // 点燃（原侵蚀）：灼燃
  // ---- 中立契约（10）—— 敌我双方通吃；图标允许与他组复用（同组内不重）----
  contract_n_leader: 'crown',     // 领袖：精英领袖 👑
  contract_n_heal: 'heartplus',   // 愈合：每秒回血（红十字）
  contract_n_gamble: 'hourglass', // 赌局：交给命运的沙漏
  contract_n_greed: 'minus',      // 贪婪：生命换资金（−）
  contract_n_miasma: 'skull',     // 清图：毒雾 ☠（没有解药）
  contract_n_dawn: 'chevrons',    // 破晓：穿透双防 »
  contract_n_masoch: 'heart',     // 自残：上限掉三成 ♥
  contract_n_duel: 'sword',       // 单挑：一对一 ⚔
  contract_n_brawl: 'users',      // 群殴：人海
  contract_n_arena: 'medal',      // 擂台：三人擂台赛
  // ---- 中立契约新增 9 条（用户 2026-10-14）----
  contract_n_freq: 'shield',      // 频率：免疫 3 次伤害的护盾
  contract_n_execute: 'skull',    // 斩杀：低血立即死亡 ☠
  contract_n_slaughter: 'sword',  // 屠戮：每有单位死亡即增伤
  contract_n_laststand: 'heart',  // 锁血：生命不低于 1
  contract_n_reflect: 'rotate',   // 反伤：把伤害还回去
  contract_n_vampire: 'heartplus',// 嗜血：造成伤害回血
  contract_n_revive: 'check',     // 复活：被击倒后站起
  contract_n_lowhp: 'minus',      // 残血：最大生命值砍半
  contract_n_cold: 'bolt',        // 寒冷：攻速 -100
};

const FALLBACK = { self: 'crown', enemy: 'skull', neutral: 'gear' };

/** @param {string} id contract id（choices.json contracts[].id）@returns {string} glyph name (GLYPHS/ICONS) */
export function contractGlyph(id) {
  if (MAP[id]) return MAP[id];
  const s = String(id || '');
  return FALLBACK[s.startsWith('contract_e_') ? 'enemy' : s.startsWith('contract_n_') ? 'neutral' : 'self'];
}

/** 加强档（强攻+/狂暴+/强袭+/强韧+）：同字形 + 金色「+」角标。 */
export function contractPlus(id) {
  return /^contract_e_\w+8$/.test(String(id || ''));
}

/**
 * 这条 EffectRef 是不是契约（契约的 key 是 `contract:<id>`，id 是 `contract:<id>#<uid>`）。
 * 右侧效果列靠它把契约摘出去（ui/effectsList.js），「查看契约」页靠它收集本局选过的契约。
 * @param {{key?: string|null, id?: string|null}} ref m.private.effects 的一条
 */
export function isContractRef(ref) {
  return String(ref?.key || ref?.id || '').startsWith('contract:');
}

/** `contract:<id>#<uid>` / `contract:<id>` → 契约 id（choices.json contracts[].id）。 */
export function contractIdOf(ref) {
  return String(ref?.key || ref?.id || '').replace(/^contract:/, '').split('#')[0];
}

/**
 * 契约归属组：我方 self / 中立 neutral / 敌方 enemy。
 * 优先用服务端一并下发的 group（server/match/contracts.js applyContract 写入，
 * 与 sim/content/contracts.js install() 同口径），缺了按 id 前缀兜底。
 */
export function contractGroupOf(id, group) {
  if (group === 'self' || group === 'neutral' || group === 'enemy') return group;
  const s = String(id || '');
  return s.startsWith('contract_e_') ? 'enemy' : s.startsWith('contract_n_') ? 'neutral' : 'self';
}
