// 莱茵生命 fan expansion. Balance values live here so both the browser and the server read the same source.
//
// 0.1.3-Rhine 重做：科研装置系统（生命维持仪 / 能量谐振仪 / 生态调控器、突破研究点、休整期装置界面）
// 整套移除，改由「伊芙利特体系」承载：只要在场达到 3 / 6 / 9 名不同【莱茵生命】干员，就依次
// 获得伊芙利特、把她升成精锐、再给她隐匿；伊芙利特的攻击力由基础值 + 科研层数 + 在场干员的加成决定。
export const RHINE_BOND = 'rhineShip';
export const RHINE_CHARACTERS = Object.freeze({
  mayer: 'char_242_otter', silence: 'char_108_silent', ptilopsis: 'char_128_plosis', saria: 'char_202_demkni',
  ifrit: 'char_134_ifrit', muelsyse: 'char_249_mlyss', halo2: 'char_1047_halo2', astgenne: 'char_135_halo',
  dorothy: 'char_4048_doroth', magallan: 'char_248_magallan',
});
export const RHINE_BALANCE = Object.freeze({
  /** 在场不同【莱茵生命】干员数达到 3 / 6 / 9 时依次：获得伊芙利特 / 升精锐 / 获得莱茵实验终端与联合研究主机。 */
  thresholds: [3, 6, 9],
  /** 9 名阈值发放的装备（普通品阶，各一件，每局一次）。 */
  thresholdItems: ['chess_item_rhine_terminal_a', 'chess_item_rhine_mainframe_a'],
  /** 伊芙利特：初始基础攻击力（普通 / 精锐）；每层科研 +2。梅尔在场时另有基础攻击力 +20（`mayerPresenceAtk`，不叠加）。 */
  ifritBaseAttack: [300, 500], ifritAttackPerLayer: 2,
  /** 每 1 层科研：所有莱茵生命干员基础生命值 +2、基础防御力 +1。 */
  layerStep: 1, layerHp: 2, layerDef: 1,
  /**
   * 9 名档新增：在场 9 名不同【莱茵生命】干员时，每层科研给**伊芙利特**的基础攻击力从 +2 提高到 +3
   * （server/sim/content/rhine.js refreshOp：与所有莱茵干员的生命 / 防御加成互不干扰）。
   */
  ifritAttackPerLayerTier3: 3,
  /**
   * 在场干员让伊芙利特获得的额外效果。**下表是普通（非精锐）版本的数值**；对应干员是精锐时，
   * 她给伊芙利特的加成整体再 ×`presenceEliteMul`（+50%），由 server/sim/content/rhine.js 结算。
   *   赫默 每秒回1%最大生命 / 星源 法术穿透+15 / 白面鸮 技力恢复+0.3 /
   *   塞雷娅 生命值+200 / 麦哲伦 攻击范围内敌方减速20% / 多萝西 攻速+30 /
   *   缪尔赛思 穿戴装备获得1.5倍效果 / 溯光星源 伊芙利特造成伤害提高20%。
   */
  presenceEliteMul: 1.5,
  presence: {
    silence: { hpRegenRatio: 0.01 },
    astgenne: { resIgnoreFlat: 15 },
    ptilopsis: { spRecoveryFlat: 0.3 },
    saria: { hpFlat: 200 },
    magallan: { slow: 0.20 },
    dorothy: { aspd: 30 },
    muelsyse: { equipMul: 1.5 },
    halo2: { dmgDealtMul: 0.20 },
  },
  /**
   * 1 本 梅尔：休整期结束时，莱茵生命每 6 层使伊芙利特**基础攻击力** +1；
   * 精锐梅尔改成每 4 层使伊芙利特**基础攻击力** +1。
   */
  mayerAtkLayerStep: 6, mayerEliteAtkLayerStep: 4, mayerIfritFlat: 1,
  /** 梅尔（在场效果）：伊芙利特基础攻击力 +20（精锐 ×presenceEliteMul，并入 u.base.atk）。 */
  mayerPresenceAtk: 20,
  /**
   * 2 本 星源（已改）：【莱茵生命】与【术师】每叠加 `astgenneAtkStep` 层，本干员攻击力 +`astgenneAtkPct`
   * （数据驱动：garrison `RHINE_ASTGENNE_ATK_PER_LAYER` 的 bb 可覆盖，见 server/sim/content/rhine.js）。
   * 旧的「每次开技能给莱茵生命与奥术加层」已移除。
   */
  astgenneAtkStep: 2, astgenneAtkPct: 0.01, astgennePartnerBond: 'casterShip',
  /**
   * 3 本 塞雷娅：战斗中，伊芙利特每次开启技能后，本干员攻击力 / 生命值 / 防御力 +10%（精锐 +20%）；
   * 每场战斗最多 +30%（精锐 +40%）。
   */
  sariaTriggerPct: [0.10, 0.20], sariaTriggerCap: [0.30, 0.40],
  /**
   * 4 本 麦哲伦：伊芙利特每次开启技能，莱茵生命与灵巧各 +4，每场战斗莱茵最多 12 层、灵巧最多 8 层。
   */
  magallanSkillLayers: [4, 8], magallanBattleCap: [12, 24], magallanSkillfulCap: [8, 16],
  /**
   * 5 本 多萝西：伊芙利特每次开启技能，只加莱茵生命（灵巧加成已移除），每场战斗莱茵最多 24 层。
   */
  dorothySkillLayers: [6, 12], dorothyBattleCap: [24, 48],
  /** 附加盟约 id（文案里没有「已激活」就不做激活判定）。 */
  arcaneBondId: 'arcaneShip', skillfulBondId: 'skillfulShip', steadBondId: 'steadShip',
  /** 保持不变的三位（文案未改）：赫默 <进入休整期时> 莱茵+4/远见+2；白面鸮 每名在场莱茵+2 层；溯光星源 每花 3 资金 莱茵+3/灵巧奥术+2。 */
  silenceRhineLayers: [4, 8], silenceVisiLayers: [2, 4], ptilopsisLayersPerMember: [2, 4],
  halo2CoinStep: 3, halo2RhineLayers: [3, 6], halo2Layers: [2, 4],
  /** 召唤物上限（梅尔的水獭 / 多萝西的陷阱），与科研装置无关，保持不变。 */
  mayerSummons: [1, 2], dorothyTrapLimit: [4, 5],
});
// Equipment values are shared by generated records and the combat implementations.
export const RHINE_EQUIPMENT = Object.freeze({
  /**
   * 莱茵实验终端（3 本 / 2 资金）：攻击力加成不变；原先「每 10 层科研 +攻速」整条删除，改成只对伊芙利特生效的
   * 「基础攻击力 +50」（精锐 +100）。
   */
  terminal: Object.freeze({ key: 'chess_item_rhine_terminal', tier: 3, attack: [0.15, 0.25], ifritBaseAtk: [50, 100] }),
  /**
   * 联合研究主机（6 本 / 4 资金）：携带者不是伊芙利特 → 生命上限 +45%（精锐 +90%）；是伊芙利特 → 基础攻击力 +100
   * （精锐 +200）；她若同时装备莱茵实验终端，再 +50（精锐 +100）并额外附带 10%（精锐 15%）攻击力的灼热损伤。
   */
  mainframe: Object.freeze({
    key: 'chess_item_rhine_mainframe', tier: 6, hp: [0.45, 0.90],
    ifritBaseAtk: [100, 200], pairBaseAtk: [50, 100], pairBurn: [0.10, 0.15],
  }),
});
