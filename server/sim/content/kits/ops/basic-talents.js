// server/sim/content/kits/ops/basic-talents.js — 商店档/阵营档干员的天赋实现（2026-10-12 补）。
//
// 背景：data/chess.json 里有一批干员带 `talents`，但**没有专属 kit 文件**。content/index.js 的
// `fallbackKit` 对「非自选 / 非补位」的 def 直接 `return genericKit(...)`（**不挂 genericTalents**），
// 而 genericTalents 只对自选/补位生效 —— 于是这些天赋在商店档被静默丢弃。
// 实证：末药「急救包」（部署后立刻恢复全体友方 150% 攻击力的生命）→ kit.talents=0，healingDone=0。
//
// 本文件补上实现，两类：
//   ① **复用官方 kit**：同一个 charId 的官方 kit 已有（chess_char_* 条目，或自选侧的 ops/op-*.js），且天赋黑板
//      与 prof 条目逐字一致（2026-10-12 用脚本核对过）→ 直接转发那个工厂。
//   ② **手写**：按天赋描述实现（多为 statBuff / toggleBuff / 部署时一次性效果）。
// 技能默认由 genericKit 提供：商店档走 `selectSkillSpec` 的 `skillIsDefault` 分支，会原样保留我们返回的 kit；
// **但若该干员的技能只有官方 kit 才写得对（机制型技能），必须走 ① 整包转发** —— 否则技能会落到 generic 启发式：
// 2026-10-15 用户报「克莱门莎放逐舱没生效」，根因就是她此前只做了 ②（只补两个天赋），S2 风暴潮/放逐舱 无处实现。
import { num, talentBb, statBuff, installAura, alliesInGridOf, onHitBy, giveSp, up } from '../shared/tier1.js';
import { genericKit } from '../../generic.js';
import { dirVec } from '../../../dir.js';

// ---------- ① 复用官方 kit（天赋 bb 与官方条目一致）----------
import snakek from './chess_char_3_16-snakek.js';    // 蛇屠箱  防御专精
import podego from './chess_char_1_13-podego.js';    // 波登可  园丁
import agoat2 from './chess_char_6_20-agoat2.js';    // 纯烬艾雅法拉 氤氲 / 火山灰疗愈
import skadi2 from './chess_char_6_04-skadi2.js';    // 浊心斯卡蒂 远古血亲 / 捕食习性
import kazema from './chess_char_2_11-kazema.js';    // 风丸   折纸生花
import pasngr from './chess_char_6_05-pasngr.js';    // 异客   机理分析 / 孤卒
// 克莱门莎：**技能也必须转发**（S2 风暴潮 / 浮游放逐舱 全在她的官方 kit 里）。此前只补了两个天赋，
// 技能落到 genericKit → 放逐舱恒不生效（2026-10-15 用户报「克莱门莎放逐舱没生效」）。
import clemntOfficial from './op-clemnt.js';

/** 只补天赋的 kit 工厂：技能仍取通用 kit（`installs` = 一组 (battle, unit) => void）。 */
function talentsOnly(bb, chess, def, installs) {
  const base = genericKit(bb, chess, def);
  return { ...base, talents: installs.map((install) => ({ install })) };
}

/** 天赋 `i` 的黑板（`{}` 当缺）。 */
const bbOf = (chess, i = 0) => talentBb(chess, i);

/** 切比雪夫距离 ≤ `n`（含自身）。 */
const near = (a, b, n) => Math.max(Math.abs(a.tileR - b.tileR), Math.abs(a.tileC - b.tileC)) <= n;

// ---------- ② 手写 ----------

/** 阿消 防火护服: 法术抗性+15。 */
const sqrrel = (bb, chess, def) =>
  talentsOnly(bb, chess, def, [(b, u) => statBuff(b, u, 'talent:sqrrel:res', { resFlat: num(bbOf(chess).magic_resistance) })]);

/** 暗索 听觉训练: 获得 30% 的物理闪避。 */
const rope = (bb, chess, def) =>
  talentsOnly(bb, chess, def, [(b, u) => statBuff(b, u, 'talent:rope:dodge', { dodgePhys: num(bbOf(chess).prob) })]);

/** 食铁兽 功夫: 获得 40% 的物理闪避。 */
const panda = (bb, chess, def) =>
  talentsOnly(bb, chess, def, [(b, u) => statBuff(b, u, 'talent:panda:dodge', { dodgePhys: num(bbOf(chess).prob) })]);

/**
 * 坚雷 攻守兼备: 攻击力+7%，防御力+7%；**以及特性「技能开启时普通攻击会造成法术伤害」**.
 *
 * 坚雷's branch is 驭法铁卫 (`subProfessionId: 'artsprotector'`), which has NO entry in professions.js `SUB` — so
 * `resolveProfile` fell back to `PROFESSION_DEFAULTS.TANK` (phys) and the trait's whole point was dead: his normal
 * attacks stayed physical even while a skill ran. Same branch as 斩业星熊, whose kit authors it explicitly
 * (kits/ops/op-hsgma2.js:123 `trait: { dmgType: 'phys' }` + :128 `attack: { dmgType: 'arts' }` per skill) — this
 * mirrors that, and the `trait` key is applied last by resolveProfile (professions.js:717) so the data's 'phys'
 * (which build-data writes for WE2) can never win.
 * Both of his skills are timed MANUAL durations that only raise ATK (bb.atk), so each needs the arts override; the
 * engine turns the running attack into arts through `effectiveProfile` (ai.js:56-64).
 */
const durnar = (bb, chess, def) => {
  // The selected skill id: `def.skill` is the loadout-resolved record (content/index.js:17-18); fall back to the
  // record's own default (`chess.skill`). Same idiom as kits/ops/rodos.js `S()`.
  const picked = def?.skill?.skillId ?? def?.skill?.id ?? chess?.skill?.skillId ?? null;
  const kit = talentsOnly(bb, chess, def, [(b, u) => {
    const t = bbOf(chess);
    statBuff(b, u, 'talent:durnar:stats', { atkPct: num(t.atk), defPct: num(t.def) });
  }]);
  const arts = { dmgType: 'arts' };
  const skills = {};
  for (const s of chess?.skills ?? []) {
    if (!s?.skillId) continue;
    skills[s.skillId] = {
      kind: 'duration', duration: num(s.duration, 25),
      mods: { atkPct: num(s.bb?.atk) },
      attack: arts,                                   // 技能开启时普通攻击会造成法术伤害
    };
  }
  return {
    ...kit,
    trait: { dmgType: 'phys' },                       // 未开启技能时仍是物理
    ...(Object.keys(skills).length ? { skills, skill: skills[picked] ?? Object.values(skills)[0] } : null),
  };
};

/** 红云 猎人的经验: 自身的技力自然回复速度+0.3/秒。 */
const clour = (bb, chess, def) =>
  talentsOnly(bb, chess, def, [(b, u) => statBuff(b, u, 'talent:clour:sp', { spRecoveryFlat: num(bbOf(chess).sp_recovery_per_sec) })]);

/** 末药 急救包: 部署后立刻恢复全体友方单位的生命值，恢复量为末药攻击力的 150%。 */
const myrrh = (bb, chess, def) =>
  talentsOnly(bb, chess, def, [(b, u) => {
    const amt = u.s.atk * num(bbOf(chess).heal_scale, 1.5);
    if (!(amt > 0)) return;
    // install 就在部署流程里跑 ⇒ 此刻即「部署后立刻」。只奶己方可治疗的干员/召唤物（heal 自己会挡 healFree）。
    for (const a of b.allyUnits) {
      if (a === u || !a.alive || !a.deployed || a.hidden) continue;
      if (a.kind !== 'op' && a.kind !== 'token') continue;
      if (a.hp >= a.s.maxHp - 1e-6) continue;
      b.heal(u, a, amt, { tags: ['talent'] });
    }
  }]);

/** 寻澜 独自远走: 部署时，若周围 4 格没有其他干员，获得 2 点部署费用。 */
const surfer = (bb, chess, def) =>
  talentsOnly(bb, chess, def, [(b, u) => {
    const n = num(bbOf(chess).cost, 2);
    if (!(n > 0)) return;
    const around = (x) => x !== u && x.kind === 'op' && x.alive && x.deployed && Math.abs(x.tileR - u.tileR) + Math.abs(x.tileC - u.tileC) <= 1;
    if (!b.allyUnits.some(around)) b.addDp(u.ownerId, n);
  }]);

/** 自身与**身后一格**的本地坐标（按朝向旋转，同 op-hodrer 的 BEHIND）。 */
const BEHIND = Object.freeze([Object.freeze([0, -1])]);
/** 目标是否在 `u` 的身后一格。 */
const inBehind = (b, u, a) => alliesInGridOf(b, u, BEHIND).includes(a);
/** 法抗增减 mod（|v| < 1 ⇒ 百分比，否则平值；同 tier4 的 resCut）。 */
const resCut = (v) => (Math.abs(v) < 1 ? { resMul: Math.max(0, 1 + v) } : { resFlat: v });
/** 目标在 `u` 的朝向侧（前方：与朝向点积 > 0）。 */
const inFrontOf = (u, x) => {
  const [dr, dc] = dirVec(u.dir);
  return (x.tileR - u.tileR) * dr + (x.tileC - u.tileC) * dc > 0;
};
/** 每 `iv` 秒跑一次（随 owner 清理）。 */
const tick = (b, u, iv, fn) => b.every(iv, () => { if (up(u)) fn(); }, { owner: u });

/** 场地里是否存在水地形（深水区）：`b.grid.tiles` 上任意一格的 terrain 为 deepsea（grid.js TERRAIN_BY_KEY:
 *  tile_deepsea / tile_deepwater 都归 `deepsea`）。战场格子由 stage 一次性铺出 ⇒ 部署时判一次即可。 */
const hasWaterTerrain = (b) => {
  const tiles = b?.grid?.tiles;
  if (!tiles) return false;
  for (const t of tiles) if (t && t.terrain === 'deepsea') return true;
  return false;
};

/** 锡兰 湖畔漫步者: 攻击力+5%，当场地中存在水地形时改为攻击力+18%。
 *  数据 key 的拼写差异 `celyon_t_1[map].atk`（少一个 e）是**官方 akdata 自身的笔误**，照抄。
 *  两键是**加算**：官方 desc 的 5% / 18% 正是 `[common].atk 0.05` 与 `0.05 + [map].atk 0.13`（PHASE_2 pot0）。 */
const ceylon = (bb, chess, def) => talentsOnly(bb, chess, def, [(b, u) => {
  const t = bbOf(chess);
  const common = num(t['ceylon_t_1[common].atk'], 0.05);
  const extra = num(t['celyon_t_1[map].atk'], 0);
  const wet = extra > 0 && hasWaterTerrain(b) ? extra : 0;
  statBuff(b, u, 'talent:ceylon:atk', { atkPct: common + wet });
}]);

/** 拜松 交叉掩护: 在场时自身防御力+50；身后的【先锋】/【近卫】干员也享受相同效果。 */
const bison = (bb, chess, def) => talentsOnly(bb, chess, def, [(b, u) => {
  const v = num(bbOf(chess).def, 50);
  if (!(v > 0)) return;
  statBuff(b, u, 'talent:bison:def', { defFlat: v });
  installAura(b, u, {
    key: 'talent:bison:behind', value: v, interval: 0.5,
    select: (a) => a !== u && a.kind === 'op'
      && (a.def?.profession === 'PIONEER' || a.def?.profession === 'WARRIOR') && inBehind(b, u, a),
    mods: { defFlat: v },
  });
}]);

/**
 * 吽 门神 + 特性「技能可以治疗友方单位」(guardian)**的完整实现**.
 *
 * Before this the file only installed the TALENT: `talentsOnly` delegates the skill spec to `genericKit`, and 吽's
 * two skills (`skchr_hmau_1` / `skchr_hmau_2`) name no key `generic.js` understands, so both came out as an
 * empty/stat-only spec: his trait's heal never happened (runtime probe: the skill fired, `profile.heal` stayed null,
 * 0 heal events over 900 steps). The trait is the branch's whole point — a 守护者 whose skills cannot heal is not a
 * 守护者 — so both skills are authored here, on top of the talent.
 *
 * Data (data/chess.json, build-data over the official levels; normal → elite):
 *   S1 反制治疗   AUTO, durationType NONE, spType INCREASE_WHEN_TAKEN_DAMAGE, spCost 6→5, initSp 1→2, heal_scale 1.2→1.4
 *     「下一次攻击改为周围的一名友方单位恢复相当于攻击力120%的生命」 — a DEFAULT cast that replaces the attack about to
 *     be made with a single-target heal of heal_scale × ATK. `heal: true` is REQUIRED (skills.js:108 derives
 *     `healSkill` from `spec.heal ?? (profile.dmgType === 'heal' && profile.heal)`; 吽's own profile is phys/melee,
 *     so without the flag the engine never looks for an injured ally and the cast would have no valid target).
 *   S2 反制医疗模式 MANUAL, duration 22→24, spCost 24→23, initSp 11→12, atk/def 0.45→0.6, base_attack_time 1.3, sp 1
 *     「攻击力和防御力+45%，停止攻击并专心对周围友方单位进行治疗，并在治疗时为其恢复1点技力」 — while it runs:
 *     ATK/DEF +atk/+def, `noAttack` (停止攻击) and a heal of 1× ATK on the allies around her instead of an attack,
 *     each heal granting the healed ally `sp` SP. `attack.dmgType:'heal'` switches the running attack to the heal,
 *     and `heal: true` makes the engine target allies at the normal attack cadence.
 */
const hmau = (bb, chess, def) => {
  const kit = talentsOnly(bb, chess, def, [(b, u) => {
    const t = bbOf(chess);
    statBuff(b, u, 'talent:hmau:def', { defPct: num(t.def) });
    const hi = num(t.heal_scale, 1);
    if (hi <= 1) return;
    tick(b, u, 0.5, () => {
      for (const a of alliesInGridOf(b, u, BEHIND)) {
        if (a.tileR === u.tileR && a.tileC === u.tileC) continue;
        if (a.def?.position !== 'RANGED') continue;             // 高台单位
        statBuff(b, a, 'talent:hmau:heal', { healingTakenMul: hi });
      }
    });
  }]);
  return {
    ...kit,
    skills: {
      // 下一次攻击改为治疗（守卫者的蓄力治疗）
      skchr_hmau_1: {
        kind: 'instant', heal: true,
        attack: { dmgType: 'heal', heal: { mode: 'single' }, healScale: num(bb.heal_scale, 1.2), projectile: 'none' },
      },
      // 反制医疗模式：停止攻击，专心治疗周围友方，并在治疗时为其回复 sp 点技力
      skchr_hmau_2: {
        kind: 'duration', duration: num(bb.duration, 22), heal: true,
        mods: { atkPct: num(bb.atk, 0.45), defPct: num(bb.def, 0.45) },
        attack: { dmgType: 'heal', heal: { mode: 'single' }, healScale: 1, projectile: 'none', noAttack: false },
        onHit({ battle: b, unit: u, target }) {
          if (!up(target)) return;
          const n = num(bb.sp, 1);
          if (n > 0) giveSp(target, n, 'talent');
          void b; void u;
        },
      },
    },
  };
};

/** 夜烟 黑色迷雾: 攻击使目标法术抗性-20%，持续 1 秒。 */
const nights = (bb, chess, def) => talentsOnly(bb, chess, def, [(b, u) => {
  const t = bbOf(chess);
  const cut = num(t.magic_resistance, -0.2), dur = num(t.duration, 1);
  if (!cut) return;
  b.on('hit', (c) => {
    const ty = c.dmg?.type;
    if (c.source !== u || !c.target || c.target.side !== 'enemy' || !c.dmg) return;
    if (ty === 'element' || ty === 'elemental') return;
    b.addBuff(c.target, { key: 'talent:nights:res', duration: dur, mods: resCut(cut), source: u, tags: ['talent'] });
  }, { owner: u });
}]);

/** 但书 卡西米尔法律专精: 攻击速度+10；置入战场后这个效果同样赋予给一名随机【卡西米尔】干员。 */
const proviso = (bb, chess, def) => talentsOnly(bb, chess, def, [(b, u) => {
  const v = num(bbOf(chess).attack_speed, 10);
  if (!(v > 0)) return;
  statBuff(b, u, 'talent:proviso:aspd', { aspd: v });
  const given = new Set([u]);
  tick(b, u, 0.5, () => {                                    // 后部署的卡西米尔干员也补上（随机一名）
    const cand = b.allyUnits.filter((a) => a.kind === 'op' && a.alive && a.deployed
      && !given.has(a) && (a.def?.bonds || []).includes('kazimierzShip'));
    if (!cand.length) return;
    const pick = cand[Math.floor(b.rng() * cand.length)] ?? cand[0];
    given.add(pick);
    statBuff(b, pick, 'talent:proviso:aspd:shared', { aspd: v });
  });
}]);

/** 灰喉 顺风: 攻击速度+6；攻击时有 15% 的概率攻击力提升至 150%。 */
const swllow = (bb, chess, def) => talentsOnly(bb, chess, def, [(b, u) => {
  const t = bbOf(chess);
  statBuff(b, u, 'talent:swllow:aspd', { aspd: num(t.attack_speed) });
  const p = num(t.prob), s = num(t.atk_scale, 1);
  if (!(p > 0) || s === 1) return;
  onHitBy(b, u, ({ dmg }) => { if (dmg?.isAttack && b.rng() < p) dmg.mul *= s; });
}]);

/** 暴行 山谷: 周围四格中有两格以上的高地地形时，攻击力和防御力+10%。 */
const savage = (bb, chess, def) => talentsOnly(bb, chess, def, [(b, u) => {
  const t = bbOf(chess);
  const need = Math.max(1, Math.floor(num(t.cnt, 2)));
  const key = 'talent:savage:valley';
  tick(b, u, 0.5, () => {
    let n = 0;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const r = u.tileR + dr, c = u.tileC + dc;
      if (b.grid.inBounds(r, c) && b.grid.tile(r, c).height === 'HIGH') n++;
    }
    if (n >= need) statBuff(b, u, key, { atkPct: num(t.atk), defPct: num(t.def) });
    else b.removeBuff(u, key);
  });
}]);

/** 格拉尼 骑警: 在场时，所有【先锋】职业干员获得 20% 的物理闪避。 */
const grani = (bb, chess, def) => talentsOnly(bb, chess, def, [(b, u) => {
  const p = num(bbOf(chess).prob);
  if (!(p > 0)) return;
  installAura(b, u, {
    key: 'talent:grani:dodge', value: p, interval: 0.5,
    select: (a) => a.kind === 'op' && a.def?.profession === 'PIONEER',
    mods: { dodgePhys: p },
  });
}]);

/** 晓歌 万全: 未阻挡敌人时攻击速度+12，阻挡敌人时攻击力+12%。 */
const ctable = (bb, chess, def) => talentsOnly(bb, chess, def, [(b, u) => {
  const t = bbOf(chess);
  const K_ASPD = 'talent:ctable:aspd', K_ATK = 'talent:ctable:atk';
  tick(b, u, 0.25, () => {
    const blocking = (u.blocking || []).length > 0;
    if (blocking) { b.removeBuff(u, K_ASPD); statBuff(b, u, K_ATK, { atkPct: num(t.atk) }); }
    else { b.removeBuff(u, K_ATK); statBuff(b, u, K_ASPD, { aspd: num(t.attack_speed) }); }
  });
}]);

/** 空 安可: 技能结束后，50% 几率立即回复 50% 的最大技力。 */
const sora = (bb, chess, def) => talentsOnly(bb, chess, def, [(b, u) => {
  const t = bbOf(chess);
  const p = num(t.prob, 0.5), r = num(t.sp, 0.5);
  if (!(p > 0) || !(r > 0)) return;
  b.on('skillEnd', (c) => {
    if (c.unit !== u || !up(u)) return;
    const max = u.skill?.maxSp ?? u.skill?.spCost ?? 0;
    if (!(max > 0) || b.rng() >= p) return;
    giveSp(u, max * r, 'talent');
  }, { owner: u });
}]);

/** 爱丽丝 封印的宝盒: 储存的攻击能量造成的伤害提升至 130%（技能伤害 ×atk_scale）。 */
const iris = (bb, chess, def) => talentsOnly(bb, chess, def, [(b, u) => {
  const s = num(bbOf(chess).atk_scale, 1);
  if (s === 1) return;
  onHitBy(b, u, ({ dmg }) => { if (dmg?.isSkill) dmg.mul *= s; });
}]);

export default Object.freeze({
  // ---------- ① 复用官方 kit ----------
  chess_prof_snakek_a: snakek.chess_char_3_16_a,
  chess_prof_snakek_b: snakek.chess_char_3_16_a,
  chess_prof_podego_a: podego.chess_char_1_13_a,
  chess_prof_podego_b: podego.chess_char_1_13_a,
  chess_prof_agoat2_a: agoat2.chess_char_6_20_a,
  chess_prof_agoat2_b: agoat2.chess_char_6_20_a,
  chess_prof_skadi2_a: skadi2.chess_char_6_04_a,
  chess_prof_skadi2_b: skadi2.chess_char_6_04_a,
  chess_prof_kazema_a: kazema.chess_char_2_11_a,
  chess_prof_kazema_b: kazema.chess_char_2_11_a,
  chess_prof_pasngr_a: pasngr.chess_char_6_05_a,
  chess_prof_pasngr_b: pasngr.chess_char_6_05_a,
  // 克莱门莎 生死定夺 / 习得性防御 **+ 冲蚀 / 风暴潮（放逐舱）/ 与海为敌**：整包转发官方 kit
  chess_prof_clemnt_a: clemntOfficial.char_4231_clemnt,
  chess_prof_clemnt_b: clemntOfficial.char_4231_clemnt,

  // ---------- ② 手写 ----------
  chess_lm_axue_a: sqrrel, chess_lm_axue_b: sqrrel,                  // 阿消 防火护服
  chess_lm_anlock_a: rope, chess_lm_anlock_b: rope,                  // 暗索 听觉训练
  chess_lm_shitie_a: panda, chess_lm_shitie_b: panda,                // 食铁兽 功夫
  chess_prof_durnar_a: durnar, chess_prof_durnar_b: durnar,          // 坚雷 攻守兼备
  chess_prof_clour_a: clour, chess_prof_clour_b: clour,              // 红云 猎人的经验
  chess_prof_myrrh_a: myrrh, chess_prof_myrrh_b: myrrh,              // 末药 急救包
  chess_prof_surfer_a: surfer, chess_prof_surfer_b: surfer,          // 寻澜 独自远走

  chess_prof_ceylon_a: ceylon, chess_prof_ceylon_b: ceylon,          // 锡兰 湖畔漫步者
  chess_pg_bison_a: bison, chess_pg_bison_b: bison,                  // 拜松 交叉掩护
  chess_lm_mou_a: hmau, chess_lm_mou_b: hmau,                        // 吽 门神
  chess_prof_nights_a: nights, chess_prof_nights_b: nights,          // 夜烟 黑色迷雾
  chess_prof_proviso_a: proviso, chess_prof_proviso_b: proviso,      // 但书 卡西米尔法律专精
  chess_prof_swllow_a: swllow, chess_prof_swllow_b: swllow,          // 灰喉 顺风
  chess_prof_savage_a: savage, chess_prof_savage_b: savage,          // 暴行 山谷
  chess_prof_grani_a: grani, chess_prof_grani_b: grani,              // 格拉尼 骑警
  chess_prof_ctable_a: ctable, chess_prof_ctable_b: ctable,          // 晓歌 万全
  chess_pg_sora_a: sora, chess_pg_sora_b: sora,                      // 空 安可
  chess_prof_iris_a: iris, chess_prof_iris_b: iris,                  // 爱丽丝 封印的宝盒
});
