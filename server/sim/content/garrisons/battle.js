// server/sim/content/garrisons/battle.js — IN_BATTLE 特质 (garrisons) of the operators on the field.
//
// Each operator carries `unit.def.raw.garrisonIds` (elite chess carry the `_b` garrisons); the IN_BATTLE ones are
// dispatched here by their effectKey (bbStr.key for battle runes, else effectType — docs/DATA.md §4):
//
//   ADD_BOND            grants `give_garrison_id` to other operators before the first deployment (targets parsed from
//                       the text: 身前一格 / 身前一格【X】/ 自身和身前一格 / 同一行最右边 / 所有【X】). A unit owns a garrison id
//                       at most once (耀骑士临光 already carries the 144/159 it grants to itself). A granted trait keeps
//                       its data cap like a native one: 华法琳's garrison_95 stops at 7 / 14 layers per battle (PRTS 下半
//                       3月27日更新#2: 「从 初始12/精锐24 降低至 初始7/精锐14」; GitHub #175, PR #192 by @kukiC).
//   layer events        act1autochess_gar_event_useskill (skillStart) · _selfkillenemy (kill, every check_cnt) ·
//                       _selfdead (death 'killed'; texts with 替身 also on every substitute ⇄ body swap, read from the
//                       dollkeeper flag unit.trait.doll) · _consume_ammo (ammoUsed; range_id 0-1 self, 1-1 front tile,
//                       x-5 self + 4 adjacent, pooled counter) · _enemy_abflag_inrange (an enemy in range ENTERS
//                       'freeze' — or, with bbStr.check_status, that status: the 契约档 但书 wants 'sluggish' —  × prob) ·
//                       _heal (契约档 末药: the holder heals an ally) · gar_event_defdown_source (契约档 黑: a NEW
//                       DEF-lowering debuff on an enemy whose source is the holder — polled per tick, buffs.mods
//                       defPct/defFlat < 0 or defMul < 1; a refresh counts again, an extend of the same instance does
//                       not) · act2autochess_gar_event_onstart (every deploy) ·
//                       act2autochess_gar_event_allyenemy_sleepstun_inrange (an enemy or operator in range ENTERS
//                       sleep / stun). "进入…时": re-applying a running status (a refresh) is not a new entry
//                       (engine statusApplied ctx.entered) — except a pulse that re-applies its own short status as a
//                       fresh one (applyStatus `reenter`: 缇缇 S2's sleep ward, DESIGN §24.8).
//                       Targets: bond_by_id / bond_self (own active bonds) / bond_actived_maxstack;
//                       amounts: by_count / by_charcount_samerow / by_charlevel; conditions character_same_row /
//                       character_same_col (≥ check_count incl. self). Gains go through support.gainLayers with
//                       reason 'garrison', source = the trait's owner, cap = max_add_count_per_battle per (instance, bond)
//                       — per instance for bond_actived_maxstack (塑心: the highest bond may change, the cap does not).
//                       **Require-active 的口径与 prep 侧同一条规则（requireActiveOf，garrisons/meta.js）：文案写
//                       「已激活的（盟约）」/「（当前）激活且」才要求该盟约已激活，写「（无需激活盟约）」或两者都没写
//                       的**不需要**激活。** 2026-10-16 修：此前 fireGain 一律 requireActive: true，把契约档
//                       棘刺/琴柳/晓歌/格拉尼/锡兰/黑 那 12 条「没写已激活」的特质也当成「只加已激活的盟约」——
//                       单带棘刺（或棘刺+精锐，同 baseId 只算 1 名）时【近卫】不激活 ⇒ 击杀一只都不叠层；
//                       官方那 68 条文案都写着「已激活的」，改后行为不变。
//   act1autochess_gar_event_addition_cnt (魔王)  layerGain: a 'garrison' gain whose source stands on the tile in front
//                       of 魔王 (range_id 1-1) — or was knocked out there this instant (幽灵鲨 "被击倒时"; engine ctx.tile)
//                       — gets +extra_cnt per bond (the extra does not count toward the source's per-battle cap).
//   stat traits         GAIN_BUFF (battleRuneKey char_attribute_mul "攻击力和生命值+20%": a rune on the chess's base
//                       attributes, so atkMul / hpMul), attr_common_global_buff (spRecoveryFlat; "+X%" ATK / HP would be
//                       直接乘算), attrByBond ("每叠加N层…+X%": 直接乘算, support directMods),
//                       respawnTimeByBond, attrByBond_add_onstart, ab_damageScaleByBond — layer readers use
//                       floor(Σ layers of the listed ACTIVE bonds / divide_num) and are recomputed after every layer
//                       gain (research 02 §5 [ASSUMED] only active bonds count). PROF_DURNAR_BLOCK_STATS (契约档 坚雷)
//                       is not a layer reader but a tick-recomputed self buff from the live block count.
//   hit modifiers       act1autochess_gar_eff_attack_enemy (dmg.amount × atk vs check_tag enemies),
//                       ab_damageScaleByBond (bound / sluggish targets), _chaos (弱点伤害, research 04 glossary:
//                       phys/arts → whichever deals MORE after the engine's mitigation incl. the attacker's DEF/RES
//                       ignore and dealt/taken multipliers; a tie keeps the type).
//   NONE                风丸 "2 copies merge" — prep rule (chess.upgradeNum 2), nothing in battle.
//
// Hooks: priority 0, except 弱点伤害 (hit, WEAKNESS_PRIORITY −10: decided on the final amount after the ATK
// multipliers). install() registers nothing when no operator carries an IN_BATTLE garrison.

import * as S from '../support/index.js';
import { mitigate } from '../../damage.js';
import { SCOPE_MOD_CORE } from '../../../../shared/bondScope.js';
import { frontOf } from '../../dir.js';
// 与 prep 侧（SERVER_* 特质）同一口径的「是否需要盟约已激活」判据：文案写「已激活」/「激活且」才要求激活。
import { requireActiveOf } from './meta.js';

const ids = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const EMPTY = Object.freeze([]);
/** Status keys for check_ab_flag values used by the data (16 = 冻结). */
const AB_FLAG_STATUS = Object.freeze({ 16: 'freeze' });

function garrisonIdsOf(u) {
  const list = u?.def?.raw?.garrisonIds ?? u?.def?.garrisonIds;
  return Array.isArray(list) ? list : EMPTY;
}

// ---------------------------------------------------------------------------------------------------------------------
// install

export function install(battle) {
  const all = [];
  const owned = new Map(); // unit → Set(garrisonId)
  const add = (unit, g, grantedBy = null) => {
    let set = owned.get(unit);
    if (!set) { set = new Set(); owned.set(unit, set); }
    if (set.has(g.garrisonId)) return null;
    set.add(g.garrisonId);
    const bb = g.bb || {};
    const cap = S.num(bb.max_add_count_per_battle, 0) > 0 ? S.num(bb.max_add_count_per_battle) : Infinity;
    const it = {
      unit, g, gid: g.garrisonId, key: g.effectKey, bb, bbStr: g.bbStr || {}, grantedBy,
      cap, capKey: `gar:${g.garrisonId}:${unit.id}`, cnt: 0, k: -1,
      // "使已激活的【X】层数+N" 还是 "（无需激活盟约）" 由记录自己的文案决定（requireActiveOf，prep 侧同一条）
      requireActive: requireActiveOf(g),
    };
    all.push(it);
    return it;
  };
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    for (const gid of garrisonIdsOf(u)) {
      const g = S.garrisonRecord(gid);
      if (g && g.eventType === 'IN_BATTLE') add(u, g);
    }
  }
  if (!all.length) return;

  const grants = [];
  for (const it of all.slice()) {
    if (it.key !== 'ADD_BOND') continue;
    const g2 = S.garrisonRecord(it.bbStr.give_garrison_id);
    if (!g2 || g2.eventType !== 'IN_BATTLE') continue;
    for (const t of grantTargets(battle, it)) {
      const got = add(t, g2, it);
      if (got) grants.push(got);
    }
  }

  const by = new Map();
  for (const it of all) {
    let arr = by.get(it.key);
    if (!arr) { arr = []; by.set(it.key, arr); }
    arr.push(it);
  }
  for (const [key, list] of by) {
    const inst = INSTALLERS[key];
    if (inst) inst(battle, list);
  }
  installHitMods(battle, by);
  installReaders(battle, by);

  if (grants.length) {
    battle.on('battleStart', () => {
      for (const it of grants) S.fxOn(battle, 'garrisonGrant', it.unit, `gar:${it.grantedBy.gid}`, it.gid, { from: it.grantedBy.unit.id });
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// ADD_BOND targets (before deployment: home tiles)

function opsOf(battle, pid) {
  const out = [];
  for (const u of battle.allyUnits) if (S.isOp(u) && u.ownerId === pid && !u.removed) out.push(u);
  return out;
}
function opAtHome(battle, pid, r, c) {
  for (const u of battle.allyUnits) if (S.isOp(u) && u.ownerId === pid && !u.removed && u.homeR === r && u.homeC === c) return u;
  return null;
}

function grantTargets(battle, it) {
  const u = it.unit;
  const desc = it.g.desc || '';
  const need = it.bbStr.check_bond_id || null;
  const ok = (t) => !!t && (!need || S.isMember(battle, t, need));
  const front = () => { const [fr, fc] = frontOf(u.homeR, u.homeC, u.dir); return opAtHome(battle, u.ownerId, fr, fc); };
  if (desc.includes('所有')) return opsOf(battle, u.ownerId).filter(ok);
  if (desc.includes('同一行最右边')) {
    let best = null;
    for (const t of opsOf(battle, u.ownerId)) {
      if (t.homeR !== u.homeR) continue;
      // a board position ("最右边" of the player's own board: the mirrored Final Assault right side counts from the left)
      const col = (x) => (x.player && x.player.mirror ? -x.homeC : x.homeC);
      if (!best || col(t) > col(best)) best = t;
    }
    return ok(best) ? [best] : [];
  }
  const out = [];
  if (desc.includes('自身和身前') && ok(u)) out.push(u);
  const f = front();
  if (ok(f)) out.push(f);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// layer gains

function targetBonds(battle, it) {
  const u = it.unit;
  switch (it.bbStr.bond_type) {
    case 'bond_self': return S.unitBonds(u).filter((b) => S.bondActive(battle, u.ownerId, b));
    case 'bond_actived_maxstack': { const b = S.topActiveBond(battle, u.ownerId); return b ? [b] : EMPTY; }
    default: return ids(it.bbStr.bond_id);
  }
}

function amountOf(battle, it) {
  const bb = it.bb;
  switch (it.bbStr.bond_add_type) {
    case 'by_charcount_samerow': return S.rowMates(battle, it.unit).length * S.num(bb.bond_add_count_multi, S.num(bb.bond_add_count, 1));
    case 'by_charlevel': return S.tierOf(it.unit) * S.num(bb.bond_add_count, 1);
    default: return S.num(bb.bond_add_count, 0);
  }
}

function conditionMet(battle, it) {
  const ck = it.bbStr.conditionkey;
  const need = S.num(it.bb.check_count, 0);
  if (ck === 'character_same_row') return S.rowMates(battle, it.unit).length >= need;
  if (ck === 'character_same_col') {
    let n = 0;
    for (const a of battle.allyUnits) if (S.isOp(a) && a.ownerId === it.unit.ownerId && S.onField(a) && a.tileC === it.unit.tileC) n++;
    return n >= need;
  }
  return true;
}

/** Fire a layer-gain garrison instance. Returns the layers added. */
export function fireGain(battle, it) {
  if (!conditionMet(battle, it)) return 0;
  const bonds = targetBonds(battle, it);
  if (!bonds.length) return 0;
  let n = amountOf(battle, it);
  // bond_actived_maxstack (塑心 garrison_90 "当前已激活且层数最多的盟约层数+1（每场作战至多10层）"): the cap is the instance's
  // own over the battle, whichever bond is the highest at each gain — per (instance, bond) a change of the highest bond
  // granted a fresh 10 (PR #178 review). The base amount counts toward it (魔王's extra does not, as in gainLayers).
  const whole = it.bbStr.bond_type === 'bond_actived_maxstack' && Number.isFinite(it.cap);
  if (whole) {
    n = Math.min(Math.floor(n), Math.max(0, Math.floor(it.cap) - (it.wholeUsed ?? 0)));
    if (!(n > 0)) return 0;
  }
  const added = S.gainLayers(battle, {
    playerId: it.unit.ownerId, bonds, n, requireActive: it.requireActive !== false, source: it.unit, reason: 'garrison',
    cap: whole ? Infinity : it.cap, capKey: whole ? null : it.capKey,
  });
  if (whole && added > 0) it.wholeUsed = (it.wholeUsed ?? 0) + n;
  if (added > 0) S.fxOn(battle, 'garrison', it.unit, `gar:${it.gid}`, it.key, { n: added });
  return added;
}

const byUnit = (list) => {
  const m = new Map();
  for (const it of list) {
    let a = m.get(it.unit);
    if (!a) { a = []; m.set(it.unit, a); }
    a.push(it);
  }
  return m;
};

function isFrontOf(holder, u) {
  if (!u || u === holder || u.ownerId !== holder.ownerId || !S.onField(u)) return false;
  const [fr, fc] = frontOf(holder.tileR, holder.tileC, holder.dir);
  return u.tileR === fr && u.tileC === fc;
}
/**
 * 魔王: the gain's source (an operator of the holder's player) stands in front of it. `tile` = the engine's layerGain
 * ctx.tile: where the source stands, or where it was knocked out this very instant (幽灵鲨 "被击倒时" gains fire on death).
 */
function sourceInFront(holder, u, tile) {
  if (!u || u === holder || u.ownerId !== holder.ownerId || !S.isOp(u) || !Array.isArray(tile)) return false;
  const [fr, fc] = frontOf(holder.tileR, holder.tileC, holder.dir);
  return tile[0] === fr && tile[1] === fc;
}
function ammoScope(it, u) {
  const h = it.unit;
  switch (it.bbStr.range_id) {
    case '1-1': return S.onField(h) && isFrontOf(h, u);
    case 'x-5': return u === h || (S.onField(h) && S.onField(u) && u.ownerId === h.ownerId && S.isOp(u) && Math.abs(u.tileR - h.tileR) + Math.abs(u.tileC - h.tileC) === 1);
    default: return u === h;
  }
}

const INSTALLERS = {
  /**
   * 契约档 推进之王（用户 2026-10-15）: 视为核心盟约层数最高的成员享受全部加成。
   *
   * 关键：层数取的是 SCOPE_MOD_CORE（rhine/rainbow/rodos/babel/sui/us/penguin/lungmen/demon/evolve）里
   * 玩家当前 **最高** 的那条盟约层数（而不是分盟求和）。本干员**不参与激活**——加成直接挂在本干员 buff
   * 上（不走 bondActive / 成员判据），所以 6 人档 / 9 人档不会被本干员误算入成员数。
   *
   * bb 形状沿用 attrByBond：`{ divide_num, atk, max_hp, def, attack_speed, hp_recovery_per_sec, sp_recovery_per_sec }`
   * 走与 act1autochess_gar_eff_attrByBond 完全相同的 attrMods 路径，避免和既有加成分裂。
   */
  SIEGE_CORE_MAX_BOND(battle, list) {
    for (const it of list) {
      const u = it.unit;
      const key = `gar:${it.gid}`;
      const refresh = () => {
        const div = Math.max(1, S.num(it.bb.divide_num, 1));
        let best = 0;
        for (const b of SCOPE_MOD_CORE) {
          if (!S.bondActive(battle, u.ownerId, b)) continue;
          const l = S.bondLayers(battle, u.ownerId, b);
          if (l > best) best = l;
        }
        const k = Math.floor(best / div);
        if (k === it.k) return;
        it.k = k;
        if (k > 0) S.passiveBuff(battle, u, key, attrMods(it.bb, k));
        else battle.removeBuff(u, key);
      };
      refresh();
      battle.on('battleStart', refresh, { owner: u });
      battle.on('layerGain', () => battle.after(0, refresh), { owner: u });
    }
  },

  /**
   * 契约档 推进之王（用户 2026-10-15）: 【先锋】层数首次达到 200 层，碎颅击持续时间无限。
   *
   * 监听 layerGain（vanguardShip 跨过 200），给本干员加永久 buff；buff 处理器在每个 tick 把碎颅击的
   * SkillRuntime.timeLeft 钉在 Infinity（duration 类型技能 timeLeft 耗尽才 end，所以 Infinity 就无限）。
   * 一次跨过即生效（标记 `siege:skillInfiniteGiven`），整局不重置。
   */
  SIEGE_SKILL_INFINITE(battle, list) {
    const TARGET = 'skchr_siege_3';
    for (const it of list) {
      const u = it.unit;
      const flagKey = `siege:skillInfiniteGiven:${u.id}`;
      battle.on('layerGain', ({ bondId, after }) => {
        if (bondId !== 'vanguardShip') return;
        if (!(after >= 200)) return;
        if (u.mem?.[flagKey]) return;
        if (u.mem) u.mem[flagKey] = true;
        const key = 'siege:skillInfinite';
        battle.addBuff(u, { key, persist: true, allowDead: true, visible: false });
      }, { owner: u });
      battle.on('tick', () => {
        if (!u.mem?.[flagKey]) return;
        const sk = u.skill;
        if (!sk || !sk.active) return;
        if (sk.spec?.skillId !== TARGET) return;
        sk.timeLeft = Infinity;
      }, { owner: u, priority: 200 });
    }
  },

  /**
   * 契约档 桃金娘（用户 2026-10-15）:
   *   「<战斗中>开启技能使已激活的【先锋】层数+1，身前一格干员攻击力+X%，阻挡数+1」
   *
   * 实现在 `kits/ops/chess_char_3_myrtle.js`（installTrait）—— 那里同时能拿到 skillStart 事件与技能运行时状态，
   * 是该效果唯一的实现点；此处只登记 bbStr.bond_id 让 traitOf() 认得它，不重复挂 buff（否则会双触发）。
   */
  MYRTLE_FRONTIER(battle, list) {
    for (const it of list) it.bonds = ids(it.bbStr.bond_id);
    void battle;
  },

  /**
   * 契约档 协律（用户 2026-10-14）: "<战斗中>首次攻击敌人时，使已激活的【术师】层数+N"。
   */
  FIRST_ATTACK_BOND_LAYER(battle, list) {
    const m = byUnit(list);
    battle.on('attack', ({ attacker, targets }) => {
      const arr = attacker ? m.get(attacker) : null;
      if (!arr) return;
      if (!Array.isArray(targets) || !targets.length) return;
      for (const it of arr) {
        if (it.firstAttackDone) continue;
        it.firstAttackDone = true;
        const n = S.num(it.bb.n, 1);
        if (!(n > 0)) continue;
        const bondId = it.bbStr?.bond_id;
        if (!bondId) continue;
        const added = S.gainLayers(battle, { playerId: it.unit.ownerId, bonds: [bondId], n, requireActive: true, source: it.unit, reason: 'garrison', cap: n, capKey: it.capKey + ':fa' });
        if (added > 0) S.fxOn(battle, 'garrison', it.unit, `gar:${it.gid}`, it.key, { n: added });
      }
    });
  },

  /**
   * 契约档 红云（用户 2026-10-14）: "攻击范围内每有一个地面敌人，自身攻击力和攻击速度+5%"。
   *
   * 一个持续重算的自身 buff：数一数**自己攻击范围内**的地面敌人（`battle.enemiesInKeys` +
   * `isGroundOp` 的反面 —— 敌人用 `isFlying` 判定），每有一个给一档 `per_enemy_pct` 的攻击力与攻速。
   * 用 engine 自己的 `enemiesInKeys`，所以隐匿 / 不可选中 / 射程变化都自动跟随。
   * bb: { per_enemy_pct }   （精锐版数据里给两倍）
   */
  GROUND_ENEMY_SELF_BUFF(battle, list) {
    for (const it of list) {
      const u = it.unit;
      const key = `gar:${it.gid}:${u.id}`;
      const pct = () => S.num(it.bb.per_enemy_pct, 0.05);
      const refresh = () => {
        if (!u.alive || !u.deployed) return;
        const p = pct();
        if (!(p > 0)) return;
        // 范围内的地面敌人（`isFlying` 为假即地面；与 professions.js 的 groundOnly 同口径）
        let n = 0;
        try {
          for (const e of battle.enemiesInKeys(u.rangeKeys, u, u.profile)) if (e && !e.isFlying) n++;
        } catch { return; }
        const mods = n > 0 ? { atkPct: n * p, aspd: n * p * 100 } : null;
        const old = u.findBuff(key);
        if (!mods) { if (old) battle.removeBuff(u, key); return; }
        if (old && old.mods?.atkPct === mods.atkPct && old.mods?.aspd === mods.aspd) return;
        battle.addBuff(u, { key, mods, persist: true, allowDead: true, visible: true, tags: ['trait'] });
      };
      battle.on('tick', refresh, { owner: u });
      battle.on('battleStart', refresh, { owner: u });
      battle.on('deploy', (ctx) => { if (ctx.unit === u) refresh(); }, { owner: u });
    }
  },

  act1autochess_gar_event_useskill(battle, list) {
    const m = byUnit(list);
    battle.on('skillStart', ({ unit }) => {
      const arr = m.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
  },

  act1autochess_gar_event_selfkillenemy(battle, list) {
    const m = byUnit(list);
    for (const it of list) it.allies = /我方干员/.test(it.g.desc || '');
    battle.on('kill', ({ killer, victim }) => {
      const arr = killer ? m.get(killer) : null;
      if (!arr || !victim) return;
      for (const it of arr) {
        if (!(victim.side === 'enemy' || (it.allies && victim.side === 'ally' && victim.kind === 'op'))) continue;
        it.cnt++;
        if (it.cnt % Math.max(1, S.num(it.bb.check_cnt, 1)) === 0) fireGain(battle, it);
      }
    });
  },

  // 契约档 灰喉（用户 2026-10-11）: "<战斗中>首次击败敌人时，使已激活的【罗德岛】层数+2、【狙击】层数+4"
  // —— 每场战斗一次；各盟约的加层数按序取 bb.add_0 / add_1（bbStr.bond_ids 的顺序），上限即该数值本身。
  gar_event_firstkill_bond(battle, list) {
    const m = byUnit(list);
    battle.on('kill', ({ killer, victim }) => {
      const arr = killer ? m.get(killer) : null;
      if (!arr || !victim || victim.side !== 'enemy') return;
      for (const it of arr) {
        if (it.firstKillDone) continue;
        it.firstKillDone = true;
        const bonds = ids(it.bbStr?.bond_ids || '');
        bonds.forEach((bondId, i) => {
          const n = S.num(it.bb[`add_${i}`], 0);
          if (!(n > 0)) return;
          const added = S.gainLayers(battle, { playerId: it.unit.ownerId, bonds: [bondId], n, requireActive: true, source: it.unit, reason: 'garrison', cap: n, capKey: it.capKey + ':' + i });
          if (added > 0) S.fxOn(battle, 'garrison', it.unit, `gar:${it.gid}`, it.key, { n: added });
        });
      }
    });
  },

  act1autochess_gar_event_selfdead(battle, list) {
    const m = byUnit(list);
    battle.on('death', ({ unit, reason }) => {
      if (reason !== 'killed') return;
      const arr = m.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
    const swaps = list.filter((it) => /替身/.test(it.g.desc || ''));
    if (!swaps.length) return;
    for (const it of swaps) it.doll = false;
    battle.on('tick', () => {
      for (let i = 0; i < swaps.length; i++) {
        const it = swaps[i];
        const u = it.unit;
        const doll = !!(u.trait && u.trait.doll);
        if (doll === it.doll) continue;
        it.doll = doll;
        if (u.alive && u.deployed) fireGain(battle, it);
      }
    });
  },

  act1autochess_gar_event_consume_ammo(battle, list) {
    battle.on('ammoUsed', ({ unit }) => {
      if (!unit) return;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (!ammoScope(it, unit)) continue;
        it.cnt++;
        if (it.cnt % Math.max(1, S.num(it.bb.consume_count, 1)) === 0) fireGain(battle, it);
      }
    });
  },

  /**
   * 契约档 予愿安洁莉娜（用户 2026-10-15）:
   *   「<战斗中>自身每消耗2枚弹药，使已激活的【罗德岛】和【特种】层数+1」
   *
   * 与 act1autochess_gar_event_consume_ammo 的区别：
   *   ① 只统计**本干员自己**消耗的弹药（那是 "自身每消耗"），不认 ammoScope 的身前/相邻范围；
   *   ② 层数按 `bbStr.bond_ids` 一次给多个盟约（罗德岛 + 特种），且**各自要求已激活**
   *      （`requireActive` —— 文本写的是「已激活的」，未激活的不给，符合仓库里 gainLayers 的既有口径）。
   * 只在**弹药型技能**消耗弹药时计数（用户的裁定）：引擎的 ammoUsed 只在 ammoLeft 真正减少时发出，
   * 非弹药技能的普通攻击不发这个事件，所以这里再按 `skill.kind === 'ammo'` 兜一道。
   */
  AMMO_CONSUME_BOND(battle, list) {
    for (const it of list) {
      const u = it.unit;
      const need = Math.max(1, S.num(it.bb.consume_count, 2));
      const add = S.num(it.bb.add, 1);
      const bonds = ids(it.bbStr.bond_ids);
      if (!bonds.length || !(add > 0)) continue;
      let cnt = 0;
      battle.on('ammoUsed', ({ unit }) => {
        if (unit !== u || !S.onField(u)) return;
        if (u.skill && u.skill.kind !== 'ammo') return;
        cnt++;
        if (cnt % need) return;
        S.gainLayers(battle, {
          playerId: u.ownerId, bonds, n: add, requireActive: true, source: u, reason: 'garrison',
        });
      }, { owner: u });
    }
  },

  act1autochess_gar_event_enemy_abflag_inrange(battle, list) {
    // 监听的状态：`bbStr.check_status` 优先（契约档 但书 "攻击范围内的敌方被减少移动速度时" = sluggish），
    // 否则回到 ab-flag 表（16 = 冻结）。
    const statusOf = (it) => (it.bbStr && it.bbStr.check_status) || AB_FLAG_STATUS[S.num(it.bb.check_ab_flag, 16)] || 'freeze';
    const watched = new Set(list.map(statusOf));
    // "进入冻结时": only a new entry (engine ctx.entered — a refresh of a running status is not one)
    battle.on('statusApplied', ({ target, status, entered }) => {
      if (!target || !watched.has(status) || !entered || target.side !== 'enemy') return;
      for (const it of list) {
        if (status !== statusOf(it)) continue;
        if (!S.onField(it.unit) || !S.inRange(it.unit, target)) continue;
        if (battle.rng() < S.num(it.bb.prob, 1)) fireGain(battle, it);
      }
    });
  },

  // 契约档 末药: "<战斗中>治疗我方单位时，使已激活的【医疗】层数+1（每次作战至多3层）" —— 她自己治疗友方单位
  // 时计数（regen 与自愈也算一次），每 check_cnt 次触发一次，上限走 bb.max_add_count_per_battle。
  act1autochess_gar_event_heal(battle, list) {
    const m = byUnit(list);
    battle.on('heal', ({ source, target }) => {
      const arr = source ? m.get(source) : null;
      if (!arr || !target || target.side !== 'ally') return;
      for (const it of arr) {
        it.cnt++;
        if (it.cnt % Math.max(1, S.num(it.bb.check_cnt, 1)) === 0) fireGain(battle, it);
      }
    });
  },

  // 契约档 黑: "<战斗中>每使一名敌人防御力降低，【狙击】层数+1（最多X层）" —— 敌人身上出现**新的**降低防御的
  // debuff（buff.mods 里 defPct / defFlat < 0 或 defMul < 1）且该 debuff 的来源（buff.source）是持有者本人时
  // 计数一次；同一个 debuff 的续时（extend 原地改 mods）不算新的一次，刷新 / 重新施加（新实例）算一次。
  // 防御降低的施加没有专门的事件（不像 statusApplied），按 tick 轮询敌人身上的 buff 快照做增量。
  gar_event_defdown_source(battle, list) {
    const m = byUnit(list);
    const isDefDown = (b) => {
      const mods = b && b.mods;
      if (!mods) return false;
      return S.num(mods.defPct, 0) < 0 || S.num(mods.defFlat, 0) < 0 || (S.num(mods.defMul, 1) < 1 && S.num(mods.defMul, 0) > 0);
    };
    const seen = new Set();
    battle.on('tick', () => {
      for (const e of battle.enemies) {
        if (!e.alive || !Array.isArray(e.buffs)) continue;
        for (const b of e.buffs) {
          if (!isDefDown(b) || seen.has(b)) continue;
          seen.add(b);
          const arr = b.source ? m.get(b.source) : null;
          if (!arr) continue;
          for (const it of arr) {
            it.cnt++;
            if (it.cnt % Math.max(1, S.num(it.bb.check_cnt, 1)) === 0) fireGain(battle, it);
          }
        }
      }
    });
  },

  // 契约档 坚雷: "<战斗中>每阻挡一位敌人，自身生命值与防御力+5%" —— 按**当前阻挡数**实时重算的自身 buff
  // （蛇屠箱那种 whileTrue 只能表达"有没有挡"，这里是按人头乘系数）。阻挡数一变才重算。
  PROF_DURNAR_BLOCK_STATS(battle, list) {
    for (const it of list) it.n = -1;
    battle.on('tick', () => {
      for (const it of list) {
        const u = it.unit;
        const key = `gar:${it.gid}`;
        const n = S.onField(u) && Array.isArray(u.blocking) ? u.blocking.length : 0;
        if (n === it.n) continue;
        it.n = n;
        if (!(n > 0)) { battle.removeBuff(u, key); continue; }
        S.passiveBuff(battle, u, key, { hpPct: S.num(it.bb.hp_pct, 0) * n, defPct: S.num(it.bb.def_pct, 0) * n });
      }
    });
  },

  act2autochess_gar_event_onstart(battle, list) {
    const m = byUnit(list);
    battle.on('deploy', ({ unit }) => {
      const arr = m.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
    // Player-confirmed: 远牙's granted trait also gains on each body / substitute switch (DESIGN §28.5).
    // Restrict this extra trigger to that trait; use its existing amounts, active-bond checks and battle cap.
    const farTooth = byUnit(list.filter((it) => it.gid === 'garrison_108_a' || it.gid === 'garrison_108_b'));
    if (farTooth.size) battle.on('dollSwap', ({ unit }) => {
      const arr = farTooth.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
  },

  act2autochess_gar_event_allyenemy_sleepstun_inrange(battle, list) {
    battle.on('statusApplied', ({ target, status, entered }) => { // "进入沉睡/晕眩时": new entries only (ctx.entered)
      if (!target || (status !== 'sleep' && status !== 'stun') || !entered) return;
      if (!(target.side === 'enemy' || (target.side === 'ally' && target.kind === 'op'))) return;
      for (const it of list) if (S.onField(it.unit) && S.inRange(it.unit, target)) fireGain(battle, it);
    });
  },

  // 契约档 琴柳/晓歌/格拉尼: "<战斗中>每回复1点部署费用，【先锋】层数+1（每场作战至多X层）" —— 按玩家部署
  // 费用的**正增量**累计（花费回落不计），每满 1 点触发一次；上限走 bb.max_add_count_per_battle。
  gar_event_dp_regen(battle, list) {
    const byPid = new Map();
    for (const it of list) {
      let a = byPid.get(it.unit.ownerId);
      if (!a) { a = []; byPid.set(it.unit.ownerId, a); }
      a.push(it);
    }
    const st = new Map(); // pid → { last, frac }
    battle.on('tick', () => {
      for (const p of battle.players) {
        const s = st.get(p.playerId);
        if (!s) { st.set(p.playerId, { last: p.dp ?? 0, frac: 0 }); continue; }
        const cur = p.dp ?? 0;
        const gain = cur - s.last;
        s.last = cur;
        if (!(gain > 0)) continue;
        s.frac += gain;
        const arr = byPid.get(p.playerId);
        if (!arr) continue;
        while (s.frac >= 1) {
          s.frac -= 1;
          for (const it of arr) fireGain(battle, it);
        }
      }
    });
  },

  // 契约档 棘刺: "若自身攻击范围内有敌人倒下，使【近卫】层数+4（每场作战至多16层）" —— death 'killed'
  //（撤退/到期不算），倒下位置在自身攻击范围内；上限走 bb.max_add_count_per_battle。
  gar_event_enemykilled_inrange(battle, list) {
    battle.on('death', ({ unit, reason }) => {
      if (reason !== 'killed' || !unit || unit.side !== 'enemy') return;
      for (const it of list) if (S.onField(it.unit) && S.inRange(it.unit, unit)) fireGain(battle, it);
    });
  },

  // 契约档 棘刺: "每次普通攻击额外回复2点技力" —— attack 事件（isSkill 的技能攻击不算，每次攻击动作一份）。
  gar_eff_hit_sp(battle, list) {
    const m = byUnit(list);
    battle.on('attack', ({ attacker, isSkill }) => {
      if (!attacker || isSkill) return;
      const arr = m.get(attacker);
      if (!arr) return;
      for (const it of arr) attacker.skill?.gainSp?.(S.num(it.bb.sp, 0), 'garrison:hit_sp');
    });
  },

  act1autochess_gar_event_addition_cnt(battle, list) {
    battle.on('layerGain', (ctx) => {
      if (ctx.reason !== 'garrison' || !ctx.source) return;
      for (const it of list) {
        const h = it.unit;
        if (h.ownerId !== ctx.playerId || !S.onField(h)) continue;
        if (it.bbStr.range_id && it.bbStr.range_id !== '1-1') continue;
        if (sourceInFront(h, ctx.source, ctx.tile)) ctx.n += S.num(it.bb.extra_cnt, 0);
      }
    });
  },

  GAIN_BUFF(battle, list) {
    for (const it of list) {
      const mods = {};
      if (S.num(it.bb.atk, 0) > 0) mods.atkMul = S.num(it.bb.atk);
      if (S.num(it.bb.max_hp, 0) > 0) mods.hpMul = S.num(it.bb.max_hp);
      if (S.num(it.bb.def, 0) > 0) mods.defMul = S.num(it.bb.def);
      S.passiveBuff(battle, it.unit, `gar:${it.gid}`, mods);
    }
  },

  attr_common_global_buff(battle, list) {
    for (const it of list) {
      const mods = {};
      if (S.num(it.bb.sp_recovery_per_sec, 0)) mods.spRecoveryFlat = S.num(it.bb.sp_recovery_per_sec);
      Object.assign(mods, S.directMods({ atk: S.num(it.bb.atk, 0), hp: S.num(it.bb.max_hp, 0) }));
      if (S.num(it.bb.attack_speed, 0)) mods.aspd = S.num(it.bb.attack_speed);
      S.passiveBuff(battle, it.unit, `gar:${it.gid}`, mods);
    }
  },

  // grants are resolved in install(); 风丸's rule lives in the prep economy
  ADD_BOND() {},
  NONE() {},
};

// ---------------------------------------------------------------------------------------------------------------------
// layer readers (每叠加N层)

const READERS = new Set([
  'act1autochess_gar_eff_attrByBond', 'act1autochess_gar_eff_respawnTimeByBond',
  'act2autochess_gar_eff_attrByBond_add_onstart', 'act2autochess_gar_eff_ab_damageScaleByBond',
  'SUI_LAYER_MILESTONE', 'gar_eff_ammo_per_layer',
]);

/** floor(Σ layers of the listed active bonds / divide_num). */
export function stepsOf(battle, it) {
  const div = Math.max(1, S.num(it.bb.divide_num, 1));
  let sum = 0;
  for (const b of it.bonds ?? (it.bonds = ids(it.bbStr.bond_id))) if (S.bondActive(battle, it.unit.ownerId, b)) sum += S.bondLayers(battle, it.unit.ownerId, b);
  return Math.floor(sum / div);
}

function attrMods(bb, k) {
  // "每叠加N层，本干员攻击力+X%": a 直接乘算 bonus like every other "+X%" of the 卫戍 systems (support directMods)
  const m = S.directMods({ atk: S.num(bb.atk, 0) * k, hp: S.num(bb.max_hp, 0) * k, def: S.num(bb.def, 0) * k });
  if (S.num(bb.attack_speed, 0)) m.aspd = S.num(bb.attack_speed) * k;
  if (S.num(bb.hp_recovery_per_sec, 0)) m.hpRegen = S.num(bb.hp_recovery_per_sec) * k;
  if (S.num(bb.sp_recovery_per_sec, 0)) m.spRecoveryFlat = S.num(bb.sp_recovery_per_sec) * k;
  return m;
}

function applyReader(battle, it) {
  const k = stepsOf(battle, it);
  if (k === it.k) return;
  it.k = k;
  const u = it.unit;
  const key = `gar:${it.gid}`;
  switch (it.key) {
    case 'SUI_LAYER_MILESTONE': {
      // 岁·层数里程碑（bbStr.bond_id，默认 suiShip）：每 `every` 层给一份 grant —— extra_targets（额外攻击目标）、
      // block_cnt（阻挡）、magic_resist_penetrate（法术穿透 +X%）。步数 = floor(层数 / every)（2026-10-11 修正：
      // 之前 every 没参与计算、按原始层数发放 —— 重岳/余/黍的里程碑一直超额），随 layerGain 重算。
      if (k > 0) {
        const bb2 = it.bb;
        const n = Math.floor(k / Math.max(1, S.num(bb2.every, 1)));
        const mods = {};
        if (S.num(bb2.extra_targets, 0)) mods.maxTargets = S.num(bb2.extra_targets) * n;
        if (S.num(bb2.block_cnt, 0)) mods.blockCnt = S.num(bb2.block_cnt) * n;
        if (S.num(bb2.magic_resist_penetrate, 0)) mods.resIgnorePct = Math.min(1, S.num(bb2.magic_resist_penetrate) * n);
        S.passiveBuff(battle, u, key, mods);
      } else battle.removeBuff(u, key);
      break;
    }
    case 'gar_eff_ammo_per_layer': {
      // 契约档 克莱门莎/提丰: "【近卫/狙击】每叠加N层，攻击力+X%、弹药量+Y%（子弹射出速度+Z）" —— 攻击力/攻速
      // 走被动 buff 随 layerGain 重算；弹药量按 skill 基础弹药 × 步数补足（非弹药技能不补，只挂展示 buff）。
      if (k > 0) {
        const mods = {};
        if (S.num(it.bb.atk_pct, 0)) mods.atkPct = S.num(it.bb.atk_pct) * k;
        if (S.num(it.bb.aspd, 0)) mods.aspd = S.num(it.bb.aspd) * k;
        S.passiveBuff(battle, u, key, mods);
      } else battle.removeBuff(u, key);
      const pct = S.num(it.bb.ammo_pct, 0);
      if (pct > 0 && u.skill) {
        const baseAmmo = Math.max(0, Math.floor(+u.skill.ammo || 0));
        const n = Math.floor(k * pct * baseAmmo);
        if (u.skill.kind === 'ammo' && n > (it.ammoGiven ?? 0)) {
          u.skill.addAmmo?.(n - (it.ammoGiven ?? 0));
          it.ammoGiven = n;
        }
      }
      break;
    }
    case 'act1autochess_gar_eff_attrByBond':
      if (k > 0) S.passiveBuff(battle, u, key, attrMods(it.bb, k));
      else battle.removeBuff(u, key);
      break;
    case 'act1autochess_gar_eff_respawnTimeByBond':
      // 耀骑士临光's 144: −1.5 % / −3 % per 3 卡西米尔 layers with no minimum in the blackboard (divide_num, respawn_time
      // only) — clamped at 0 like every other redeploy multiplier, so a knock-out timer can reach 0 s (GitHub #370;
      // until 0.2.1 a 0.05 floor kept it at 5 % of the base time from 192 layers, 96 for the elite)
      if (k > 0) S.passiveBuff(battle, u, key, { redeployMul: Math.max(0, 1 + S.num(it.bb.respawn_time, 0) * k) });
      else battle.removeBuff(u, key);
      break;
    case 'act2autochess_gar_eff_attrByBond_add_onstart': {
      const b = u.findBuff(key);
      if (b && b.timeLeft > 0) onstartBuff(battle, it, b.timeLeft);
      break;
    }
    default: break; // damageScale reads it.k in the hit hook
  }
}

function onstartBuff(battle, it, duration) {
  const k = Math.max(0, it.k);
  const key = `gar:${it.gid}`;
  if (!(k > 0) || !(duration > 0)) { battle.removeBuff(it.unit, key); return; }
  battle.addBuff(it.unit, { key, duration, refresh: 'replace', mods: { atkFlat: S.num(it.bb.atk, 0) * k, hpFlat: S.num(it.bb.max_hp, 0) * k } });
}

function installReaders(battle, by) {
  const list = [];
  for (const key of READERS) for (const it of by.get(key) ?? EMPTY) list.push(it);
  if (!list.length) return;
  const recompute = () => { for (const it of list) applyReader(battle, it); };
  recompute();
  let pending = false;
  battle.on('layerGain', () => {
    if (pending) return;
    pending = true;
    battle.after(0, () => { pending = false; recompute(); });
  });
  const onstart = by.get('act2autochess_gar_eff_attrByBond_add_onstart');
  if (onstart) {
    const m = byUnit(onstart);
    battle.on('deploy', ({ unit }) => {
      const arr = m.get(unit);
      if (!arr) return;
      for (const it of arr) { it.k = stepsOf(battle, it); onstartBuff(battle, it, S.num(it.bb.duration, 0)); }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// hit modifiers

/**
 * 弱点伤害 (research 04 §glossary: "each hit is dealt as whichever of physical/arts yields MORE damage against that
 * target's DEF/RES"): the engine's own mitigation formula incl. the attacker's DEF/RES ignore stats; a tie keeps the
 * original type.
 */
export function weaknessType(source, target, dmg) {
  const ss = source && source.s ? source.s : null;
  const ign = {
    defIgnorePct: S.num(dmg.defIgnorePct, 0) + (ss ? S.num(ss.defIgnorePct, 0) : 0),
    defIgnoreFlat: S.num(dmg.defIgnoreFlat, 0) + (ss ? S.num(ss.defIgnoreFlat, 0) : 0),
    resIgnorePct: S.num(dmg.resIgnorePct, 0) + (ss ? S.num(ss.resIgnorePct, 0) : 0),
    resIgnoreFlat: S.num(dmg.resIgnoreFlat, 0) + (ss ? S.num(ss.resIgnoreFlat, 0) : 0),
  };
  const ph = mitigate(dmg.amount, 'phys', target.s, ign) * (ss ? S.num(ss.physDealtMul, 1) : 1) * S.num(target.s.physTakenMul, 1);
  const ar = mitigate(dmg.amount, 'arts', target.s, ign) * (ss ? S.num(ss.artsDealtMul, 1) : 1) * S.num(target.s.artsTakenMul, 1);
  if (ar > ph + 1e-9) return 'arts';
  if (ph > ar + 1e-9) return 'phys';
  return dmg.type;
}
const bound = (t) => !!(t.s && t.s.flags && t.s.flags.bind) || !!t.findBuff('bind');

/** Priority of the 弱点伤害 conversion: after every default-priority hit modifier, so the final amount decides. */
export const WEAKNESS_PRIORITY = -10;

function installHitMods(battle, by) {
  const m = new Map();
  const push = (it, kind) => {
    let a = m.get(it.unit);
    if (!a) { a = []; m.set(it.unit, a); }
    a.push({ it, kind });
  };
  for (const it of by.get('act1autochess_gar_eff_attack_enemy') ?? EMPTY) push(it, 'tag');
  for (const it of by.get('act2autochess_gar_eff_ab_damageScaleByBond') ?? EMPTY) push(it, 'ab');
  if (m.size) {
    battle.on('hit', ({ source, target, dmg }) => {
      const arr = source ? m.get(source) : null;
      if (!arr || !target || target.side !== 'enemy' || !dmg || dmg.type === 'element') return;
      for (let i = 0; i < arr.length; i++) {
        const { it, kind } = arr[i];
        if (kind === 'tag') {
          // an ATK multiplier: fixed-value DoT ticks are not ATK-based
          if (Array.isArray(dmg.tags) && dmg.tags.includes('dot')) continue;
          const tags = target.def && target.def.tags;
          if (Array.isArray(tags) && tags.includes(it.bbStr.check_tag)) dmg.amount *= S.num(it.bb.atk, 1);
        } else if (it.k > 0) {
          const hit = (S.num(it.bb.check_ab_flag, 0) && bound(target)) || (S.num(it.bb.check_sluggish, 0) && !!target.findBuff('sluggish'));
          if (hit) dmg.mul = S.num(dmg.mul, 1) * (1 + S.num(it.bb.damage_scale_per_stack, 0) * it.k);
        }
      }
    });
  }
  const chaos = new Set((by.get('act1autochess_gar_eff_chaos') ?? EMPTY).map((it) => it.unit));
  if (chaos.size) {
    battle.on('hit', ({ source, target, dmg }) => {
      if (!source || !chaos.has(source) || !target || target.side !== 'enemy' || !dmg) return;
      if (dmg.type === 'phys' || dmg.type === 'arts') dmg.type = weaknessType(source, target, dmg);
    }, { priority: WEAKNESS_PRIORITY });
  }
}
