// 彩虹小队 (Arknights × Rainbow Six) operator kits: the eight collab operators' selectable skills plus the
// two ground traps (迎宾踏垫 / 雷鸣地雷) their owners place as hand pieces.
//
// Numbers come from the pinned client data (`chess.skills[].bb`, built by tools/rainbow-data.mjs), so the
// kit only maps blackboard keys to engine effects — the same convention as kits/rhineNew.js.
import { num, talentBb, skillRec, up, makeZone, instantKind } from '../shared/tier1.js';
import { absoluteRangeKeys, enemyStealthed } from '../../../targeting.js';
import { summonToken } from '../../tokens.js';
import { bodyOnTile } from '../../../body.js';

const selected = (chess, def) => def?.skill?.id ?? def?.skill?.skillId ?? chess.skill?.skillId;
/** The skill record of `id`, carrying the runtime blackboard only when it is the selected skill. */
const record = (chess, id, bb, def) => {
  const rec = skillRec(chess, id) ?? {};
  return id === selected(chess, def) ? { ...rec, bb: bb ?? rec.bb ?? {} } : rec;
};
const cc = (battle, unit, targets, key, duration) => {
  for (const e of targets) if (up(e)) battle.applyStatus(e, key, { duration, source: unit });
};
/** A ground operator's attack range keys (the 破墙弹 / 激素子弹 lines travel straight ahead). */
const lineAhead = (unit, n) => {
  const keys = [];
  const [dr, dc] = unit.fwd ?? [0, 1];
  for (let k = 1; k <= n; k++) keys.push([unit.tileR + dr * k, unit.tileC + dc * k]);
  return keys;
};

// -----------------------------------------------------------------------------------------------------------------
// 战车 (Ⅰ)
export function tachanka(bb, chess, def) {
  const S1 = 'skchr_tachak_1', S2 = 'skchr_tachak_2';
  const s1 = record(chess, S1, bb, def), s2 = record(chess, S2, bb, def);
  const burn = {
    scale: num(s1.bb?.atk_scale, 0.4), span: num(s1.bb?.projectile_delay_time, 6),
    pen: num(s1.bb?.def_penetrate_fixed, 160), interval: Math.max(0.2, num(s1.bb?.interval, 1)),
  };
  const skills = {
    [S1]: {
      kind: 'instant',
      // 燃烧榴弹 is thrown at the attack's own target, so the area is only known once the attack resolves.
      onAttack({ battle, unit, targets }) {
        const target = (targets ?? []).find((t) => t && t.side === 'enemy') ?? null;
        const r = target ? target.tileR : unit.tileR + (unit.fwd?.[0] ?? 0);
        const c = target ? target.tileC : unit.tileC + (unit.fwd?.[1] ?? 1);
        const keys = new Set([r * 21 + c, (r + 1) * 21 + c, (r - 1) * 21 + c, r * 21 + c + 1, r * 21 + c - 1]);
        battle.fx('rhinePulse', { x: c, y: r, source: unit.id, radius: 1 });
        if (target) battle.addBuff(target, { key: 'tachanka:burn', duration: burn.span, source: unit, visible: true, data: { pen: burn.pen } });
        makeZone(battle, unit, {
          x: c, y: r, radius: 1.2, duration: burn.span, interval: burn.interval,
          onPulse(b) {
            for (const e of b.enemies) {
              if (!up(e) || e.isFlying || !keys.has(e.tileR * 21 + e.tileC)) continue;
              b.dealDamage(unit, e, { amount: unit.s.atk * burn.scale, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'burn'] });
              b.addBuff(e, { key: 'tachanka:burn', duration: burn.span, source: unit, visible: true, data: { pen: burn.pen } });
            }
          },
        });
      },
      onHit({ battle, unit, target }) {
        // "战车攻击燃烧范围内目标时无视其N的防御力"
        const pen = num(target?.findBuff('tachanka:burn')?.data?.pen);
        if (pen > 0 && target) battle.addBuff(unit, { key: 'tachanka:pen', duration: 0.05, mods: { defIgnoreFlat: pen }, data: { for: target.id } });
      },
    },
    [S2]: {
      kind: 'duration', duration: num(s2.duration, 4),
      mods: { batPct: num(s2.bb?.base_attack_time, -0.85) },
      targeting: { random: true },
      attack: { atkScale: num(s2.bb?.atk_scale, 1.7) },
      // "每次攻击有N%的概率攻击力提升至atk_scale" — the roll is per attack, so it is applied on the hit.
      onStart({ battle, unit, skill }) { unit.mem.tachankaLuck = { prob: num(s2.bb?.prob, 0.11), scale: num(s2.bb?.atk_scale, 1.7), skill }; },
      onEnd({ unit }) { unit.mem.tachankaLuck = null; },
    },
  };
  const t0 = talentBb(chess, 0);
  return {
    skills,
    skill: skills[selected(chess, def)] ?? skills[S1],
    talents: [
      { install(battle, unit) {
        // 重火力 (第一天赋): 攻击距离+1、防御力+5%、再部署时间+20秒 — a passive stat talent, so it is a persistent
        // buff; the +20 s rides the base redeploy time (as 麦哲伦's 无人机 does in kits/tier3.js).
        const mods = {};
        const defPct = num(t0.def, 0);
        if (defPct) mods.defPct = defPct;
        const ext = num(t0.ability_range_forward_extend, 0);
        if (ext > 0) mods.rangeExtend = Math.round(ext);
        if (Object.keys(mods).length) battle.addBuff(unit, { key: 'tachanka:talent', mods, persist: true, allowDead: true });
        const rt = num(t0.respawn_time, 0);
        if (rt) unit.base.respawnTime = Math.max(0, num(unit.base?.respawnTime, 0) + rt);
      } },
      { install(battle, unit) {
        // 幸运弹 (S2): every attack has prob to hit at atk_scale.
        battle.on('hit', (c) => {
          const m = unit.mem.tachankaLuck;
          if (!m || c.source !== unit || c.target?.side !== 'enemy' || !battle.rng.chance(m.prob)) return;
          battle.dealDamage(unit, c.target, { amount: unit.s.atk * (m.scale - 1), type: 'phys', isSkill: true, tags: ['skill', 'tachankaBurst'] });
        }, { owner: unit, priority: -5 });
      } }],
  };
}

// -----------------------------------------------------------------------------------------------------------------
// 闪击 (Ⅱ)
export function blitz(bb, chess, def) {
  const S1 = 'skchr_blitz_1', S2 = 'skchr_blitz_2';
  const s1 = record(chess, S1, bb, def), s2 = record(chess, S2, bb, def);
  const t0 = talentBb(chess, 0);
  const front = num(chess?.trait?.bb?.range_forward, 1);
  const skills = {
    [S1]: {
      kind: 'charges', maxCharges: 4,
      onStart({ battle, unit, skill }) {
        // 闪光护盾: every enemy in the front area is stunned and silenced.
        const keys = new Set(absoluteRangeKeys(skill.rangeGrid ?? [[0, 1], [1, 1], [-1, 1]], unit.tileR, unit.tileC, unit.dir, 0));
        for (const e of battle.enemies) {
          if (!up(e) || !keys.has(e.tileR * 21 + e.tileC)) continue;
          battle.applyStatus(e, 'stun', { duration: num(s1.bb?.stun, 3.5), source: unit });
          battle.applyStatus(e, 'silence', { duration: num(s1.bb?.silence, 3.5), source: unit });
        }
        battle.fx('flash', { x: unit.x, y: unit.y, id: unit.id, n: 1 });
      },
    },
    [S2]: {
      kind: 'duration', duration: num(s2.duration, 6),
      mods: { aspd: num(s2.bb?.attack_speed, 200) },
      onStart({ battle, unit }) {
        // 突破防线: one physical hit on every blocked enemy plus a stun; 第一天赋 scaled up while it runs.
        const scale = num(s2.bb?.atk_scale, 1.7);
        for (const e of [...(unit.blocking ?? [])]) {
          if (!up(e)) continue;
          battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'breakthrough'] });
          if (up(e)) battle.applyStatus(e, 'stun', { duration: num(s2.bb?.stun, 6), source: unit });
        }
        // "第一天赋效果提升至N倍" — 持盾射击's bonus against stunned targets.
        unit.mem.blitzTalentScale = num(s2.bb?.talent_scale, 1.4);
      },
      onEnd({ unit }) { unit.mem.blitzTalentScale = null; },
    },
  };
  return {
    skills,
    skill: skills[selected(chess, def)] ?? skills[S1],
    talents: [{ install(battle, unit) {
      // 持盾射击: prefers stunned enemies and hits them harder.
      const base = num(t0.atk_scale, 1.3);
      battle.on('hit', (c) => {
        if (c.source !== unit || c.target?.side !== 'enemy') return;
        if (!c.target.findBuff('stun')) return;
        const scale = base * num(unit.mem.blitzTalentScale, 1);
        battle.dealDamage(unit, c.target, { amount: unit.s.atk * (scale - 1), type: 'phys', isSkill: true, canDodge: false, tags: ['skill', 'shieldShot'] });
      }, { owner: unit, priority: -5 });
    } }],
  };
}

// -----------------------------------------------------------------------------------------------------------------
// 霜华 (Ⅲ) — her traps are separate hand pieces (token kit below); the skill itself only refills stock.
export function frost(bb, chess, def) {
  const S1 = 'skchr_rfrost_1', S2 = 'skchr_rfrost_2';
  const s1 = record(chess, S1, bb, def), s2 = record(chess, S2, bb, def);
  // The skill's active part PLACES one more 迎宾踏垫 on the field. The old version called
  // `unit.skill.addCharge`, whose "at max charges set sp = spCost" refilled her own SP on every activation —
  // an endless skill loop, which the renderer showed as a constantly re-triggering skill glow.
  const refill = (battle, unit, n) => {
    for (let i = 0; i < n; i++) summonToken(battle, unit, 'token_10016_rfrost_mine', 'ranged');
    battle.fx('summon', { x: unit.x, y: unit.y, id: unit.id, token: 'token_10016_rfrost_mine', n });
  };
  const skills = {
    // 陷阱部署: the trap's own damage / stun is on the token kit; the active part grants one more trap.
    [S1]: { kind: 'instant', onStart({ battle, unit }) { refill(battle, unit, num(s1.bb?.cnt, 1)); } },
    // 击倒猎物: traps bind instead of stunning (token kit reads the selected skill) and she fires 3 shots at the victim.
    [S2]: { kind: 'instant', onStart({ battle, unit }) { refill(battle, unit, num(s2.bb?.cnt, 1)); } },
  };
  return { skills, skill: skills[selected(chess, def)] ?? skills[S1] };
}

// -----------------------------------------------------------------------------------------------------------------
// 灰烬 (Ⅴ)
export function ash(bb, chess, def) {
  const S1 = 'skchr_ash_1', S2 = 'skchr_ash_2', S3 = 'skchr_ash_3';
  const s1 = record(chess, S1, bb, def), s2 = record(chess, S2, bb, def), s3 = record(chess, S3, bb, def);
  const t0 = talentBb(chess, 0);
  const skills = {
    // 支援射击: permanent ATK up and every attack becomes a two-hit combo.
    [S1]: {
      kind: 'duration', duration: Infinity,
      mods: { atkPct: num(s1.bb?.atk, 0.11) },
      attack: { hits: Math.max(2, Math.round(num(s1.bb?.['attack@times'], 2))) },
    },
    // 突击战术: a 31-round magazine at a much shorter interval, harder against stunned targets.
    [S2]: {
      kind: 'ammo', ammo: 31,
      mods: { batPct: num(s2.bb?.base_attack_time, -0.8) },
      attack: {
        atkScale: 1,
        onHit({ battle, unit, target }) {
          if (!target || !up(target) || !target.findBuff('stun')) return;
          const scale = num(s2.bb?.['ash_s_2[atk_scale].atk_scale'], 2.1);
          battle.dealDamage(unit, target, { amount: unit.s.atk * (scale - 1), type: 'phys', isSkill: true, tags: ['skill', 'ashBurst'] });
        },
      },
    },
    // 攻坚榴弹: a wall-breaching shell that pushes enemies back and explodes.
    [S3]: {
      kind: 'charges', maxCharges: 2,
      onStart({ battle, unit }) {
        const keys = new Set(lineAhead(unit, 4).map(([r, c]) => r * 21 + c));
        const scale = num(s3.bb?.atk_scale, 2.6), wall = num(s3.bb?.hitwall_scale, 7.2);
        const hit = [];
        for (const e of battle.enemies) {
          if (!up(e) || !keys.has(e.tileR * 21 + e.tileC)) continue;
          hit.push(e);
          battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'breach'] });
        }
        // The shell bursts on the first blocked tile (a hit wall doubles the blast).
        const [dr, dc] = unit.fwd ?? [0, 1];
        let br = unit.tileR, bc = unit.tileC;
        for (let k = 1; k <= 4; k++) {
          const r = unit.tileR + dr * k, c = unit.tileC + dc * k;
          if (!battle.grid.inRect(r, c) || battle.isReservedTile(r, c)) break;
          br = r; bc = c;
        }
        const blocked = hit.length > 0;
        const blast = unit.s.atk * (blocked ? wall : num(s3.bb?.not_hitwall_scale, 3.6));
        for (const e of battle.foesInRadius(bc, br, 1.5)) {
          if (!up(e)) continue;
          battle.dealDamage(unit, e, { amount: blast, type: 'phys', isSkill: true, canDodge: false, tags: ['skill', 'breachBlast'] });
        }
        battle.fx('rhinePulse', { x: bc, y: br, source: unit.id, radius: 1.5 });
      },
    },
  };
  return {
    skills,
    skill: skills[selected(chess, def)] ?? skills[S1],
    talents: [{ install(battle, unit) {
      // 辅助装备: a flash grenade on deploy stuns the enemies around one target.
      const stun = num(t0.stun, 4);
      if (!(stun > 0)) return;
      battle.on('deploy', (c) => {
        if (c.unit !== unit || !up(unit)) return;
        const seq = unit.deploySeq;
        battle.after(0.1, () => {
          if (!up(unit) || unit.deploySeq !== seq) return;
          const keys = absoluteRangeKeys(unit.rangeGrid ?? [[0, 0]], unit.tileR, unit.tileC, unit.dir, unit.rangeExtend ?? 0);
          const inRange = battle.enemies.filter((e) => up(e) && keys.includes(e.tileR * 21 + e.tileC));
          const pick = inRange[0];
          if (!pick) return;
          for (const e of battle.foesInRadius(pick.x, pick.y, 1.1)) {
            if (up(e)) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
          }
          battle.fx('flash', { x: pick.x, y: pick.y, id: pick.id, n: 1 });
        }, { owner: unit });
      }, { owner: unit });
    } }],
  };
}

// -----------------------------------------------------------------------------------------------------------------
// 导火索 (Ⅱ) — 强攻手 (centurion)
//
// Trait 「同时攻击阻挡的所有敌人」 (user 2026-10-14): `centurion` is the 强攻手 branch, and every other 强攻手 in this game
// carries exactly that sentence (艾丝黛尔 / 幽灵鲨 / 百炼嘉维尔 / 暴行). `SUB.centurion` already supplies the behaviour
// (professions.js:571 `P({ hitAllBlocked: true })` — his attacks strike every enemy he blocks), so this kit installs
// no trait at all; the branch default IS the trait.
//
// CORRECTION (2026-10-14). `data/chess.json` had given him the 收割者 sentence instead — word for word
// 「无法被友方角色治疗，攻击造成群体伤害，每攻击到一个敌人回复自身50生命，最大生效数等于阻挡数」, identical to
// 休谟斯 / 圣约送葬人 / 隐德来希. That text is NOT his: the official tables carry no trait text for anyone
// (`character_table` / `character_table_full` have no `trait` field on char_4126_fuze or any other operator), so the
// sentence was authored here and had been copied across branches. The data's `trait.desc` is corrected in the same
// change, and the `noHeal` + reaper-style per-hit self-heal a previous revision added on the strength of that text has
// been removed — a 强攻手 is healable and has no self-heal.
export function fuze(bb, chess, def) {
  const S1 = 'skchr_fuze_1', S2 = 'skchr_fuze_2';
  const s1 = record(chess, S1, bb, def), s2 = record(chess, S2, bb, def);
  const skills = {
    // 火力侦察: +1 attack range, ATK up, big ASPD burst over a 100-round magazine.
    [S1]: { kind: 'ammo', ammo: Math.max(1, Math.round(num(s1.bb?.['attack@trigger_time'], 100))), mods: { atkPct: num(s1.bb?.atk, 0.17), aspd: num(s1.bb?.attack_speed, 75), rangeExtend: num(s1.bb?.ability_range_forward_extend, 1) } },
    // 霰射炸药: five delayed explosions behind the tile in front.
    [S2]: {
      kind: 'charges', maxCharges: Math.max(1, Math.round(num(s2.bb?.skill_max_trigger_time, 3))),
      onStart({ battle, unit }) {
        const scale = num(s2.bb?.atk_scale, 4.4);
        const [dr, dc] = unit.fwd ?? [0, 1];
        const r = unit.tileR + dr * 2, c = unit.tileC + dc * 2;
        for (let i = 0; i < 5; i++) {
          const rr = r + (dc ? 0 : i - 2), ccx = c + (dc ? i - 2 : 0);
          battle.after(2 + i * 0.5, () => {
            const centre = battle.grid.inRect(rr, ccx) ? { r: rr, c: ccx } : { r, c };
            for (const e of battle.foesInRadius(centre.c, centre.r, 1.2)) {
              if (up(e) && !e.isFlying) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, canDodge: false, tags: ['skill', 'clusterCharge'] });
            }
            battle.fx('rhinePulse', { x: centre.c, y: centre.r, source: unit.id, radius: 1.2 });
          }, { owner: unit });
        }
      },
    },
  };
  // 强攻手: no `trait` key — `SUB.centurion` already gives 「同时攻击阻挡的所有敌人」 (`hitAllBlocked`), and a kit-level
  // `trait` would only re-state it. (A previous revision installed `noHeal` + a reaper-style self-heal here, on the
  // strength of a trait sentence that belonged to the 收割者 branch; both are gone — see the header.)
  return { skills, skill: skills[selected(chess, def)] ?? skills[S1] };
}

// -----------------------------------------------------------------------------------------------------------------
// 医生 (Ⅳ)
export function doc(bb, chess, def) {
  const S1 = 'skchr_rdoc_1', S2 = 'skchr_rdoc_2';
  const s1 = record(chess, S1, bb, def), s2 = record(chess, S2, bb, def);
  const t0 = talentBb(chess, 0);
  const skills = {
    // 以暴制暴: an immediate self-heal, then a 31-round burst at a much shorter attack interval.
    [S1]: {
      kind: 'ammo', ammo: Math.max(1, Math.round(num(s1.bb?.['attack@trigger_time'], 31))), heal: true,
      mods: { batPct: num(s1.bb?.base_attack_time, -0.7) },
      attack: { dmgType: 'heal', heal: { mode: 'single' } },
      onStart({ battle, unit }) {
        battle.heal(unit, unit, unit.s.atk * num(s1.bb?.heal_scale, 3), { self: true });
      },
    },
    // 激素手枪: one strong heal on the first friendly operator straight ahead.
    [S2]: {
      kind: 'charges', maxCharges: Math.max(1, Math.round(num(s2.bb?.skill_max_trigger_time, 3))), heal: true,
      onStart({ battle, unit }) {
        const amount = unit.s.atk * num(s2.bb?.heal_scale, 6);
        let target = null;
        for (const [r, c] of lineAhead(unit, 8)) {
          if (!battle.grid.inRect(r, c)) break;
          const ally = battle.allies(unit.ownerId).find((a) => up(a) && a.tileR === r && a.tileC === c && a.kind === 'op');
          if (ally) { target = ally; break; }
        }
        if (!target) target = unit;
        battle.heal(unit, target, amount, { source: unit });
        battle.fx('healAoe', { x: target.x, y: target.y, id: target.id, r: 0.6 });
      },
    },
  };
  return {
    skills,
    skill: skills[selected(chess, def)] ?? skills[S2],
    talents: [{ install(battle, unit) {
      // 军医: own max HP up and attacks ignore a flat amount of DEF (a persistent mod, never a second damage event).
      const hp = num(t0.max_hp), pen = num(t0.def_penetrate_fixed, num(t0.def_penetrate));
      const mods = {};
      if (hp > 0) mods.hpPct = hp;
      if (pen > 0) mods.defIgnoreFlat = pen;
      if (Object.keys(mods).length) battle.addBuff(unit, { key: 'doc:medic', persist: true, allowDead: true, mods });
    } }],
  };
}

// -----------------------------------------------------------------------------------------------------------------
// 双月 (Ⅳ)
export function iana(bb, chess, def) {
  const S1 = 'skchr_iana_1', S2 = 'skchr_iana_2';
  const s1 = record(chess, S1, bb, def), s2 = record(chess, S2, bb, def);
  const skills = {
    // 幻影诡雷 (S1, PASSIVE): the 幻影 detonating is the skill's damage part — `atk_scale` × ATK (3 / 3.4 per quality).
    // The decoy itself and the 替身 switch are the talent's (see install below); this keeps the number the old
    // implementation already used, so a decoy that is attacked both marks its attacker and takes the blast.
    [S1]: { kind: 'passive' },
    // 全知者的战术: reveal the enemies around her and gain 隐匿 + a large ASPD boost.
    [S2]: {
      kind: 'duration', duration: Math.max(1, num(s2.duration, 10)),
      mods: { aspd: num(s2.bb?.attack_speed, 260) },
      flags: { stealth: true },
      onStart({ battle, unit, skill }) {
        const keys = absoluteRangeKeys([[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]], unit.tileR, unit.tileC, unit.dir, 0);
        const reveal = Math.max(1, num(s2.bb?.anti_invisible_duration, 10));
        for (const e of battle.enemies) {
          if (up(e) && keys.includes(e.tileR * 21 + e.tileC)) battle.applyStatus(e, 'reveal', { duration: reveal, source: unit });
        }
        battle.addBuff(unit, { key: 'iana:stealth', duration: skill.timeLeft, flags: { stealth: true }, visible: true });
      },
    },
  };
  return {
    skills,
    skill: skills[selected(chess, def)] ?? skills[S2],
    install(battle, unit) {
      // 双子分身复制器 (天赋, 2026-10-13 修复): 部署时原地释放<全息幻影>，该幻影不会攻击；幻影受到攻击时，
      // 使攻击幻影的敌人在 `duration` 秒内获得 脆弱(damage_scale−1) 且隐匿效果失效(reveal)，并立即切换为<替身>作战。
      // 官方文本: "部署时原地释放全息幻影，该幻影不会攻击，受到攻击时使攻击幻影的敌人在8秒内受到20%的脆弱且隐匿效果失效，
      // 并立即切换为<替身>作战"。
      //
      // <替身>形态本身由 傀儡师 分支特性提供 (professions.js installDollkeeper: 受致命伤 ⇒ enter() 切替身，
      // 20 s 后 onExpire ⇒ leave() 切回本体)，双月的 subProfessionId 正是 dollkeeper，所以"变不回去本体"不是缺少
      // 切回逻辑，而是这条天赋压根没有把幻影受击接到 `dollSwitch` 上：旧实现只在幻影被攻击时做了一次半径 1.1 的
      // 物理伤害爆发，而且监听的是 unit 自己(敌人打的是双月本体)，于是既没有脆弱/反隐、也没有立即切换为<替身>。
      //
      // 另外把"立即切换"改成先走 dollSwitch，切换动画期间替身持有的 noSp 只覆盖那 1 s + 20 s 的替身期；
      // 切回本体后 leave() 会重建本体，技力恢复正常回复(不再"技力条不动")。
      const t0 = talentBb(chess, 0);
      const weakDur = Math.max(0, num(t0.duration, 8));
      const weakScale = num(t0.damage_scale, 1.2);
      // 幻影承伤窗口: 官方只是"幻影受到攻击时"触发一次，用 mem 按每次部署记录，避免重复触发。
      const markAttacker = (src) => {
        if (!up(src)) return;
        battle.addBuff(src, { key: 'iana:holoMark', duration: weakDur, source: unit, visible: true, tags: ['talent'] });
        if (weakScale > 1) battle.applyStatus(src, 'fragile', { duration: weakDur, value: weakScale - 1, source: unit });
        // "隐匿效果失效": 让该敌人的隐匿在一段时间内失效(反隐)
        battle.applyStatus(src, 'reveal', { duration: weakDur, source: unit });
      };
      battle.on('deploy', (c) => {
        if (c.unit !== unit || !up(unit)) return;
        unit.mem.ianaHolo = true;      // 幻影就位：本体内受到攻击即等价于幻影受击(幻影不可被选中，本体在原地替它挨打)
        unit.mem.ianaHoloSeq = unit.deploySeq;
      }, { owner: unit });
      battle.on('damaged', (d) => {
        if (d.target !== unit || !up(unit)) return;
        if (!unit.mem.ianaHolo || unit.mem.ianaHoloDone === unit.deploySeq) return;
        if (unit.trait.doll || unit.trait.dollSwitching) return;   // 已经是替身/切换中，不再重复触发
        unit.mem.ianaHoloDone = unit.deploySeq;
        unit.mem.ianaHolo = false;
        markAttacker(d.source);
        // 幻影诡雷 (S1): the 幻影 detonates around itself when it is set off — `atk_scale` × ATK physical.
        const burst = num(s1.bb?.atk_scale, 3);
        if (burst > 0) {
          for (const e of battle.foesInRadius(unit.x, unit.y, 1.1)) {
            if (up(e)) battle.dealDamage(unit, e, { amount: unit.s.atk * burst, type: 'phys', isSkill: true, tags: ['skill', 'decoy'] });
          }
        }
        // "并立即切换为<替身>作战"
        battle.emit('dollSwitch', { unit, reason: 'talent', done: false });
        battle.fx('rhinePulse', { x: unit.x, y: unit.y, source: unit.id, radius: 0.6 });
      }, { owner: unit });
    },
  };
}

// -----------------------------------------------------------------------------------------------------------------
// 艾拉 (Ⅵ)
export function ela(bb, chess, def) {
  const S1 = 'skchr_ela_1', S2 = 'skchr_ela_2', S3 = 'skchr_ela_3';
  const s1 = record(chess, S1, bb, def), s2 = record(chess, S2, bb, def), s3 = record(chess, S3, bb, def);
  const t1 = talentBb(chess, 1);
  // "技能结束时获得一个/两个陷阱": it PLACES a 雷鸣地雷 on the field, it does not recharge her own skill.
  // (The old version called `unit.skill.addCharge`, whose "at max charges set sp = spCost" turned every
  // activation into a free instant refill — an endless skill loop.)
  const refill = (battle, unit, n) => {
    for (let i = 0; i < n; i++) summonToken(battle, unit, 'token_10033_ela_grzmot', 'ranged');
    battle.fx('summon', { x: unit.x, y: unit.y, id: unit.id, token: 'token_10033_ela_grzmot', n });
  };
  const skills = {
    // 眩目阻滞: her traps slow (the token kit), the active part grants one more mine.
    [S1]: { kind: 'instant', onStart({ battle, unit }) { refill(battle, unit, 1); } },
    // 震荡坚守: great DEF, splash attacks that ignore DEF, one mine at the end.
    [S2]: {
      kind: 'duration', duration: Math.max(1, num(s2.duration, 20)),
      mods: { defPct: num(s2.bb?.def, 2.5) },
      attack: { splashRadius: num(s2.bb?.['attack@projectile_range'], 1.1), defIgnoreFlat: num(s2.bb?.def_penetrate_fixed, 500) },
      onEnd({ battle, unit }) { refill(battle, unit, 1); },
    },
    // “博萨克风暴”: a 40-round magazine, faster interval, ATK up, two mines at the end.
    [S3]: {
      kind: 'ammo', ammo: Math.max(1, Math.round(num(s3.bb?.['attack@trigger_time'], 40))),
      mods: { atkPct: num(s3.bb?.atk, 0.6), batPct: num(s3.bb?.base_attack_time, -0.35) },
      onEnd({ battle, unit }) { refill(battle, unit, Math.max(1, Math.round(num(s3.bb?.cnt, 2)))); },
    },
  };
  return {
    skills,
    skill: skills[selected(chess, def)] ?? skills[S3],
    talents: [{ install(battle, unit) {
      // “正中靶心”: a chance of a stronger physical hit, guaranteed on an enemy affected by 雷鸣地雷.
      // `isAttack` keeps it to her own ATTACKS ("攻击有30%几率…"): without it the extra hit of this very talent
      // re-entered this handler (its damage carries no isAttack) and recursed to the hook-depth cap.
      const prob = num(t1.prob, 0.3), scale = num(t1.atk_scale, 1.5);
      if (!(scale > 1)) return;
      battle.on('hit', (c) => {
        if (c.source !== unit || !c.dmg?.isAttack || c.target?.side !== 'enemy' || !up(c.target)) return;
        const marked = !!c.target.findBuff('ela:mine');
        if (!marked && !battle.rng.chance(prob)) return;
        battle.dealDamage(unit, c.target, { amount: unit.s.atk * (scale - 1), type: 'phys', isSkill: true, tags: ['skill', 'bullseye'] });
      }, { owner: unit, priority: -5 });
    } }],
  };
}

// -----------------------------------------------------------------------------------------------------------------
// traps

const TRAP_TILE_EPS = 0.5;
/** Ground enemies standing on the trap's tile, oldest first. Skips 隐匿 ones (see below). */
const steppedOn = (battle, t) => battle.enemies
  .filter((e) => up(e) && !e.hidden && !e.isFlying && !enemyStealthed(e) && (e.hitArea ? bodyOnTile(e, t.tileR, t.tileC)
    : Math.abs(e.x - t.tileC) <= TRAP_TILE_EPS && Math.abs(e.y - t.tileR) <= TRAP_TILE_EPS))
  .sort((a, b) => a.spawnSeq - b.spawnSeq);

/**
 * A ground trap: inert while placed, fires once when a ground enemy steps on its tile, then leaves the field.
 * `onTrigger(battle, trap, victim, bb)` applies the skill-specific effect (the token's own blackboard).
 */
function trapKit({ tokenId, tag, onTrigger }) {
  return () => ({
    fromTokens: true,
    trait: { noAttack: true },
    skill: { kind: 'passive', onTick({ battle, unit: t }) {
      if (!up(t) || t.mem[`${tag}Triggered`] === t.deploySeq) return;
      const victim = steppedOn(battle, t)[0];
      if (!victim) return;
      t.mem[`${tag}Triggered`] = t.deploySeq;
      const owner = t.ownerUnit;
      const bb = t.def?.skill?.bb ?? {};
      if (owner && up(owner)) onTrigger(battle, t, owner, victim, bb);
      battle.fx('dorothyTrap', { x: t.x, y: t.y, id: t.id, token: tokenId, target: victim.id, consumed: true });
      battle.retreat(t, { reason: 'expired', permanent: true });
    } },
    install(battle, t) {
      // A trap is invisible to the enemies and cannot be healed or targeted.
      battle.addBuff(t, { key: `${tag}:untargetable`, persist: true, allowDead: true, flags: { untargetable: true, noHeal: true, noBlock: true } });
    },
  });
}

/** 迎宾踏垫: physical damage on the victim, then either stun (S1) or bind + three follow-up shots (S2). */
export const frostTrap = trapKit({
  tokenId: 'token_10016_rfrost_mine',
  tag: 'frostMine',
  onTrigger(battle, t, owner, victim, bb) {
    const scale = num(bb.atk_scale, 2.8);
    battle.dealDamage(owner, victim, { amount: owner.s.atk * scale, type: 'phys', isSkill: true, canDodge: false, tags: ['summon', 'trap', 'frostMine'] });
    if (!up(victim)) return;
    const bind = num(bb.constraint);
    if (bind > 0) {
      battle.applyStatus(victim, 'bind', { duration: bind, source: owner });
      // 击倒猎物: three extra shots if the victim is inside her own attack range.
      const times = Math.max(0, Math.round(num(bb.times, 3)));
      const keys = absoluteRangeKeys(owner.rangeGrid ?? [[0, 0]], owner.tileR, owner.tileC, owner.dir, owner.rangeExtend ?? 0);
      if (times > 0 && keys.includes(victim.tileR * 21 + victim.tileC)) {
        for (let i = 0; i < times; i++) {
          if (!up(victim)) break;
          battle.dealDamage(owner, victim, { amount: owner.s.atk * num(bb.atk_scale, 1.5), type: 'phys', isSkill: true, tags: ['summon', 'trap', 'frostShot'] });
        }
      }
    } else {
      battle.applyStatus(victim, 'stun', { duration: num(bb.stun, 1), source: owner });
    }
  },
});

/** 雷鸣地雷: marks everyone around it (停顿 / 脆弱 / 眩晕, by skill) and leaves the 雷鸣地雷 mark. */
export const elaTrap = trapKit({
  tokenId: 'token_10033_ela_grzmot',
  tag: 'elaMine',
  onTrigger(battle, t, owner, victim, bb) {
    const around = battle.foesInRadius(victim.x, victim.y, num(bb.projectile_range, 1.7));
    for (const e of around) {
      if (!up(e)) continue;
      battle.addBuff(e, { key: 'ela:mine', duration: 10, source: owner, visible: true, tags: ['trap'] });
      const stun = num(bb.stun);
      const sluggish = num(bb.sluggish);
      const weak = num(bb['weak[limit]']);
      if (stun > 0) battle.applyStatus(e, 'stun', { duration: stun, source: owner });
      if (sluggish > 0) battle.applyStatus(e, 'sluggish', { duration: sluggish, source: owner });
      if (weak > 0) battle.applyStatus(e, 'fragile', { duration: weak, value: num(bb.damage_scale, 1.25) - 1, source: owner });
    }
    battle.fx('rhinePulse', { x: victim.x, y: victim.y, source: t.id, radius: num(bb.projectile_range, 1.7) });
  },
});

// -----------------------------------------------------------------------------------------------------------------

/** baseChessId → kit (content/index.js merges these into KITS). */
export const RAINBOW_KITS = Object.freeze({
  chess_rainbow_tachanka: tachanka,
  chess_rainbow_blitz: blitz,
  chess_rainbow_frost: frost,
  chess_rainbow_ash: ash,
  chess_rainbow_fuze: fuze,
  chess_rainbow_doc: doc,
  chess_rainbow_iana: iana,
  chess_rainbow_ela: ela,
});

/** tokenId → kit, resolved by content/index.js for summon pieces (`tokenKits` is the registry name it reads). */
export const RAINBOW_TOKEN_KITS = Object.freeze({
  token_10016_rfrost_mine: frostTrap,
  token_10033_ela_grzmot: elaTrap,
});
export const tokenKits = RAINBOW_TOKEN_KITS;

export default RAINBOW_KITS;
