// 麦哲伦 (char_248_mgllan) — 莱茵生命 expansion, 4 本 召唤师.
//
// Her vanilla kit: 天赋「支援无人机·龙腾」lets her keep `cnt` 龙腾 drones (3 / 4 / 5 by phase) with at most 3 on the
// field at once; each of her three skills produces a different drone (skill.overrideTokenKey) and changes what it does:
//   S1 高效制冷模块  — 龙腾.F (no attack): 自身与无人机攻击范围内敌人每 interval 秒停顿 sluggish 秒; 开启时改为束缚 1.6 秒
//   S2 激光开采模块  — 龙腾.L (melee, 单体法术): 开启时 麦哲伦与无人机攻速 +attack_speed，无人机改为群体攻击
//   S3 武装打击模块  — 龙腾.A (ranged, 群体物理): 开启时 攻击力 +atk，无人机爆炸范围扩大
// 技能结束时回收所有无人机 (the drones' own 回收 skill in the official data, driven from the owner here).
// 天赋「光学折射配件」: 无人机部署后 hidden_duration 秒隐匿 (the drone kit adds the stealth buff).
import { num, talentBb, skillRec, freeTileAround, enemiesInGrid, up } from '../shared/tier1.js';

export const MAGALLAN_DRONES = ['token_10005_mgllan_drone1', 'token_10005_mgllan_drone2', 'token_10005_mgllan_drone3'];
const MGLLAN_S1 = 'skchr_mgllan_1', MGLLAN_S2 = 'skchr_mgllan_2', MGLLAN_S3 = 'skchr_mgllan_3';
/** 支援无人机·龙腾: 最多同时部署 3 台. */
const DRONE_LIMIT = 3;
/** 武装打击模块「爆炸范围扩大」的溅射半径（格）; the base 群体物理 radius of the same drone. */
const BLAST_RADIUS = 1.1, BLAST_RADIUS_BIG = 1.7;

const liveDrones = (b, owner) => b.allyUnits.filter((a) => a.kind === 'token' && MAGALLAN_DRONES.includes(a.defId) && a.ownerUnit === owner && up(a));
const selected = (chess, def) => def?.skill?.id ?? chess.skill?.skillId;
const droneOf = (chess, id) => skillRec(chess, id)?.overrideTokenKey ?? MAGALLAN_DRONES[2];
const record = (chess, id, bb, def) => {
  const rec = skillRec(chess, id) ?? {};
  return id === selected(chess, def) ? { ...rec, bb: bb ?? rec.bb ?? {} } : rec;
};

/** 龙腾无人机 kit: 隐匿 on deploy, S1 无人机不攻击, S3 无人机群体攻击. */
export function magallanDroneKit(skillId) {
  const trait = skillId === MGLLAN_S1 ? { noAttack: true } : skillId === MGLLAN_S3 ? { splashRadius: BLAST_RADIUS } : null;
  return { fromTokens: true, skill: null, trait, talents: [{ install(b, t) {
    // 光学折射配件: 无人机在部署后的 hidden_duration 秒内处于隐匿状态.
    const hidden = num(t.def?.talents?.find((x) => x.bb?.hidden_duration != null)?.bb.hidden_duration, 0);
    if (hidden > 0) b.addBuff(t, { key: 'mgllan:stealth', flags: { stealth: true }, duration: hidden, source: t.ownerUnit ?? null });
  } }] };
}

export function magallan(bb, chess, def) {
  const sel = selected(chess, def);
  const droneId = droneOf(chess, sel);
  const stock = Math.max(1, num(talentBb(chess).cnt, DRONE_LIMIT));
  const s1 = record(chess, MGLLAN_S1, bb, def), s2 = record(chess, MGLLAN_S2, bb, def), s3 = record(chess, MGLLAN_S3, bb, def);
  const isS3 = sel === MGLLAN_S3;
  /** The drone's attack profile depends on the S3 blast state, so read it live (the kit trait seeds the base radius). */
  const blastRadius = (u) => (!isS3 ? 0 : u.mem.mgBlast ? BLAST_RADIUS_BIG : BLAST_RADIUS);

  const summon = (b, u) => {
    if (!up(u) || !(u.mem.droneStock > 0) || liveDrones(b, u).length >= DRONE_LIMIT) return;
    const tok = b.tokenDef(droneId, u) ?? {};
    const ranged = (tok.position ?? tok.raw?.position) !== 'MELEE';
    const tile = freeTileAround(b, u, (r, c) => b.grid.canStand(r, c, { ranged }));
    if (!tile) return;
    const t = b.spawnToken(u, droneId, tile[0], tile[1], { kit: magallanDroneKit(sel), anySource: true });
    if (t) { u.mem.droneStock--; b.fx('summon', { x: t.x, y: t.y, id: t.id, token: droneId }); }
  };

  /** 技能结束时回收所有无人机 (each returned drone goes back into the stock). */
  const recallAll = (b, u) => {
    for (const t of liveDrones(b, u)) {
      b.retreat(t, { reason: 'recycle', permanent: true });
      u.mem.droneStock = Math.min(stock, num(u.mem.droneStock) + 1);
    }
  };

  const skills = {
    // S1 高效制冷模块: 开启时 停顿→束缚, 结束时回收全部无人机 (the 被动 runs in install()).
    [MGLLAN_S1]: { kind: 'duration', onStart({ unit }) { unit.mem.mgBind = true; }, onEnd({ battle: b, unit }) { unit.mem.mgBind = false; recallAll(b, unit); } },
    // S2 激光开采模块: 麦哲伦攻速 +attack_speed (无人机由 install() 的被动一起给), 无人机群体攻击.
    [MGLLAN_S2]: { kind: 'duration', mods: { aspd: num(s2.bb?.attack_speed, 60) },
      onStart({ unit }) { unit.mem.mgGroup = true; }, onEnd({ battle: b, unit }) { unit.mem.mgGroup = false; recallAll(b, unit); } },
    // S3 武装打击模块: 麦哲伦攻击力 +atk, 无人机溅射半径扩大.
    [MGLLAN_S3]: { kind: 'duration', mods: { atkPct: num(s3.bb?.atk, 0.6) },
      onStart({ unit }) { unit.mem.mgBlast = true; }, onEnd({ battle: b, unit }) { unit.mem.mgBlast = false; recallAll(b, unit); } },
  };

  return {
    skills,
    skill: skills[sel] ?? skills[MGLLAN_S3],
    talents: [{ install(b, u) {
      // ---- 支援无人机·龙腾: 部署时补满库存并自动放一台; 每 10 秒补放; 离场时收回全部无人机 -------------------
      b.on('deploy', (c) => {
        if (c.unit !== u) return;
        const seq = u.deploySeq;
        // Operators deploy before their board tokens: count those before any automatic placement.
        b.after(0, () => {
          if (!up(u) || u.deploySeq !== seq) return;
          u.mem.droneStock = Math.max(0, stock - liveDrones(b, u).length);
          summon(b, u);
        }, { owner: u });
      }, { owner: u });
      b.on('death', (c) => {
        if (c.unit !== u) return;
        for (const t of liveDrones(b, u)) b.retreat(t, { reason: 'ownerGone', permanent: true });
        u.mem.droneStock = 0;
      }, { owner: u });
      b.every(10, () => summon(b, u), { owner: u });

      // ---- 被动 (随所选技能): S1 停顿 / S2 无人机群体与攻速 / S3 溅射 --------------------------------------
      if (sel === MGLLAN_S1) {
        // 「使自身和无人机攻击范围内的敌方单位每 interval 秒停顿 sluggish 秒」; 开启后改为束缚 frozen_duration 秒.
        const interval = Math.max(0.5, num(s1.bb?.['attack@interval'], 3));
        const sluggish = num(s1.bb?.['attack@sluggish'], 0.7), bind = num(s1.bb?.['attack@frozen_duration'], 1.6);
        b.every(interval, () => {
          if (!up(u)) return;
          const hit = (src) => {
            for (const e of enemiesInGrid(b, src, null)) {
              if (u.mem.mgBind) b.applyStatus(e, 'bind', { duration: bind, source: u });
              else b.applyStatus(e, 'sluggish', { duration: sluggish, source: u });
            }
          };
          hit(u);
          for (const d of liveDrones(b, u)) hit(d);
        }, { owner: u, immediate: false });
      }
      if (sel === MGLLAN_S2) {
        const aspd = num(s2.bb?.attack_speed, 60);
        b.every(0.2, () => {
          if (!u.mem.mgGroup) return;
          for (const d of liveDrones(b, u)) b.addBuff(d, { key: 'mgllan:s2aspd', duration: 0.4, mods: { aspd }, source: u });
        }, { owner: u });
      }
      if (sel === MGLLAN_S3 || sel === MGLLAN_S2) {
        b.on('beforeAttack', (c) => {
          const d = c.attacker;
          if (!MAGALLAN_DRONES.includes(d?.defId) || d.ownerUnit !== u) return;
          if (sel === MGLLAN_S3) c.profile.splashRadius = blastRadius(u);
          else if (u.mem.mgGroup) c.targets = b.enemiesInKeys(d.rangeKeys, d, c.profile);
        }, { owner: u });
      }
    } }],
  };
}

export const MAGALLAN_KITS = { char_248_mgllan: magallan, chess_rhine_magallan_a: magallan };
/** Board-token fallback: each 龙腾 drone behaves as the skill slot it belongs to. */
export const MAGALLAN_TOKEN_KITS = {
  [MAGALLAN_DRONES[0]]: () => magallanDroneKit(MGLLAN_S1),
  [MAGALLAN_DRONES[1]]: () => magallanDroneKit(MGLLAN_S2),
  [MAGALLAN_DRONES[2]]: () => magallanDroneKit(MGLLAN_S3),
};
export default MAGALLAN_KITS;
