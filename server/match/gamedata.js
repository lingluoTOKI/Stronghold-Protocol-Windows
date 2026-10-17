// server/match/gamedata.js — typed, defaulted view of data/*.json for the match engine.
//
// Every lookup is an own-property lookup (ids come from client intents) that never throws and returns null for
// unknown ids. Tunables come from data/config.json with the documented defaults (research 00-INDEX §2–§8) when a
// key is missing, so a partial data set (tests, data being regenerated) still yields a working match.
//
// No custom balance (DESIGN §14 corrections, research 08 §6): enemy numbers are the official ones — the PRTS
// per-round enemyScale table of data/config.json, the leader pool = bloodPoint per player alive at the fight's start
// (bossPoolShareOf). data/tuning.json only overrides result titles:
//   titles[titleId]                                                { stat?, rule? } merged over config.titles
// (the former enemyHpMul / enemyAtkMul / enemySpeedMul / bossHpMul / flyPlaceholders knobs were removed; a tuning file
// that still carries them is ignored).

import { getConfig, getMode } from '../data.js';
import { normalizeScope } from '../../shared/bondScope.js';
import { isShopItem } from '../sim/simdata.js';
import { mergeData } from '../../shared/plugins/dataUtils.js';
import { standInRecord } from '../../shared/standIn.js';
import { MAX_OFFER_SLOTS } from './player/common.js';

const own = (map, id) => (map && typeof map === 'object' && typeof id === 'string' && Object.hasOwn(map, id) && map[id] && typeof map[id] === 'object' ? map[id] : null);
const numOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const posIntOr = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);
/** 非负整数：0 是**有效值**（maxArtsPerRound 用 0 表示「不限制」）。 */
const nonNegIntOr = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);

export const DEFAULTS = Object.freeze({
  income: [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 12, 12, 12, 12, 12],
  incomeCap: 12,
  chessPrice: { 1: 2, 2: 3, 3: 3, 4: 3, 5: 4, 6: 4 },
  sellPrice: 1,
  refreshPrice: 1,
  poolCopies: { 1: 12, 2: 14, 3: 18, 4: 16, 5: 8, 6: 5 },
  mergeCount: 3,
  goldenCopies: 3,
  itemMergeCount: 2,
  benchSize: 10,
  tempSize: 5,
  deployCap: 8,
  equipPerChess: 2,
  // 法术（Art）每个休整期的使用次数上限；0 = 不限制。用户 2026-10-13：去掉「每回合只能使用两次」
  // （原本用来约束如意红包，实际是全局法术上限）。
  maxArtsPerRound: 0,
  rewardOffer: { count: 3, tierOffset: 1, maxTier: 6, price: 0 },
  upgradePrices: [5, 8, 11, 12, 13],
  maxShopLevel: 6,
  shopSlots: { 1: { chess: 3, item: 1 }, 2: { chess: 4, item: 1 }, 3: { chess: 4, item: 1 }, 4: { chess: 5, item: 1 }, 5: { chess: 5, item: 1 }, 6: { chess: 5, item: 1 } },
  defaultBandId: 'band_bldsk',
  defaultStartLp: 28,
  lpCapPerRound: 10,
  bossOvertimeAfter: 150,
  bossOvertimeDrainPerSec: 1,
  hiddenCore: { single: 350, multi: 1200, minTeamLpExclusive: 1, difficulties: ['NORMAL', 'HARD', 'ABYSS'] },
  dp: { init: 10, perSec: 1, max: 99 },
  unite: { maxHelpers: 2, templates: { 1: 'act1autochess_escaped_single', 2: 'act1autochess_escaped_multi' } },
  timers: { infoCheck: 25, bandDraft: 50, bandTurn: 30, battleCheck: 3, spFirst: 30, spTurn: 16, contractFirst: 60 },
  // 开局抽禁数量：0.2.1 原版值（商店刷新按原版包走，盟约档与契约档同一套）
  bans: { FUNNY: { core: 0, addon: 1 }, NORMAL: { core: 3, addon: 4 }, HARD: { core: 3, addon: 4 }, ABYSS: { core: 3, addon: 4 } },
  bandDraft: { skipsPerPlayer: 1, timeoutBandId: 'band_bldsk' },
  leftoverFundsKeptByBands: ['band_cannot'],
});

/** Game seconds per real second of a battle (forced 2×): combat limits in data are real seconds (combatTimeLimit). */
export const COMBAT_TIME_SCALE = 2;

/**
 * Multiplier of bloodPoint[difficulty] for the shared leader pool (DESIGN §20.10, §25.13.4), from config bossHpScale —
 * each key from the mode's entry first, then the global one; the defaults are the current rule:
 *   solo   `solo` (1: the table value — one player's share);
 *   co-op  `perPlayer` true (the owner's decision of 2026-10-06, adopting PR #209 by @qingjingshenghuo): `coop` (1) × the
 *          players alive when the fight starts — bots and AI 托管 seats count, eliminated and departed seats do not —
 *          at most `aliveFull` (4); a count left out means a full team;
 *          `perPlayer` false: the fixed pool of 0.1.x (「保持固定血量」, restorable with `solo` 0.25): `coop` whatever the
 *          count, × min(alive, aliveFull) / aliveFull with `aliveScaling`.
 * @param {object|null|undefined} modeScale config.modes[modeId].bossHpScale
 * @param {object|null|undefined} cfgScale config.bossHpScale
 * @param {boolean} isSolo
 * @param {number} [aliveCount] alive players at the Final Assault / Hidden Core start (co-op)
 * @returns {number}
 */
export function bossPoolShareOf(modeScale, cfgScale, isSolo, aliveCount) {
  const ms = modeScale && typeof modeScale === 'object' ? modeScale : {};
  const cs = cfgScale && typeof cfgScale === 'object' ? cfgScale : {};
  const pick = (k, d) => (Number.isFinite(ms[k]) && ms[k] > 0 ? ms[k] : Number.isFinite(cs[k]) && cs[k] > 0 ? cs[k] : d);
  const flag = (k, d) => (typeof ms[k] === 'boolean' ? ms[k] : typeof cs[k] === 'boolean' ? cs[k] : d);
  if (isSolo) return pick('solo', 1);
  const full = Math.max(1, Math.floor(pick('aliveFull', 4)));
  const n = Number(aliveCount);
  const alive = Number.isFinite(n) && n >= 1 ? Math.min(full, Math.floor(n)) : full;
  if (flag('perPlayer', true)) return pick('coop', 1) * alive;
  return pick('coop', 1) * (flag('aliveScaling', false) ? alive / full : 1);
}

/** Strip the _a/_b suffix of an item id (the registry key of an item family). */
export const itemKey = (id) => (typeof id === 'string' ? id.replace(/_[ab]$/, '') : '');

export class GameData {
  /**
   * @param {Readonly<Record<string, any>>} data server/data.js getData() (may be partial)
   * @param {string} modeId e.g. 'mode_multi_hard'
   * @param {'mod'|'official'|null} [scope] 显示范围（shared/bondScope.js）—— 盟约档用原版的抽禁口径
   */
  constructor(data, modeId, scope = null) {
    this.raw = data && typeof data === 'object' ? data : {};
    this.config = getConfig(this.raw) || {};
    this.modeId = modeId;
    /** 显示范围（'mod' 契约 / 'official' 盟约 / null 不筛选）—— 只影响开局抽禁与卡池，见 match/pool.js */
    this.scope = scope == null ? null : normalizeScope(scope);
    /** 开发者功能扩展：shopSlots 的 per-match 覆盖（MatchDev 的 'shopSlots' action 设置；null = 用 mode/默认）。 */
    this.devShopSlots = null;
    /**
     * 「无限模拟」越界成长（Match 在 endless 局挂上，见 shared/constants.js ENDLESS_GROWTH）：
     *   `{ from: 首领回合, baseRound: 14, hp: 0.1, atk: 0.1, speed: 0, compound: true }`
     * 含义（用户 2026-10-17）：R1–R14 完全按终极模拟的表；**R15 起**以 `baseRound`(R14) 那一档为基数，
     * 每回合约 **×1.1**（乘算）：R15 = 基数×1.1、R16 = 基数×1.1² …；null = 关（其它模式一点不受影响）。
     * @type {{ from: number, baseRound?: number, hp: number, atk: number, speed: number, compound?: boolean } | null}
     */
    this.endlessGrowth = null;
    /**
     * 本局当前回合（Match 每回合开始写入）。endless 局的**普通波次**是照最后一档普通回合（R13）的配置生成的，
     * buildNormalWave 传给 enemyScale 的回合号因此是 13，但敌人属于的是本局真正的回合 —— 越界成长取两者中靠后的
     * 那个（见 enemyScale）。其他对局这个值不参与任何计算。
     * @type {number}
     */
    this.endlessRound = 0;
    this.mode = getMode(modeId, this.raw) || {};
    // Mode-level globals inherit field by field; the vanilla mode never changes its config object.
    const overrides = Object.fromEntries(Object.keys(this.config).filter(k => k !== 'modes' && Object.hasOwn(this.mode, k)).map(k => [k, this.mode[k]]));
    if (Object.keys(overrides).length) this.config = mergeData(this.config, overrides);
    this.economy = this.config.economy && typeof this.config.economy === 'object' ? this.config.economy : {};
    const chess = this.raw.chess && typeof this.raw.chess === 'object' ? this.raw.chess : {};
    this._chess = chess;
    this._items = this.raw.items && typeof this.raw.items === 'object' ? this.raw.items : {};
    // Fixed operator gifts are unlimited outputs, but every produced normal/advanced item still occupies 1/2 copies
    // (card-pool experiment BV1eLXXBqEgF, maintainer-confirmed 2026-10-11). Random subset gifts are not exempt.
    this._fixedGiftItems = new Set(Object.values(this.raw.garrisons || {})
      .filter(g => g.effectKey === 'SERVER_GAIN_EQUIP').map(g => g.bbStr?.chess).filter(id => this._items[id]));
    this._bonds = this.raw.bonds && typeof this.raw.bonds === 'object' ? this.raw.bonds : {};
    /** visible, droppable base (normal) chess ids — 入池**不看** `shop` 标记：非卖品（伊芙利特 / 罗德岛 starter）同样占份数，抽取时由 shopEligible 过滤 */
    this.visibleChess = Object.keys(chess).filter((id) => {
      const c = chess[id];
      return c && c.visible && !c.isGolden && !c.isDiy && !c.isHidden && Number.isInteger(c.tier);
    }).sort();
    /**
     * Shop item ids by tier (sim/simdata.js isShopItem: normal EQUIP, not hidden, not effect-only — the special
     * 维式重锤 and 突变细胞 are never sold). Every shop-item draw uses it: the shop item slot (pool.js), the 道具补给 /
     * 机密商店 cards (choices.js) and the shop-eligible item pools (Match.rollItemId). A pool's `also` list
     * (pool_equip_kathe: 突变细胞, #631) is appended there and is not in this table, so the shop slot still never sells it.
     */
    this.shopItemsByTier = {};
    for (const [id, it] of Object.entries(this._items)) {
      if (!isShopItem(it)) continue;
      (this.shopItemsByTier[it.tier] ||= []).push(id);
    }
    for (const k of Object.keys(this.shopItemsByTier)) this.shopItemsByTier[k].sort();
    this.bondIds = Object.keys(this._bonds).sort((a, b) => (numOr(this._bonds[a].identifier, 99) - numOr(this._bonds[b].identifier, 99)) || (a < b ? -1 : 1));
    this.modeInactiveBonds = new Set(Array.isArray(this.mode.inactiveBondIds) ? this.mode.inactiveBondIds : []);
    /** bandBondIds memo */
    this._bandBonds = new Map();
    this.inactiveEnemies = new Set(Array.isArray(this.mode.inactiveEnemyKeys) ? this.mode.inactiveEnemyKeys : []);
    /** data/tuning.json (titles only, see the header) */
    this.tuning = this.raw.tuning && typeof this.raw.tuning === 'object' ? this.raw.tuning : {};
    /** standIn memo: chess id → composed 补位 record | null */
    this._standIns = new Map();
  }

  /**
   * Leader HP pool multiplier — always 1 (no custom balance). Kept for callers written against the old tuning layer
   * (finalAssault.bossPoolHp); use `bossPoolHp` / `bossPoolShare` for the official pool.
   * @deprecated
   */
  bossHpMul(bossId) { // eslint-disable-line no-unused-vars
    return 1;
  }

  /**
   * Shared leader HP pool (DESIGN §20.10, §25.13.4): ONE pool for every boss field of the match (official tip "最终攻势中，
   * 所有人将一起对敌方领袖造成伤害"; the mirrored copies of a pair field share it — notice 5114 "两侧的敌方领袖共享生命值
   * （敌方领袖的总生命值不变）", which is about those copies). Size = bloodPoint[difficulty] × bossPoolShare: the table value
   * per player alive when the fight starts (the owner's decision of 2026-10-06, PR #209; it replaces the fixed pool of
   * 「保持固定血量」, which config bossHpScale restores — bossPoolShareOf); `aliveCount` omitted ⇒ a full team. Leaders are
   * never scaled by enemyScale ("领袖单位于服务器的生命值加成不受上述加成影响").
   * @param {string} bossId
   * @param {number} [aliveCount] alive players at the Final Assault / Hidden Core start (co-op)
   * @returns {number}
   */
  bossPoolHp(bossId, aliveCount) {
    const boss = this.boss(bossId);
    const diff = this.difficulty;
    let base = boss && boss.bloodPoint && Number.isFinite(boss.bloodPoint[diff]) ? boss.bloodPoint[diff] : null;
    if (base == null && boss && boss.bloodPoint) base = Object.values(boss.bloodPoint).find((v) => Number.isFinite(v)) ?? null;
    if (base == null) base = 500000;
    return Math.max(1, Math.round(base * this.bossPoolShare(aliveCount)));
  }

  /**
   * Multiplier of bloodPoint for the leader pool (see bossPoolHp; the rule and the config keys: bossPoolShareOf).
   * @param {number} [aliveCount]
   */
  bossPoolShare(aliveCount) {
    return bossPoolShareOf(this.mode.bossHpScale, this.config.bossHpScale, this.isSolo, aliveCount);
  }

  /** config.titles with the tuning overrides (stat / rule per title id) merged in. */
  get titles() {
    const list = Array.isArray(this.config.titles) ? this.config.titles : [];
    const ov = this.tuning.titles && typeof this.tuning.titles === 'object' ? this.tuning.titles : {};
    return list.map((t) => {
      if (!t || typeof t.id !== 'string' || !Object.hasOwn(ov, t.id) || !ov[t.id] || typeof ov[t.id] !== 'object') return t;
      const o = ov[t.id];
      const out = { ...t };
      if (typeof o.stat === 'string') out.stat = o.stat;
      if (o.rule === 'max' || o.rule === 'min') out.rule = o.rule;
      return out;
    });
  }

  // ---- ids ------------------------------------------------------------------------------------------

  chess(id) { return own(this._chess, id); }
  item(id) { return own(this._items, id); }
  bond(id) { return own(this._bonds, id); }
  band(id) { return own(this.raw.bands, id); }
  garrison(id) { return own(this.raw.garrisons, id); }
  effect(id) { return own(this.raw.effects, id); }
  enemy(key) { return own(this.raw.enemies, key); }
  wave(id) { return own(this.raw.waves, id); }
  stage(id) { return own(this.raw.stages, id); }
  boss(id) { return own(this.raw.bosses, id); }
  token(id) { return own(this.raw.tokens, id) ?? own(this.raw.backups && this.raw.backups.tokens, id); }
  get choices() { return this.raw.choices && typeof this.raw.choices === 'object' ? this.raw.choices : {}; }
  get factions() { return this.raw.factions && typeof this.raw.factions === 'object' ? this.raw.factions : {}; }

  /**
   * 商店可购判定：`chess.shop === false` 的干员**不进任何商店风格的随机抽取**（这类干员各有专属获取途径，
   * 被随机抽出来就是漏子）：
   *   * 伊芙利特 `chess_rhine_ifrit_a/b` —— 仅由【莱茵生命】在场的莱茵干员达到 6 名时发放
   *     （match/factions.js `rhineIfritCheck`，`acquireChess(..., { fromPool: false })`，不占共享池份数）；
   *   * 罗德岛 starter 与精锐（shared/rodosIsland.js 的 `shop: false` 条目）—— 罗德岛盟约专属。
   * 岁干员 `chess_sui_*` **不在**此列：2026-10-16 用户裁定「如意红包是额外给的，岁本来就能在商店买到」——
   * 这 10 条（5 本体 + 5 精锐）的 `shop` 已改回 true，商店槽 / 晋升三选一 / shopEligible 池都照常抽得到。
   * 三个调用点共用这一个口径（2026-10-16 统一；此前只有商店槽过滤了）：
   *   player/economy.js `_rollChessSlot`（商店抽卡）、player/acquire.js `pushRewardOffer`（晋升 / 合成精锐的
   *   免费三选一）、match/spDraft.js `rollPool`（choices.json 里 `rule: 'shopEligible'` 的池）。
   */
  shopEligible(id) { return this.chess(id)?.shop !== false; }

  /**
   * The 补位 record of chess `id` (normal or elite; DATA.md §18): shared/standIn.js standInRecord over data/backups.json
   * — the chess's identity (ids, tier, bonds, 特质, price, merge) with its official stand-in's body (stats, range, skills
   * with the backup skill as the default, talents, module, art, `standInFor`). Null for a PRESET / 自选 chess, an unknown
   * id or data without backups.json. Memoized (frozen records).
   * @param {string} id
   * @returns {object|null}
   */
  standIn(id) {
    if (typeof id !== 'string') return null;
    if (this._standIns.has(id)) return this._standIns.get(id);
    const c = this.chess(id);
    const backups = this.raw.backups && typeof this.raw.backups === 'object' ? this.raw.backups : null;
    let rec;
    try { rec = c && backups ? standInRecord(c, backups) : null; } catch { rec = null; }
    if (rec) Object.freeze(rec);
    this._standIns.set(id, rec);
    return rec;
  }

  /** Normal (base) chess id of a chess id (golden → base). */
  baseIdOf(id) {
    const c = this.chess(id);
    if (!c) return typeof id === 'string' ? id.replace(/_b$/, '_a') : null;
    return c.baseId || (c.isGolden ? id.replace(/_b$/, '_a') : id);
  }

  goldenIdOf(id) {
    const c = this.chess(this.baseIdOf(id));
    if (c && c.goldenId && this.chess(c.goldenId)) return c.goldenId;
    const alt = typeof id === 'string' ? id.replace(/_a$/, '_b') : null;
    return alt && this.chess(alt) ? alt : null;
  }

  isGolden(id) { const c = this.chess(id) || this.item(id); return !!(c && c.isGolden); }

  tierOf(id) {
    const c = this.chess(id) || this.item(id);
    return c && Number.isInteger(c.tier) ? c.tier : 1;
  }

  // ---- economy --------------------------------------------------------------------------------------

  income(round) {
    const arr = Array.isArray(this.economy.income) ? this.economy.income : DEFAULTS.income;
    const cap = numOr(this.economy.incomeCap, DEFAULTS.incomeCap);
    const v = arr[round];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    return Math.max(0, Math.min(cap, 3 + round));
  }

  /**
   * Shop price of a chess — **always the tier table**, never the record's own `price` (user rulings 2026-10-13
   * "所有5阶6阶干员售价均为4" / 2026-10-14 "所有2 3 4阶干员购买的资金均为3" / 2026-10-16 同上，契约模式同口径).
   *
   * `data/chess.json` carries a per-record `price` copied verbatim from the source table by the importer. 114 visible
   * records disagree with their own tier (tier 2: 烈夏 / 凛冬 at 2 and 19 golden copies at 4; tier 4: 迷迭香 at 4,
   * 苦艾 4 with its golden at 5; tier 5/6: 早露 5/6、怒潮凛冬 6/7、维什戴尔…), so reading that field first made those
   * operators cost something other than their tier's price — the 「乌萨斯几个卖的价钱还是异常」 report of 2026-10-16
   * (早露 5/6、怒潮凛冬 6/7、凛冬 2、烈夏 2、真理 4、苦艾 4/5).
   *
   * Price is therefore a pure function of the **RESOLVED** tier (an elite inherits its base tier's price; the record's
   * `price` is deliberately never consulted — the data keeps it only as provenance, see `_verify/_verify-shop-price.mjs`).
   * Resolution order:
   *   1. `mode.economy.chessPrice[tier]`   — per-mode override, for a mode that wants its own economy scale
   *   2. `config.economy.chessPrice[tier]` — the install's table, {1:2, 2/3/4:3, 5/6:4}
   *   3. `DEFAULTS.chessPrice[tier]`       — the same table, so a partial data set still charges tier prices
   * Each level accepts either `{normal, golden}` or a bare number.
   */
  chessPrice(id) {
    const c = this.chess(id);
    const tier = this.tierOf(id);
    const quality = c && c.isGolden ? 'golden' : 'normal';
    const fallback = DEFAULTS.chessPrice[tier] ?? 3;
    const override = this.mode.economy?.chessPrice?.[tier];
    if (override && typeof override === 'object') {
      const v = override[quality];
      if (Number.isFinite(v) && v >= 0) return v;
    } else if (Number.isFinite(override) && override >= 0) return override;
    const row = this.economy.chessPrice && this.economy.chessPrice[tier];
    if (row && typeof row === 'object') return numOr(row[quality], fallback);
    return numOr(row, fallback);
  }

  sellPrice(id) {
    const c = this.chess(id);
    const override = this.mode.economy?.chessSell?.[this.tierOf(id)]?.[c?.isGolden ? 'golden' : 'normal'];
    if (Number.isFinite(override) && override >= 0) return override;
    if (c && Number.isFinite(c.sellPrice) && c.sellPrice >= 0) return c.sellPrice;
    const tier = this.tierOf(id);
    const row = this.economy.chessSell && this.economy.chessSell[tier];
    if (row && typeof row === 'object') return numOr(c && c.isGolden ? row.golden : row.normal, DEFAULTS.sellPrice);
    return DEFAULTS.sellPrice;
  }

  itemPrice(id) {
    const it = this.item(id);
    return it && Number.isFinite(it.price) && it.price >= 0 ? it.price : 2;
  }

  get refreshPrice() { return Math.max(0, numOr(this.economy.refreshPrice, DEFAULTS.refreshPrice)); }
  get benchSize() { return posIntOr(this.economy.benchSize, DEFAULTS.benchSize); }
  get tempSize() { return posIntOr(this.economy.tempSize, DEFAULTS.tempSize); }
  get deployCap() { return posIntOr(this.economy.deployCap, DEFAULTS.deployCap); }
  get equipPerChess() { return posIntOr(this.economy.equipPerChess, DEFAULTS.equipPerChess); }
  get maxArtsPerRound() { return nonNegIntOr(this.economy.maxArtsPerRound, DEFAULTS.maxArtsPerRound); }
  get goldenCopies() { return posIntOr(this.economy.goldenCopies, DEFAULTS.goldenCopies); }
  get itemMergeCount() { return posIntOr(this.economy.itemMergeCount, DEFAULTS.itemMergeCount); }
  get leftoverKeptBands() {
    const ids = Array.isArray(this.economy.leftoverFundsKeptByBands) ? this.economy.leftoverFundsKeptByBands : DEFAULTS.leftoverFundsKeptByBands;
    const extra = Object.values(this.raw.bands || {}).filter(b => b.effectRef && ids.includes(b.effectRef)).map(b => b.bandId);
    return extra.length ? [...ids, ...extra] : ids;
  }
  get defaultBandId() { return typeof this.economy.defaultBandId === 'string' ? this.economy.defaultBandId : DEFAULTS.defaultBandId; }
  get defaultStartLp() { return posIntOr(this.economy.defaultStartLp, DEFAULTS.defaultStartLp); }

  rewardOffer() {
    const r = this.economy.rewardOffer && typeof this.economy.rewardOffer === 'object' ? this.economy.rewardOffer : {};
    return {
      // (an offer shows at most MAX_OFFER_SLOTS: a larger count — a data plugin's — only rolled for slots nobody sees)
      count: Math.min(MAX_OFFER_SLOTS, posIntOr(r.count, DEFAULTS.rewardOffer.count)),
      tierOffset: Number.isInteger(r.tierOffset) ? r.tierOffset : DEFAULTS.rewardOffer.tierOffset,
      maxTier: posIntOr(r.maxTier, DEFAULTS.rewardOffer.maxTier),
      price: Math.max(0, numOr(r.price, 0)),
    };
  }

  /**
   * Copies of a base chess in the shared pool — and, for a DIY slot, of a slotted 自选 piece in its player's own stock
   * (player/diy.js buildDiyStock).
   */
  poolCopies(baseId) {
    const ov = this.economy.poolCopiesOverrides;
    const tier = this.tierOf(baseId);
    const pc = this.economy.poolCopies;
    const v = ov && Number.isInteger(ov[baseId]) && ov[baseId] >= 0 ? ov[baseId] : pc?.[tier];
    const base = Number.isInteger(v) && v >= 0 ? v : (DEFAULTS.poolCopies[tier] ?? 10);
    // Co-op doubles the single-player counts: the measured shared pool (shared by the whole team, independent of team
    // size) and each player's private 自选 stock alike — the maintainer's decision of 2026-10-15 (GitHub #650): with
    // the shared pool doubled and the 自选 stock not, a 自选 operator was diluted in the copy-weighted rolls.
    const multiplier = this.isSolo ? 1 : posIntOr(this.economy.coopPoolMultiplier, 1);
    return base * multiplier;
  }

  /** Normal equipment copies in the shared pool; effect-only items have no shop stock limit. */
  itemPoolCopies(id) {
    const base = this.baseIdOf(id), rec = this.item(base);
    if (!rec || !isShopItem(rec)) return null;
    const count = this.economy.itemPoolCopiesOverrides?.[base] ?? this.economy.itemPoolCopies?.[rec.tier];
    return Number.isInteger(count) && count >= 0 ? count : null;
  }

  /** Whether a fixed trait gift may be produced beyond stock (including the advanced version of that item). */
  isUnlimitedGiftItem(id) { return this._fixedGiftItems.has(this.baseIdOf(id)); }

  /**
   * Copies needed to merge (0 = never merges: golden chess). Uniform 3 for every tier (2026-10-13, user ruling
   * "所有干员都需要3个才能精锐"): a handful of records carried a hand-authored `upgradeNum: 2` (风丸, the 岁 / 龙门 /
   * 企鹅 / 喀兰 自选 series) and `economy.mergeCountOverrides` pinned 风丸 as well, so those operators elite'd on two
   * copies while every other one needed three. The per-record value is now ignored outright rather than the data
   * being rewritten — the minified data/chess.json keeps its fields (other tooling reads them) and a future data
   * refresh cannot reintroduce a divergent count.
   */
  mergeCount(id) {
    const c = this.chess(id);
    if (!c || c.isGolden) return 0;
    return posIntOr(this.economy.mergeCount, DEFAULTS.mergeCount);
  }

  // ---- mode -----------------------------------------------------------------------------------------

  get isSolo() { return this.mode.type === 'SINGLE' || /^mode_single_/.test(this.modeId || ''); }
  get difficulty() { return this.mode.difficulty || (this.modeId ? String(this.modeId).split('_').pop().toUpperCase() : 'NORMAL'); }
  get lastRound() {
    if (Number.isInteger(this.mode.lastRound) && this.mode.lastRound > 0) return this.mode.lastRound;
    return this.modeId === 'mode_single_funny' ? 9 : 14;
  }
  get bossRound() { return Number.isInteger(this.mode.bossRound) && this.mode.bossRound > 0 ? this.mode.bossRound : this.lastRound; }
  get hiddenRound() { return Number.isInteger(this.mode.hiddenRound) && this.mode.hiddenRound > 0 ? this.mode.hiddenRound : null; }
  get maxShopLevel() { return posIntOr(this.mode.maxShopLevel, DEFAULTS.maxShopLevel); }

  roundCfg(r) {
    const rounds = this.mode.rounds;
    return rounds && typeof rounds === 'object' && rounds[String(r)] && typeof rounds[String(r)] === 'object' ? rounds[String(r)] : null;
  }

  spRounds() { return Array.isArray(this.mode.spRounds) ? this.mode.spRounds.filter((n) => Number.isInteger(n)) : []; }

  /** 契约选择的回合（本作新增，data/config.json modes[].contractRounds，2/8/12）。 */
  contractRounds() { return Array.isArray(this.mode.contractRounds) ? this.mode.contractRounds.filter((n) => Number.isInteger(n)) : []; }

  upgradePrices() {
    const arr = Array.isArray(this.mode.upgradePrices) ? this.mode.upgradePrices : DEFAULTS.upgradePrices;
    return arr.map((v) => Math.max(0, numOr(v, 99)));
  }

  /** Base price to go from `level` to level+1 (null at max). */
  upgradeBase(level) {
    if (level >= this.maxShopLevel) return null;
    const arr = this.upgradePrices();
    return arr[level - 1] ?? 99;
  }

  shopSlots(level) {
    const s = this.mode.shopSlots && this.mode.shopSlots[String(level)];
    const d = DEFAULTS.shopSlots[level] || DEFAULTS.shopSlots[6];
    // 开发者功能扩展：面板的 shopSlots 覆盖（dev 局，devMode.js 的 'shopSlots' action 写入）——
    // 只改调度中心的商品栏位数，item 栏位仍按 mode / 默认走。
    const dev = this.devShopSlots;
    const devChess = dev && Number.isInteger(dev.chess) && dev.chess >= 0 ? dev.chess : null;
    if (s && typeof s === 'object') {
      const chess = Number.isInteger(s.chess) && s.chess >= 0 ? s.chess : d.chess;
      const item = Number.isInteger(s.item) && s.item >= 0 ? s.item : d.item;
      return { chess: Math.min(devChess ?? chess, 8), item: Math.min(item, 4) };
    }
    // 没有 mode 配置时整份默认值照发（保持原语义：可能不止 chess / item 两个键）
    return devChess == null ? { ...d } : { ...d, chess: Math.min(devChess, 8) };
  }

  /** Real-second prep timer for round r (null = untimed). */
  prepTime(r) {
    const rc = this.roundCfg(r);
    if (!rc) return this.isSolo ? null : 90;
    const v = rc.prepTime;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }

  /** The round level's `maxPlayTime` (config rounds[r].combatTimeLimit) as data gives it — REAL seconds. */
  combatTimeLimitReal(r) {
    const rc = this.roundCfg(r);
    const v = rc ? rc.combatTimeLimit : undefined;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    const m = this.mode.combatTimeLimit && this.mode.combatTimeLimit[String(r)];
    return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 60;
  }

  /**
   * Combat time limit of round r in GAME seconds (what the Battle and 联防 use): maxPlayTime × the forced battle speed
   * (config.combatTimeScale, default COMBAT_TIME_SCALE 2). `maxPlayTime` counts real seconds of the 2× battle: read
   * as game seconds, the rounds' own spawn schedules would not fit (R2 spawns its last flyer at 43 s of a 45 s limit,
   * R3 at 62 s of 55 s — enemies that can never be killed, or never spawn), while × 2 every limit is ≈ the last spawn +
   * one flyer crossing (R2 43 + 44 ≈ 90, R3 62 + 44 ≈ 110, R5 38 + 67 ≈ 110). docs/BALANCE.md §2.1.
   */
  combatTimeLimit(r) {
    return this.combatTimeLimitReal(r) * this.combatTimeScale;
  }

  /** Game seconds per real second of a battle (config.combatTimeScale, default COMBAT_TIME_SCALE 2). */
  get combatTimeScale() {
    const k = numOr(this.config.combatTimeScale, COMBAT_TIME_SCALE);
    return k > 0 ? k : COMBAT_TIME_SCALE;
  }

  /**
   * The boss round level's `maxPlayTime` (config rounds[r].levelMaxPlayTime, 120) in REAL seconds — the countdown of
   * the Final Assault / Hidden Core. It is not a hard stop there ("计时结束后战斗仍然会继续", research 01 §10); null
   * when the data has none.
   */
  bossLevelTime(r) {
    const rc = this.roundCfg(r);
    const v = rc ? rc.levelMaxPlayTime : undefined;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }

  /**
   * Official enemy multipliers of round r (config enemyScale: the PRTS table + 终极 speed ×1.15 from R3). `supplyHpMul`
   * (only when ≠ 1: co-op 终极 R5–R15) = the share of hpMul from 补给线 / 补给线II (config `supplyHp`), effects whose
   * `enemy_exclude` leaves out the 14 器物 hit-count keys — they take hpMul / supplyHpMul (archetypes.js `times`).
   */
  baseEnemyScale(r) {
    const e = this.mode.enemyScale && this.mode.enemyScale[String(r)];
    if (!e || typeof e !== 'object') return { hpMul: 1, atkMul: 1, speedMul: 1 };
    const supply = numOr(e.supplyHp, 1);
    return {
      hpMul: Math.max(0.01, numOr(e.hp, 1)),
      atkMul: Math.max(0, numOr(e.atk, 1)),
      speedMul: Math.max(0.01, numOr(e.speed, 1)),
      ...(supply > 0 && supply !== 1 ? { supplyHpMul: supply } : {}),
    };
  }

  /**
   * Enemy multipliers of round r = the official table (baseEnemyScale), times the 「无限模拟」越界成长 when this
   * GameData belongs to an endless match (`endlessGrowth`, set by Match; null otherwise — every other match sees exactly
   * baseEnemyScale).
   *
   * 用户 2026-10-17 口径：**R1–R14 就是终极模拟的表**；**R15 起**以 **R14 那一档**为基数，每回合 **×1.2**（乘算）：
   *   R14: hp ×3.583181 / atk ×1.948717        （原表，不动）
   *   R15: ×1.2   → R16: ×1.44 → R17: ×1.728 …  （= 基数 × 1.2^(r−14)）
   * 见 shared/constants.js ENDLESS_GROWTH。
   *
   * The growth keys off the match's CURRENT round (`endlessRound`) when it is later than r: an endless run's normal wave
   * is composed from the last normal round's config, so buildNormalWave hands in that round's number, not this round's.
   */
  enemyScale(r) {
    const s = this.baseEnemyScale(r);
    const g = this.endlessGrowth;
    if (!g) return s;
    const rr = Math.max(Number(r) || 0, Number(this.endlessRound) || 0);
    if (!(rr > g.from)) return s;

    // 基数取「基准回合」（缺省 = 首领回合）那一档的原始倍率：用户「按照终极模拟的数值提升」。
    const baseRound = Number.isFinite(g.baseRound) ? g.baseRound : g.from;
    const base = this.baseEnemyScale(baseRound);
    const k = rr - baseRound;                       // 越界回合数：R15 ⇒ 1
    const compound = g.compound !== false;          // 默认乘算（新口径）
    /** 每回合 (1 + 增量)：乘算 ⇒ (1+v)^k，加法 ⇒ 1 + v·k（旧口径，保留以兼容） */
    const grow = (v, cur) => {
      const x = Math.max(0, numOr(v, 0));
      if (!x) return cur;
      return compound ? cur * Math.pow(1 + x, k) : cur * (1 + x * k);
    };
    return {
      ...s,
      hpMul: grow(g.hp, base.hpMul),
      atkMul: grow(g.atk, base.atkMul),
      speedMul: grow(g.speed, base.speedMul),
    };
  }

  timer(key) {
    const t = this.config.timers && this.config.timers[key];
    return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : DEFAULTS.timers[key] ?? 10;
  }

  get lpCapPerRound() { return posIntOr(this.config.lpCapPerRound, DEFAULTS.lpCapPerRound); }
  /**
   * Boss overtime (`bossTurnHpReduceTime` 150 / 1 LP per second): a server turn timer of turnInfoDataDict like
   * prepPhaseTime, so REAL seconds on the same clock as the boss level's 120 s maxPlayTime (combat limits are real
   * seconds, docs/BALANCE.md §2.1) — the level countdown runs out first, the battle continues, and the merged team LP
   * drains 1 per real second from the 150 s mark (research 01 §10, 06 §11.7). Read as game seconds the drain would
   * start at 75 real s (45 s before the countdown ends) at 2 LP per real second.
   */
  get bossOvertimeAfterReal() { return Math.max(0, numOr(this.config.bossOvertimeAfter, DEFAULTS.bossOvertimeAfter)); }
  /** Team LP drained per REAL second of overtime. */
  get bossOvertimeDrainReal() { return Math.max(0, numOr(this.config.bossOvertimeDrainPerSec, DEFAULTS.bossOvertimeDrainPerSec)); }
  /** Overtime start in GAME seconds of a boss field clock (150 real s × the forced 2× = 300). */
  get bossOvertimeAfter() { return this.bossOvertimeAfterReal * this.combatTimeScale; }
  /** Team LP drained per GAME second of overtime (1 per real second = 0.5 per game second). */
  get bossOvertimeDrain() { return this.bossOvertimeDrainReal / this.combatTimeScale; }
  /**
   * Team LP the overtime drain has taken when a boss field clock reads `gt` game seconds: bossOvertimeDrainReal per
   * whole REAL second past bossOvertimeAfterReal (the first point at 151 real s).
   */
  bossOvertimeDue(gt, afterReal = this.bossOvertimeAfterReal) {
    const over = (Number(gt) || 0) / this.combatTimeScale - afterReal;
    return over >= 1 ? Math.floor(over) * this.bossOvertimeDrainReal : 0;
  }
  get dp() {
    const d = this.config.dp && typeof this.config.dp === 'object' ? this.config.dp : {};
    return { dpInit: numOr(d.init, 10), dpPerSec: numOr(d.perSec, 1), dpMax: numOr(d.max, 99) };
  }
  get unite() {
    const u = this.config.unite && typeof this.config.unite === 'object' ? this.config.unite : {};
    return {
      maxHelpers: posIntOr(u.maxHelpers, DEFAULTS.unite.maxHelpers),
      templates: u.templates && typeof u.templates === 'object' ? u.templates : DEFAULTS.unite.templates,
    };
  }
  get hiddenCore() {
    const h = this.config.hiddenCore && typeof this.config.hiddenCore === 'object' ? this.config.hiddenCore : {};
    return {
      single: numOr(h.single, DEFAULTS.hiddenCore.single),
      multi: numOr(h.multi, DEFAULTS.hiddenCore.multi),
      minTeamLpExclusive: numOr(h.minTeamLpExclusive, DEFAULTS.hiddenCore.minTeamLpExclusive),
      difficulties: Array.isArray(h.difficulties) ? h.difficulties : DEFAULTS.hiddenCore.difficulties,
    };
  }
  /**
   * 开局抽禁数量（data/config.json `bans[difficulty]` 可覆盖）—— 商店刷新按 0.2.1 原版包走，
   * 盟约档与契约档同一套。
   * @param {string} difficulty
   * @returns {{ core: number, addon: number }}
   */
  bans(difficulty) {
    const b = this.config.bans && this.config.bans[difficulty];
    const d = DEFAULTS.bans[difficulty] || { core: 0, addon: 0 };
    if (!b || typeof b !== 'object') return { ...d };
    return { core: Number.isInteger(b.core) && b.core >= 0 ? b.core : d.core, addon: Number.isInteger(b.addon) && b.addon >= 0 ? b.addon : d.addon };
  }
  get bandDraft() {
    const b = this.config.bandDraft && typeof this.config.bandDraft === 'object' ? this.config.bandDraft : {};
    return {
      skipsPerPlayer: Number.isInteger(b.skipsPerPlayer) && b.skipsPerPlayer >= 0 ? b.skipsPerPlayer : DEFAULTS.bandDraft.skipsPerPlayer,
      timeoutBandId: typeof b.timeoutBandId === 'string' && this.band(b.timeoutBandId) ? b.timeoutBandId : this.defaultBandId,
    };
  }

  /** Bosses weights for the boss round / hidden round. */
  bossWeights(hidden = false) {
    const w = hidden ? this.mode.hiddenBossWeights : this.mode.bossWeights;
    return w && typeof w === 'object' ? Object.entries(w).filter(([id, v]) => this.boss(id) && Number(v) > 0) : [];
  }

  /** Band usable in this mode type. */
  bandAllowed(bandId) {
    const b = this.band(bandId);
    if (!b) return false;
    const list = Array.isArray(b.modeTypeList) ? b.modeTypeList : null;
    if (!list) return true;
    return list.includes(this.isSolo ? 'SINGLE' : 'MULTI');
  }

  bandIds() {
    const bands = this.raw.bands && typeof this.raw.bands === 'object' ? this.raw.bands : {};
    return Object.keys(bands).filter((id) => this.bandAllowed(id)).sort((a, b) => numOr(bands[a].sortId, 99) - numOr(bands[b].sortId, 99) || (a < b ? -1 : 1));
  }

  startLp(bandId) {
    const b = this.band(bandId);
    return b && Number.isInteger(b.totalHp) && b.totalHp > 0 ? b.totalHp : this.defaultStartLp;
  }

  /**
   * The bonds a strategy's mechanic is built around (DESIGN §21.26): bands.json `bondIds`, written at build time by
   * shared/bandBonds.js from the band's own text and blackboards (潘格尼尼 → 拉特兰, 克莱门莎 → 阿戈尔, 玛恩纳 → 卡西米尔 …) —
   * the field the strategy draft's 本局禁用 mark reads too. Known bond ids in data order; [] for an unknown band, one tied to
   * no bond (华法琳, 阿米娅 …) or data without the field. The bot never picks a strategy tied to a bond the mode switches
   * off (bot.js botPickBand).
   * @param {string} bandId
   * @returns {string[]}
   */
  bandBondIds(bandId) {
    if (this._bandBonds.has(bandId)) return this._bandBonds.get(bandId);
    const listed = this.band(bandId)?.bondIds;
    const set = new Set(Array.isArray(listed) ? listed : []);
    const out = Object.freeze(this.bondIds.filter((id) => set.has(id)));
    this._bandBonds.set(bandId, out);
    return out;
  }

  /**
   * Placeable (hand) tokens a chess sends to the hand when placed on the board: [{ tokenId, count }] — its manually
   * deployable summons (tokens.json `placeable`: 医疗探机, 诅咒娃娃, 海嗣, 狼群, 流形, 爬行号·防护单元; user playtest #6)
   * that the chess makes under `loadout` ({ skillIndex } from shared/protocol.js resolveLoadout; absent ⇒ its default
   * skill): the owner variant's `sources` (`bySkill[skillIndex]` for a non-default skill) name a talent or a skill —
   * 赫默 / 巫恋 on S1 make no drone / doll. `count` = the summon's deploy limit (PRTS 卫戍协议/帮助 "根据召唤物部署数量
   * 上限（非初始持有量），发送等量召唤物至手牌区": 凯瑟琳 2 of her 3 devices).
   */
  placeableTokens(chessId, loadout = null) {
    const c = this.chess(chessId);
    if (!c || !Array.isArray(c.tokens)) return [];
    const out = [];
    for (const tid of c.tokens) {
      const t = this.token(tid);
      if (!t || t.kind !== 'summon' || t.placeable !== true) continue;
      const vs = t.variants && typeof t.variants === 'object' ? t.variants : {};
      const v = vs[chessId] ?? vs[String(chessId).replace(/_b$/, '_a')] ?? null;
      if (v) {
        const alt = loadout && Number.isInteger(loadout.skillIndex) && v.bySkill ? v.bySkill[loadout.skillIndex] : null;
        const src = Array.isArray(alt?.sources) ? alt.sources : Array.isArray(v.sources) ? v.sources : [];
        if (!src.includes('talent') && !src.includes('skill')) continue;
      }
      const count = posIntOr(v?.stats?.deployLimit, posIntOr(t.deployLimit, 1));
      out.push({ tokenId: tid, count: Math.min(count, 9) });
    }
    return out;
  }
}
