// 罗德岛 roster skill implementations. The prep/battle traits live in rodos.js / rodosMeta.js; this file only
// maps each operator's transcribed skill blackboard onto engine effects.
import { COLS } from '../../../constants.js';
import { num, up, makeZone, alliesInGridOf, onHitBy, statBuff, toggleBuff, giveSp, batMod, RING1 } from '../shared/tier1.js';
const S = (chess, def, id) => ((def?.skill?.skillId ?? def?.skill?.id ?? chess.skill?.skillId) === id);

/** "技能持续时间内逐渐获得N点部署费用" (可露希尔): 1 DP every `duration / N` s while the skill runs. */
function gradualCost(battle, unit, total, duration) {
  const n = Math.max(1, Math.round(num(total, 0)));
  const step = Math.max(0.25, num(duration, 0) / n);
  for (let i = 1; i <= n; i++) battle.after(step * i, () => battle.addDp(unit.ownerId, 1), { owner: unit });
}

/**
 * 凯尔希·思衡托 S3 破梏重生 的战术锚点: 「立刻获得战术锚点 … 部署战术锚点后，自身移动至该位置，并使攻击范围内
 * 最多2名友方干员可以部署至自身攻击范围的另一位置」。
 *
 * 官方这两步都由玩家放置锚点决定；本作是自走棋，没有这一步操作，[ASSUMED] 由引擎代选：
 *   * 她飞到自身攻击范围内、离伤势最重的友方最近的可部署格（当前格已经最优时不动），原格留下一个不可索敌的
 *     战术锚点标记（Battle.spawnToken，与乌尔比安 S3 的船锚标记同一写法），技能结束撤除；
 *   * 攻击范围内最多 `bb.relocate` 名友方干员【移动】到她攻击范围内的另一可部署格 —— 只挑**当前没有阻挡任何
 *     敌人**的干员（挪走挡怪的单位会漏怪），落点取离她最近的空格。
 * 两处移动都是【移动】(Battle.moveRedeploy: 不退场、保留血量与增益、重新触发部署效果)，不是撤退再部署。
 */
function deployAnchor(battle, unit, chess, bb) {
  const cells = (unit.rangeKeys || []).map((k) => [Math.floor(k / COLS), k % COLS]);
  const usable = (r, c) => battle.grid.inRect(r, c) && battle.onOwnBoard(unit.player, r, c)
    && battle.grid.canStand(r, c) && !battle.grid.isObstacle(r, c) && !battle.isReservedTile(r, c);
  const ratio = (a) => a.hp / Math.max(1, a.s.maxHp);
  const home = [unit.tileR, unit.tileC];

  // 「自身移动至该位置」
  const worst = battle.allyUnits
    .filter((a) => a !== unit && up(a) && a.ownerId === unit.ownerId && a.deployed && a.hp < a.s.maxHp - 1e-6)
    .sort((a, b) => ratio(a) - ratio(b))[0];
  if (worst) {
    const d = ([r, c]) => Math.max(Math.abs(r - worst.tileR), Math.abs(c - worst.tileC));
    const dest = cells
      .filter(([r, c]) => usable(r, c) && !(r === home[0] && c === home[1]))
      .sort((p, q) => d(p) - d(q))[0] ?? null;
    // 当前位置已经比任何候选更靠近伤员时不移动（无意义的位移只会破坏阵型）
    if (dest && d(dest) < d(home)) {
      const fromX = unit.x, fromY = unit.y;
      if (battle.moveRedeploy(unit, dest[0], dest[1]) && unit.alive) {
        battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
        unit.mem.kalts2Anchor = {
          marker: battle.spawnToken(unit, chess?.skill?.overrideTokenKey ?? 'token_kalts2_anchor', home[0], home[1],
            { untargetable: true, kit: { skill: null, trait: { noAttack: true } } }),
        };
      }
    }
  }

  // 「使攻击范围内最多2名友方干员可以部署至自身攻击范围的另一位置」
  const n = Math.max(0, Math.round(num(bb.relocate, 2)));
  if (!n) return;
  const mine = new Set(unit.rangeKeys || []);
  const spots = cells.filter(([r, c]) => usable(r, c));
  const cands = battle.allyUnits
    .filter((a) => a !== unit && up(a) && a.ownerId === unit.ownerId && a.deployed
      && !(a.blocking && a.blocking.length)                        // 正在挡怪的单位不挪（挪走就漏怪）
      && mine.has(a.tileR * COLS + a.tileC))
    .sort((a, b) => ratio(a) - ratio(b))
    .slice(0, n);
  for (const a of cands) {
    const from = a.tileR * COLS + a.tileC;
    // 逐个候选格试（最近优先）：格子被占用时 relocate 会拒绝，换下一个；全都占满则该干员原地不动
    const ordered = spots
      .filter(([r, c]) => r * COLS + c !== from)
      .sort((p, q) => (Math.abs(p[0] - unit.tileR) + Math.abs(p[1] - unit.tileC))
        - (Math.abs(q[0] - unit.tileR) + Math.abs(q[1] - unit.tileC)));
    for (const [r, c] of ordered) {
      const fromX = a.x, fromY = a.y;
      if (!battle.moveRedeploy(a, r, c)) continue;
      if (a.alive) battle.fx('teleport', { x: a.x, y: a.y, id: a.id, fromX, fromY });
      break;
    }
  }
}

/** All 11 operators share one entry point; the selected skill decides what happens. */
export function rodosKit(bb, chess, def) {
  const skills = {};
  const pick = (id) => S(chess, def, id);

  // ---- 先锋 -----------------------------------------------------------------------------------------
  if (pick('skchr_fang_1')) skills.skchr_fang_1 = { kind: 'duration', duration: num(bb.duration, 10), mods: { defPct: num(bb.def, 0.3) }, onStart({ battle, unit }) { battle.addDp(unit.ownerId, num(bb.cost, 6)); } };
  if (pick('skchr_fang2_1')) skills.skchr_fang2_1 = {
    kind: 'duration', duration: num(bb.duration, 15),
    attack: { atkScale: num(bb.atk_scale, 3.2) },
    onStart({ battle, unit }) { battle.addDp(unit.ownerId, num(bb.cost, 2)); },
  };
  if (pick('skchr_fang2_2')) skills.skchr_fang2_2 = {
    kind: 'duration', duration: num(bb.duration, 20),
    mods: { atkPct: num(bb.atk, 0.5), defPct: num(bb.def, 0.5) },
    onStart({ battle, unit }) { unit.mem.blockBonus = (unit.mem.blockBonus ?? 0) + num(bb.block_cnt, 1); },
    onEnd({ battle, unit }) { void battle; unit.mem.blockBonus = Math.max(0, (unit.mem.blockBonus ?? 1) - num(bb.block_cnt, 1)); },
  };

  // ---- 术师 -----------------------------------------------------------------------------------------
  if (pick('skchr_lava_1')) skills.skchr_lava_1 = {
    kind: 'duration', duration: num(bb.duration, 25), mods: { aspd: num(bb.attack_speed, 45) },
  };
  // 炎狱炎熔 S1 焰淬匕首: attack range +1, ATK up, hits two targets at once.
  if (pick('skchr_lava2_1')) skills.skchr_lava2_1 = {
    kind: 'duration', duration: num(bb.duration, 31), mods: { atkPct: num(bb.atk, 0.14) },
    targeting: {
      rangeExtend: num(bb.ability_range_forward_extend, 1),
      maxTargets: Math.max(1, Math.round(num(bb['attack@max_target'], 2))),
    },
  };
  // 炎狱炎熔 S2 狱火之环: stops attacking; a fire ring around herself and the highest-HP ally in range burns the 8
  // tiles around each of them every second for atk_scale × ATK arts.
  if (pick('skchr_lava2_2')) skills.skchr_lava2_2 = {
    kind: 'duration', duration: num(bb.duration, 36),
    attack: { noAttack: true },
    onStart({ battle, unit }) {
      const scale = num(bb.atk_scale, 0.4);
      const dur = num(bb.duration, 36);
      const interval = Math.max(0.1, num(bb.interval, 1));
      const ring = (x, y) => makeZone(battle, unit, {
        x, y, radius: RING1, duration: dur, interval, skill: 'lava2',
        onPulse(b) {
          for (const e of b.foesInRadius(x, y, RING1)) {
            if (e.s?.flags?.untargetable) continue;
            b.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, canDodge: false, tags: ['dot', 'zone'] });
          }
        },
      });
      ring(unit.x, unit.y);
      // "立即选择攻击范围内生命值最高的友方单位": current HP, ties → the first in battle order.
      const best = alliesInGridOf(battle, unit).filter((a) => a !== unit).sort((a, b) => b.hp - a.hp)[0];
      if (best) ring(best.x, best.y);
    },
  };

  // ---- 狙击 -----------------------------------------------------------------------------------------
  // 克洛丝 二连射·自动: 攻击回复技力 (data spType), one next attack that fires twice at 140 %.
  if (pick('skchr_kroos_1')) skills.skchr_kroos_1 = {
    kind: 'instant',
    attack: { hits: Math.max(2, Math.round(num(bb.times, 2))), atkScale: num(bb.atk_scale, 1.4) },
  };
  if (pick('skchr_greyy2_1')) skills.skchr_greyy2_1 = { kind: 'duration', duration: num(bb.duration, 25), mods: { aspd: num(bb.attack_speed, 55) } };
  if (pick('skchr_greyy2_2')) skills.skchr_greyy2_2 = {
    kind: 'duration', duration: num(bb.duration, 20), mods: { atkPct: num(bb.atk, 0.45) },
    onHit({ battle, unit, target }) {
      if (!up(target)) return;
      const r = Math.max(1, Math.round(num(bb.radius, 1)));
      for (const e of battle.enemies) {
        if (!up(e)) continue;
        if (Math.abs(e.tileR - target.tileR) > r || Math.abs(e.tileC - target.tileC) > r) continue;
        battle.applyStatus(e, 'stun', { duration: num(bb.stun, 2), source: unit });
      }
    },
  };

  // ---- 医疗 -----------------------------------------------------------------------------------------
  if (pick('skchr_hibisc_1')) skills.skchr_hibisc_1 = { kind: 'duration', duration: num(bb.duration, 20), mods: { atkPct: num(bb.atk, 0.4) } };
  if (pick('skchr_hbisc2_1')) skills.skchr_hbisc2_1 = { kind: 'duration', duration: num(bb.duration, 30), mods: { atkPct: num(bb.atk, 0.8) } };
  if (pick('skchr_hbisc2_2')) skills.skchr_hbisc2_2 = {
    kind: 'duration', duration: num(bb.duration, 20),
    onHit({ battle, unit, target }) {
      // 抚业之触: mark the target 法术脆弱 and trickle-heal the most hurt ally in range.
      if (up(target)) {
        battle.addBuff(target, { key: 'rodos:vulnerable', duration: 5, mods: { dmgTakenMul: 1 + num(bb.magic_fragile, 0.3) } });
      }
      const ally = battle.allyUnits.filter((a) => a.ownerId === unit.ownerId && up(a) && a.hp < a.s.maxHp).sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp)[0];
      if (ally) battle.heal(unit, ally, unit.s.atk * num(bb.heal_scale, 1));
    },
  };
  if (pick('skchr_kalts2_1')) skills.skchr_kalts2_1 = { kind: 'duration', duration: num(bb.duration, 25), mods: { atkPct: num(bb.heal_scale, 1) } };
  // 凯尔希·思衡托 S2 保护性拒止: an AMMO skill (data durationType). Every medical unit she fires deals true damage
  // around its target, 停顿s it (sluggish — 描述写的是停顿不是眩晕), and heals the allies around it for heal_scale × ATK.
  if (pick('skchr_kalts2_2')) skills.skchr_kalts2_2 = {
    kind: 'ammo', ammo: Math.max(1, Math.round(num(bb.ammo, 10))),
    // 她是医疗（professions.js MEDIC ⇒ profile.dmgType 'heal' && profile.heal），而本技能是**攻击**技能。两条一起写才开得出来：
    //
    // 1) `heal: false` —— 不写这条，skills.js:108 把本技能判成治疗技能，_defaultCondition 走 healSkill 分支（:492）
    //    只看「射程内有受伤友方」，与「打敌人」南辕北辙。标成非治疗技能后判据才变成「射程内有敌人」，
    //    技能期内 attack.dmgType 'true' 经 ai.js:64 把 p.heal 置空，医疗单元射向敌人。
    //    她平时的普通攻击仍是治疗（profile 未动）。
    //
    // 2) `trigger: { rule: 'SEARCH' }` —— 光有 1) 仍然开不了技。DEFAULT 规则**只在「即将攻击/治疗」那一刻**判定
    //    （ai.js:113 → skills.js:508），而 ai.js:111 在那之前就 return 了：常态她是治疗 profile，
    //    acquireTargets（ai.js:149）只挑受伤友方，一个都没有 ⇒ 攻击检查提前退出 ⇒ onAboutToAttack 永远不被调用。
    //    于是成了死循环：要开技得先有攻击动作，而攻击动作只在「有受伤友方」时才发生 —— 没有友方掉血就永远不开技。
    //    SEARCH 是官方策略「不受基础策略影响，在初始攻击范围内存在敌人时释放技能」：改为**每 tick 检查**，不需要
    //    先有攻击动作；skills.js:456 的注释正是为这类单位写的（「不攻击的单位 DEFAULT 的 about to attack 永不到来」）。
    //    [DEVIATION] 数据里本技能的 rawRule 是 DEFAULT，此处按这条注释的口径改判。
    heal: false,
    trigger: { rule: 'SEARCH' },
    targeting: { rangeExtend: 1 },   // 「攻击范围扩大」：数据与技能都没有范围网格，按 babel.js:121 的先例向前 +1
    mods: { atkPct: num(bb.atk, 1.25) },
    attack: { dmgType: 'true', atkScale: num(bb.true_scale, 3.5), splashRadius: 1.1 },
    onHit({ battle, unit, target }) {
      if (!up(target)) return;
      // 描述写的是「停顿」（sluggish：移动变慢）不是「眩晕」（stun：完全无法行动）—— 引擎两个状态都有。
      // 黑板键名沿用数据里的 `stun`，语义按描述取「停顿」。
      const slow = num(bb.stun, 5);
      if (slow > 0) battle.applyStatus(target, 'sluggish', { duration: slow, source: unit });
      const amount = unit.s.atk * num(bb.heal_scale, 1.7);
      for (const a of battle.allyUnits) {
        if (a === unit || a.ownerId !== unit.ownerId || !up(a)) continue;
        if (Math.max(Math.abs(a.tileR - target.tileR), Math.abs(a.tileC - target.tileC)) > 1) continue;
        battle.heal(unit, a, amount, { tags: ['skill'] });
      }
    },
  };
  // 凯尔希·思衡托 S3 破梏重生 (35 s, MANUAL): 「立刻获得战术锚点，攻击力+125%，攻击间隔大幅缩小(-1.55)，
  // 额外治疗1个目标，部署战术锚点后，自身移动至该位置，并使攻击范围内最多2名友方干员可以部署至自身攻击范围的另一位置」。
  if (pick('skchr_kalts2_3')) skills.skchr_kalts2_3 = {
    kind: 'duration', duration: num(bb.duration, 35),
    mods: {
      // 「攻击力+125%」—— 旧代码取 `bb.heal_scale`，而 S3 的黑板**没有这个键**（那是 S1/S2 的治疗系数键），
      // 于是永远落成兜底的 1.2，与文案的 +125% 对不上。
      atkPct: num(bb.atk, 1.25),
      // 「攻击间隔大幅缩小(-1.55)」—— `bb.interval` 是**秒数**不是比例，而引擎的攻击间隔是
      // bat ×(1 + ΣbatPct)×100/aspd（units.js:7），只能按比例给；`batMod` (shared/tier1.js:265) 就是这个换算：
      // 她的 bat 2.85 ⇒ -1.55/2.85 ≈ -0.544，即间隔 2.85 s → 1.30 s。
      batPct: batMod(bb.interval, chess),
    },
    // 「额外治疗1个目标」⇒ 治疗目标数 1 + 1 = 2（targeting.maxTargets，ai.js:67 → :156；同 skchr_lava2_1 的写法）。
    targeting: { maxTargets: 1 + Math.max(0, Math.round(num(bb.extra_targets, 1))) },
    onStart({ battle, unit }) { deployAnchor(battle, unit, chess, bb); },
    onEnd({ battle, unit }) {
      const h = unit.mem.kalts2Anchor;
      unit.mem.kalts2Anchor = null;
      if (h?.marker?.alive) battle.retreat(h.marker, { reason: 'expired', permanent: true });
    },
  };

  // ---- 辅助 -----------------------------------------------------------------------------------------
  // 撷英调香师 (护佑者 blessing): trait 「攻击造成法术伤害，技能开启后改为治疗友方单位（治疗量相当于75%攻击力）」.
  // `blessing` has no SUB entry (professions.js resolveProfile keeps dmgType 'arts' / heal null), so the branch's
  // heal has to be authored here. Data (data/chess.json chess_rodos_flwr2_a, build-data over the official levels):
  //   S1 “山中的喜悦”  AUTO, durationType NONE, heal_scale 3.5, def 0.2, charges 2 — an INSTANT charged heal:
  //     「立即进行一次治疗，治疗量为撷英调香师攻击力的350%，并使目标防御力+20%，持续10秒（不可叠加）可充能2次」.
  //     The official trait sentence's 75% is the branch's baseline for a *plain* skill-heal attack; this chess's own
  //     heal_scale supersedes it, so the blackboard value is what is used (never a hardcoded 0.75).
  //   S2 “神殿的余烬”  PASSIVE, duration 24, attack_speed 38, protect_mul 1.7, atk 0.2 — a passive: ASPD +38, the
  //     talent's 庇护 ×1.7, and every heal grants the target ATK +20% for 3 s (official attack@buff_duration 3).
  // The charge/instant shape comes from the data (`charges`), so S1 fires as soon as its SP is full.
  const SHELTER = num(bb.protect, 0.2);
  if (pick('skchr_flwr2_1')) skills.skchr_flwr2_1 = {
    kind: 'charges',
    charges: Math.max(1, Math.round(num(bb.charges, 2))),
    // `heal: true` is REQUIRED: skills.js:108 `healSkill = s.heal ?? (profile.dmgType === 'heal' && profile.heal)`.
    // This chess's own profile is arts/heal-null (the `blessing` branch has no SUB entry), so without the flag the
    // engine never looks for an injured ally and the skill would only ever fire at an enemy — the cast finds no valid
    // target and the trait's heal never happens. Same idiom as 古米 chess_char_1_10-sunbr.js:63 and 塞雷娅 :77.
    heal: true,
    // 立即进行一次治疗: the cast replaces this attack with a single-target heal of heal_scale × ATK
    attack: { dmgType: 'heal', heal: { mode: 'single' }, healScale: num(bb.heal_scale, 3.5), projectile: 'none' },
    onHit({ battle, unit, target }) {
      if (!up(target)) return;
      battle.addBuff(target, { key: 'rodos:flwr2_def', duration: 10, mods: { defPct: num(bb.def, 0.2) }, visible: true, refresh: 'keep' });
    },
  };
  if (pick('skchr_flwr2_2')) skills.skchr_flwr2_2 = {
    kind: 'passive', duration: num(bb.duration, 24),
    mods: { aspd: num(bb.attack_speed, 38), atkPct: num(bb.atk, 0.2) },
    // 天赋提供的庇护效果提升至 protect_mul 倍 — recorded for the talent's tick below.
    onStart({ unit }) { unit.mem.flwr2ShelterMul = num(bb.protect_mul, 1.7); },
  };

  // 撷英调香师 T1 「使攻击范围内生命比例不高于自身的友军获得20%庇护」 + 凯尔希·思衡托 (护佑者 warden) trait/T1: neither
  // branch has a SUB entry, so their trait-level obligations are installed here. The dispatcher returns one kit for all
  // 11 罗德岛 pieces, so each block is guarded by the record's own id and only the fielded operator's fires.
  const rec = chess ?? {};
  const isFlwr2 = /flwr2/.test(String(rec.charId ?? def?.charId ?? '')) || /flwr2/.test(String(def?.baseId ?? def?.id ?? ''));
  const isKalts2 = /kalts2/.test(String(rec.charId ?? def?.charId ?? '')) || /kalts2/.test(String(def?.baseId ?? def?.id ?? ''));
  /** Which 罗德岛 operator this piece is: the record's own key (chess_rodos_<key>_a/_b) without prefix/suffix. */
  const roKey = String(def?.baseId ?? def?.id ?? rec.chessId ?? '').replace(/^chess_rodos_/, '').replace(/_[ab]$/, '') || null;

  const talents = [];

  // ---------------------------------------------------------------------------------------------------------------
  // 罗德岛 干员的数据天赋 (data/chess.json `talents`)。这些记录的天赋**不带黑板**（bb 全空），数值只写在文案里，
  // 而且引擎只从 `kit.talents` 取实现（battle/players.js:238 `for (const t of u.kit.talents || [])`）——
  // 所以在这之前它们**完全是死数据**：文案上写着 ×1.5 / 停顿 / 脆弱，实战里没有任何效果。
  // 数值一律按文案硬写并注明出处（数据里没有可读的 bb，读不到就只能是文案）。
  // 部署费用类（芬 轻量化 −1、历阵锐枪芬 轻装上阵 −4/−2、可露希尔 极限调度 下限−5）**不在这里**：
  // `battle/deploy.js:217` 读的是静态的 `unit.base.cost`，费用是**休整期/备战层**的事，
  // 本作由 data/garrisons.json（SERVER_PRICE 等）承载 —— 见 rodosMeta.js。
  switch (roKey) {
    // 芬 轻量化 「部署费用-1」 —— 费用是备战层的事（deploy.js:217 读静态 base.cost），不在战斗侧实现。
    case 'lava': // 炎熔 快速技能使用 「部署后立即获得10点技力」
      talents.push({ install(battle, unit) {
        battle.on('deploy', (ctx) => { if (ctx.unit === unit) giveSp(unit, 10, 'talent'); }, { owner: unit });
      } });
      break;
    case 'kroos': // 克洛丝 要害瞄准·初级 「攻击时，15%几率当次攻击的攻击力提升至150%」
      talents.push({ install(battle, unit) {
        onHitBy(battle, unit, ({ dmg }) => {
          if (!dmg?.isAttack || !dmg.isMain) return;
          if (battle.rng() < 0.15) dmg.mul *= 1.5;
        });
      } });
      break;
    case 'hibisc': // 芙蓉 治疗力提升 「攻击力+5%」
      talents.push({ install(battle, unit) { statBuff(battle, unit, 'talent:hibisc:atk', { atkPct: 0.05 }); } });
      break;
    case 'lava2': // 炎狱炎熔 岩浆重铸 「技能开启时攻击力+15%」
      talents.push({ install(battle, unit) {
        toggleBuff(battle, unit, 'talent:lava2:atk', () => !!unit.skill?.active, { atkPct: 0.15 });
      } });
      break;
    case 'hbisc2': // 濯尘芙蓉 朝开夕落 「攻击敌人时对目标施加20%的法术脆弱，持续5秒」
      talents.push({ install(battle, unit) {
        onHitBy(battle, unit, ({ target }) => {
          if (!target || target.side !== 'enemy' || !up(target)) return;
          battle.addBuff(target, {
            key: 'talent:hbisc2:fragile', duration: 5, source: unit, visible: true, refresh: 'replace', tags: ['talent'],
            mods: { dmgTakenMul: 1.2 },                       // 法术脆弱: 受到的法术伤害 +20%
          });
        });
      } });
      break;
    case 'greyy2': // 承曦格雷伊 窃光链缚 「攻击时有40%的几率造成2秒停顿，对停顿中的敌人伤害提升15%」
      talents.push({ install(battle, unit) {
        onHitBy(battle, unit, ({ dmg, target }) => {
          if (!target || target.side !== 'enemy' || !up(target)) return;
          // 对停顿中的敌人伤害提升15%（先判加成，再判是否新施加停顿）
          if (dmg?.isAttack && target.findBuff('sluggish')) dmg.mul *= 1.15;
          if (battle.rng() < 0.4) battle.applyStatus(target, 'sluggish', { duration: 2, source: unit });
        });
      } });
      break;
    default: break;
  }

  if (isFlwr2 && SHELTER > 0) {
    // 庇护 = 受到伤害减少 (dmgTakenMul), re-read every tick so a change in either HP ratio takes effect at once; S2's
    // protect_mul scales it. Only allies whose HP ratio is ≤ hers AND who stand in her attack range qualify —
    // `alliesInGridOf` (shared/tier1.js:137) is the established "allies inside my range" helper (it also honours
    // `Battle.allySelectable`, e.g. 隐匿). The buff carries `data.mul` so a change of the S2 multiplier re-adds it.
    talents.push({ install(battle, unit) {
      const apply = () => {
        if (!unit.alive || !unit.deployed) return;
        const mul = num(unit.mem.flwr2ShelterMul, 1);
        const mine = unit.hp / Math.max(1, unit.s.maxHp);
        const want = new Set();
        for (const a of alliesInGridOf(battle, unit)) {
          if (a.ownerId !== unit.ownerId) continue;
          if (a.hp / Math.max(1, a.s.maxHp) > mine + 1e-9) continue;
          want.add(a.id);
        }
        for (const a of battle.allyUnits) {
          if (!a.alive || a.ownerId !== unit.ownerId) continue;
          const cur = a.findBuff('talent:flwr2:shelter');
          if (want.has(a.id)) {
            if (!cur || cur.data?.mul !== mul) {
              battle.addBuff(a, {
                key: 'talent:flwr2:shelter', source: unit, persist: true, allowDead: true, tags: ['talent'],
                data: { mul }, mods: { dmgTakenMul: 1 - Math.min(0.9, SHELTER * mul) },
              });
            }
          } else if (cur) battle.removeBuff(a, 'talent:flwr2:shelter');
        }
      };
      battle.on('tick', apply, { owner: unit });
      battle.on('battleStart', apply, { owner: unit });
      battle.on('deploy', (ctx) => { if (ctx.unit === unit) apply(); }, { owner: unit });
      battle.on('skillStart', (ctx) => { if (ctx.unit === unit) apply(); }, { owner: unit });
      battle.on('skillEnd', (ctx) => { if (ctx.unit === unit) apply(); }, { owner: unit });
    } });
  }
  if (isKalts2) {
    // Trait (护佑者) 「恢复友方单位生命，并且可以起飞」 + T1 遗尘守望 「生命上限和防御力+30%，阻挡数+1，阻挡范围扩大，
    // 部署后生命修复单元升空，自身起飞」: from deployment the operator is airborne — `liftoff` (no ground enemy selects or
    // is blocked by her) + `blockFly` (she blocks flyers), the same flag pair 凯尔希's own op-kalts2.js uses for her
    // in-battle flight (kits/ops/op-kalts2.js:305).
    talents.push({ install(battle, unit) {
      battle.addBuff(unit, {
        key: 'talent:kalts2:liftoff', persist: true, allowDead: true, visible: true, tags: ['talent'],
        flags: { liftoff: true, blockFly: true },
      });
      battle.releaseBlocked?.(unit);
    } });
    // T1 遗尘守望 的属性部分: 生命上限和防御力+30%（精英 +5% ⇒ 数据里是同一个 bb 空对象，取基础值）.
    talents.push({ install(battle, unit) {
      const k = unit.def?.golden ? 0.35 : 0.30;
      statBuff(battle, unit, 'talent:kalts2:guardian', { hpPct: k, defPct: k });
    } });
    // T2 医者丰碑 「其他友方干员进入自身攻击范围时立刻获得1层护盾并额外获得一次每秒回复60（+10）点生命值的增益治疗，
    // 持续30秒（不可叠加），增益治疗对【罗德岛】干员的效果翻倍」:
    //   * every OTHER ally that enters her attack range gets a 1-hit shield (`shieldHits`) and a 30 s hpRegen buff;
    //   * 不可叠加 ⇒ one grant per ally at a time (`refresh:'keep'`, and the tick skips an ally that already holds it);
    //   * 【罗德岛】 allies get double the regeneration (nationId rhodes, the same test op-closur.js:376 uses for 极限调度).
    // Entry is re-checked on a tick interval because a move / a range change can put an ally inside without a 'deploy'.
    talents.push({ install(battle, unit) {
      const REGEN = 60;                     // 每秒回复60点（精英 +10）
      const DUR = 30;
      const KEY = 'talent:kalts2:monument';
      const isRodos = (a) => /rhodes/i.test(String(a.def?.nationId ?? a.def?.raw?.nationId ?? a.def?.raw?.nation ?? ''));
      battle.on('tick', () => {
        if (!unit.alive || !unit.deployed) return;
        for (const a of alliesInGridOf(battle, unit)) {
          if (a === unit || !up(a)) continue;
          if (a.findBuff(KEY)) continue;                       // 不可叠加
          const n = REGEN + (unit.def?.golden ? 10 : 0);
          const val = isRodos(a) ? n * 2 : n;
          battle.addBuff(a, {
            key: KEY, duration: DUR, source: unit, visible: true, tags: ['talent'],
            mods: { hpRegen: val },
          });
          battle.addBuff(a, { key: `${KEY}:shield`, shieldHits: 1, duration: DUR, source: unit, visible: true, tags: ['talent'] });
        }
      }, { owner: unit });
    } });
  }

  // ---- 可露希尔 (战术家): every skill empowers her 援军 — the 指挥中心 token the player places in her attack range —
  // and pays 部署费用. `unit.trait.reinforcement` is set by the token kit (content/tokens.js closurBase) and by the
  // tactician profession; empty when her 援军 is off the field, so each skill checks before buffing it.
  if (pick('skchr_closur_1')) skills.skchr_closur_1 = {
    kind: 'duration', duration: num(bb.duration, 8),
    onStart({ battle, unit }) {
      const rein = unit.trait.reinforcement;
      // "立即使自身的援军获得1层护盾（不叠加）" — one damage instance is negated.
      if (up(rein)) battle.addBuff(rein, {
        key: 'rodos:closur_shield', shieldHits: Math.max(1, Math.round(num(bb.shield, 1))),
        duration: num(bb.duration, 8), visible: true, refresh: 'replace',
      });
      gradualCost(battle, unit, num(bb.cost, 3), num(bb.duration, 8));
    },
  };
  if (pick('skchr_closur_2')) skills.skchr_closur_2 = {
    kind: 'duration', duration: num(bb.duration, 30), mods: { atkPct: num(bb.atk, 0.55) },
    targeting: { maxTargets: Math.max(1, Math.round(num(bb['attack@max_target'], 2))) },
    onStart({ battle, unit }) {
      battle.addDp(unit.ownerId, num(bb.cost, 7));
      gradualCost(battle, unit, num(bb.cost_over_time, 15), num(bb.duration, 30));
      const rein = unit.trait.reinforcement;
      if (up(rein)) battle.addBuff(rein, {
        key: 'rodos:closur_extend', duration: num(bb.duration, 30), visible: true,
        mods: { defPct: num(bb.def, 0.45), blockCnt: num(bb.block_cnt, 1) },
      });
    },
  };
  if (pick('skchr_closur_3')) skills.skchr_closur_3 = {
    kind: 'duration', duration: num(bb.duration, 30),
    mods: { batPct: num(bb.interval, -0.5) },
    attack: { atkScale: num(bb.atk_scale, 1.9) },
    onStart({ battle, unit }) { gradualCost(battle, unit, num(bb.cost_over_time, 18), num(bb.duration, 30)); },
    onHit({ battle, unit, target }) {
      // 迟钝: a stacking move-speed debuff, slow_down per hit up to slow_down_max, each stack lasting 3 s.
      if (!up(target)) return;
      const per = num(bb.palsy, 0.05);
      const cap = num(bb.palsy_cap, 0.5);
      const stacks = (target.findBuff('rodos:qed_slow')?.data?.stacks ?? 0) + 1;
      const value = Math.min(cap, stacks * per);
      battle.addBuff(target, {
        key: 'rodos:qed_slow', duration: 3, refresh: 'replace', visible: true,
        data: { stacks }, mods: { moveMul: 1 - value },
      });
    },
  };

  const own = Object.values(skills)[0] ?? null;
  return { skills, skill: own, ...(talents.length ? { talents } : null) };
}

/** baseChessId → kit. Every 罗德岛 piece uses the same dispatcher. */
const KEYS = ['fang', 'lava', 'kroos', 'hibisc', 'lava2', 'hbisc2', 'greyy2', 'fang2', 'flwr2', 'closure', 'kalts2'];
export const RODOS_KITS = Object.freeze(Object.fromEntries(KEYS.flatMap((k) => [[`chess_rodos_${k}_a`, rodosKit], [`chess_rodos_${k}_b`, rodosKit]])));

export default RODOS_KITS;
