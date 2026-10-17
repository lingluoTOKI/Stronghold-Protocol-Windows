// 彩虹小队 (Rainbow Six collab) fan expansion. Balance values and roster are shared by the browser
// and the server, exactly like shared/rhineResearch.js does for the Rhine Lab expansion.
//
// Bond model: 彩虹小队 is a CORE bond (one of the faction bonds, like 炎 / 莱茵生命). It activates with a
// single member and counts 1 … 8 members; every operator on the player's side receives the layer bonuses
// of the members actually deployed (「加成全队」). Its 8 members cost 1, 2, 2, 3, 4, 4, 5 and 6 gold.

import { up, acr, thresholdLine, lines } from './bondText.js';

/** Bond id inside data/bonds.json (core, bondType SEASON). */
export const RAINBOW_BOND = 'rainbowShip';

/** The five add-on bonds the squad's traits lean on. */
export const RAINBOW_ADDON_BONDS = Object.freeze({
  raid: 'raidShip',        // 突袭
  swift: 'swiftShip',      // 迅捷 (导火索)
  stead: 'steadShip',      // 坚守 (闪击)
  skillful: 'skillfulShip',// 灵巧 (霜华 / 双月)
  deput: 'deputShip',      // 助力
  preci: 'preciShip',      // 精准 (灰烬 / 艾拉)
});

/**
 * The eight collab operators. `team` is the client's own teamId for the collab (`rainbow`), kept here so
 * tests can assert the generated roster matches the client data.
 */
export const RAINBOW_CHARACTERS = Object.freeze({
  tachanka: 'char_459_tachak',
  fuze: 'char_4126_fuze',
  blitz: 'char_457_blitz',
  frost: 'char_458_rfrost',
  doc: 'char_4125_rdoc',
  iana: 'char_4124_iana',
  ash: 'char_456_ash',
  ela: 'char_4123_ela',
});

/** Trap/summon characters the two traper operators deploy. */
export const RAINBOW_TOKENS = Object.freeze({
  frost: 'token_10016_rfrost_mine',
  ela: 'token_10033_ela_grzmot',
});

/**
 * Roster spec consumed by tools/rainbow-data.mjs. `skillId` is the default carried skill, `defaultModuleId`
 * the default module for the elite (精锐) copy, `bonds` every bond the operator belongs to (彩虹小队 plus its
 * add-on) and `index` fixes shop/identifier order (战车 first).
 */
export const RAINBOW_ADDITIONS = Object.freeze([
  { key: 'tachanka', charId: RAINBOW_CHARACTERS.tachanka, tier: 1, bonds: [], skillId: 'skchr_tachak_1', defaultModuleId: 'uniequip_002_tachak', subName: '剑豪', trait: 'tachanka' },
  { key: 'fuze', charId: RAINBOW_CHARACTERS.fuze, tier: 2, bonds: [RAINBOW_ADDON_BONDS.swift], skillId: 'skchr_fuze_2', defaultModuleId: 'uniequip_002_fuze', subName: '收割者', trait: 'fuze' },
  { key: 'blitz', charId: RAINBOW_CHARACTERS.blitz, tier: 2, bonds: [RAINBOW_ADDON_BONDS.stead], skillId: 'skchr_blitz_1', defaultModuleId: 'uniequip_002_blitz', subName: '要塞', trait: 'blitz' },
  { key: 'frost', charId: RAINBOW_CHARACTERS.frost, tier: 3, bonds: [RAINBOW_ADDON_BONDS.skillful], skillId: 'skchr_rfrost_1', defaultModuleId: 'uniequip_002_rfrost', subName: '陷阱师', trait: 'frost' },
  { key: 'doc', charId: RAINBOW_CHARACTERS.doc, tier: 4, bonds: [], skillId: 'skchr_rdoc_2', defaultModuleId: 'uniequip_002_rdoc', subName: '教官', trait: 'doc' },
  { key: 'iana', charId: RAINBOW_CHARACTERS.iana, tier: 4, bonds: [RAINBOW_ADDON_BONDS.skillful], skillId: 'skchr_iana_2', defaultModuleId: 'uniequip_002_iana', subName: '傀儡师', trait: 'iana' },
  { key: 'ash', charId: RAINBOW_CHARACTERS.ash, tier: 5, bonds: [RAINBOW_ADDON_BONDS.preci], skillId: 'skchr_ash_2', defaultModuleId: 'uniequip_003_ash', subName: '速射手', trait: 'ash' },
  { key: 'ela', charId: RAINBOW_CHARACTERS.ela, tier: 6, bonds: [RAINBOW_ADDON_BONDS.preci], skillId: 'skchr_ela_3', defaultModuleId: 'uniequip_002_ela', subName: '陷阱师', trait: 'ela' },
]);

/**
 * Team-wide layer bonuses（_bonds-mod.txt 2026-10-13 定稿：全部**线性每层**，无步进）：
 *   atkPct 攻击%（战车）    spRecoveryMulPct 技力回复%（导火索）  defPct 防御%（闪击）
 *   resFlat 法术抗性（霜华，基础值）      hpPct 生命值%（医生）        hpRegen 每秒回血（双月，基础生命值固定值）
 *   defIgnoreFlat 攻击无视防御力（灰烬，迷迭香式固定值）  aspdFlat 攻击速度（艾拉，面板点数）
 * 一名在场成员提供 base + perLayer×层数；**精锐**成员把「自己提供的那一条」提高至 elitePct（125%），对全体生效。
 */
export const RAINBOW_TEAM_BUFFS = Object.freeze([
  Object.freeze({ member: 'tachanka', memberName: '战车', mod: 'atkPct', base: 0.12, perLayer: 0.004, label: '攻击力', fmt: 'pct', text: '+12%，每层+0.4%' }),
  Object.freeze({ member: 'fuze', memberName: '导火索', mod: 'spRecoveryMulPct', base: 0.05, perLayer: 0.002, label: '技力回复', fmt: 'pct', text: '+5%，每层+0.2%' }),
  Object.freeze({ member: 'blitz', memberName: '闪击', mod: 'defPct', base: 0.12, perLayer: 0.004, label: '防御力', fmt: 'pct', text: '+12%，每层+0.4%' }),
  Object.freeze({ member: 'frost', memberName: '霜华', mod: 'resFlat', base: 10, perLayer: 0.1, label: '法术抗性', fmt: 'flat', text: '+10，每层+0.1' }),
  Object.freeze({ member: 'doc', memberName: '医生', mod: 'hpPct', base: 0.12, perLayer: 0.005, label: '生命值', fmt: 'pct', text: '+12%，每层+0.5%' }),
  Object.freeze({ member: 'iana', memberName: '双月', mod: 'hpRegen', base: 50, perLayer: 1, label: '每秒回复生命值', fmt: 'flat', text: '+50，每层+1' }),
  Object.freeze({ member: 'ash', memberName: '灰烬', mod: 'defIgnoreFlat', base: 100, perLayer: 1, label: '攻击无视防御力', fmt: 'flat', text: '+100，每层+1' }),
  Object.freeze({ member: 'ela', memberName: '艾拉', mod: 'aspdFlat', base: 15, perLayer: 0.6, label: '攻击速度', fmt: 'flat', text: '+15，每层+0.6' }),
]);

export const RAINBOW_BALANCE = Object.freeze({
  /** Bond thresholds: one member activates it, eight is the full squad (「激活人数为1 2 3 4 5 6 7 8人」). */
  thresholds: [1, 2, 3, 4, 5, 6, 7, 8],
  /** An ELITE 彩虹小队 operator receives its own team line at this fraction (1.25 = 提升至125%). */
  elitePct: 1.25,
  /** Attack line: every 3 layers grant +1 ATK to every friendly operator while 战车 is deployed. */
  atkStep: 3,
  atkPerStep: 1,
  /** 战车: +N 彩虹小队 layers per member on the board at 休整期结束 (精锐 doubles). */
  tachankaLayersPerMember: [1, 2],
  /**
   * 导火索: IN BATTLE, SP recovery per second for HIMSELF (白面鸮-style 技力光环, but self only).
   * ≤ `fuzeSquadSize` members on the field → the small value, above it → the large one. 精锐 doubles.
   */
  fuzeSquadSize: 4,
  fuzeSpRecovery: [0.2, 0.4],
  fuzeSpRecoveryLarge: [0.3, 0.6],
  /** 闪击: percent DEF / HP per 3 layers of 彩虹小队 + 坚守 (精锐 doubles). */
  blitzLayerStep: 3,
  blitzBonusPct: [0.01, 0.02],
  /** 霜华: 休整期开始, +彩虹小队 / +灵巧 layers by squad size (精锐 doubles). */
  frostSquadSize: 4,
  frostSmall: { rainbow: 2, skillful: 2 },
  frostLarge: { rainbow: 4, skillful: 3 },
  /** 医生: 休整期结束, +N layers to self, the tile in front and the tile behind (精锐 doubles). */
  docLayers: [3, 6],
  /** 双月: ON GAIN (获得时), +N layers to every active bond of the carrier. */
  ianaLayers: [5, 10],
  /**
   * 灰烬: 休整期结束, both bonds scale with the squad size. Below `size` members → the small pair,
   * at or above it → the large pair. 精锐 doubles both numbers.
   */
  ashSquadSize: 4,
  ashLayersSmall: { rainbow: 5, preci: 8 },
  ashLayersLarge: { rainbow: 10, preci: 12 },
  /** 艾拉: 8 members in play → her own received team lines +25%; otherwise +60% ATK / HP. 精锐 doubles both. */
  elaSquadSize: 8,
  elaFullSquadBonusPct: [0.25, 0.50],
  elaFallbackAtkPct: [0.60, 1.20],
  elaFallbackHpPct: [0.60, 1.20],
});

/**
 * 彩虹小队 bond text — written like the official core bonds (data/bonds.json `yanShip`): one headline line,
 * then one `<在场N名不同【彩虹小队】干员>` line per member, with every 加成 value highlighted.
 * An ELITE operator receives its own line at 125% of the normal value.
 *
 * The eight lines are also what each member contributes: 战车 / 导火索 / … in roster order, so the Nth
 * threshold is the Nth member of `RAINBOW_TEAM_BUFFS`.
 */
export const RAINBOW_BOND_TEXT =
  lines(
    `【彩虹小队】干员按层数为场上全体干员提供增益，精锐的【彩虹小队】干员提供的加成提高至${up(RAINBOW_BALANCE.elitePct * 100 + '%')}`,
    // One line per member: 战车 / 导火索 / … — the head names the member that has to stand on the field.
    ...RAINBOW_TEAM_BUFFS.map((b) =>
      `<在场干员为${b.memberName}>全体干员${up(b.label)}${up(b.text)}${b.fmt === 'flat' ? up('（基础）') : ''}`),
    acr('精锐的【彩虹小队】干员提供的加成提高至125%。'),
  );

/** True when `charId` is one of the eight collab operators. */
export function isRainbowCharacter(charId) {
  return Object.values(RAINBOW_CHARACTERS).includes(charId);
}

/** True when `charId` is one of the two trap characters of the squad. */
export function isRainbowTrapCharacter(charId) {
  return charId === RAINBOW_CHARACTERS.frost || charId === RAINBOW_CHARACTERS.ela;
}


/**
 * Team-wide mods for one layer count, given which members are on the field（用户 2026-10-11 重做）。
 *
 * Every operator on the field receives each line whose member is deployed（「加成全队」），数值 = base + perLayer×层数。
 * **精锐**成员把「自己提供的那一条」提高至 RAINBOW_BALANCE.elitePct（125%）——对包括自己在内的全体生效；
 * 不再区分接收者（mods 对全队一致）。
 *
 * @param {number} layers 彩虹小队 layers
 * @param {Iterable<string>|Set<string>} membersOnField rainbow character ids present
 * @param {Set<string>} [eliteMembers] the 彩虹小队 members present AS ELITE
 * @param {string|null} [_viewerCharId] 未使用（保留参数位兼容旧调用）
 * @returns {{ mods: object, healOnHit: number, ammoBonus: number }}
 */
export function rainbowTeamMods(layers, membersOnField, eliteMembers = null, _viewerCharId = null) {
  const present = membersOnField instanceof Set ? membersOnField : new Set(membersOnField || []);
  const elites = eliteMembers instanceof Set ? eliteMembers : new Set(eliteMembers || []);
  const mods = Object.create(null);
  let healOnHit = 0;
  let ammoBonus = 0;
  const n = Math.max(0, Number(layers) || 0);
  const add = (mod, value) => {
    if (value <= 0) return;
    if (mod === 'healOnHit') { healOnHit += value; return; }
    // 弹药上限: an ammo-kind skill's magazine grows by this many rounds (rainbow.js applies it).
    if (mod === 'ammoBonus') { ammoBonus += value; return; }
    if (mod === 'healingDealtMulPct') { mods.healingDealtMul = (mods.healingDealtMul ?? 1) * (1 + value); return; }
    if (mod === 'dmgDealtMulPct') { mods.dmgDealtMul = (mods.dmgDealtMul ?? 1) * (1 + value); return; }
    if (mod === 'spRecoveryMulPct') { mods.spRecoveryMul = (mods.spRecoveryMul ?? 1) * (1 + value); return; }
    if (mod === 'aspdPct') { mods.aspdPct = (mods.aspdPct ?? 0) + value; return; }
    // 艾拉的攻击速度：面板点数（引擎 `aspd` 加算键）
    if (mod === 'aspdFlat') { mods.aspd = (mods.aspd ?? 0) + value; return; }
    mods[mod] = (mods[mod] ?? 0) + value;
  };
  for (const line of RAINBOW_TEAM_BUFFS) {
    const charId = RAINBOW_CHARACTERS[line.member];
    if (!present.has(charId)) continue;
    // 精锐成员：自己提供的那条 ×125%（对全体生效）
    const mul = elites.has(charId) ? RAINBOW_BALANCE.elitePct : 1;
    add(line.mod, (line.base + line.perLayer * n) * mul);
  }
  return { mods, healOnHit, ammoBonus };
}
