// server/match/match/devMode.js — Match methods: 开发者模式（dev-ext 移植，2026-10-15）——「全量模拟」试验场。
//
// 一套只在本地端（回环 / 私网）存在的开发工具：room.create { dev: true, stage: 'dev_full_sim' } 开的局跳过
// INFO_CHECK / BAND_DRAFT 两屏直落战斗（skipToBattle），打一张空波次试验场图（devWave：每回合内置出怪全部
// 删除），敌人 / 数值 / 场景由局内开发者面板通过 g.dev 现场编辑（devEdit），回合数无限（views.js lastRound
// 999），击败首领不结束对局（bossRounds.js _finishFinal 的 dev 分支）。
//
// 三道闸（缺一不可，公网服务器上从外部连进来的浏览器看不到任何入口）：
//   1. server/lobby.js create()   —— dev === true 仅收 session.local === true 且 mode:'solo'，stage 必须已加载；
//   2. server/lobby.js welcomeInfo —— 只在本地端会话的 welcome 里带 devAllowed: true（非本地端这个键不出现）；
//   3. 本文件 devEdit 的入口判断   —— this.dev 为假时 g.dev 一律 BAD_MSG（协议层的形状校验之外的第二道）。
//
// 与 workshop 版 dev-ext 的差异（本项目没有工坊包系统，内容直接进 data/）：
//   * 试验场图与空波次表是 data/stages.json 的 dev_full_sim 与 data/waves.json 的 dev_ext_empty；
//   * 本项目的波次模板按回合取自 config.modes[].rounds[].template（不是 stage.rounds），所以 dev 局的空波次
//     由 devWave() 直接给出（模板 dev_ext_empty，spawns: []，routes 用它的两条画好的路线）；
//   * 面板改的干员数值放在棋子的 meta.data.devExt，由 battleInput 带进战斗输入（u.devExt），sim 的 Battle 在
//     battleStart 把它挂成直接乘算的属性 buff（server/sim/Battle.js 构造函数的 devExt 钩子，服务端与浏览器
//     共用同一份 sim，所以客户端 authoritative 战斗同样生效）。

import { PHASE, ERR } from '../../../shared/constants.js';
import { previewOf, isFlyKey } from '../waves.js';
import { OK, fail } from './common.js';

/** 试验场关卡 id（data/stages.json，weight 0 / active false —— 正常抽图永远选不中它）。 */
export const DEV_STAGE_ID = 'dev_full_sim';
/** 空波次表 id（data/waves.json：spawns [] / totalCount 0，routes 是设计器画的两条路线）。 */
export const DEV_WAVE_ID = 'dev_ext_empty';
/** 面板可改的干员数值覆盖键（battle/main.mjs devMods 的同款口径）。 */
const DEV_OVERRIDE_KEYS = ['atk', 'def', 'hp', 'aspd', 'res', 'bat', 'blockCnt'];

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.trunc(Number(v) || 0)));
/** 一个干员的 devExt 覆盖 → 干净的 { key: number }（空对象 = 没有覆盖）。 */
function cleanOverrides(ov) {
  const out = {};
  if (!ov || typeof ov !== 'object') return out;
  for (const k of DEV_OVERRIDE_KEYS) {
    const n = Number(ov[k]);
    if (Number.isFinite(n) && n !== 0) out[k] = Math.max(-1e6, Math.min(1e6, n));
  }
  return out;
}

export class MatchDev {
  /**
   * dev 局的起手（platform.js start()）：跳过 INFO_CHECK / BAND_DRAFT 两屏 —— 每个座位直接拿默认策略
   * （timeoutBandId，没有队友所以不会撞），进 BATTLE_CHECK（协议启动）后落第 1 回合。
   */
  skipToBattle() {
    for (const ps of this.order) {
      const id = this.defaultBand(ps.playerId);
      ps.bandId = id;
      ps.lp = this.gd.startLp(id);
      this.markPrivate(ps);
    }
    this.enterBattleCheck();
  }

  /**
   * dev 局一个普通回合的波次：模板 dev_ext_empty（空 spawns），路线用它画好的两条，时间限制走回合配置。
   * r > 15 时 roundCfg 为空 ⇒ 回退 60s 真实（×2 = 120 游戏秒），与 buildNormalWave 的缺省一致。
   * @param {number} r 回合（1 起）
   */
  devWave(r) {
    const tpl = this.gd.wave(DEV_WAVE_ID);
    return {
      templateId: DEV_WAVE_ID,
      spawns: [],
      routes: Array.isArray(tpl?.routes) ? tpl.routes : [],
      extraRoutes: Array.isArray(tpl?.extraRoutes) ? tpl.extraRoutes : [],
      timeLimit: this.gd.combatTimeLimit(r),
      overrides: {},
      pick: null,
      entries: { ground: null, fly: null },
      actions: [],
    };
  }

  /**
   * g.dev 的服务端实现（shared/protocol.js DEV_ACTIONS 的闭枚举；`action` 缺省 = 旧形状 { funds }）。
   * 只接受 dev 局（room.create { dev: true }）的存活人类座位；每个 action 的语义校验都在这，协议层只把类型。
   * @param {import('../PlayerState.js').PlayerState} ps
   * @param {any} msg 已过 validateC2S 的 g.dev
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  devEdit(ps, msg) {
    if (!this.dev) return fail(ERR.BAD_MSG, 'developer mode is off for this match');
    if (!ps || ps.isBot || ps.left) return fail(ERR.NOT_IN_ROOM);
    if (this.ended || this.disposed) return fail(ERR.WRONG_PHASE);
    const action = typeof msg.action === 'string' ? msg.action : 'funds';
    let res = OK;
    this.guard(() => { res = this._devAction(ps, action, msg); });
    return res;
  }

  /** @returns {{ ok: true } | { error: string, detail?: string }} */
  _devAction(ps, action, msg) {
    switch (action) {
      case 'funds': {
        const v = clampInt(msg.funds, 0, 1e9);
        ps.funds = v;
        ps.dirty();
        this.markPrivate(ps);
        return OK;
      }
      case 'lp': {
        const v = clampInt(msg.lp, 0, 1e6);
        ps.lp = v;
        if (this.teamLp != null) this._syncTeamLp();
        this.markPublic();
        this.markPrivate(ps);
        return OK;
      }
      case 'shopLevel': {
        const lv = clampInt(msg.shopLevel, 1, this.gd.maxShopLevel);
        ps.shop.level = lv;
        ps.shop.upgradePrice = this.gd.upgradeBase(lv) ?? 0;
        ps.rollShop({ keepFrozen: false });
        ps.dirty();
        this.markPrivate(ps);
        return OK;
      }
      case 'shopSlots': {
        const n = clampInt(msg.shopSlots, 0, 8);
        this.devShopSlots = { chess: n };
        // gamedata.shopSlots() 的 per-match 覆盖（GameData 实例是本局独享的）
        this.gd.devShopSlots = { chess: n };
        ps.rollShop({ keepFrozen: false });
        ps.dirty();
        this.markPrivate(ps);
        return OK;
      }
      case 'layers': {
        // 给每个已激活盟约加 n 层（0..999，逐盟约钳位；ps.layers 整局持久，bondsMeta.computeBonds 读它）
        const n = clampInt(msg.layers, -999, 999);
        if (n === 0) return OK;
        if (!ps.layers || typeof ps.layers !== 'object') ps.layers = {};
        let touched = false;
        for (const [id, b] of Object.entries(ps.bonds || {})) {
          if (!b || !b.active) continue;
          ps.layers[id] = clampInt((ps.layers[id] || 0) + n, 0, 999);
          touched = true;
        }
        if (!touched) return fail(ERR.BAD_TARGET, 'no active bond to add layers to');
        ps.recompute();
        ps.dirty();
        this.markPrivate(ps);
        this.markPublic();
        return OK;
      }
      case 'band': {
        const id = typeof msg.bandId === 'string' ? msg.bandId : null;
        if (!id || !this.gd.bandAllowed(id)) return fail(ERR.BAD_TARGET, `band ${String(id).slice(0, 64)} not allowed in this mode`);
        ps.bandId = id;
        ps.lp = this.gd.startLp(id);
        ps.recompute();
        ps.dirty();
        this.markPrivate(ps);
        this.markPublic();
        return OK;
      }
      case 'item': {
        const id = typeof msg.itemId === 'string' ? msg.itemId : null;
        if (!id || !this.gd.item(id)) return fail(ERR.BAD_TARGET, `unknown item ${String(id).slice(0, 64)}`);
        const piece = ps.acquireItem(id, { source: 'dev', requirePool: false });
        if (!piece) return fail(ERR.BAD_TARGET, 'no room for the item');
        ps.dirty();
        this.markPrivate(ps);
        return OK;
      }
      case 'grantChess': {
        // 两种形状：{ chessId, overrides? } 新发一名干员；{ uid, overrides } 改已持有干员（场上 / 整备区）的数值。
        // overrides 落在棋子的 meta.data.devExt，由 battleInput 带进战斗输入（u.devExt → Battle 的 battleStart buff）。
        if (typeof msg.chessId === 'string') {
          const rec = this.gd.chess(msg.chessId);
          if (!rec || rec.isGolden || rec.visible === false || rec.isHidden) return fail(ERR.BAD_TARGET, `unknown chess ${msg.chessId.slice(0, 64)}`);
          const piece = ps.acquireChess(msg.chessId, { source: 'dev', fromPool: false });
          if (!piece) return fail(ERR.BAD_TARGET, 'no room for the operator');
          const ov = cleanOverrides(msg.overrides);
          if (Object.keys(ov).length) piece.meta.data = { ...(piece.meta.data || {}), devExt: ov };
          ps.dirty();
          this.markPrivate(ps);
          return OK;
        }
        if (Number.isInteger(msg.uid)) {
          const loc = ps.find(msg.uid);
          if (!loc || loc.piece.kind !== 'chess') return fail(ERR.BAD_TARGET, 'not an owned operator');
          const ov = cleanOverrides(msg.overrides);
          const data = { ...(loc.piece.meta.data || {}) };
          if (Object.keys(ov).length) data.devExt = ov;
          else delete data.devExt;
          loc.piece.meta.data = data;
          ps.dirty();
          this.markPrivate(ps);
          return OK;
        }
        return fail(ERR.BAD_MSG, 'grantChess needs chessId or uid');
      }
      case 'spawnEnemy': {
        // 现场添加敌人：按 routes 轮转（已添加条数 % routes.length，也可显式 routeIndex），依次进场。
        // 只在添加的那个回合出现（phases.js startRound 每回合起始清空 devExtraEnemies）。
        const enemyKey = typeof msg.enemyKey === 'string' ? msg.enemyKey : null;
        if (!enemyKey || !this.gd.enemy(enemyKey)) return fail(ERR.BAD_TARGET, `unknown enemy ${String(enemyKey).slice(0, 64)}`);
        const rec = this.gd.enemy(enemyKey);
        const count = clampInt(msg.count ?? 1, 1, 50);
        const routes = (this.wave && Array.isArray(this.wave.routes) ? this.wave.routes : []) || [];
        const routeIndex = Number.isInteger(msg.routeIndex)
          ? clampInt(msg.routeIndex, 0, Math.max(0, routes.length - 1))
          : (routes.length ? this.devExtraEnemies.length % routes.length : 0);
        this.devExtraEnemies.push({
          time: Math.round((2 + this.devExtraEnemies.length * 1.5) * 10) / 10,
          enemyKey,
          count,
          interval: count > 1 ? 1 : 0,
          routeIndex,
          mods: {},
          actionIndex: -1,
          tag: 'dev',
          preview: { gate: 'lower', fly: isFlyKey(this.gd, enemyKey), elite: !!(rec.rank && rec.rank !== 'NORMAL') },
        });
        this.markPublic();
        for (const p of this.order) this.markPrivate(p);
        return OK;
      }
      case 'enemyOverride': {
        // 逐敌人数值覆盖（绝对值）：并进本场战斗的 enemyOverrides（combat.js _normalOpts / bossRounds 的首领场）。
        // 每回合起始清空（phases.js startRound），与添加的敌人同寿命。
        const enemyKey = typeof msg.enemyKey === 'string' ? msg.enemyKey : null;
        if (!enemyKey || !this.gd.enemy(enemyKey)) return fail(ERR.BAD_TARGET, `unknown enemy ${String(enemyKey).slice(0, 64)}`);
        const stats = {};
        for (const k of ['atk', 'def', 'hp', 'res']) {
          const n = Number(msg[k]);
          if (Number.isFinite(n) && n >= 0) stats[k === 'hp' ? 'maxHp' : k] = n;
        }
        if (!Object.keys(stats).length) { delete this.devEnemyOverrides[enemyKey]; return OK; }
        this.devEnemyOverrides[enemyKey] = { stats };
        this.markPublic();
        return OK;
      }
      case 'stage': {
        // 换地图（立刻生效）：下一场战斗用新图；棋盘按新图的可部署位复检（recompute → _evictIllegal）。
        const id = typeof msg.stage === 'string' ? msg.stage : null;
        const rec = id ? this.gd.stage(id) : null;
        if (!rec) return fail(ERR.BAD_TARGET, `unknown stage ${String(id).slice(0, 64)}`);
        this.stageId = id;
        this.stage = rec;
        for (const p of this.alivePlayers()) p.recompute();
        this.markPublic();
        return OK;
      }
      case 'roundKind': {
        // 指定下一回合的类型：'boss' ⇒ 任意回合都打首领（endPrep 进 FINAL_ASSAULT）；'normal' ⇒ 首领回合也打普通波。
        // startRound 消费并清空（views.js 的 devNextKind 给面板回显）。
        const kind = msg.roundKind === 'boss' ? 'boss' : msg.roundKind === 'normal' ? 'normal' : null;
        if (!kind) return fail(ERR.BAD_MSG, 'roundKind must be normal or boss');
        this.devRoundKind = kind;
        this.markPublic();
        return OK;
      }
      case 'boss': {
        // 首领数值覆盖：hp = 共享血池的上限（startFinalAssault 的 dev 分支），atk/def/res 并进首领场的
        // enemyOverrides（键 = boss.enemyKey，bossRounds.js _devBossEnemyOverrides）。
        const ov = {};
        for (const k of ['hp', 'atk', 'def', 'res']) {
          const n = Number(msg[k]);
          if (Number.isFinite(n) && n > 0) ov[k] = n;
        }
        if (!Object.keys(ov).length) { this.devBossOverrides = null; this.markPublic(); return OK; }
        this.devBossOverrides = ov;
        this.markPublic();
        return OK;
      }
      default:
        return fail(ERR.BAD_MSG, `unknown dev action ${String(action).slice(0, 32)}`);
    }
  }

  /**
   * dev 局一次普通回合的战斗生成表：面板本回合现场添加的敌人（spawnEnemy；startRound 每回合起始清空，
   * 所以它们只在添加的那个回合出现）。combat.js _normalOpts 把它们并进 spawns。
   * @returns {object[]} SpawnSpec 列表（已带 ownerPlayerId 由调用方补）
   */
  devEnemySpecs() {
    return this.devExtraEnemies.map((s) => ({ ...s }));
  }

  /** 面板添加/覆盖的敌人预览（m.public.devEnemies / m.private.nextEnemies 的追加区；waves.js previewOf 口径）。 */
  devEnemyPreview() {
    return previewOf(this.devExtraEnemies);
  }
}
