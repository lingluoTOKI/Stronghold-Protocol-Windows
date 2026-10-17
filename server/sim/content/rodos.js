// 罗德岛 战斗侧 —— 用户 2026-10-15 全量重写（盟约级效果）。
//
// 盟约级只有两条 buff 路线：
//   · 10 层起每叠 4 层：所有【罗德岛】干员 攻/血 +1%。
//   · 6 名在场：所有【罗德岛】干员 造成伤害提高 (15 + (-1*(当前生命值-31)) * 4) %。
//
// 干员个体特质（5/6 本结算、克洛丝/凯尔希·思衡托/煌/迷迭香/刻俄柏/予愿安洁莉娜）不属于"盟约效果文本"，
// 但仍按需要保留并随这次重写校准（去掉旧版依赖的 deprecated 字段名）。
import { RODOS_BOND, RODOS_BALANCE as B, RODOS_PER_OPERATOR as P } from '../../../shared/rodosIsland.js';
import * as S from './support/index.js';
import { giveSp } from './kits/shared/tier1.js';

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
function setPassive(battle, unit, key, mods) {
  const old = unit.findBuff(key);
  if (old && Object.keys(mods).every((k) => old.mods?.[k] === mods[k]) && Object.keys(old.mods ?? {}).length === Object.keys(mods).length) return;
  battle.addBuff(unit, { key, mods, persist: true, allowDead: true });
}
function isRodosOp(unit) {
  const list = unit?.def?.raw?.bonds ?? unit?.def?.bonds;
  return Array.isArray(list) && list.includes(RODOS_BOND);
}
const rodosLayers = (battle, playerId) => {
  const b = battle.getPlayer(playerId)?.bonds?.[RODOS_BOND];
  return b?.active ? Math.max(0, Number(b.layers) || 0) : 0;
};

export function install(battle) {
  // ---- 10 层起每叠 4 层：所有【罗德岛】干员 攻/血 +1% ----
  const layerBuffRefresh = () => {
    for (const ps of battle.players) {
      const bond = ps?.bonds?.[RODOS_BOND];
      if (!bond?.active) continue;
      const layers = Math.max(0, Number(bond.layers) || 0);
      const steps = Math.floor(layers / B.layersPerStep);
      const atkPct = steps * B.layerAtkPctPerStep;
      const hpPct = steps * B.layerHpPctPerStep;
      for (const u of ps.units) {
        if (!S.isOp(u) || !isRodosOp(u)) continue;
        if (atkPct > 0 || hpPct > 0) setPassive(battle, u, 'rodos:layers', { atkPct, hpPct });
        else {
          const old = u.findBuff('rodos:layers');
          if (old) battle.removeBuff(u, old);
        }
      }
    }
  };
  battle.on('battleStart', layerBuffRefresh);
  battle.on('deploy', layerBuffRefresh);
  battle.on('layerGain', ({ bondId }) => { if (bondId === RODOS_BOND) battle.after(0, layerBuffRefresh); });
  battle.on('tick', layerBuffRefresh, { priority: 95 });

  // ---- 6 名在场：所有【罗德岛】干员 造成伤害提高 (15 + (-1*(当前生命值-31)) * 4) % ----
  // pct 直接由玩家当前 lp（策略生命值）算出 —— 越残血加伤越高（负 1 倍系数）。
  const R = B.dmgPerLifeLost;
  const damageBuffRefresh = () => {
    for (const ps of battle.players) {
      const bond = ps?.bonds?.[RODOS_BOND];
      const active = !!bond?.active;
      const onField = new Set();
      for (const u of ps?.units ?? []) {
        if (!S.isOp(u) || !up(u) || !isRodosOp(u)) continue;
        onField.add(S.baseChessId(u));
      }
      const lp = num(ps?.lp, 0);
      const pct = R.bonusBase + R.k * (lp - R.baseLp) * R.stepPct;
      const grant = active && onField.size >= R.at && pct > 0;
      for (const u of ps?.units ?? []) {
        if (!S.isOp(u) || !isRodosOp(u)) continue;
        if (grant) setPassive(battle, u, 'rodos:dmgLifeLost', { dmgDealtMul: 1 + pct / 100 });
        else {
          const old = u.findBuff('rodos:dmgLifeLost');
          if (old) battle.removeBuff(u, old);
        }
      }
    }
  };
  battle.on('battleStart', damageBuffRefresh);
  battle.on('deploy', damageBuffRefresh);
  battle.on('death', damageBuffRefresh);
  battle.on('layerGain', ({ bondId }) => { if (bondId === RODOS_BOND) battle.after(0, damageBuffRefresh); });

  // ---- 史尔特尔：攻击范围内有敌方单位被击倒 → 罗德岛 / 近卫 叠层（保留个体特质，参数化到 P）----
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    const g = traitOf(u, 'RODOS_DEPLOY_LAYER');
    if (!g) continue;
    const used = new Map();
    battle.on('death', (c) => {
      const dead = c?.unit;
      if (!dead || dead.side !== 'enemy' || c.reason !== 'killed') return;
      if (!up(u) || !S.inRange(u, dead)) return;
      const wantR = num(g.bb.rodos, P.surtrDeploy.rodos[0]);
      const capR = num(g.bb.max_layer, P.surtrDeploy.rodosCap[0]);
      if (wantR > 0 && capR > 0) {
        const left = capR - (used.get('rodos') ?? 0);
        if (left > 0) {
          const n = Math.min(wantR, left);
          const added = S.gainLayers(battle, { playerId: u.ownerId, bonds: [RODOS_BOND], n, requireActive: true, source: u, reason: 'garrison' });
          used.set('rodos', (used.get('rodos') ?? 0) + added);
        }
      }
      // 突袭 / 奥术 仍走官方史尔特尔旧键（保留扩展）
      const wantA = num(g.bb.raid);
      const capA = num(g.bb.raid_max, P.surtrDeploy.raidCap[0]);
      if (wantA > 0 && capA > 0) {
        const left = capA - (used.get('raid') ?? 0);
        if (left > 0) {
          const n = Math.min(wantA, left);
          const added = S.gainLayers(battle, { playerId: u.ownerId, bonds: ['raidShip'], n, requireActive: true, source: u, reason: 'garrison' });
          used.set('raid', (used.get('raid') ?? 0) + added);
        }
      }
      const wantM = num(g.bb.arcane);
      const capM = num(g.bb.arcane_max, P.surtrDeploy.arcaneCap[0]);
      if (wantM > 0 && capM > 0) {
        const left = capM - (used.get('arcane') ?? 0);
        if (left > 0) {
          const n = Math.min(wantM, left);
          const added = S.gainLayers(battle, { playerId: u.ownerId, bonds: ['arcaneShip'], n, requireActive: true, source: u, reason: 'garrison' });
          used.set('arcane', (used.get('arcane') ?? 0) + added);
        }
      }
    }, { owner: u });
  }

  // ---- 寒芒克洛丝：前方干员开技能 → 罗德岛 / 精准 叠层 ----
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    const g = traitOf(u, 'RODOS_FRONT_SKILL_LAYER');
    if (!g) continue;
    let usedR = 0, usedP = 0;
    battle.on('skillStart', (c) => {
      const caster = c.unit;
      if (!up(u) || !up(caster) || caster === u || caster.ownerId !== u.ownerId) return;
      const [fr, fc] = [(u.tileR + (u.fwd?.[0] ?? 0)), (u.tileC + (u.fwd?.[1] ?? 1))];
      if (caster.tileR !== fr || caster.tileC !== fc) return;
      const capR = num(g.bb.max_layer, P.kroosAllySkill.cap);
      const nR = Math.max(0, Math.min(num(g.bb.rodos, P.kroosAllySkill.layers), capR - usedR));
      if (nR > 0) usedR += S.gainLayers(battle, { playerId: u.ownerId, bonds: [RODOS_BOND], n: nR, requireActive: true, source: u, reason: 'garrison' });
      const capP = num(g.bb.preci_max, P.kroosAllySkill.preciCap[1]);
      const nP = Math.max(0, Math.min(num(g.bb.preci, P.kroosAllySkill.preci[0]), capP - usedP));
      if (nP > 0) usedP += S.gainLayers(battle, { playerId: u.ownerId, bonds: ['preciShip'], n: nP, requireActive: true, source: u, reason: 'garrison' });
    }, { owner: u });
  }

  // ---- 凯尔希·思衡托：罗德岛 / 医疗 每 N 层 → 本干员 弹药量 +M、攻击力 +P% ----
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    const g = traitOf(u, 'RODOS_AMMO_PER_LAYER');
    if (!g) continue;
    const step = Math.max(1, num(g.bb.layers_per_step, P.kalts2.layersPerStep));
    const per = num(g.bb.ammo, P.kalts2.ammoPerStep);
    const ammoPct = num(g.bb.ammo_pct);
    const atkPctPer = num(g.bb.atk_pct, P.kalts2.atkPctPerStep);
    const addonId = g.bbStr?.addon_bond_id || null;
    const addonLayers = () => (addonId ? Math.max(0, Number(battle.getPlayer(u.ownerId)?.bonds?.[addonId]?.layers) || 0) : 0);
    const refresh = () => {
      if (!up(u)) return;
      const layers = rodosLayers(battle, u.ownerId) + addonLayers();
      const steps = Math.floor(layers / step);
      const pct = steps * atkPctPer;
      const old = u.findBuff('rodos:kalts2');
      if (pct > 0) {
        if (!old || old.mods?.atkPct !== pct) battle.addBuff(u, { key: 'rodos:kalts2', persist: true, allowDead: true, mods: { atkPct: pct } });
      } else if (old) battle.removeBuff(u, old);
      // 弹药：Skill.addAmmo 只对「正在跑」的弹药技能生效（非 active 直接 return）。所以「本次激活已补足的子弹数」
      // 只能在技能激活期间记账 —— 早期版本 battleStart 也走这里，mem 被记成 n 却一颗子弹都没进去，技能开启时
      // `n > mem` 不成立 ⇒ 这条驻地（每 N 层弹药量 +M%）在实战里从不生效。现在技能开启时先把记账清零，再按
      // 当前层数整份补足；层数在技能进行中继续上涨时补差额。
      if (!u.skill || u.skill.kind !== 'ammo' || !u.skill.active) return;
      const baseAmmo = Math.max(0, Math.floor(+u.skill.ammo || 0));
      const n = ammoPct != null ? Math.floor(steps * ammoPct * baseAmmo) : steps * per;
      if (n > (u.mem.rodosAmmo ?? 0)) {
        u.skill.addAmmo?.(n - (u.mem.rodosAmmo ?? 0));
        u.mem.rodosAmmo = n;
      }
    };
    battle.on('battleStart', refresh);
    battle.on('layerGain', ({ bondId }) => { if (bondId === RODOS_BOND || (addonId && bondId === addonId)) battle.after(0, refresh); });
    // 一次激活一个基数：技能开启时清零记账，再整份补足（同一次的后续 layerGain 只补差额）
    battle.on('skillStart', ({ unit: x }) => { if (x !== u) return; u.mem.rodosAmmo = 0; refresh(); }, { owner: u });
  }

  // ---- 「罗德岛<职业>每叠 N 层，本干员 +X」家族（刻俄柏 / 迷迭香 / 予愿安洁莉娜）----
  const LAYER_FAMILY = [
    { key: 'RODOS_LAYER_ASPD', buffKey: 'rodos:layerAspd', apply: (u, steps, g) => ({ aspd: steps * num(g.bb.aspd, 1) }) },
    { key: 'RODOS_LAYER_ATK', buffKey: 'rodos:layerAtk', apply: (u, steps, g) => ({ atkPct: steps * num(g.bb.atk_pct, 0.02) }) },
    { key: 'RODOS_LAYER_AMMO_ATK', buffKey: 'rodos:layerAmmoAtk', apply: (u, steps, g) => ({ atkPct: steps * num(g.bb.atk_pct, 0.01) }) },
  ];
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    const g = LAYER_FAMILY.map((f) => [f, traitOf(u, f.key)]).find(([, gg]) => gg);
    if (!g) continue;
    const [fam, rec] = g;
    const step = Math.max(1, num(rec.bb.layers_per_step, 3));
    const bondId = rec.bbStr?.bond_id || null;
    const ownBonds = new Set(Array.isArray(u.def?.raw?.bonds) ? u.def.raw.bonds : (Array.isArray(u.def?.bonds) ? u.def.bonds : []));
    const layersOf = (id) => (id ? Math.max(0, Number(battle.getPlayer(u.ownerId)?.bonds?.[id]?.layers) || 0) : 0);
    const refresh = () => {
      if (!up(u)) return;
      const total = layersOf(RODOS_BOND) + (bondId && ownBonds.has(bondId) ? layersOf(bondId) : 0);
      const steps = Math.floor(total / step);
      const mods = fam.apply(u, steps, rec);
      const old = u.findBuff(fam.buffKey);
      const same = old && Object.keys(mods).every((k) => old.mods?.[k] === mods[k]);
      const any = (mods.aspd || 0) > 0 || (mods.atkPct || 0) > 0;
      if (any && !same) battle.addBuff(u, { key: fam.buffKey, persist: true, allowDead: true, visible: true, tags: ['trait'], mods });
      else if (!any && old) battle.removeBuff(u, old);
      const ammoPct = num(rec.bb.ammo_pct, 0);
      if (ammoPct > 0 && u.skill) {
        const baseAmmo = Math.max(0, Math.floor(+u.skill.ammo || 0));
        const n = Math.floor(steps * ammoPct * baseAmmo);
        if (u.skill.kind === 'ammo' && n > (u.mem.rodosLayerAmmo ?? 0)) {
          u.skill.addAmmo?.(n - (u.mem.rodosLayerAmmo ?? 0));
          u.mem.rodosLayerAmmo = n;
        }
      }
    };
    battle.on('battleStart', refresh);
    battle.on('layerGain', ({ bondId: b }) => { if (b === RODOS_BOND || (bondId && b === bondId)) battle.after(0, refresh); });
    battle.on('skillStart', ({ unit: x }) => { if (x === u) refresh(); }, { owner: u });
    battle.on('deploy', (ctx) => { if (ctx.unit === u) refresh(); }, { owner: u });
  }

  // ---- 煌：部署时获得 SP，首次击败敌人使【罗德岛】【近卫】层数 +N ----
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    const g = traitOf(u, 'RODOS_DEPLOY_SP_FIRSTKILL');
    if (!g) continue;
    const sp = num(g.bb.sp, 25);
    const n = num(g.bb.layers, 8);
    battle.on('deploy', (ctx) => { if (ctx.unit !== u) return; if (sp > 0) giveSp(u, sp, 'garrison'); }, { owner: u });
    let done = false;
    battle.on('death', (c) => {
      if (done) return;
      if (!up(u)) return;
      const dead = c?.unit;
      if (!dead || dead.side !== 'enemy' || c.reason !== 'killed') return;
      done = true;
      S.gainLayers(battle, { playerId: u.ownerId, bonds: [RODOS_BOND], n, requireActive: true, source: u, reason: 'garrison:rodos-firstkill' });
      S.gainLayers(battle, { playerId: u.ownerId, bonds: ['warriorShip'], n, requireActive: true, source: u, reason: 'garrison:rodos-firstkill' });
    }, { owner: u });
  }

  // ---- 个体特质「自身攻击力、防御力、生命值 +X%」（RODOS_STARTER_ADDON / RODOS_STARTER_TOP 每回合累加）----
  //
  // prep 侧没有"给某一块干员永久加属性"的通道，所以那几个 handler 把累加值写进玩家 counters 的
  // `rodos:selfStat:<uid>`（JSON）；这里按 uid 把加成挂到本单位上，每次新战斗（battleStart）都重新应用。
  // 同一块干员多次升级 / 换代后 uid 会变，旧键留着不影响（找不到对应单位就跳过）。
  const applySelfStats = () => {
    for (const ps of battle.players || []) {
      const counters = ps.counters || {};
      for (const [key, raw] of Object.entries(counters)) {
        if (!key.startsWith('rodos:selfStat:') || typeof raw !== 'string') continue;
        const uid = Number(key.slice('rodos:selfStat:'.length));
        if (!Number.isInteger(uid)) continue;
        let p = null;
        try { p = JSON.parse(raw); } catch { continue; }
        if (!p || typeof p !== 'object') continue;
        const mods = {};
        if (num(p.atkPct) > 0) mods.atkPct = num(p.atkPct);
        if (num(p.defPct) > 0) mods.defPct = num(p.defPct);
        if (num(p.hpPct) > 0) mods.hpPct = num(p.hpPct);
        if (!Object.keys(mods).length) continue;
        for (const u of ps.units || []) {
          if (!S.isOp(u) || u.uid !== uid) continue;
          S.passiveBuff(battle, u, `rodos:selfStat:${uid}`, mods);
        }
      }
    }
  };
  applySelfStats();
  battle.on('battleStart', applySelfStats);
}

export default { install };
