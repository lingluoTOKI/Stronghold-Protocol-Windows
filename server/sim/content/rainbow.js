// 彩虹小队 (Rainbow Six collab): the team-wide layer bonuses and every combat-side (IN_BATTLE) 特质.
// Prep-side traits live in rainbowMeta.js, exactly like the Rhine expansion splits rhine.js / rhineMeta.js.
//
// Layer model: 彩虹小队 is an add-on bond that activates with one member. Its layers grant the team-wide
// bonuses of shared/rainbowSquad.js — to EVERY operator of the player (「加成全队」). Which lines are live
// depends on which members are deployed; an elite (精锐) member raises ITS OWN line to 125% for everyone
// (用户 2026-10-11 重做：线性每层数值，增益对全队一致).
//
// The team lines are read from the deployed members, not from any garrison: 战车's own 特质 is prep-side
// (SERVER_PREP_FIN), so the module must run whenever a collab operator can be on the field.
import { RAINBOW_BOND, RAINBOW_CHARACTERS, RAINBOW_BALANCE as B, rainbowTeamMods, isRainbowCharacter } from '../../../shared/rainbowSquad.js';
import * as S from './support/index.js';

const alive = (u) => !!u?.alive && u.deployed && !u.removed && !u.hidden;
const charId = (u) => u.def?.charId ?? u.def?.raw?.charId;
const elite = (u) => !!u.def?.golden;
const ids = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Live 彩虹小队 layers of a player (0 when the bond is not active). */
function layersOf(ps) {
  const b = ps?.bonds?.[RAINBOW_BOND];
  return b?.active ? Math.max(0, Number(b.layers) || 0) : 0;
}

/** Rainbow members deployed by this player: all of them, and the elite (精锐) ones. */
function membersOnField(ps) {
  const members = new Set(), eliteMembers = new Set();
  for (const u of ps?.units ?? []) {
    if (u.kind !== 'op' || !alive(u)) continue;
    const id = charId(u);
    if (!id || !isRainbowCharacter(id)) continue;
    members.add(id);
    if (elite(u)) eliteMembers.add(id);
  }
  return { members, eliteMembers };
}

/**
 * 场上属于 `bondA` **或** `bondB` 的干员数（同一名干员同时属于两者只算一次 —— 按单位去重）。
 * 导火索的特质用：<战斗中>场上【彩虹小队】或【近卫】≥3 名 → 技能结束时回复大值，否则小值。
 */
function fuzeCohortSize(battle, pid, bondA, bondB) {
  const seen = new Set();
  for (const u of battle?.allyUnits ?? []) {
    if (u.ownerId !== pid || u.kind !== 'op' || !alive(u)) continue;
    const who = u.ownerUnit ?? u;
    if (!who) continue;
    if (S.isNoBondCount(who)) continue;
    if (S.isMember(battle, who, bondA) || (bondB && S.isMember(battle, who, bondB))) seen.add(who.uid ?? who.id);
  }
  return seen.size;
}

/** Layer totals of the listed ACTIVE bonds of one player. */
export function bondLayersSum(battle, playerId, bondIds) {
  const ps = battle.getPlayer(playerId);
  let n = 0;
  for (const id of bondIds) {
    const b = ps?.bonds?.[id];
    if (b?.active) n += Math.max(0, Number(b.layers) || 0);
  }
  return n;
}

/** One persistent passive buff per (unit, key); rewritten only when its mods actually change. */
function setPassive(battle, unit, key, mods) {
  const old = unit.findBuff(key);
  if (old) {
    const same = Object.keys(mods).length === Object.keys(old.mods ?? {}).length
      && Object.keys(mods).every((k) => old.mods?.[k] === mods[k]);
    if (same) return;
  }
  battle.addBuff(unit, { key, mods, persist: true, allowDead: true });
}

function clearPassive(battle, unit, key) {
  const old = unit.findBuff(key);
  if (old) battle.removeBuff(unit, old);
}

/** The garrison ids of a unit's chess (the normalised def keeps them on `raw`, like TALENT_TRAITS reads them). */
function garrisonIdsOf(unit) {
  const list = unit?.def?.raw?.garrisonIds ?? unit?.def?.garrisonIds;
  return Array.isArray(list) ? list : [];
}

/**
 * The garrison record of `unit` with this effect key. A collab trait may be declared as a prep-side event
 * (战车 / 灰烬 / 艾拉 use SERVER_PREP_FIN) while its effect is still read here, so the event type is not filtered.
 */
function traitOf(unit, effectKey) {
  for (const gid of garrisonIdsOf(unit)) {
    const g = S.garrisonRecord(gid);
    if (g && g.effectKey === effectKey) return g;
  }
  return null;
}

export function install(battle) {
  const refresh = () => {
    for (const ps of battle.players) {
      const layers = layersOf(ps);
      const { members, eliteMembers } = membersOnField(ps);
      // 重做（用户 2026-10-11）：增益对全队一致 —— 在场成员各自提供 base+perLayer×层数 的一条，
      // 精锐成员把「自己提供的那条」提高至 125%。不再按接收者区分。
      const team = rainbowTeamMods(layers, members, eliteMembers);
      const teamMods = team.mods;
      for (const u of ps.units) {
        if (u.kind !== 'op') continue;
        if (Object.keys(teamMods).length) setPassive(battle, u, 'rainbow:team', teamMods);
        else clearPassive(battle, u, 'rainbow:team');
        const healOnHit = team.healOnHit, ammoBonus = team.ammoBonus;
        if (healOnHit > 0) setPassive(battle, u, 'rainbow:healOnHit', { healOnHit });
        else clearPassive(battle, u, 'rainbow:healOnHit');
        // 弹药量: a bigger magazine for an ammo-kind skill, refreshed on every layer change.
        // (skills.js reads `u.mem.ammoBonus` when the skill activates.)
        if (ammoBonus > 0) {
          setPassive(battle, u, 'rainbow:ammo', { ammoBonus });
          u.mem.ammoBonus = ammoBonus;
        } else {
          clearPassive(battle, u, 'rainbow:ammo');
          u.mem.ammoBonus = 0;
        }
        // 导火索（用户 2026-10-15 改版）：不再是技力回复 —— 改为「技能结束时回复生命」，
        // 判定与结算都在 install() 下方的 skillEnd 钩子里现算（人数会随战局变化），这里不再挂常驻 buff。
        if (!alive(u)) continue;
        // 闪击: every 3 layers of 彩虹小队 + 坚守 raise the carrier's own DEF / HP. The bond's own 防御 line
        // is already a flat +2 per 3 layers applied to everyone, so it is added to the base here.
        if (charId(u) === RAINBOW_CHARACTERS.blitz) {
          const g = traitOf(u, 'RAINBOW_BLITZ_STATS');
          if (g) {
            const step = S.num(g.bb?.layer_step, B.blitzLayerStep);
            const sum = bondLayersSum(battle, u.ownerId, ids(g.bbStr?.bond_ids));
            const pct = Math.floor(sum / Math.max(1, step)) * S.num(g.bb?.pct, 0);
            if (pct > 0) setPassive(battle, u, 'rainbow:blitz', { defPct: pct, hpPct: pct });
            else clearPassive(battle, u, 'rainbow:blitz');
          }
        }
        // 艾拉: with all 8 members in play her own team lines get an extra +N% (精锐 more); otherwise a flat
        // ATK / HP boost.
        if (charId(u) === RAINBOW_CHARACTERS.ela) {
          const g = traitOf(u, 'RAINBOW_ELA_FULL_SQUAD');
          if (g) {
            const full = members.size >= S.num(g.bb?.size, B.elaSquadSize);
            if (full) {
              const bonus = S.num(g.bb?.full_bonus, 0);
              const base = rainbowTeamMods(layers, members, eliteMembers, charId(u)).mods;
              const boosted = Object.create(null);
              for (const [k, v] of Object.entries(base)) boosted[k] = v * (1 + bonus);
              if (Object.keys(boosted).length) setPassive(battle, u, 'rainbow:ela', boosted);
              else clearPassive(battle, u, 'rainbow:ela');
            } else {
              const atk = S.num(g.bb?.atk, 0);
              const hp = S.num(g.bb?.max_hp, 0);
              if (atk > 0 || hp > 0) setPassive(battle, u, 'rainbow:ela', { atkPct: atk, hpPct: hp });
              else clearPassive(battle, u, 'rainbow:ela');
            }
          }
        }
      }
    }
  };

  battle.on('battleStart', refresh);
  battle.on('deploy', refresh);
  battle.on('death', refresh);
  battle.on('layerGain', ({ bondId }) => { if (bondId === RAINBOW_BOND) battle.after(0, refresh); });
  battle.on('tick', refresh, { priority: 100 });

  // 导火索（用户 2026-10-15）：<战斗中>场上【彩虹小队】或【近卫】干员 ≥ bb.threshold（默认 3）名时，
  // 自身**技能结束时立刻回复** bb.heal_ge 点生命值（精锐 20）；不足则回复 bb.heal_lt 点（精锐 10）。
  // 人数在技能结束那一刻现算（同一名干员同属两盟约只算一次）；回复按自身治疗结算，无视禁疗。
  battle.on('skillEnd', ({ unit }) => {
    if (!unit || unit.kind !== 'op' || !alive(unit)) return;
    if (charId(unit) !== RAINBOW_CHARACTERS.fuze) return;
    const g = traitOf(unit, 'RAINBOW_FUZE_SKILL_HEAL');
    if (!g) return;
    const threshold = S.num(g.bb?.threshold, 3);
    const second = g.bbStr?.second_bond_id || 'warriorShip';
    const n = fuzeCohortSize(battle, unit.ownerId, g.bbStr?.bond_id || RAINBOW_BOND, second);
    const amount = n >= threshold ? S.num(g.bb?.heal_ge, 0) : S.num(g.bb?.heal_lt, 0);
    if (amount > 0) battle.heal(unit, unit, amount, { self: true, ignoreHealFree: true });
  });

  // 双月: every 3 layers restore HP on each completed attack against an enemy.
  battle.on('hit', ({ source, target }) => {
    if (!source || !target || target.side !== 'enemy' || source.kind !== 'op' || !alive(source)) return;
    const amount = Number(source.findBuff('rainbow:healOnHit')?.mods?.healOnHit) || 0;
    if (amount <= 0 || source.hp >= source.s.maxHp) return;
    battle.heal(source, source, amount, { silent: true });
  });
}
