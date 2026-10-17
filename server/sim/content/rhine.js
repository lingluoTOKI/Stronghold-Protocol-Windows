// 莱茵生命 (Rhine Lab): the battle-side 伊芙利特 system.
//
// 0.1.3-Rhine 重做：科研装置（生命维持仪 / 能量谐振仪 / 生态调控器）与突破研究点整体移除。战斗侧只剩两件事：
//   1) 每 3 层科研让所有【莱茵生命】干员 +30 生命上限 / +15 防御；
//   2) 伊芙利特：基础攻击力 = 300(普通)/500(精锐) + 科研层数×2 + 装备给的基础攻击力 + 定向补给累积 + 梅尔每 6 层 +1；
//      在场干员再给她各自的额外效果（对应干员是精锐时该加成 ×1.5）。
// 层数收入由星级 1/2/3/4/5/6 本干员的特质结算（休整期侧的赫默/白面鸮/溯光星源在 rhineMeta.js，战斗侧的星源/
// 塞雷娅/麦哲伦/多萝西/伊芙利特在本文件的 skillStart 钩子里）。3 / 6 / 9 名不同莱茵生命干员时的「获得伊芙利特 /
// 升精锐 / 获得莱茵实验终端与联合研究主机」都在休整期侧（server/match/Match.js 的 rhineIfritCheck）。
// 装备：莱茵实验终端 = 攻击力% + 只对伊芙利特生效的基础攻击力；联合研究主机 = 非伊芙利特生命上限 / 伊芙利特基础攻击力，
// 且她同时带终端时再 +基础攻击力并附带灼热损伤（`ifritEquipBaseAtk` / `ifritPairBurn`）。
import { RHINE_BALANCE as B, RHINE_BOND, RHINE_CHARACTERS as C, RHINE_EQUIPMENT } from '../../../shared/rhineResearch.js';
import * as S from './support/index.js';
import { refreshItems } from './items/battle.js';

const alive = (u) => !!u?.alive && u.deployed && !u.removed && !u.hidden;
const charId = (u) => u.def?.charId ?? u.def?.raw?.charId;
const elite = (u) => S.isElite(u);
const layersOf = (ps) => {
  const b = ps?.bonds?.[RHINE_BOND];
  return b?.active ? Math.max(0, Number(b.layers) || 0) : 0;
};
/** Is this unit a 莱茵生命 operator? (变形同构体 pairings are prep-side, so the record's bonds decide.) */
function isRhineOp(u) {
  if (!S.isOp(u)) return false;
  if (S.unitBonds(u).includes(RHINE_BOND)) return true;
  const cid = charId(u);
  return !!cid && Object.values(C).includes(cid);
}
/** The unit's garrison (特质) records, and the one carrying `effectKey` (the trait's own effect), or null. */
function garrisonIdsOf(u) {
  const list = u?.def?.raw?.garrisonIds ?? u?.def?.garrisonIds;
  return Array.isArray(list) ? list : [];
}
function traitOf(unit, effectKey) {
  for (const gid of garrisonIdsOf(unit)) {
    const g = S.garrisonRecord(gid);
    if (g && g.effectKey === effectKey) return g;
  }
  return null;
}
/** The first deployed, alive copy of a named Rhine operator, or null. */
const unitOf = (ps, cid) => (ps?.units ?? []).find((u) => u.kind === 'op' && alive(u) && charId(u) === cid) ?? null;
const present = (ps, cid) => !!unitOf(ps, cid);
function setPassive(battle, unit, key, mods) {
  const old = unit.findBuff(key);
  if (old && mods && old.mods && Object.keys(mods).every((k) => old.mods[k] === mods[k]) && Object.keys(old.mods).length === Object.keys(mods).length) return;
  battle.addBuff(unit, { key, mods, persist: true, allowDead: true });
}
function clearPassive(battle, unit, key) {
  const old = unit.findBuff(key);
  if (old) battle.removeBuff(unit, old);
}

/** The params a carried item stores under one of its battle-rune `bbStr.key`s (rhine_terminal / rhine_mainframe), or null. */
function equipParams(u, key, bbKey) {
  for (const id of S.itemsOf(u)) {
    if (S.itemKeyOf(id) !== key) continue;
    const p = S.buffParams(S.itemRecord(id), bbKey);
    if (p) return p;
  }
  return null;
}
const TERMINAL_KEY = RHINE_EQUIPMENT.terminal.key;
const MAINFRAME_KEY = RHINE_EQUIPMENT.mainframe.key;
const terminalParams = (u) => equipParams(u, TERMINAL_KEY, 'rhine_terminal');
const mainframeParams = (u) => equipParams(u, MAINFRAME_KEY, 'rhine_mainframe');

/**
 * 联合研究主机: 携带者不是伊芙利特 → 生命上限 +45%（精锐 +90%）；携带者是伊芙利特 → 换成基础攻击力（`ifritEquipBaseAtk`
 * 并在她的基础攻击力公式里），所以这里只给非伊芙利特挂生命上限。任何干员都可能带，所以对每个干员跑。
 */
function refreshMainframe(battle, u) {
  const p = mainframeParams(u);
  const hp = p && charId(u) !== C.ifrit ? Math.max(0, S.num(p.max_hp)) : 0;
  if (hp > 0) setPassive(battle, u, 'rhine:mainframe', { hpPct: hp });
  else clearPassive(battle, u, 'rhine:mainframe');
}

/**
 * 装备给伊芙利特的基础攻击力：莱茵实验终端 +50、联合研究主机 +100，两者同时携带再 +50（普通 / 精锐各按自身品阶）。
 * 终端原先的「每 10 层科研 +攻速」已整条删除。
 */
function ifritEquipBaseAtk(u) {
  const t = terminalParams(u), m = mainframeParams(u);
  let n = (t ? Math.max(0, S.num(t.ifrit_atk)) : 0) + (m ? Math.max(0, S.num(m.ifrit_atk)) : 0);
  if (t && m) n += Math.max(0, S.num(m.pair_atk));
  return n;
}

/** 伊芙利特同时携带终端与主机时的灼燃附伤比例（取主机品阶），否则 0。 */
function ifritPairBurn(u) {
  const m = mainframeParams(u);
  if (!m || !terminalParams(u)) return 0;
  return Math.max(0, S.num(m.burn));
}

/**
 * 定向补给（娜斯提策略）：偶数回合累积的伊芙利特「基础攻击力 +」总额。娜斯提的 prep handler 把它写进一个隐藏的
 * player effect（key `rhine:ifritBandAtk`），这里读出来并进她的基础攻击力公式。
 */
function bandIfritBaseAtk(ps) {
  const e = (ps.playerEffects ?? []).find((x) => x.key === 'rhine:ifritBandAtk');
  return e ? Math.max(0, S.num(e.params?.atk)) : 0;
}

/** 机械水獭的 token id（rhineSupport.js 的 OTTER 同源）。 */
const OTTER_TOKEN = 'token_10004_otter_motter';
/**
 * Whether a healer (`_healer`) may heal `target`. 机械水獭不能接受干员治疗（包括塞雷娅及干员的治疗召唤物）：
 * 科研装置（生命维持仪）移除后不再有例外，所以水獭对一切干员治疗关闭；无干员治疗来源的自然回复不受此限。
 */
export function canReceiveHeal(_healer, target) {
  return !(target && (target.defId === OTTER_TOKEN || target.def?.id === OTTER_TOKEN));
}

export function install(battle) {
  // ---- per-layer HP/DEF + the Ifrit model, recomputed on every relevant event -------------------------
  const refreshOp = (ps, u) => {
    if (u.kind !== 'op') return;
    refreshMainframe(battle, u);
    if (!isRhineOp(u)) return;
    const active = !!ps?.bonds?.[RHINE_BOND]?.active;
    const layers = layersOf(ps);
    // 每 1 层科研：所有莱茵生命干员基础生命值 +2、基础防御力 +1（hpFlat/defFlat 加在基础值上，见 sim/units.js）。
    const steps = Math.floor(layers / B.layerStep);
    if (!active || steps <= 0) { clearPassive(battle, u, 'rhine:layers'); }
    else setPassive(battle, u, 'rhine:layers', { hpFlat: steps * B.layerHp, defFlat: steps * B.layerDef });
    if (charId(u) !== C.ifrit) return;
    // 在场干员的加成：B.presence 里是普通版数值，对应干员是精锐时整体 ×B.presenceEliteMul（+50%）。
    const presenceMul = (key) => {
      const owner = unitOf(ps, C[key]);
      return owner && elite(owner) ? B.presenceEliteMul : 1;
    };
    // 缪尔赛思（在场效果）：伊芙利特穿戴的装备效果 ×1.5（精锐缪尔赛思 ×1.5 再 ×1.5）。她的进场 / 离场会改这个
    // 倍率，所以改了就重装一次装备。
    const muelsyse = unitOf(ps, C.muelsyse);
    refreshItems(battle, u, muelsyse ? B.presence.muelsyse.equipMul * presenceMul('muelsyse') : 1);
    if (!active) { clearPassive(battle, u, 'rhine:ifritPresence'); return; }
    // 梅尔（1 本特质 `RHINE_MAYER_IFRIT_ATK`）：每 `bb.layer_step` 层莱茵生命给她基础攻击力 +`bb.flat`
    //   （普通每 6 层 +1，精锐每 4 层 +1 —— 数值读梅尔自己那条 garrison 的 bb，`RHINE_BALANCE` 只做兜底）。
    const mayer = unitOf(ps, C.mayer);
    const mayerElite = !!mayer && elite(mayer);
    const gMayer = mayer ? traitOf(mayer, 'RHINE_MAYER_IFRIT_ATK') : null;
    const mayerStepLen = gMayer
      ? Math.max(1, S.num(gMayer.bb.layer_step, mayerElite ? B.mayerEliteAtkLayerStep : B.mayerAtkLayerStep))
      : (mayerElite ? B.mayerEliteAtkLayerStep : B.mayerAtkLayerStep);
    const mayerPer = gMayer ? S.num(gMayer.bb.flat, B.mayerIfritFlat) : B.mayerIfritFlat;
    const mayerStep = mayer ? Math.floor(layers / mayerStepLen) : 0;
    const mayerAtk = mayer && mayerStep > 0 ? mayerStep * mayerPer : 0;
    // 基础攻击力 = 300(普通)/500(精锐) + 科研层数×每层加成 + 装备给的基础攻击力（终端 +50 / 主机 +100 / 两者同带再 +50）
    //   + 定向补给累积（娜斯提策略的偶数回合 +10）+ 梅尔每 6（精锐 4）层 +1 + 梅尔在场 +20（精锐 ×1.5，见 presenceEliteMul）。
    // 每层加成：默认 +2；在场 9 名不同【莱茵生命】干员时提高到 +3（B.ifritAttackPerLayerTier3）。
    const mayerPresenceAtk = mayer ? B.mayerPresenceAtk * presenceMul('mayer') : 0;
    const rhineCount = Number(ps?.bonds?.[RHINE_BOND]?.count) || 0;
    // 伊芙利特自己的 `RHINE_IFRIT_BASE_ATK`：基础攻击力固定为 bb.base_atk、每层 +bb.per_layer
    //   （普通 300 / 精锐 500，各带一份记录；常量只做兜底）。
    const gIfrit = traitOf(u, 'RHINE_IFRIT_BASE_ATK');
    const ifritBase0 = gIfrit ? S.num(gIfrit.bb.base_atk, B.ifritBaseAttack[elite(u) ? 1 : 0]) : B.ifritBaseAttack[elite(u) ? 1 : 0];
    const perLayerBase = gIfrit ? S.num(gIfrit.bb.per_layer, B.ifritAttackPerLayer) : B.ifritAttackPerLayer;
    const perLayer = rhineCount >= B.thresholds[2] ? B.ifritAttackPerLayerTier3 : perLayerBase;
    const base = ifritBase0 + layers * perLayer + ifritEquipBaseAtk(u) + bandIfritBaseAtk(ps) + mayerAtk + mayerPresenceAtk;
    if (u.base.atk !== base) { u.base.atk = base; u.markDirty(); }
    // 在场干员给伊芙利特的额外效果。慢速 / 装备倍率 / 伤害倍率三条另有归属：
    // 麦哲伦的减速在下面的 tick 光环里，缪尔赛思的 ×1.5 走 refreshItems，溯光星源的倍率键要写成 1+x，所以都在循环外处理。
    const mods = {};
    for (const [key, eff] of Object.entries(B.presence)) {
      const cid = C[key];
      if (!cid || !present(ps, cid)) continue;
      const mul = presenceMul(key);
      for (const [k, v] of Object.entries(eff)) if (k !== 'slow' && k !== 'equipMul' && k !== 'dmgDealtMul') mods[k] = (mods[k] ?? 0) + v * mul;
    }
    // 溯光星源（在场效果）：伊芙利特造成伤害提高 20%（精锐 30%）。`dmgDealtMul` 是乘算键，值写 1+百分比。
    if (present(ps, C.halo2)) mods.dmgDealtMul = (mods.dmgDealtMul ?? 1) * (1 + B.presence.halo2.dmgDealtMul * presenceMul('halo2'));
    if (Object.keys(mods).length) setPassive(battle, u, 'rhine:ifritPresence', mods);
    else clearPassive(battle, u, 'rhine:ifritPresence');
  };
  const refresh = () => { for (const ps of battle.players) for (const u of ps.units) refreshOp(ps, u); };

  battle.on('battleStart', refresh);
  battle.on('deploy', refresh);
  battle.on('death', refresh);
  battle.on('layerGain', ({ bondId }) => { if (bondId === RHINE_BOND) battle.after(0, refresh); });
  battle.on('tick', refresh, { priority: 100 });

  // ---- 2 本 星源: 【莱茵生命】与【术师】每 N 层 → 本干员攻击力 +P% ------------------------------------
  // 数据驱动（garrison `RHINE_ASTGENNE_ATK_PER_LAYER` 的 bb）：旧的「每次开技能给莱茵生命与奥术加层」已移除。
  for (const u of battle.allyUnits) {
    if (!S.isOp(u) || charId(u) !== C.astgenne) continue;
    const g = traitOf(u, 'RHINE_ASTGENNE_ATK_PER_LAYER');
    const step = Math.max(1, S.num(g?.bb?.layers_per_step, B.astgenneAtkStep));
    const per = S.num(g?.bb?.atk_pct, B.astgenneAtkPct);
    const partnerId = g?.bbStr?.caster_bond_id || B.astgennePartnerBond;
    const refresh = () => {
      if (!alive(u)) return;
      const ps = battle.getPlayer(u.ownerId);
      const layers = Math.max(0, Number(ps?.bonds?.[RHINE_BOND]?.layers) || 0)
        + Math.max(0, Number(ps?.bonds?.[partnerId]?.layers) || 0);
      const pct = Math.floor(layers / step) * per;
      const key = 'rhine:astgenneAtk';
      const old = u.findBuff(key);
      if (pct > 0) {
        if (!old || old.mods?.atkPct !== pct) battle.addBuff(u, { key, persist: true, allowDead: true, mods: { atkPct: pct } });
      } else if (old) battle.removeBuff(u, old);
    };
    battle.on('battleStart', refresh);
    battle.on('layerGain', ({ bondId }) => {
      if (bondId === RHINE_BOND || bondId === partnerId) battle.after(0, refresh);
    });
  }

  // ---- 3 本 塞雷娅: 伊芙利特每次开启技能后，本干员 攻击/生命/防御 +10%（精锐 +20%），最多 +30%（精锐 +40%）-----
  //   数值读她自己的 `RHINE_SARIA_SELF_STAT`（bb.pct / bb.cap），`RHINE_BALANCE` 只做兜底。
  for (const u of battle.allyUnits) {
    if (!S.isOp(u) || charId(u) !== C.saria) continue;
    const grade = elite(u) ? 1 : 0;
    const gSaria = traitOf(u, 'RHINE_SARIA_SELF_STAT');
    const per = gSaria ? S.num(gSaria.bb.pct, B.sariaTriggerPct[grade]) : B.sariaTriggerPct[grade];
    const cap = gSaria ? S.num(gSaria.bb.cap, B.sariaTriggerCap[grade]) : B.sariaTriggerCap[grade];
    let pct = 0;
    battle.on('skillStart', (c) => {
      const caster = c.unit;
      if (!alive(u) || !caster || caster.ownerId !== u.ownerId || charId(caster) !== C.ifrit) return;
      if (c.reason === 'carry' || c.skill?.kind === 'passive') return;
      if (pct >= cap) return;
      pct = Math.min(cap, pct + per);
      setPassive(battle, u, 'rhine:saria', { atkPct: pct, hpPct: pct, defPct: pct });
    }, { owner: u });
  }

  // ---- 4 本 麦哲伦: 伊芙利特每次开启技能 → 莱茵生命与第二条羁绊 各 +N（两项各有一场战斗的叠加上限）-------
  // ---- 5 本 多萝西: 同上。数值/羁绊由各自 garrison 的 bb / bbStr 驱动（bb.layer/max_layer/addon/addon_max）；
  //      缺记录时回退旧常量（麦哲伦第二线 = 灵巧，多萝西只有莱茵生命）。
  for (const owner of battle.allyUnits) {
    if (!S.isOp(owner)) continue;
    const cid = charId(owner);
    const isMagallan = cid === C.magallan, isDorothy = cid === C.dorothy;
    if (!isMagallan && !isDorothy) continue;
    const grade = elite(owner) ? 1 : 0;
    const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));
    const g = traitOf(owner, isMagallan ? 'RHINE_MAGALLAN_IFRIT_SKILL' : 'RHINE_DOROTHY_IFRIT_SKILL');
    const per = g ? num(g.bb.layer) : (isMagallan ? B.magallanSkillLayers : B.dorothySkillLayers)[grade];
    const cap = g ? num(g.bb.max_layer) : (isMagallan ? B.magallanBattleCap : B.dorothyBattleCap)[grade];
    const addonId = g ? g.bbStr?.addon_bond_id || null : (isMagallan ? B.skillfulBondId : null);
    const addonPer = g ? num(g.bb.addon) : per;
    const addonCap = g ? num(g.bb.addon_max) : (isMagallan ? B.magallanSkillfulCap[grade] : 0);
    const lines = [
      [g?.bbStr?.rhine_bond_id || RHINE_BOND, per, cap],
      ...(addonId ? [[addonId, addonPer, addonCap]] : []),
    ].filter(([id, n, cp]) => id && n > 0 && cp > 0);
    if (!lines.length) continue;
    const used = {};
    battle.on('skillStart', (c) => {
      const caster = c.unit;
      if (!alive(owner) || !caster || caster.ownerId !== owner.ownerId || charId(caster) !== C.ifrit) return;
      if (c.reason === 'carry' || c.skill?.kind === 'passive') return;
      for (const [bondId, want, cp] of lines) {
        const n = Math.max(0, Math.min(want, cp - (used[bondId] ?? 0)));
        if (n > 0) used[bondId] = (used[bondId] ?? 0) + S.gainLayers(battle, { playerId: owner.ownerId, bonds: [bondId], n, requireActive: true, source: owner, reason: 'garrison' });
      }
    }, { owner });
  }

  // ---- 在场效果: 麦哲伦 减速光环 / 溯光星源 灼燃附伤（都作用在伊芙利特的攻击范围/攻击上）-------------
  battle.on('tick', () => {
    for (const ps of battle.players) {
      const magallan = unitOf(ps, C.magallan);
      if (!magallan) continue;
      // 精锐麦哲伦给伊芙利特的光环同样 +50%（20% → 30%）。
      const slow = B.presence.magallan.slow * (elite(magallan) ? B.presenceEliteMul : 1);
      for (const u of ps.units) {
        if (u.kind !== 'op' || !alive(u) || charId(u) !== C.ifrit) continue;
        for (const e of battle.enemiesInKeys(u.rangeKeys, u, u.profile)) {
          battle.applyStatus(e, 'slow', { value: slow, duration: battle.dt * 2, source: u });
        }
      }
    }
  }, { priority: 90 });
  battle.on('hit', (c) => {
    const u = c.source;
    if (!S.isOp(u) || charId(u) !== C.ifrit || !c.target || c.target.side !== 'enemy') return;
    // element damage does not re-trigger this handler (the burn proc below is itself element damage)
    if (!c.dmg || c.dmg.type === 'element') return;
    // 莱茵实验终端 + 联合研究主机 联动：伊芙利特每次攻击额外附带主机品阶对应的灼热损伤（普通 10% / 精锐 15%）。
    const burn = ifritPairBurn(u);
    if (!(burn > 0)) return;
    battle.dealDamage(u, c.target, { amount: u.s.atk * burn, type: 'element', element: 'burn',
      isSkill: !!c.dmg.isSkill, canDodge: false, tags: ['rhineBurn'] });
  }, { priority: 0 });
}

export default { install };
