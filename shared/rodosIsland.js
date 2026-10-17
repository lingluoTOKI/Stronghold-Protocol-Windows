// 罗德岛 (Rhodes Island) — 用户 2026-10-15 全量重写本盟约效果。
//
// 仅保留"识别成员 / 附加盟约 / 装备"的元数据；本文件其它段全部按用户文本重写（不含任何老代码老文本）。
// 新规则（用户原话整理）：
//   · 作战胜利使【罗德岛】层数增加；作战失败则每损失 1 点目标生命额外增加层数（受在场人数影响）。
//   · 3 名：胜利 +5；失败每点 +1。
//   · 6 名：胜利 +10；失败每点 +3；额外造成伤害提高 (15 + (-1*(当前生命值-31)) * 4) %。
//   · 9 名：胜利 +20；失败每点 +5。
//   · 10 层起每叠 4 层，所有【罗德岛】干员攻击力、生命值 +1%。
//   · 20 / 40 / 60 / 80 / 100 / 120 / 140 / 170 / 200 / 240 / 280 / 320 / 360 层赠送一档干员，
//     400 层人事部文档、440 层精锐博士投影；440 层之后每 50 层额外获得 2 资金。
//   · 若赠送时该干员已精锐（grant 失败），自动顺延下一档，直到不为精锐。
export const RODOS_BOND = 'rodosShip';

/** 可露希尔 指挥中心 token —— 保留：这是 6 本特质数据的引用，不属于"效果文本"。 */
export const RODOS_CLOSUR_TOKEN = 'token_10066_closur_ourbase';

/** 附加盟约映射 —— 保留：成员数据需要。 */
export const RODOS_ADDON_BONDS = Object.freeze({
  raid: 'raidShip',
  arcane: 'arcaneShip',
  preci: 'preciShip',
  deput: 'deputShip',
  skillful: 'skillfulShip',
  mira: 'miraShip',
  caster: 'casterShip',
  warrior: 'warriorShip',
  sniper: 'sniperShip',
  special: 'specialShip',
});

/** 用户文本：3 / 6 / 9 档的胜利层数 与 每点生命层数。 */
export const RODOS_TIERS = Object.freeze([
  Object.freeze({ count: 3, win: 5, perLifeLost: 1 }),
  Object.freeze({ count: 6, win: 10, perLifeLost: 3 }),
  Object.freeze({ count: 9, win: 20, perLifeLost: 5 }),
]);

/** 6 名档造成伤害公式（用户原话：(15+(-1*(当前生命值-31))*4)%）—— 不写文字常量。 */
export const RODOS_BALANCE = Object.freeze({
  thresholds: RODOS_TIERS.map((t) => t.count),
  /** 10 层起每叠 4 层，攻 / 血 +1%。 */
  layersPerStep: 4,
  layerAtkPctPerStep: 0.01,
  layerHpPctPerStep: 0.01,
  /** 6 名档造成伤害参数化。dmgDealtMul = 1 + (bonusBase + k*(lp - baseLp) * stepPct) / 100。 */
  dmgPerLifeLost: Object.freeze({ at: 6, baseLp: 31, k: -1, bonusBase: 15, stepPct: 4 }),
  /** 440 层之后每 50 层 +2 资金（赠送顺序：400 文档、440 精锐博士投影；资金在 440 之后开始）。 */
  fundsStep: Object.freeze({ from: 440, step: 50, perStep: 2 }),
});

/** 干员档位赠送（顺序敏感，顺延逻辑按数组顺序往前推）。 */
export const RODOS_OPERATOR_MILESTONES = Object.freeze([
  Object.freeze({ at: 20, kind: 'chess', id: 'chess_rodos_fang2_a', name: '历阵锐枪芬' }),
  Object.freeze({ at: 40, kind: 'chess', id: 'chess_rodos_greyy2_a', name: '承曦格雷伊' }),
  Object.freeze({ at: 60, kind: 'chess', id: 'chess_rodos_lava2_a', name: '炎狱炎熔' }),
  Object.freeze({ at: 80, kind: 'chess', id: 'chess_rodos_hbisc2_a', name: '濯尘芙蓉' }),
  Object.freeze({ at: 100, kind: 'chess', id: 'chess_rodos_kroos_a', name: '寒芒克洛丝' }),
  Object.freeze({ at: 120, kind: 'chess', id: 'chess_rodos_huang_a', name: '煌' }),
  Object.freeze({ at: 140, kind: 'chess', id: 'chess_char_6_12_a', name: '迷迭香' }),
  Object.freeze({ at: 170, kind: 'chess', id: 'chess_rodos_flwr2_a', name: '撚英调香师' }),
  Object.freeze({ at: 200, kind: 'chess', id: 'chess_rodos_cerber_a', name: '刻俄柏' }),
  Object.freeze({ at: 240, kind: 'chess', id: 'chess_rodos_closure_a', name: '可露希尔' }),
  Object.freeze({ at: 280, kind: 'chess', id: 'chess_rodos_kalts2_a', name: '凯尔希·思衡托' }),
  // 320 层"罗格斯"是用户笔误，gameData 内是"逻各斯"（Logos, char_4133_logos, chess_rodos_logos_a）。
  Object.freeze({ at: 320, kind: 'chess', id: 'chess_rodos_logos_a', name: '逻各斯' }),
  Object.freeze({ at: 360, kind: 'chess', id: 'chess_rodos_aglna2_a', name: '予愿安洁莉娜' }),
]);

/** 物品档（不参与顺延；item 永远可发）。 */
export const RODOS_ITEM_MILESTONES = Object.freeze([
  Object.freeze({ at: 400, kind: 'item', id: 'chess_item_6_08_e_a', name: '人事部文档', count: 1 }),
  Object.freeze({ at: 440, kind: 'item', id: 'chess_item_5_06_e_b', name: '精锐博士投影', count: 1 }),
]);

/** 6 本 / 5 本战斗结算 / 个体加成（保留：不在用户"老文本"清理范围内，是各干员自身特质）。 */
export const RODOS_PER_OPERATOR = Object.freeze({
  surtrDeploy: {
    raid: [4, 8], arcane: [2, 4], rodos: [2, 2],
    raidCap: [24, 48], arcaneCap: [12, 24], rodosCap: [10, 10],
  },
  kroosAllySkill: { layers: 1, cap: 10, preci: [1, 2], preciCap: [10, 20] },
  kalts2: { layersPerStep: 10, ammoPerStep: 1, atkPctPerStep: 0.01 },
});

/** 装备数据 —— 保留。 */
export const RODOS_EQUIPMENT = Object.freeze({
  pass: Object.freeze({
    key: 'rodos_pass', name: '罗德岛权限卡', tier: 3, price: 3,
    buffKey: 'rodos_pass', layers: [4, 8], art: '/art/rodos/pass.png',
  }),
  medal: Object.freeze({
    key: 'rodos_medal', name: '罗德岛勋章', tier: 6, price: 4,
    buffKey: 'rodos_medal', extra: [1, 2], round: [5, 10], art: '/art/rodos/medal.png',
  }),
});

/** 成员表 —— 保留。 */
export const RODOS_ADDITIONS = Object.freeze([
  { key: 'fang', charId: 'char_123_fang', tier: 1, price: 2, bonds: [], trait: 'starter', subName: '尖兵', shop: false },
  { key: 'lava', charId: 'char_121_lava', tier: 1, price: 2, bonds: [RODOS_ADDON_BONDS.arcane], trait: 'starter_addon', addon: 'arcane', subName: '扩散术师', shop: false },
  { key: 'kroos', charId: 'char_124_kroos', tier: 1, price: 2, bonds: [RODOS_ADDON_BONDS.preci], trait: 'starter_addon', addon: 'preci', subName: '速射手', shop: false },
  { key: 'hibisc', charId: 'char_120_hibisc', tier: 1, price: 2, bonds: [RODOS_ADDON_BONDS.deput], trait: 'starter_top', addon: 'deput', subName: '医师' },
  { key: 'lava2', charId: 'char_1011_lava2', tier: 5, price: 3, bonds: [RODOS_ADDON_BONDS.arcane], trait: 'lava2', subName: '扩散术师', mergeNum: 2, shop: false },
  { key: 'hbisc2', charId: 'char_1024_hbisc2', tier: 5, price: 3, bonds: [RODOS_ADDON_BONDS.deput], trait: 'hbisc2', subName: '咒愈师', mergeNum: 2, shop: false },
  { key: 'greyy2', charId: 'char_1027_greyy2', tier: 3, price: 3, bonds: [RODOS_ADDON_BONDS.skillful], trait: 'greyy2', subName: '投掷手', mergeNum: 2, shop: false },
  { key: 'fang2', charId: 'char_1036_fang2', tier: 2, price: 3, bonds: [], trait: 'fang2', subName: '冲锋手', mergeNum: 2, shop: false },
  { key: 'flwr2', charId: 'char_1022_flwr2', tier: 5, price: 3, bonds: [RODOS_ADDON_BONDS.deput], trait: 'flwr2', subName: '护佑者', mergeNum: 2, shop: false },
  { key: 'closure', charId: 'char_4228_closur', tier: 6, price: 5, bonds: [RODOS_ADDON_BONDS.mira], trait: 'closure', subName: '战术家', defaultSkillId: 'skchr_closur_3', mergeNum: 2, tokens: [RODOS_CLOSUR_TOKEN] },
  { key: 'kalts2', charId: 'char_1052_kalts2', tier: 6, price: 5, bonds: [], trait: 'kalts2', subName: '守望者', defaultSkillId: 'skchr_kalts2_2', mergeNum: 2 },
  { key: 'cerber', charId: 'char_2013_cerber', tier: 5, price: 3, bonds: [RODOS_ADDON_BONDS.caster], trait: 'cerber', subName: '核心术师', defaultSkillId: 'skchr_cerber_3', mergeNum: 2 },
  { key: 'huang', charId: 'char_017_huang', tier: 4, price: 3, bonds: [RODOS_ADDON_BONDS.warrior], trait: 'huang', subName: '强攻手', defaultSkillId: 'skchr_huang_3', mergeNum: 2 },
  { key: 'aglna2', charId: 'char_1015_aglna2', tier: 6, price: 5, bonds: [RODOS_ADDON_BONDS.special], trait: 'aglna2', subName: '飞天射手', defaultSkillId: 'skchr_aglna2_3', mergeNum: 2 },
]);

export const RODOS_RETROFITS = Object.freeze([
  { key: 'greyy', charId: 'char_253_greyy', trait: 'greyySell' },
  { key: 'flower', charId: 'char_181_flower', trait: 'flowerRound' },
  { key: 'mudrock', charId: 'char_311_mudrok', trait: 'mudrockSell' },
  { key: 'surtr', charId: 'char_350_surtr', trait: 'surtrDeploy' },
  { key: 'kroos2', charId: 'char_1021_kroos2', trait: 'kroosAllySkill' },
  { key: 'rosmon', charId: 'char_391_rosmon', trait: 'rosmon' },
]);

export const isRodosMember = (charId) =>
  RODOS_ADDITIONS.some((a) => a.charId === charId) || RODOS_RETROFITS.some((r) => r.charId === charId);

/** 跨过的新档位（不含已 claim 的）。资金档按 440 之后每 50 层生成。 */
export function rodosCrossedMilestones(before, after, claimed) {
  const out = [];
  for (const m of RODOS_OPERATOR_MILESTONES) {
    if (claimed.has(m.at + ':chess')) continue;
    if (before < m.at && after >= m.at) out.push(m);
  }
  for (const m of RODOS_ITEM_MILESTONES) {
    if (claimed.has(m.at + ':' + m.kind)) continue;
    if (before < m.at && after >= m.at) out.push(m);
  }
  const F = RODOS_BALANCE.fundsStep;
  if (F && after > F.from) {
    const first = F.from + F.step * Math.max(1, Math.ceil((Math.max(before + 1, F.from + 1) - F.from) / F.step));
    for (let at = first; at <= after; at += F.step) {
      const key = at + ':funds';
      if (claimed.has(key)) continue;
      out.push(Object.freeze({ at, kind: 'funds', count: F.perStep, name: `${F.perStep} 资金` }));
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** 用户原话（player-visible desc + 仅供阅读的副本）—— 不再含任何老代码老文本。 */
export const RODOS_TEXT = [
  '【罗德岛】作战胜利使【罗德岛】层数增加，作战失败则每损失1点目标生命额外增加层数（受在场人数影响）',
  '<在场3名不同【罗德岛】干员>作战胜利层数+5；作战失败则每损失1点目标生命层数+1',
  '<在场6名不同【罗德岛】干员>作战胜利层数+10；作战失败则每损失1点目标生命层数+3，额外造成伤害提升（15+（-1*（当前生命值-31））*4）%',
  '<在场9名不同【罗德岛】干员>作战胜利层数+20；作战失败则每损失1点目标生命层数+5',
  '<10层>所有【罗德岛】干员攻击力与生命值提升',
  '▸ 实际数值：每叠4层，所有【罗德岛】干员攻击力、生命值+1%',
  '<20层>历阵锐枪芬；40层承曦格雷伊；60层炎狱炎熔；80层濯尘芙蓉；100层寒芒克洛丝；120层煌；140层迷迭香；170层撚英调香师；200层刻俄柏；240层可露希尔；280层凯尔希·思衡托；320层逻各斯；360层予愿安洁莉娜；400层人事部文档，440层精锐博士投影，之后每50层额外获得2资金。若赠送干员时该干员已精锐自动获得下一个挡位的干员，若下一个挡位的干员也精锐再获得下一个，以此类推，直到该挡位的干员不为精锐',
].join('\n');
export const RODOS_TEXT_RAW = RODOS_TEXT;
