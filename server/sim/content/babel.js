// 巴别塔 (Babel): the battle-side traits. The bond's layer economy (资金 spend) and its milestone payouts
// live in babelMeta.js; this module implements what each member does once a battle is running.
//
// Every trait reads its numbers from the garrison blackboard written by tools/babel-data.mjs, so the
// balance table in shared/babelTower.js stays the single source of truth.
import { BABEL_BOND, BABEL_ADDON_BONDS, BABEL_BALANCE as B, BABEL_MON3TR_TOKEN } from '../../../shared/babelTower.js';
import * as S from './support/index.js';
import { buffStepsOf } from './babelMeta.js';

const up = (u) => !!u && u.alive && u.deployed && !u.removed && !u.hidden;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));

function garrisonIdsOf(unit) {
  const list = unit?.def?.raw?.garrisonIds ?? unit?.def?.garrisonIds;
  return Array.isArray(list) ? list : [];
}
function traitOf(unit, effectKey) {
  for (const gid of garrisonIdsOf(unit)) {
    const g = S.garrisonRecord(gid);
    if (g && g.effectKey === effectKey) return g;
  }
  return null;
}
/** True when the bond is active for the unit's owner. */
const active = (battle, playerId, bondId) => !!battle.getPlayer(playerId)?.bonds?.[bondId]?.active;

function gain(battle, { unit, bondIds, n, requireActive = true }) {
  if (!(n > 0)) return 0;
  return S.gainLayers(battle, { playerId: unit.ownerId, bonds: bondIds, n, requireActive, source: unit, reason: 'garrison' });
}

/** Tile offset: `d` = +1 for the tile in front, -1 for the tile behind. */
function tileAt(u, d) {
  return [(u.tileR + (u.fwd?.[0] ?? 0) * d), (u.tileC + (u.fwd?.[1] ?? 1) * d)];
}

/** Permanent ATK / HP steps the player has banked from 资金 spend (see babelMeta.js). */
function buffSteps(battle, playerId) {
  return buffStepsOf(playerId ?? battle.playerId);
}

/** Bond blackboard of `bondId` from the frozen game data (`{}` when absent). */
const bondBB = (bondId) => (S.bondRecord(bondId) || {}).bb || {};

/** Bonds a unit carries (own + 变形同构体 grants). */
const bondsOf = (u) => S.unitBonds(u);

/** The three 阿米娅 of this fork, identified by their 升变 trait's effectKey. */
const AMIYA_TRAITS = Object.freeze({
  caster: 'BABEL_FRONT_SKILL_LAYER',   // 阿米娅（术士）
  guard: 'BABEL_BACK_SKILL_LAYER',    // 阿米娅（近卫）
  medic: 'BABEL_ANY_SKILL_LAYER',     // 阿米娅（医疗）
});

/**
 * (历史) 固定的三条盟约线：巴别塔 / 魔王 / 升变。2026-10-12 用户裁定后阿米娅改为「自身已激活盟约」（动态），
 * 本函数已无调用方，保留数值映射供调试参照。
 */
function amiyaLayerLines(g, fallback) {
  return [
    [g.bbStr?.babel_bond_id || BABEL_BOND, num(g.bb.babel, fallback.babel)],
    [g.bbStr?.demon_bond_id || BABEL_ADDON_BONDS.demon, num(g.bb.demon, fallback.demon)],
    [g.bbStr?.evolve_bond_id || BABEL_ADDON_BONDS.evolve, num(g.bb.evolve, fallback.evolve)],
  ].filter(([id, amount]) => typeof id === 'string' && id && amount > 0);
}

/**
 * 升变（1 名）· 三名阿米娅是否都为精锐.
 *
 * 注意自 2026-10-14 起**同形态可以在场多名**（placement.js 只禁「不同形态」），所以不能再假设
 * 「场上恰好一名、其余两名都在备战席」。判定改为：三形态（术士/近卫/医疗）**每一形态**都有一个精锐副本
 * 被持有（在场或备战席皆可），且在场的那名阿米娅自身是精锐。
 * `contentInfo().babelBench` 现在把场上已有的形态也并了进去（babelMeta.js babelBenchInfo）。
 */
function allAmiyaElite(battle, u) {
  if (!S.isElite(u)) return false;
  const bench = S.contentInfo(battle, u.ownerId).babelBench || {};
  const onField = Object.keys(AMIYA_TRAITS).find((k) => traitOf(u, AMIYA_TRAITS[k]));
  if (!onField) return false;
  for (const k of Object.keys(AMIYA_TRAITS)) {
    if (!bench[AMIYA_TRAITS[k]]?.elite) return false;   // 每一形态都要有精锐（含 onField 自己）
  }
  return true;
}

/** Floating-point-safe buff comparison (avoids re-adding an identical buff every layer gain). */
const sameMods = (a, b) => {
  const ka = a ? Object.keys(a) : [];
  const kb = b ? Object.keys(b) : [];
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (Math.abs(Number(a[k]) - Number(b[k])) > 1e-9) return false;
  return true;
};
/** Idempotent per-battle passive buff: re-adds key `key` with `mods`, or drops it when empty. */
function setBuff(battle, u, key, mods) {
  const old = u.findBuff(key);
  if (mods && Object.keys(mods).length) {
    if (!old || !sameMods(old.mods, mods)) {
      battle.addBuff(u, { key, persist: true, allowDead: true, refresh: 'replace', mods });
    }
  } else if (old) battle.removeBuff(u, old);
}

export function install(battle) {
    // ---- 永久加成: 巴别塔在场的干员 攻击力 / 生命值 +1% per banked step -----------------------------
    for (const u of battle.allyUnits) {
      if (!S.isOp(u)) continue;
      const list = u?.def?.raw?.bonds ?? u?.def?.bonds;
      if (!Array.isArray(list) || !list.includes(BABEL_BOND)) continue;
      if (!traitOf(u, 'BABEL_ANY_SKILL_LAYER') && !u.def) continue;
      const refresh = () => {
        if (!up(u)) return;
        const steps = buffSteps(battle, u.ownerId);
        const pct = steps * num(B.buffAtkPctPerStep, 0.01);
        const key = 'babel:permanent';
        const old = u.findBuff(key);
        if (pct > 0) {
          if (!old || old.mods?.atkPct !== pct || old.mods?.hpPct !== pct) {
            battle.addBuff(u, { key, persist: true, allowDead: true, mods: { atkPct: pct, hpPct: pct } });
          }
        } else if (old) battle.removeBuff(u, old);
      };
      battle.on('battleStart', refresh);
      battle.on('deploy', ({ unit: x }) => { if (x === u) refresh(); }, { owner: u });
    }

    // ---- 附加盟约 魔王: 魔王干员造成的伤害提升 (10 + 每层×0.25)%，**2 名魔王在场才激活** -----------------
    // 用户 2026-10-14 规格：<2魔王激活> —— 场上需要有 2 名【魔王】干员，该加成才开始生效。
    // 2026-10-16：data/bonds.json 的 demonShip 激活阈值同步为 2（activeCount / thresholds），
    // 盟约面板的「N人激活」与这里的战斗内判定从此是同一个数（此前面板是 1 人）。
    {
      const DEMON = BABEL_ADDON_BONDS.demon;
      const bb = bondBB(DEMON);
      const base = num(bb.base_dmg, B.demonDmgBase);
      // 伤害 (10 + 每层*0.25)% —— 新键 dmg_per_layer 优先，缺失时用旧的 dmg_per10/10 折算。
      const perLayer = num(bb.dmg_per_layer, num(bb.dmg_per10, B.demonDmgPer10) / 10);
      const need = Math.max(1, num(bb.active_count, 2));      // <2魔王激活>
      const installed = new Set();
      for (const u of battle.allyUnits) {
        if (!S.isOp(u) || !bondsOf(u).includes(DEMON)) continue;
        const refresh = () => {
          if (!up(u)) return;
          // 场上实际在场的【魔王】干员数（同一玩家）
          let onField = 0;
          for (const x of battle.allyUnits) {
            if (!S.isOp(x) || x.ownerId !== u.ownerId) continue;
            if (!S.onField(x)) continue;
            if (!bondsOf(x).includes(DEMON)) continue;
            onField++;
          }
          if (onField < need) { setBuff(battle, u, 'babel:demon-dmg', null); return; }
          const layers = Math.max(0, num(battle.getPlayer(u.ownerId)?.bonds?.[DEMON]?.layers, 0));
          const bonus = base + layers * perLayer;
          setBuff(battle, u, 'babel:demon-dmg', bonus > 0 ? { dmgDealtMul: 1 + bonus } : null);
        };
        if (installed.has(u)) continue;
        installed.add(u);
        battle.on('battleStart', refresh);
        battle.on('deploy', ({ unit: x }) => { if (x === u) refresh(); }, { owner: u });
        // 人数变化（上场 / 下场 / 阵亡）也会改变 <2魔王激活> 的成立与否
        battle.on('deploy', () => battle.after(0, refresh), { owner: u });
        battle.on('death', ({ unit: x }) => { if (x && x.ownerId === u.ownerId) battle.after(0, refresh); }, { owner: u });
        battle.on('layerGain', ({ bondId }) => { if (bondId === DEMON) battle.after(0, refresh); });
      }
    }

    // ---- 附加盟约 升变（1 名）: 在场阿米娅的三形态效果 ------------------------------------------------
    {
      const EVOLVE = BABEL_ADDON_BONDS.evolve;
      const bb = bondBB(EVOLVE);
      const n3 = (v, d) => num(v, d);
      for (const u of battle.allyUnits) {
        if (!S.isOp(u)) continue;
        const kind = Object.keys(AMIYA_TRAITS).find((k) => traitOf(u, AMIYA_TRAITS[k]));
        if (!kind) continue; // not one of the three 阿米娅
        const refresh = () => {
          if (!up(u)) return;
          const ps = battle.getPlayer(u.ownerId);
          if (!ps?.bonds?.[EVOLVE]?.active) { setBuff(battle, u, 'babel:evolve', null); return; }
          const L = Math.max(0, num(ps.bonds[EVOLVE].layers, 0));
          // 在场的形态（100%）+ 其余形态只要被持有（在场或备战席）就按下述比例折算。
          // 同形态可以在场多名，所以「其余形态」= 三形态里除掉自己这一形态的另两个。
          const parts = [{ k: kind, s: 1 }];
          const bench = S.contentInfo(battle, u.ownerId).babelBench || {};
          const others = Object.keys(AMIYA_TRAITS).filter((k) => k !== kind);
          const hits = others.map((k) => bench[AMIYA_TRAITS[k]]);
          if (hits.every(Boolean)) {
            const elites = hits.filter((b) => b && b.elite).length;
            const scale = num(bb.bench_base, B.evolveBenchBase) + elites * num(bb.bench_elite_step, B.evolveBenchEliteStep);
            for (const k of others) parts.push({ k, s: scale });
          }
          const mods = {};
          // _bonds-mod.txt：三条形态效果都是**每层线性**（原来按 L/3、L/20 分步）
          //   术士 攻速 (10 + 每层*0.4)   近卫 攻击 (10 + 每层*0.4)%   医疗 法穿 (15 + 每层*0.1)
          for (const { k, s } of parts) {
            if (k === 'caster') mods.aspd = (mods.aspd || 0) + s * (n3(bb.caster_aspd_base, B.evolveCasterAspdBase) + L * n3(bb.caster_aspd_per_layer, 0.4));
            else if (k === 'guard') mods.atkPct = (mods.atkPct || 0) + s * (n3(bb.guard_atk_base, B.evolveGuardAtkBase) + L * n3(bb.guard_atk_per_layer, 0.004));
            else if (k === 'medic') mods.resIgnoreFlat = (mods.resIgnoreFlat || 0) + s * (n3(bb.medic_pen_base, B.evolveMedicPenBase) + L * n3(bb.medic_pen_per_layer, 0.1));
          }
          // 无论哪个阿米娅在场: **技力回复速度 +(10 + 每层*0.1)%**（用户 2026-10-14：百分比、每层线性）
          // 原来是 spRecoveryFlat + Math.floor(L/10) 分步 + 固定点数 —— 语义与口径都不对。
          const spPct = (n3(bb.sp_regen_base, B.evolveSpBase) + L * n3(bb.sp_regen_per_layer, B.evolveSpPer10 / 10)) / 100;
          if (spPct > 0) mods.spRecoveryMul = 1 + spPct;
          setBuff(battle, u, 'babel:evolve', mods);
        };
        battle.on('battleStart', refresh);
        battle.on('deploy', ({ unit: x }) => { if (x === u) refresh(); }, { owner: u });
        battle.on('layerGain', ({ bondId }) => { if (bondId === EVOLVE) battle.after(0, refresh); });
      }
    }

    /**
     * 阿米娅（术士 / 近卫 / 医疗）: 全场每有一个干员开启技能 → 自身已激活盟约 各 +N。
     * 目标盟约动态取「该阿米娅自身携带且当前已激活」的每一条（巴别塔 / 魔王 / 升变，以及激活中的职业附加）。
     * 上限是每「回合」每条盟约各自计数（battle.round 翻动即重置，赫德雷同款口径）。
     * `triggerOne(caster)` 判定「开启技能的干员是否算触发」；`fallback` 是该形态的数值表。
     */
    const amiyaSkillLines = (u, g, triggerOne, fallback) => {
      const cap = Math.max(0, num(g.bb.max_layer, fallback.cap));
      const amount = Math.max(0, num(g.bb.babel, fallback.babel));
      if (!(cap > 0) || !(amount > 0)) return;
      const store = S.battleStore(battle, 'babel:amiyaLayerState', () => ({}));
      const key = `${g.garrisonId}:${u.id}`;
      if (store[key] == null) store[key] = { round: -1, used: {} };
      const st = store[key];
      battle.on('skillStart', (c) => {
        const caster = c.unit;
        // triggerOne 由调用方给出：三位阿米娅现都是「全场每有一个干员开启技能」（含自身）。
        if (!up(u) || !up(caster) || caster.ownerId !== u.ownerId) return;
        if (!triggerOne(caster)) return;
        // 每回合上限: reset when the battle round rolls over.
        if (st.round !== battle.round) { st.round = battle.round; st.used = {}; }
        const ps = battle.getPlayer(u.ownerId);
        // 自身已激活盟约（动态）：own + 变形同构体，逐条看 active（gain 里还兜一层 requireActive）。
        const lines = bondsOf(u).filter((id) => id && (ps?.bonds?.[id]?.active ?? false));
        for (const bondId of lines) {
          const n = Math.max(0, Math.min(amount, cap - (st.used[bondId] ?? 0)));
          if (n <= 0) continue;
          const added = gain(battle, { unit: u, bondIds: [bondId], n });
          if (added > 0) st.used[bondId] = (st.used[bondId] ?? 0) + added;
        }
      }, { owner: u });
    };

    // ---- 阿米娅（术士）: 全场每有一个干员开启技能 → 巴别塔 / 魔王 / 升变 各 +1（每场每条上限 6） ------
    // （effectKey 仍沿用 BABEL_FRONT_SKILL_LAYER，历史上是「身前一格」；现按用户口径改成全场。）
    for (const u of battle.allyUnits) {
      if (!S.isOp(u)) continue;
      const g = traitOf(u, 'BABEL_FRONT_SKILL_LAYER');
      if (!g) continue;
      amiyaSkillLines(u, g, () => true, B.amiCasterAllySkill);
    }

    // ---- 阿米娅（近卫）: 全场每有一个干员开启技能 → 巴别塔 / 魔王 / 升变 各 +1（每场每条上限 10） -----
    // （effectKey 仍沿用 BABEL_BACK_SKILL_LAYER，历史上是「身后一格」；现按用户口径改成全场。）
    for (const u of battle.allyUnits) {
      if (!S.isOp(u)) continue;
      const g = traitOf(u, 'BABEL_BACK_SKILL_LAYER');
      if (!g) continue;
      amiyaSkillLines(u, g, () => true, B.amiGuardAllySkill);
    }

    // ---- 阿米娅（医疗）: 全场每有一个干员开启技能 → 自身已激活盟约 各 +2（每回合每条上限 16） ----
    for (const u of battle.allyUnits) {
      if (!S.isOp(u)) continue;
      const g = traitOf(u, 'BABEL_ANY_SKILL_LAYER');
      if (!g) continue;
      amiyaSkillLines(u, g, () => true, B.amiMedicAllySkill);
    }

    // ---- 升变（1 名）· 真实伤害技能每场战斗只能释放一次；三名阿米娅都为精锐时解除 ----------------------
    for (const u of battle.allyUnits) {
      if (!S.isOp(u)) continue;
      if (!Object.keys(AMIYA_TRAITS).some((k) => traitOf(u, AMIYA_TRAITS[k]))) continue;
      if (!B.evolveTrueSkillOncePerBattle) continue;
      battle.on('skillEnd', (c) => {
        if (c.unit !== u) return;
        const sk = c.skill;
        if (!sk || sk.kind === 'passive') return;
        if (!(num(sk.bb?.true_dmg, 0) > 0)) return;     // 只有真实伤害技能受限
        if (allAmiyaElite(battle, u)) return;           // 三名阿米娅都为精锐 → 不再有限制
        sk.noSkill = true;                              // 本场已释放一次，本场不可再放
      }, { owner: u });
    }

    // ---- 赫德雷: 叠层特质（数值见 garrisons bb；每回合上限） --------------------------------------------
    // 赫德雷：身后一格的干员开启技能时触发。
    for (const u of battle.allyUnits) {
      if (!S.isOp(u)) continue;
      const g = traitOf(u, 'BABEL_STUN_LAYER');
      if (!g) continue;
      const key = `gar:${g.garrisonId}:${u.id}`;
      // 每场战斗的叠层计数：存在 battle 上（旧代码写 battle.mem，但 Battle 上并无此字段 —— install 阶段抛错
      // 会让本文件后续所有的处理器（魔王 / 凯尔希 / 维什戴尔）都注册不上）。
      const store = S.battleStore(battle, 'babel:stunState', () => ({}));
      if (store[key] == null) store[key] = { babel: 0, addon: 0, round: -1 };
      const st = store[key];
      const grant = () => {
        if (!up(u)) return;
        // 每回合上限: reset when the battle round rolls over.
        if (st.round !== battle.round) { st.round = battle.round; st.babel = 0; st.addon = 0; }
        const babelCap = num(g.bb.babel_max, B.cqbwStun.babelCap[0]);
        const addonCap = num(g.bb.visi_max ?? g.bb.preci_max, B.cqbwStun.preciCap[0]);
        const babelN = Math.max(0, Math.min(num(g.bb.babel, B.cqbwStun.babel[0]), babelCap - st.babel));
        const addonN = Math.max(0, Math.min(num(g.bb.visi ?? g.bb.preci, 1), addonCap - st.addon));
        const addonId = g.bbStr.visi_bond_id || g.bbStr.preci_bond_id || BABEL_ADDON_BONDS.preci;
        if (babelN > 0) st.babel += gain(battle, { unit: u, bondIds: [g.bbStr.babel_bond_id || BABEL_BOND], n: babelN });
        if (addonN > 0) st.addon += gain(battle, { unit: u, bondIds: [addonId], n: addonN });
      };
      // 赫德雷：身后一格的干员开启技能时 → 叠层
      battle.on('skillStart', (c) => {
        const caster = c.unit;
        if (!up(u) || !up(caster) || caster.ownerId !== u.ownerId) return;
        const [br, bc] = tileAt(u, -1);
        if (caster.tileR !== br || caster.tileC !== bc) return;
        grant();
      });
    }

    // ---- W（5 本）: 本干员攻击范围内每有一个干员开启技能 → 巴别塔 / 精准 各 +N（每场战斗各上限）---------
    // 独立于赫德雷的 effectKey：W 的触发范围（攻击范围内，而非全场）与上限口径（每场战斗，而非每回合）都不同。
    for (const u of battle.allyUnits) {
      if (!S.isOp(u)) continue;
      const g = traitOf(u, 'BABEL_RANGE_SKILL_LAYER');
      if (!g) continue;
      const key = `gar:${g.garrisonId}:${u.id}`;
      const store = S.battleStore(battle, 'babel:rangeStun', () => ({}));
      if (store[key] == null) store[key] = {};
      const st = store[key];
      const lines = [
        [g.bbStr?.babel_bond_id || BABEL_BOND, num(g.bb.babel, 0), num(g.bb.babel_max, 0)],
        [g.bbStr?.preci_bond_id || BABEL_ADDON_BONDS.preci, num(g.bb.preci, 0), num(g.bb.preci_max, 0)],
      ].filter(([id, n, cap]) => typeof id === 'string' && n > 0 && cap > 0);
      // 上限是「每场战斗」：计数留在本场的 battleStore 里，回合切换不清零。
      battle.on('skillStart', (c) => {
        const caster = c.unit;
        if (!up(u) || !up(caster) || caster.ownerId !== u.ownerId) return;
        if (!S.inRange(u, caster)) return; // 只统计本干员攻击范围内的干员
        for (const [bondId, amount, cap] of lines) {
          const n = Math.max(0, Math.min(amount, cap - (st[bondId] ?? 0)));
          if (n <= 0) continue;
          st[bondId] = (st[bondId] ?? 0) + gain(battle, { unit: u, bondIds: [bondId], n });
        }
      });
    }

    // ---- 魔王（4 本）: 身前一格干员因特质叠层时，使其层数额外 +N ---------------------------------------
    // N 按身前干员的类型取「一档」（不叠加）：默认 +any；身前为巴别塔盟约（非阿米娅）+babel；身前为阿米娅 +amiya。
    // 例（普通魔王）：身前干员自身 +1 层 → 默认合计 2、身前是巴别塔干员合计 3、身前是阿米娅合计 4；精锐各再 +1。
    for (const u of battle.allyUnits) {
      if (!S.isOp(u)) continue;
      const g = traitOf(u, 'BABEL_FRONT_TRAIT_BOOST');
      if (!g) continue;
      const nAny = num(g.bb.any, 1);
      const nBabel = num(g.bb.babel, nAny);
      const nAmiya = num(g.bb.amiya, nBabel);
      const isAmiya = (x) => Object.values(AMIYA_TRAITS).some((k) => traitOf(x, k));
      battle.on('layerGain', (ev) => {
        if (!up(u)) return;
        const src = ev?.source ?? ev?.unit;
        if (!src || src === u || src.ownerId !== u.ownerId) return;
        const [fr, fc] = tileAt(u, 1);
        if (src.tileR !== fr || src.tileC !== fc) return;
        if (String(ev?.reason ?? '') !== 'garrison') return; // 只加成特质带来的叠层
        if (typeof ev.bondId !== 'string') return;
        const n = isAmiya(src) ? nAmiya : bondsOf(src).includes(BABEL_BOND) ? nBabel : nAny;
        if (n > 0) gain(battle, { unit: u, bondIds: [ev.bondId], n });
      });
    }

    // ---- 凯尔希: 巴别塔每叠 N 层 → (召唤物) Mon3tr 攻击力 / 生命值 +P%、攻击速度 +A --------------------
    for (const u of battle.allyUnits) {
      if (!S.isOp(u)) continue;
      const g = traitOf(u, 'BABEL_MON3TR_PER_LAYER');
      if (!g) continue;
      const step = Math.max(1, num(g.bb.layers_per_step, B.kaltsLayersPerStep));
      const perAtk = num(g.bb.atk_pct, B.kaltsMon3trPctPerStep);
      const perHp = num(g.bb.hp_pct, perAtk);
      const perAspd = num(g.bb.aspd, B.kaltsMon3trAspdPerStep);
      // 第二条羁绊可由 bbStr.addon_bond_id 指定（凯尔希 = 医疗），层数与巴别塔相加后取档。
      const addonId = g.bbStr?.addon_bond_id || null;
      // 加成落在她召唤出来的 token 上（Mon3tr），不是凯尔希自身。
      const summons = () => battle.allyUnits.filter((t) => t.kind === 'token' && t.ownerUnit === u);
      const refresh = () => {
        if (!up(u)) return;
        const layers = Math.max(0, Number(battle.getPlayer(u.ownerId)?.bonds?.[babelId(g)]?.layers) || 0)
          + (addonId ? Math.max(0, Number(battle.getPlayer(u.ownerId)?.bonds?.[addonId]?.layers) || 0) : 0);
        const steps = Math.floor(layers / step);
        const key = 'babel:mon3tr';
        for (const t of summons()) {
          if (!t.alive || t.removed) continue;
          setBuff(battle, t, key, steps > 0
            ? { atkPct: steps * perAtk, hpPct: steps * perHp, aspd: steps * perAspd }
            : null);
        }
      };
      battle.on('battleStart', refresh);
      battle.on('deploy', ({ unit: x }) => { if (x === u || x?.ownerUnit === u) battle.after(0, refresh); });
      battle.on('layerGain', ({ bondId }) => {
        const mainId = babelId(g);
        if (bondId === mainId || (addonId && bondId === addonId)) battle.after(0, refresh);
      });
    }

    // ---- 维什戴尔: 巴别塔和精准每有 N 层 → 本干员攻击力 +P% ------------------------------------------
    for (const u of battle.allyUnits) {
      if (!S.isOp(u)) continue;
      const g = traitOf(u, 'BABEL_ATK_PER_LAYER');
      if (!g) continue;
      const step = Math.max(1, num(g.bb.layers_per_step, B.wisdelLayersPerStep));
      const per = num(g.bb.atk_pct, B.wisdelAtkPctPerStep);
      // 第二条盟约可由 bbStr.addon_bond_id 指定（凯尔希精锐=魔王，默认=精准）
      const addonId = g.bbStr?.addon_bond_id || BABEL_ADDON_BONDS.preci;
      const refresh = () => {
        if (!up(u)) return;
        const ps = battle.getPlayer(u.ownerId);
        const layers = Math.max(0, Number(ps?.bonds?.[BABEL_BOND]?.layers) || 0)
          + Math.max(0, Number(ps?.bonds?.[addonId]?.layers) || 0);
        const pct = Math.floor(layers / step) * per;
        const key = 'babel:atk';
        const old = u.findBuff(key);
        if (pct > 0) {
          if (!old || old.mods?.atkPct !== pct) {
            battle.addBuff(u, { key, persist: true, allowDead: true, mods: { atkPct: pct } });
          }
        } else if (old) battle.removeBuff(u, old);
      };
      battle.on('battleStart', refresh);
      battle.on('layerGain', ({ bondId }) => {
        if (bondId === BABEL_BOND || bondId === addonId) battle.after(0, refresh);
      });
    }
}

export default { install };

// =================================================================================================================
// 凯尔希的召唤物 Mon3tr（shared/babelTower.js BABEL_MON3TR_TOKEN）—— 与 流形 / 医疗探机 同类的手动放置召唤物。
//
// PRTS / 客户端表：阻挡 3；天赋 1「Mon3tr」可以被凯尔希治疗，不在凯尔希攻击范围内时防御力降至 0；
// 天赋 2「不毁重构」被击倒后（不包括撤退）使周围 8 格敌人晕眩 3 秒并对其造成 1200 点真实伤害；
// 备注 凯尔希退场时强制撤退场上的 Mon3tr；Mon3tr 退场后原地返还 1 个（手牌补足见 PlayerState.grantTokensFor）。
// 凯尔希的「巴别塔 / 魔王每 3 层 → Mon3tr 攻防 +1%」由上面的 BABEL_MON3TR_PER_LAYER 特质挂在它的 token 上。

/** 周围 8 格（不含自身）内的敌人。 */
function mon3trAround(battle, unit) {
  const out = [];
  for (const e of battle.enemies) {
    if (!e.alive || e.hidden) continue;
    const dr = e.tileR - unit.tileR, dc = e.tileC - unit.tileC;
    if (dr === 0 && dc === 0) continue;
    if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) out.push(e);
  }
  return out;
}

/** Mon3tr 的 kit（tokenKits[token_10002_kalts_mon3tr]）。 */
export function mon3trKit(bb, raw, def) {
  return {
    skill: null,
    install(battle, unit) {
      // ---- 天赋 2 不毁重构: 被击倒（不包括撤退）→ 周围 8 格晕眩 + 真实伤害 ----------------------------
      const tal = (Array.isArray(def?.talents) ? def.talents : []).find((t) => t?.bb && t.bb.value != null);
      const stun = num(tal?.bb?.stun, 3);
      const trueDmg = num(tal?.bb?.value, 1200);
      battle.on('death', (c) => {
        if (c.unit !== unit || c.reason !== 'killed') return; // 撤退 / 到期不算「被击倒」
        for (const e of mon3trAround(battle, unit)) {
          if (trueDmg > 0) battle.dealDamage(unit, e, { amount: trueDmg, type: 'true', isSkill: true, canDodge: false, tags: ['summon', 'talent'] });
          if (stun > 0 && e.alive) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
        }
        battle.fx('summonBurst', { x: unit.x, y: unit.y, id: unit.id, token: unit.defId });
      }, { owner: unit });

      const own = unit.ownerUnit && unit.ownerUnit.side === 'ally' ? unit.ownerUnit : null;
      if (!own) return;

      // ---- 凯尔希退场 → 强制撤退场上的 Mon3tr（PRTS 备注） --------------------------------------------
      battle.on('death', (c) => {
        if (c.unit === own && unit.alive) battle.retreat(unit, { reason: 'ownerGone', permanent: true });
      }, { owner: unit });

      // ---- 天赋 1 Mon3tr: 不在凯尔希攻击范围内时防御力降至 0 ------------------------------------------
      battle.every(0.25, () => {
        if (!unit.alive) return;
        const inside = up(own) && !!S.inRange(own, unit);
        battle.addBuff(unit, {
          key: 'mon3tr:outOfRange', refresh: 'replace', duration: 0.5, source: unit,
          mods: inside ? {} : { defFlat: -Math.max(0, Number(unit.base?.def) || 0) },
        });
      }, { owner: unit });
    },
  };
}

/** 召唤物 kit 注册表（content/index.js 合并进 TOKEN_KITS）。 */
export const tokenKits = Object.freeze({ [BABEL_MON3TR_TOKEN]: mon3trKit });

/** The bond a 凯尔希 trait feeds (巴别塔 unless the garrison names another). */
function babelId(g) {
  return g?.bbStr?.babel_bond_id || BABEL_BOND;
}
void active;
