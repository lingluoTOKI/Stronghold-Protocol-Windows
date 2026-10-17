// 巴别塔 (Babel) core bond — the fourth fan expansion of this fork.
//
// Layer source: FUNDS. Unlike 罗德岛 (whose layers come from battle results), 巴别塔 grows while the player
// spends — every 资金 paid out in a round pushes both the layer total and a permanent ATK / HP bonus on the
// 巴别塔 operators standing on the field. Layer totals pay milestone rewards the first time each is reached.
//
// Members carry 巴别塔 plus their own add-on bond. Two add-on bonds are introduced here (魔王 / 升变);
// 远见 / 精准 / 突袭 are the shipped ones the members reuse.
// The bond / 附加盟约 descriptions are written with the official rich-text markup (shared/bondText.js): every
// 加成 value carries a `<@ba.vup>…</>` span, which the client renders as the blue `.rt-vup` highlight.
import { up, gray, thresholdLine, lines, stripMarkup } from './bondText.js';

export const BABEL_BOND = 'babelShip';

/**
 * Plain form of an official-markup string: the `<@ba.vup>…</>` / `<$…>…</>` spans stripped.
 * `desc` carries this (the shipped records keep `desc` unstyled); `descRaw` keeps the tags, which the client
 * renders with public/js/ui/richText.js (`.rt-vup` = the blue #3fb6ff highlight for 加成 numbers).
 */
export const plainText = stripMarkup;

/** Bond ids the members carry as their 附加盟约. 魔王 and 升变 are new to this fork. */
export const BABEL_ADDON_BONDS = Object.freeze({
  farsight: 'visiShip',  // 远见 — shipped
  demon: 'demonShip',    // 魔王 — new
  evolve: 'evolveShip',  // 升变 — new
  preci: 'preciShip',    // 精准 — shipped
  raid: 'raidShip',      // 突袭 — shipped
  stead: 'steadShip',    // 坚守 — shipped
  sniper: 'sniperShip',  // 狙击 — shipped（W）
  warrior: 'warriorShip',// 近卫 — shipped（赫德雷）
});

/**
 * 凯尔希的召唤物 Mon3tr（token_10002_kalts_mon3tr）——和 缪尔赛思的流形 / 赫默的医疗探机 一样是
 * **手动放置**的召唤物（tokens.json `placeable`）：凯尔希上场时进入待部署区，玩家自己拖到近战位。
 * 数值与天赋取自 PRTS / 客户端表（阻挡 3、精英二满级 HP 5433 / ATK 1402 / DEF 405），战斗侧 kit 见
 * server/sim/content/babel.js 的 `tokenKits`。
 */
export const BABEL_MON3TR_TOKEN = 'token_10002_kalts_mon3tr';

/**
 * The 1 / 3 / 6 thresholds and what each tier pays. The **highest tier whose `count` is met** applies —
 * the tiers replace each other, exactly like the shipped core bonds' 「N人：…」 lines.
 *
 *  `fundsPerBuffPct` — 每回合每花费这么多资金，巴别塔干员永久 +1% 攻击力与生命值
 *                      （`buffAll` = 作用于「所有巴别塔干员」，否则「巴别塔在场的干员」）。
 *  `fundsPerLayer`   — 每花费这么多资金结算一次「层数 +`layersPerSpend`」。
 *  `layersPerSpend`  — 每 `fundsPerLayer` 资金，巴别塔层数 +这么多。
 *  `immediate`       — 激活该档时立刻发放的干员（6 人档直接给维什戴尔）。
 */
export const BABEL_TIERS = Object.freeze([
  // 1 人即可激活：GROWTH TIER — spend-driven layers start here, so a single member already banks them.
  Object.freeze({ count: 1, fundsPerBuffPct: 5, fundsPerLayer: 5, layersPerSpend: 1, immediate: null, buffAll: false }),
  Object.freeze({ count: 3, fundsPerBuffPct: 4, fundsPerLayer: 4, layersPerSpend: 2, immediate: null, buffAll: true }),
  // 2026-10-12 修：这里原本写的是短名 'wisdel'，grantChess 拿到它 gd.chess('wisdel') 查不到 → 返回 null，
  // 「在场6名…并立刻获得维什戴尔」从来没发出去过。改成真正的 chessId（与 BABEL_MILESTONES 的口径一致）。
  Object.freeze({ count: 6, fundsPerBuffPct: 3, fundsPerLayer: 3, layersPerSpend: 3, immediate: 'chess_babel_wisdel_a', buffAll: true }),
]);

export const BABEL_BALANCE = Object.freeze({
  thresholds: BABEL_TIERS.map((t) => t.count),
  /** Every 3 资金 spent is the unit the layer gain is measured in (see BABEL_TIERS.layersPerSpend). */
  spendUnit: 3,
  /** The permanent bonus is +1% ATK and +1% max HP per step; DEF is untouched. */
  buffAtkPctPerStep: 0.01,
  buffHpPctPerStep: 0.01,
  /** No bond-specific cap: the engine's 999 layer cap still applies. */
  layerCap: null,

  // ---- 附加盟约 魔王 / 升变 的人数效果 ----------------------------------------------------------
  /**
   * 魔王（**场上 2 名【魔王】干员**）: 魔王干员造成的伤害提升 `base` + 每 10 层魔王额外 `per10`。
   * 2026-10-16 用户裁定：激活人数 1 → 2，与 `data/bonds.json` 的 `demonShip.activeCount` / `thresholds`
   * 以及 `bb.active_count` 全部对齐（战斗内判定见 server/sim/content/babel.js 的 `need`）。
   * （早期草案曾写作「真实伤害」，引擎没有真伤增幅通道，spec v2 改回「造成的伤害提升」。）
   */
  demonDmgBase: 0.10,
  demonDmgPer10: 0.01,
  /** 升变（1 名）· 阿米娅（术士）在场: 攻击速度 +`base`，每 3 层升变额外 +`per3`。 */
  evolveCasterAspdBase: 10,
  evolveCasterAspdPer3: 1,
  /** 升变（1 名）· 阿米娅（近卫）在场: 攻击力 +`base`，每 3 层升变额外 +`per3`。 */
  evolveGuardAtkBase: 0.10,
  evolveGuardAtkPer3: 0.01,
  /** 升变（1 名）· 阿米娅（医疗）在场: 法术穿透 +`base`，每 20 层升变额外 +`per20`。 */
  evolveMedicPenBase: 10,
  evolveMedicPenPer20: 1,
  /** 升变（1 名）· 在场的为精锐阿米娅: 造成的伤害 +`base`，每 10 层升变额外 +`per10`。 */
  evolveEliteDmgBase: 0.10,
  evolveEliteDmgPer10: 0.01,
  /** 升变（1 名）· 无论哪个阿米娅在场: 技力回复 +`base`，每 10 层升变额外 +`per10`。 */
  evolveSpBase: 0.1,
  evolveSpPer10: 0.01,
  /**
   * 升变（1 名）· 其余两位阿米娅同时在备战席: 在场阿米娅按「其余两位中精锐的数量」折算她们的在场效果。
   * 0 名精锐 50% / 1 名精锐 75% / 2 名精锐 100%（`evolveBenchEliteStep` = 每多一名精锐 +25%）。
   */
  evolveBenchBase: 0.5,
  evolveBenchEliteStep: 0.25,
  /**
   * 升变（1 名）· 真实伤害技能「每场战斗只能释放一次」；三名阿米娅都为精锐时解除该限制。
   * A skill counts as a 真实伤害技能 when its blackboard carries `true_dmg` (奇美拉 的「伤害类型变为真实」)。
   */
  evolveTrueSkillOncePerBattle: true,
  /**
   * 升变（1 名）· 三名阿米娅（术士 / 近卫 / 医疗）只能选择其中一名在场；同名同职业的两名可以同时在场。
   * Chess records of the three forms carry `deployExclusiveGroup: 'babel-amiya'` (tools/babel-operators.mjs);
   * server/match/PlayerState.js refuses a placement that would put two different forms on the board.
   */
  evolveDeployExclusiveGroup: 'babel-amiya',

  // ---- per-operator trait numbers ---------------------------------------------------------------
  /**
   * 阿米娅（术士）: 战斗中，全场每有一个干员开启技能时，自身已激活盟约 各 +1（每回合每条各至多 +`cap`）。
   * 2026-10-12 用户裁定：触发范围改全场、目标改「自身已激活盟约」（动态）、上限改每回合。
   */
  amiCasterAllySkill: { babel: 1, demon: 1, evolve: 1, cap: 6 },
  /** 阿米娅（近卫）: 全场每有一个干员开启技能时，自身已激活盟约 各 +1（每回合每条各至多 +`cap`）。 */
  amiGuardAllySkill: { babel: 1, demon: 1, evolve: 1, cap: 10 },
  /** 阿米娅（医疗）: 全场每有一个干员开启技能时，自身已激活盟约 各 +2（每回合每条各至多 +`cap`）。 */
  amiMedicAllySkill: { babel: 2, demon: 2, evolve: 2, cap: 16 },
  /**
   * 赫德雷 / W: 攻击范围内每有一名敌人被晕眩时叠层。
   * `[0]` is the normal copy, `[1]` the 精锐 one.
   */
  hodrerStun: { babel: [2, 4], visi: [1, 2], babelCap: [8, 16], visiCap: [4, 8] },
  cqbwStun: { babel: [4, 4], preci: [2, 4], babelCap: [24, 32], preciCap: [12, 24] },
  /** 伊内丝: 回合结束时 使自身已激活盟约 +6 (精锐翻倍). */
  inesRound: [6, 12],
  /**
   * 魔王: 身前一格的干员因特质使层数提升时，使其层数额外 +1；
   * 若身前干员为巴别塔盟约（非阿米娅）干员，则巴别塔额外 +1；
   * 若身前干员为阿米娅（术士/近卫/医疗其一），则巴别塔、魔王、升变三条各额外 +1。
   */
  cetsyrFront: { any: [1, 2], babel: [1, 2], amiya: [1, 2] },
  /** 凯尔希: 巴别塔每叠 5 层，(作为召唤物的) Mon3tr 攻击力、生命值 +2%、攻击速度 +1. */
  kaltsLayersPerStep: 5,
  kaltsMon3trPctPerStep: 0.02,
  kaltsMon3trAspdPerStep: 1,
  /** 维什戴尔: 巴别塔和精准每有 3 层，本干员攻击力 +2%. */
  wisdelLayersPerStep: 3,
  wisdelAtkPctPerStep: 0.02,
  /**
   * 3 人档新增（用户 2026-10-16）：巴别塔每叠满 `layerFundEvery` 层，下回合额外获得 `layerFundAmount` 资金。
   * 仅在该档（≥ `layerFundTier` 名不同巴别塔干员在场）生效；跨过的每个整 30 层档位各发一次。
   */
  layerFundTier: 3,
  layerFundEvery: 30,
  layerFundAmount: 1,
});

/**
 * Milestone rewards, keyed by the layer total that first reaches it.
 * 50 赫德雷 / 100 伊内丝 / 150 W / 200 维什戴尔.
 *
 * `id` is a **chessId** for `kind: 'chess'` — resolved straight out of data/chess.json.
 */
export const BABEL_MILESTONES = Object.freeze([
  Object.freeze({ at: 50, kind: 'chess', id: 'chess_babel_hodrer_a', name: '赫德雷' }),
  // 伊内丝 is a shipped operator, so she is granted by her own chessId.
  Object.freeze({ at: 100, kind: 'chess', id: 'chess_char_4_04_a', name: '伊内丝' }),
  Object.freeze({ at: 150, kind: 'chess', id: 'chess_babel_cqbw_a', name: 'W' }),
  Object.freeze({ at: 200, kind: 'chess', id: 'chess_babel_wisdel_a', name: '维什戴尔' }),
]);

/**
 * A 巴别塔 operator, keyed by `trait` (the text is generated in tools/babel-data.mjs).
 *
 * `tier` is the 本数 the spec quotes; `price` follows the shipped tier table (3/4/5 本 → 3 资金, 6 本 → 5).
 * `bonds` is the 附加盟约 list exactly as the owner's text has it.
 *
 * `defaultSkillId` pins the skill the record ships with (**not** the first one): BABEL_SKILLS lists S1 first, so
 * without it every operator would fight with its S1. Keep it in sync with `assets.skillIcon` — the client reads
 * `assets.skillIcon` before `skill.iconId` (public/js/ui/assetUrls.js), and tools/rhine-data.mjs syncSkillIcons()
 * re-derives it from the resolved default.
 */
export const BABEL_ADDITIONS = Object.freeze([
  // 3 本
  {
    key: 'amiya', charId: 'char_002_amiya', tier: 3, price: 3,
    bonds: [BABEL_ADDON_BONDS.demon, BABEL_ADDON_BONDS.evolve],
    trait: 'amiCaster', subName: '中坚术师', displayName: '阿米娅（术士）',
    // 奇美拉: 攻击力+160%、生命上限+75%、伤害类型变为真实，每场战斗只能释放一次（三名阿米娅皆精锐时解除）。
    defaultSkillId: 'skchr_amiya_3',
    deployExclusiveGroup: BABEL_BALANCE.evolveDeployExclusiveGroup,
  },
  {
    key: 'hodrer', charId: 'char_4088_hodrer', tier: 3, price: 3,
    bonds: [BABEL_ADDON_BONDS.warrior],
    trait: 'hodrer', subName: '重剑手', displayName: '赫德雷',
    defaultSkillId: 'skchr_hodrer_2',
  },
  // 4 本
  {
    key: 'amiya2', charId: 'char_1001_amiya2', tier: 4, price: 3,
    bonds: [BABEL_ADDON_BONDS.evolve],
    trait: 'amiGuard', subName: '术战者', displayName: '阿米娅（近卫）',
    defaultSkillId: 'skchr_amiya2_2',
    deployExclusiveGroup: BABEL_BALANCE.evolveDeployExclusiveGroup,
  },
  // 5 本
  {
    key: 'cqbw', charId: 'char_113_cqbw', tier: 5, price: 3,
    bonds: [BABEL_ADDON_BONDS.sniper],
    trait: 'cqbw', subName: '炮手', displayName: 'W',
    defaultSkillId: 'skchr_cqbw_2',
  },
  {
    key: 'kalts', charId: 'char_003_kalts', tier: 5, price: 3,
    bonds: [BABEL_ADDON_BONDS.demon],
    trait: 'kalts', subName: '医师', displayName: '凯尔希',
    // 指令：熔毁 — Mon3tr 的伤害类型变为真实（server/sim/content/kits/babel.js）。
    defaultSkillId: 'skchr_kalts_3',
    // 她的召唤物 Mon3tr 作为可手动放置的手牌（chess.tokens → placeableTokens）。
    tokens: [BABEL_MON3TR_TOKEN],
  },
  {
    key: 'amiya3', charId: 'char_1037_amiya3', tier: 5, price: 3,
    bonds: [BABEL_ADDON_BONDS.evolve],
    trait: 'amiMedic', subName: '咒愈师', displayName: '阿米娅（医疗）',
    defaultSkillId: 'skchr_amiya3_2',
    deployExclusiveGroup: BABEL_BALANCE.evolveDeployExclusiveGroup,
  },
  // 6 本
  {
    key: 'wisdel', charId: 'char_1035_wisdel', tier: 6, price: 5,
    bonds: [BABEL_ADDON_BONDS.preci],
    trait: 'wisdel', subName: '投掷手', displayName: '维什戴尔',
    defaultSkillId: 'skchr_wisdel_3',
  },
]);

/**
 * Existing operators that gain 巴别塔 and a replacement trait.
 * `dropBonds` lists 附加盟约 the spec removes from the operator (魔王 drops 协防干员).
 */
export const BABEL_RETROFITS = Object.freeze([
  {
    key: 'ines', charId: 'char_4087_ines', trait: 'ines',
    bonds: [BABEL_ADDON_BONDS.farsight, BABEL_ADDON_BONDS.raid],
  },
  {
    key: 'cetsyr', charId: 'char_4134_cetsyr', trait: 'cetsyr',
    bonds: [BABEL_ADDON_BONDS.demon], dropBonds: ['emptyShip'], // 协防干员
  },
]);

/**
 * Every 巴别塔 milestone the layer total newly crossed going from `before` to `after`, in ascending order.
 * `claimed` holds the `at:kind` keys already paid this match (it is not mutated here).
 */
export function babelCrossedMilestones(before, after, claimed) {
  const out = [];
  for (const m of BABEL_MILESTONES) {
    if (claimed.has(m.at + ':' + m.kind)) continue;
    if (before < m.at && after >= m.at) out.push(m);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Funds spent in a round → 巴别塔 layers gained, for a bond that is active at `memberCount`. */
export function babelLayersFromFunds(fundsSpent, memberCount) {
  const tier = [...BABEL_TIERS].reverse().find((t) => memberCount >= t.count);
  if (!tier || fundsSpent <= 0) return 0;
  // 1 人档按自己的 5 资金步长结算；3 / 6 人档沿用 spendUnit（3 资金）的步长。
  return Math.floor(fundsSpent / (tier.fundsPerLayer ?? BABEL_BALANCE.spendUnit)) * tier.layersPerSpend;
}

/** Funds spent in a round → permanent ATK / HP percent steps earned, at `memberCount`. */
export function babelBuffStepsFromFunds(fundsSpent, memberCount) {
  const tier = [...BABEL_TIERS].reverse().find((t) => memberCount >= t.count);
  if (!tier || fundsSpent <= 0) return 0;
  return Math.floor(fundsSpent / tier.fundsPerBuffPct);
}

export const isBabelMember = (charId) =>
  BABEL_ADDITIONS.some((a) => a.charId === charId) || BABEL_RETROFITS.some((r) => r.charId === charId);

/**
 * 巴别塔 bond text — the official core-bond shape (see shared/bondText.js): one headline line, then one
 * `<在场N名不同【巴别塔】干员>` line per tier, then the milestone line. Every 加成 value carries the blue
 * highlight (`<@ba.vup>`, css `.rt-vup`); `BABEL_TEXT` is the plain form `desc` has always carried.
 */
export const BABEL_TEXT_RAW = lines(
  `【巴别塔】花费资金使巴别塔${up('层数')}增加，并使巴别塔在场的干员永久提升${up('攻击力')}与${up('生命值')}${gray('（受每回合花费的资金影响）')}`,
  ...BABEL_TIERS.map((t) => thresholdLine(t.count, '巴别塔',
    `每回合每花费${up(t.fundsPerBuffPct)}资金则${t.buffAll ? '所有巴别塔干员' : '巴别塔在场的干员'}永久${up('+1%')}攻击力、生命值；`
    + `每花费${up(t.fundsPerLayer)}资金巴别塔层数${up('+' + t.layersPerSpend)}`
    + (t.immediate ? `，并立刻获得${up('维什戴尔')}` : ''))),
  `层数首次到达时获得奖励：${up('50')}层赫德雷；${up('100')}层伊内丝；${up('150')}层W；${up('200')}层维什戴尔。`,
);

/** `BABEL_TEXT_RAW` with the rich-text markup removed (the shape `desc` has always carried). */
export const BABEL_TEXT = stripMarkup(BABEL_TEXT_RAW);

/** 附加盟约 魔王: 场上 2 名效果文本. */
export const BABEL_DEMON_TEXT =
  `【魔王】：场上 ${up('2')} 名魔王干员时，魔王干员造成的伤害提升（${up('10%')}+每${up('10')}层魔王额外${up('+1%')}）。`;

/** 附加盟约 升变: 1 名效果文本. */
export const BABEL_EVOLVE_TEXT = lines(
  `【升变】：若在场为阿米娅（术士）则阿米娅的攻击速度提升${up('10')}，每${up('3')}层升变额外${up('+1')}`,
  `若在场为阿米娅（近卫）则阿米娅的攻击力提升${up('10%')}，每${up('3')}层升变额外${up('+1%')}`,
  `若在场为阿米娅（医疗）则阿米娅法术穿透${up('+10')}，每${up('20')}层升变额外${up('+1')}`,
  `若其余两位阿米娅同时在备战席，则在场的阿米娅获得其余两位在场的效果（两位皆非精锐时${up('50%')}、其中一位精锐时${up('75%')}、两位皆精锐时${up('100%')}）`,
  `若在场的为精锐阿米娅，则在场的阿米娅造成的伤害提高${up('10%')}，每${up('10')}层升变额外${up('+1%')}`,
  '若三名阿米娅都为精锐，则真实伤害技能不再有每场战斗释放的限制',
  `无论哪个阿米娅在场，其技力回复${up('+0.1')}，每${up('10')}层升变额外${up('+0.01')}`,
  '阿米娅（术士）（近卫）（医疗）只能选择其中一名在场，可以在场两个同职业的阿米娅',
) + '。';

