// server/sim/content/suiProf.js — 岁·职业附加盟约的 battle 侧（12 个，weight=0）。
//
// 单职业（8）: 成员=全场该 profession 干员（support.unitBonds 按 shared/profBonds.js 归属），tier 由在场人数
//              与 thresholds [2,3(/4)] 驱动。层数 L = 该盟约自身层数（主要来自岁干员的休整期特质）。
// 复合（4）:   狙击术师/近卫重装/先锋医疗/特种辅助 —— thresholds [9] 自身永不激活；档位由两个组成单职业盟约的
//              tier 驱动（各 ≥1 → T1，各 ≥2 → T2）；公式里的「(A+B层数)」取两者层数和的一半（用户 2026-10-09 裁定）。
//
// 实现范围：先锋 spRecoveryMul、近卫/重装 ATK·HP（成员→地面→全体）、狙击/术师穿透+附带伤害、
// 医疗治疗量（healingDealtMul + 3 人档血线加成）、辅助 debuff aura、特种 redeploy/免费部署概率（引擎 _freeDeployRoll）/部署后 ATK、
// 近卫重装 T2 分担+反伤+脆弱（照坚守 redirect）、先锋医疗 T1 技力×1.5 与休整期加层（match 端 factions.js
// _suiPrepEnd，prep.js endPrep 挂钩）与 T2 治疗溢出 60% 转护盾、
// 四个复合的 T1 与狙击术师 T2 真伤。
//
// install(battle) 与 bonds/core.js 同构；registerMeta 无 garrison handler（效果全 battle 侧）。

import * as S from './support/index.js';
import { ID, KEY } from './bonds/addon/battle.js';
import { reviveNow } from './items/battle.js';
import { isHpLoss } from '../damage.js';

const num = S.num;
const L = (battle, pid, id) => S.bondLayers(battle, pid, id);
const tier = (battle, pid, id) => S.bondTier(battle, pid, id);
const bbOf = (id) => {
  const r = S.bondRecord(id);
  return S.buffParams(r, r?.bbStr?.key) ?? r?.bb ?? {};
};
// （isGround 已随近卫「3 人档地面 / 4 人档全体」两段式一起移除，改用 S.isMember 判定成员）
/** 近卫重装成员 = 近卫或重装干员（动态判定，部署会变化）。 */
const isWarrtank = (battle, u) => S.isMember(battle, u, 'warriorShip') || S.isMember(battle, u, 'tankShip');

export function install(battle) {
  if (!battle || !Array.isArray(battle.players)) return;
  for (const p of battle.players) {
    const pid = p.playerId;
    if (!p.bonds || typeof p.bonds !== 'object') continue;
    installPlayer(battle, pid);
  }
}

function installPlayer(battle, pid) {
  const ops = () => S.playerOps(battle, pid);

  // ---- 先锋：技力回复速度 +(15 + 每层×0.2)%；3 人档对全体干员有效，且先锋技能结束时有概率获得技力 ----
  // 用户 2026-10-14 规格：<在场3名不同【先锋】干员>该效果对全部干员有效，且先锋干员技能结束时有
  //   (25 + 每层×0.2)% 的概率获得 25 点技力。
  if (S.bondActive(battle, pid, 'vanguardShip')) {
    const bb = bbOf('vanguardShip');
    const all = tier(battle, pid, 'vanguardShip') >= 2;
    const vL = () => L(battle, pid, 'vanguardShip');
    // 每层线性（新键 sp_recovery_per_layer 优先；缺失时用旧的 per_10_layers/10 折算）
    const perLayer = num(bb.sp_recovery_per_layer, num(bb.sp_recovery_per_10_layers, 0.02) / 10);
    const apply = () => {
      const mul = 1 + num(bb.sp_recovery_bonus, 0.15) + perLayer * vL();
      for (const u of ops()) {
        if (all || S.isMember(battle, u, 'vanguardShip')) S.passiveBuff(battle, u, 'bond:vanguardShip', { spRecoveryMul: mul });
        else battle.removeBuff(u, 'bond:vanguardShip');
      }
    };
    apply();
    // 层数变化后刷新（3 人档还会随档位改变作用范围）
    const st = S.battleStore(battle, 'vanguardShip:refresh', () => ({ hooked: false }));
    if (!st.hooked) {
      st.hooked = true;
      battle.on('layerGain', (c) => {
        if (c.playerId !== pid) return;
        battle.after(0, apply);
      }, { priority: -100 });
    }

    // 3 人档：先锋干员技能结束 → (25 + 每层×0.2)% 概率获得 25 点技力
    if (all) {
      // base 是「百分比数字」（25 = 25%），per_layer 是「每层的百分点」（0.2 = 0.2%/层）。
      // 两者都按百分点算，最后统一 /100 得到概率。
      const probPctPerLayer = num(bb.skill_end_sp_prob_per_layer, 0.2);
      const chance = () => Math.min(1, (num(bb.skill_end_sp_prob_base, 25) + probPctPerLayer * vL()) / 100);
      const gain = num(bb.skill_end_sp_gain, 25);
      battle.on('skillEnd', (c) => {
        const u = c && c.unit;
        if (!u || u.ownerId !== pid) return;
        if (!S.isMember(battle, u, 'vanguardShip')) return;
        if (!S.onField(u)) return;
        const p = chance();
        if (!(p > 0) || !u.skill) return;
        if (battle.rng() >= p) return;
        u.skill.gainSp(gain, 'bond:vanguardShip');
      }, { priority: 0 });
    }
  }

  // ---- 近卫：攻击力 +(15 + 每层×0.7)% ----
  // 用户 2026-10-14 规格：<在场3名不同【近卫】干员>该效果对**全部干员**有效，且近卫干员**攻击数+1**。
  //（原来的「3 人档地面 / 4 人档全体」两段式已按新规格取消。）
  if (S.bondActive(battle, pid, 'warriorShip')) {
    const bb = bbOf('warriorShip');
    const t = tier(battle, pid, 'warriorShip');
    const all = t >= 2;                        // 3 人档起对全部干员有效
    const apply = () => {
      const atk = num(bb.base_atk, 0.15) + num(bb.atk_per_layer, 0.007) * L(battle, pid, 'warriorShip');
      const extra = all ? num(bb.extra_targets, 1) : 0;   // 近卫干员攻击数 +1
      for (const u of ops()) {
        const member = S.isMember(battle, u, 'warriorShip');
        if (all || member) {
          const mods = S.directMods({ atk });
          if (member && extra > 0) mods.maxTargets = extra;
          S.passiveBuff(battle, u, KEY.warrior, mods);
        } else {
          battle.removeBuff(u, KEY.warrior);
        }
      }
    };
    apply();
    const st = S.battleStore(battle, 'warriorShip:refresh', () => ({ hooked: false }));
    if (!st.hooked) {
      st.hooked = true;
      battle.on('layerGain', (c) => { if (c.playerId === pid) battle.after(0, apply); }, { priority: -100 });
    }
  }

  // ---- 重装：生命值 +(25 + 每层×1.2)% ----
  // 用户 2026-10-14 规格：<在场3名不同【重装】干员>该效果对**全部干员**有效，且重装干员**阻挡数+1**。
  if (S.bondActive(battle, pid, 'tankShip')) {
    const bb = bbOf('tankShip');
    const t = tier(battle, pid, 'tankShip');
    const all = t >= 2;                                   // 3 人档起对全部干员有效
    const apply = () => {
      const hp = num(bb.base_hp, 0.25) + num(bb.hp_per_layer, 0.012) * L(battle, pid, 'tankShip');
      const block = all ? num(bb.extra_block, 1) : 0;      // 重装干员阻挡数 +1
      for (const u of ops()) {
        const member = S.isMember(battle, u, 'tankShip');
        if (all || member) {
          const mods = S.directMods({ hp });
          if (member && block > 0) mods.blockCnt = block;
          S.passiveBuff(battle, u, KEY.tank, mods);
        } else {
          battle.removeBuff(u, KEY.tank);
        }
      }
    };
    apply();
    const st = S.battleStore(battle, 'tankShip:refresh', () => ({ hooked: false }));
    if (!st.hooked) {
      st.hooked = true;
      battle.on('layerGain', (c) => { if (c.playerId === pid) battle.after(0, apply); }, { priority: -100 });
    }
  }

  // ---- 狙击：无视防御力 +（50 + 每层*1.2）**固定点数**（_bonds-mod.txt 明确标「固定点数」）；
  //      3 人档：若该次攻击没附带元素伤害 → 造成（25 + 无视防御点数*2）的**侵蚀损伤**；
  //              若附带元素伤害 → 元素伤害提升（10 + 无视防御点数*0.4）%
  if (S.bondActive(battle, pid, 'sniperShip')) {
    const bb = bbOf('sniperShip');
    const t = tier(battle, pid, 'sniperShip');
    const lv = L(battle, pid, 'sniperShip');
    const penFlat = num(bb.def_pen_flat_base, 50) + num(bb.def_pen_flat_per_layer, 1.2) * lv;
    for (const u of ops()) if (S.isMember(battle, u, 'sniperShip')) S.passiveBuff(battle, u, 'bond:sniperShip', { defIgnoreFlat: penFlat });
    if (t >= 2) {
      // 侵蚀损伤量 = 25 + 无视防御点数*2；元素伤害增幅 = (10 + 点数*0.4)%
      const erosion = num(bb.t2_erosion_base, 25) + penFlat * num(bb.t2_erosion_per_pen, 2);
      const elemAmp = (num(bb.t2_elem_dmg_base, 10) + penFlat * num(bb.t2_elem_dmg_per_pen, 0.4)) / 100;
      sniperCasterT2(battle, pid, 'sniperShip', 'erosion', erosion, elemAmp);
    }
  }

  // ---- 术师：无视法术抗性 +（5 + 每层*0.2）**固定点数**；
  //      3 人档：无元素 → 造成（25 + 无视法抗点数*20）的**灼燃损伤**；有元素 → 元素伤害 +（10 + 点数*4）%
  if (S.bondActive(battle, pid, 'casterShip')) {
    const bb = bbOf('casterShip');
    const t = tier(battle, pid, 'casterShip');
    const lv = L(battle, pid, 'casterShip');
    const penFlat = num(bb.res_pen_flat_base, 5) + num(bb.res_pen_flat_per_layer, 0.2) * lv;
    for (const u of ops()) if (S.isMember(battle, u, 'casterShip')) S.passiveBuff(battle, u, 'bond:casterShip', { resIgnoreFlat: penFlat });
    if (t >= 2) {
      const burn = num(bb.t2_burn_base, 25) + penFlat * num(bb.t2_burn_per_pen, 20);
      const elemAmp = (num(bb.t2_elem_dmg_base, 10) + penFlat * num(bb.t2_elem_dmg_per_pen, 4)) / 100;
      sniperCasterT2(battle, pid, 'casterShip', 'burn', burn, elemAmp);
    }
  }

  // ---- 医疗：治疗量 +10%（每 5 层额外 +1%）；3 人档：治疗量再 +50%，治疗 <50% 血线干员时再 +50% ----
  // 治疗量走 MUL 键 healingDealtMul（damage.js heal：amount × source.healingDealtMul × target.healingTakenMul，
  // 与医疗芯片同通道，只放大「这名医疗治别人」的量）。
  // 用户 2026-10-14 规格：
  //   治疗量 +(20 + 每层×1)%（原来是每5层+5%，数值等价，改成显式每层）
  //   <在场3名不同【医疗】干员>治疗量溢出时，对应目标获得溢出治疗量 (60 + 每层×0.8)% 的护盾
  //   （原「额外+50%」「低血量额外+50%」两项按新规格删除）
  if (S.bondActive(battle, pid, 'medicShip')) {
    const bb = bbOf('medicShip');
    const t = tier(battle, pid, 'medicShip');
    const apply = () => {
      const perLayer = num(bb.heal_per_layer, num(bb.heal_per_5_layers, 0.05) / 5);
      const mul = 1 + num(bb.base_heal, 0.20) + perLayer * L(battle, pid, 'medicShip');
      for (const u of ops()) {
        if (S.isMember(battle, u, 'medicShip')) S.passiveBuff(battle, u, 'bond:medicShip', { healingDealtMul: mul });
        else battle.removeBuff(u, 'bond:medicShip');
      }
    };
    apply();
    const st = S.battleStore(battle, 'medicShip:refresh', () => ({ hooked: false }));
    if (!st.hooked) {
      st.hooked = true;
      battle.on('layerGain', (c) => { if (c.playerId === pid) battle.after(0, apply); }, { priority: -100 });
    }

    // 3 人档：治疗溢出 → 目标获得 (60 + 每层×0.8)% 溢出量的护盾
    if (t >= 2) {
      battle.on('heal', (ctx) => {
        const src = ctx.source, tg = ctx.target;
        if (!src || src.ownerId !== pid || src.kind !== 'op' || !tg || tg.kind !== 'op') return;
        if (!S.isMember(battle, src, 'medicShip')) return;
        if (tier(battle, pid, 'medicShip') < 2) return;
        // 'heal' 在钳制前发出（ctx.amount 是结算倍率后的治疗量，target.hp 尚未回），溢出 = amount − (max − hp)
        const overflow = num(ctx.amount) - Math.max(0, tg.s.maxHp - tg.hp);
        if (!(overflow > 0)) return;
        const ratio = num(bb.shield_base, 0.60) + num(bb.shield_per_layer, 0.008) * L(battle, pid, 'medicShip');
        const val = overflow * ratio;
        if (!(val > 0)) return;
        const key = `bond:medicShip:shield#${src.id}`;
        const cur = tg.findBuff(key);
        if (cur) { cur.shield = (cur.shield || 0) + val; tg.markDirty(); }
        else battle.addBuff(tg, { key, shield: val, duration: Infinity, visible: true, source: src, tags: ['bond'] });
      });
    }
  }

  // ---- 辅助：攻击范围内敌方**移动速度** -（10 + 每层*0.2）%（_bonds-mod.txt 只写移速，不写防御/法抗）；
  //      3 人档：攻击范围内**我方**攻击速度 +（15 + 每层*0.5）
  if (S.bondActive(battle, pid, 'supportShip')) {
    const bb = bbOf('supportShip');
    const t = tier(battle, pid, 'supportShip');
    const lv = L(battle, pid, 'supportShip');
    const slow = num(bb.base_move_slow, 0.10) + num(bb.move_slow_per_layer, 0.002) * lv;
    supportAura(battle, pid, { moveMul: Math.max(0, 1 - slow) });
    if (t >= 2) {
      const aspd = num(bb.t2_ally_aspd_base, 15) + num(bb.t2_ally_aspd_per_layer, 0.5) * lv;
      supportOwnAura(battle, pid, { aspd });
    }
  }

  // ---- 特种：redeploy ×(1−(10%+0.4%/层)) + 免费部署概率（15%+0.4%/层）；3 人档部署后 ATK +（10%+1%/层）----
  if (S.bondActive(battle, pid, 'specialShip')) {
    const bb = bbOf('specialShip');
    const t = tier(battle, pid, 'specialShip');
    const lv = L(battle, pid, 'specialShip');
    const mul = Math.max(0.05, 1 - num(bb.base_deploy, 0.10) - num(bb.deploy_per_layer, 0.004) * lv);
    const freeP = Math.min(1, num(bb.free_prob, 0.15) + num(bb.free_prob_per_layer, 0.004) * lv);
    for (const u of ops()) if (S.isMember(battle, u, 'specialShip')) {
      S.passiveBuff(battle, u, 'bond:specialShip', { redeployMul: mul });
      // 引擎侧读这个 buff 的 mods.freeDeployChance 来掷骰（见 sim/battle/deploy.js _freeDeployRoll）
      S.passiveBuff(battle, u, 'bond:specialShip:free', { freeDeployChance: freeP });
    }
    if (t >= 2) {
      const atkMods = S.directMods({ atk: num(bb.t2_atk, 0.10) + num(bb.t2_atk_per_layer, 0.01) * L(battle, pid, 'specialShip') });
      battle.on('deploy', ({ unit }) => {
        if (unit?.ownerId !== pid || unit.kind !== 'op' || !S.isMember(battle, unit, 'specialShip')) return;
        S.passiveBuff(battle, unit, 'bond:specialShip:atk', atkMods);
      });
    }
  }

  // ---- 复合：狙击术师（tier 由两个组成盟约驱动：各 2 人 → T1、各 3 人 → T2；层数取 (狙击+术师)/2）----
  //   T1「<2人档> 狙击与术师干员攻击力 +(20 + 每层*1)%」
  //   T2「<3人档> 狙击与术师干员攻击附带的**元素损伤效果可共存**且效果提升 (10 + 每层*0.5)%」
  //      共存 = 两个职业的元素附加（狙击的侵蚀 / 术师的灼燃）同时生效；
  //      提升 = 两边的元素损伤量与元素伤害增幅都 ×(1 + M)。
  if (S.bondActive(battle, pid, 'sncasterShip')) {
    const bb = bbOf('sncasterShip');
    const t = tier(battle, pid, 'sncasterShip');
    const half = (L(battle, pid, 'sniperShip') + L(battle, pid, 'casterShip')) / 2;
    if (t >= 1) {
      const mods = S.directMods({ atk: num(bb.t1_atk, 0.2) + half * num(bb.t1_atk_per_layer, 0.01) });
      for (const u of ops()) if (S.isMember(battle, u, 'sniperShip') || S.isMember(battle, u, 'casterShip')) S.passiveBuff(battle, u, 'bond:sncasterShip', mods);
    }
    if (t >= 2) {
      const amp = 1 + (num(bb.t2_elem_amp_base, 10) + half * num(bb.t2_elem_amp_per_layer, 0.5)) / 100;
      sniCasterCoexist(battle, pid, amp);
    }
  }

  // ---- 复合：近卫重装
  //   <各3人档 = tier2> 防御力 +(25 + 每层*0.8)%；攻击额外附带「防御力数值*0.5」的法术伤害
  //   <各2人档 = tier1> 非近卫/重装干员受伤时，所受伤害部分由近卫(20%)与重装(30%)承担；
  //                     近卫/重装受伤时来源受反伤 + 脆弱；层数取 (近卫+重装)/2
  // 用户 2026-10-14 规格：两档顺序与旧实现相反 —— 防御/附带伤害在**各 3 人档**，分担在**各 2 人档**。
  if (S.bondActive(battle, pid, 'warrtankShip')) {
    const bb = bbOf('warrtankShip');
    const t = tier(battle, pid, 'warrtankShip');
    const half = (L(battle, pid, 'warriorShip') + L(battle, pid, 'tankShip')) / 2;
    if (t >= 2) {
      // 各 3 人档：防御力 + 攻击附带「防御力*0.5」法术伤害（规格无「阻挡数+1」）
      const mods = S.directMods({ def: num(bb.t1_def, 0.25) + half * num(bb.t1_def_per_layer, 0.008) });
      for (const u of ops()) if (isWarrtank(battle, u)) S.passiveBuff(battle, u, 'bond:warrtankShip', mods);
      const scale = num(bb.t1_def_dmg_scale, 0.5);
      if (scale > 0) {
        battle.on('hit', ({ source, target, dmg }) => {
          if (!source || source.ownerId !== pid || source.kind !== 'op' || !target?.alive) return;
          if (dmg?.suiExtra || !dmg?.isAttack) return;
          if (!isWarrtank(battle, source)) return;
          const def = Math.max(0, source.s?.def ?? 0);
          const add = def * scale;
          if (!(add > 0)) return;
          const d = battle.makeDamage({ amount: add, type: 'arts', tags: ['bond:wt:defdmg'] });
          d.suiExtra = true;
          battle.dealDamage(source, target, d);
        });
      }
    }
    if (t >= 1) {
      // 分担：非近卫重装干员每次受伤，按**来源职业**分成两份 —— 近卫承担 shareW、重装承担 shareT
      //（_bonds-mod.txt：近卫分担 20%、重装分摊 30%）。两段式照坚守 redirect：
      // 'hit' 先砍掉总额并打标记，'damaged' 再按在场近卫/重装各自平均分摊。
      // 反伤：近卫/重装干员受伤时，来源受到 (850+10*层数) 法术伤害（无来源），每 0.2 秒至多 1 次/人，并附 4 秒 50% 脆弱。
      const shareW = Math.max(0, Math.min(1, num(bb.t2_share_warrior, 0.2)));
      const shareT = Math.max(0, Math.min(1, num(bb.t2_share_tank, 0.3)));
      const ratio = Math.max(0, Math.min(1, shareW + shareT));
      battle.on('hit', (c) => {
        const tg = c.target, dmg = c.dmg;
        if (!tg || tg.side !== 'ally' || tg.kind !== 'op' || tg.ownerId !== pid || !dmg || dmg.cancel) return;
        if (dmg.wtShare || dmg.wtThorn || dmg.wtCut || c.type === 'element') return;
        if (isWarrtank(battle, tg)) return;
        // 分担属「各 2 人档」（tier1）
        if (tier(battle, pid, 'warrtankShip') < 1) return;
        let any = false;
        for (const u of ops()) if (isWarrtank(battle, u) && S.onField(u)) { any = true; break; }
        if (!any) return;
        if (!(ratio > 0) || ratio >= 1) return;
        dmg.mul *= 1 - ratio;
        dmg.wtCut = ratio;
      }, { priority: -20 });
      battle.on('damaged', (c) => {
        const tg = c.target, dmg = c.dmg;
        if (!tg || tg.side !== 'ally' || tg.kind !== 'op' || tg.ownerId !== pid || !dmg) return;
        if (dmg.wtCut) {
          const cut = dmg.wtCut;
          dmg.wtCut = 0;
          const total = (num(c.amount) / (1 - cut)) * cut;
          if (!(total > 0)) return;
          // 按职业分组，各自平均分摊
          const wars = [], tanks = [];
          for (const u of ops()) {
            if (!S.onField(u)) continue;
            if (S.isMember(battle, u, 'warriorShip')) wars.push(u);
            else if (S.isMember(battle, u, 'tankShip')) tanks.push(u);
          }
          const parts = [];
          if (wars.length && shareW > 0) for (const m of wars) parts.push([m, total * shareW / cut / wars.length]);
          if (tanks.length && shareT > 0) for (const m of tanks) parts.push([m, total * shareT / cut / tanks.length]);
          for (const [m, amt] of parts) {
            if (!(amt > 0)) continue;
            const d = battle.makeDamage({ amount: amt, type: 'true', canDodge: false, tags: ['bond:wt:share'] });
            d.wtShare = true;
            d.suiExtra = true;
            battle.dealDamage(null, m, d);
          }
          return;
        }
        if (dmg.wtShare || dmg.wtThorn || c.type === 'element' || isHpLoss(dmg) || !isWarrtank(battle, t)) return;
        // 反伤同属「各 2 人档」
        if (tier(battle, pid, 'warrtankShip') < 1) return;
        const last = t.mem['bond:warrtank:cd'] ?? -Infinity;
        if (battle.time - last < num(bb.cd, 0.2) - 1e-9) return;
        t.mem['bond:warrtank:cd'] = battle.time;
        const src = c.source;
        if (!src || src.side !== 'enemy' || !src.alive) return;
        const half = (L(battle, pid, 'warriorShip') + L(battle, pid, 'tankShip')) / 2;
        const d = battle.makeDamage({ amount: num(bb.t2_thorns_base, 850) + num(bb.t2_thorns_per, 10) * half, type: 'arts', canDodge: false, sourceless: true });
        d.wtThorn = true;
        d.suiExtra = true;
        battle.dealDamage(t, src, d);
        if (src.alive) battle.applyStatus(src, 'fragile', { duration: num(bb.t2_weak_time, 4), value: num(bb.t2_weak, 0.5), source: t });
      });
    }
  }

  // ---- 复合：先锋医疗（档位 = 复合盟约自身 tier）----
  //   <各2人档 = tier1> 技力回复加成 ×1.5；休整期结束给所有已激活盟约 +（4 + 每层*0.2）层
  //                    （层数取 (先锋+医疗)/2，小数累积合并发放 —— 见 match/match/factions.js _suiPrepEnd）
  //   <各3人档 = tier2> ① 先锋每回复 3 点部署费用 → 全体医疗干员 +1 技力
  //                    ② 医疗治疗溢出 → 70% 溢出量转化为伤害（上限 = 目标生命上限）
  //                    ③ 我方干员倒下时，剩余部署费用 > 该干员下次部署费用×3 → 立刻复活，血量恢复 100%
  //   用户 2026-10-14 规格。
  if (S.bondActive(battle, pid, 'vangmedShip')) {
    const bb = bbOf('vangmedShip');
    const t = tier(battle, pid, 'vangmedShip');
    if (t >= 1) {
      for (const u of ops()) {
        if (!S.isMember(battle, u, 'vanguardShip') && !S.isMember(battle, u, 'medicShip')) continue;
        const cur = u.findBuff('bond:vanguardShip');
        const base = cur?.mods?.spRecoveryMul ?? 1;
        S.passiveBuff(battle, u, 'bond:vangmedShip', { spRecoveryMul: 1 + (base - 1) * num(bb.t1_sp_mul, 1.5) });
      }
    }
    if (t >= 2) {
      // ① 先锋回费 → 医疗回技力：每累计回复 `dp_per_sp`(=3) 点部署费用，全体医疗干员 +`sp_per_dp`(=1) 技力。
      // 引擎的自然回费（flags.dpPerSec）直接写 ps.dp、不派发事件，所以这里按帧观察 ps.dp 的增量
      //（与 lifecycle.js 的 ps.dp = min(dpMax, dp + dpPerSec*dt) 同源；扣费/被抽费只会让增量 ≤ 0，自然被跳过）。
      const dpPer = Math.max(1, num(bb.dp_per_sp, 3));
      const spPer = num(bb.sp_per_dp, 1);
      if (spPer > 0) {
        const st = S.battleStore(battle, 'vangmed:dp', () => ({ pool: 0, last: null }));
        battle.every(0.25, () => {
          const ps = battle.getPlayer(pid);
          if (!ps) return;
          const dp = num(ps.dp, 0);
          if (st.last == null) { st.last = dp; return; }   // 首帧只记基线
          const gain = dp - st.last;
          st.last = dp;
          if (!(gain > 0)) return;
          st.pool += gain;
          const times = Math.floor(st.pool / dpPer);
          if (times <= 0) return;
          st.pool -= times * dpPer;
          for (const u of ops()) {
            if (!S.isMember(battle, u, 'medicShip')) continue;
            if (!S.onField(u) || !u.skill) continue;
            u.skill.gainSp(spPer * times, 'bond:vangmed');
          }
        });
      }

      // ② 医疗治疗溢出 → 70% 转化为伤害
      // 「【医疗】干员治疗后若本次治疗量溢出，溢出量的一部分**造成伤害**（上限 = 目标生命上限）」
      //  伤害打给**被治疗者攻击范围内**的敌人，上限按「目标生命上限」钳制（同一名医疗干员本场累计）避免滚雪球。
      const conv = num(bb.t2_overflow_dmg, 0.7);
      // 'heal' 在钳制前发出（ctx.amount = 结算倍率后的治疗量，target.hp 尚未回），溢出 = amount − (max − hp)。
      battle.on('heal', (ctx) => {
        const src = ctx.source, tg = ctx.target;
        if (!src || src.ownerId !== pid || src.kind !== 'op' || !tg || tg.kind !== 'op' || tg.ownerId !== pid) return;
        if (!S.isMember(battle, src, 'medicShip')) return;
        if (tier(battle, pid, 'vangmedShip') < 2) return;
        const overflow = ctx.amount - Math.max(0, tg.s.maxHp - tg.hp);
        if (!(overflow > 0) || !(conv > 0)) return;
        const key = `bond:vangmedShip:ovf:${src.id}`;
        const cap = tg.s.maxHp;                        // 上限 = 目标生命上限
        const used = src.mem[key] ?? 0;
        const dmgAmt = Math.min(overflow * conv, Math.max(0, cap - used));
        if (!(dmgAmt > 0)) return;
        src.mem[key] = used + dmgAmt;
        // 打给被治疗者攻击范围内的敌人（没有则记在治疗者范围内）
        const keys = tg.rangeKeySet ?? tg.rangeKeys ?? src.rangeKeySet ?? src.rangeKeys;
        const foes = keys ? battle.enemiesInKeys(keys, src, { canHitFly: true }) : [];
        const first = foes[0];
        if (!first) return;
        const d = battle.makeDamage({ amount: dmgAmt, type: 'true', canDodge: false, tags: ['bond:vm:overflow'] });
        d.suiExtra = true;
        battle.dealDamage(src, first, d);
      });

      // ③ 我方干员倒下 → 剩余部署费用 > 下次部署费用×3 时立刻复活，血量恢复 100%
      // 复用引擎的 reviveNow（items/battle.js）：它要求 c.reason === 'killed'，并走 battle.redeploy(u, {free:true})。
      const reviveMul = num(bb.revive_cost_mul, 3);
      battle.on('death', (c) => {
        const u = c && c.unit;
        if (!u || u.kind !== 'op' || u.ownerId !== pid) return;
        if (tier(battle, pid, 'vangmedShip') < 2) return;
        if (battle.over) return;
        const cost = num(u.s?.cost, 0);
        const ps = battle.getPlayer(pid);
        const have = num(ps?.dp, 0);
        if (!(have > cost * reviveMul)) return;
        reviveNow(battle, c, 'bond:vangmed');
      });
    }
  }

  // ---- 复合：特种辅助
  //   <各3人档 = tier2> 攻击范围内**敌方**攻击速度 -(10 + 每层*0.5)
  //   <各2人档 = tier1> 攻击范围内**敌方**受到伤害 +(10% + 每层*1%)；层数取 (特种+辅助)/2
  // 用户 2026-10-14 规格：两档顺序与旧实现相反 —— 攻速削减在**各 3 人档**，受到伤害提升在**各 2 人档**。
  if (S.bondActive(battle, pid, 'spcsupShip')) {
    const bb = bbOf('spcsupShip');
    const t = tier(battle, pid, 'spcsupShip');
    const half = (L(battle, pid, 'specialShip') + L(battle, pid, 'supportShip')) / 2;
    if (t >= 2) {
      // 各 3 人档：敌方攻速降低（固定值减 aspd）
      const cut = num(bb.t1_aspd, 10) + half * num(bb.t1_per_layer, 0.5);
      compEnemyAura(battle, pid, { aspd: -cut }, 'bond:spcsupShip:enemy');
    }
    if (t >= 1) {
      // 各 2 人档：敌方受到伤害提升
      const mul = 1 + num(bb.t2_dmg, 0.10) + half * num(bb.t2_dmg_per_layer, 0.01);
      compEnemyAura(battle, pid, { dmgTakenMul: mul }, 'bond:spcsupShip:fragile');
    }
  }
}

/**
 * 复合特种辅助：成员攻击范围内的**敌方**挂 debuff（0.25s poll，随移动重算）。
 * 与 supportAura 同构，但成员名单取「特种或辅助」两个组成盟约的并集。
 */
function compEnemyAura(battle, pid, mods, key) {
  const poll = () => {
    const next = new Set();
    for (const u of S.playerOps(battle, pid)) {
      if (!S.onField(u)) continue;
      if (!S.isMember(battle, u, 'specialShip') && !S.isMember(battle, u, 'supportShip')) continue;
      for (const e of battle.enemiesInRadius(u.x, u.y, 2.5)) next.add(e);
    }
    const cur = battle._suiCompEnemyAura ?? (battle._suiCompEnemyAura = new Map());
    for (const [e, k] of cur) if (!next.has(e) || k !== key) { battle.removeBuff(e, k); cur.delete(e); }
    for (const e of next) {
      if (cur.get(e) === key) { battle.addBuff(e, { key, mods, refresh: 'replace' }); continue; }
      battle.addBuff(e, { key, mods, refresh: 'replace' });
      cur.set(e, key);
    }
  };
  poll();
  battle.every(0.25, poll);
}

/**
 * 狙击术师 T2（_bonds-mod.txt）：「狙击与术师干员攻击附带的元素损伤效果可共存且效果提升 (10+每层*0.5)%」。
 *
 * 单职业 3 人档的元素附加是**二选一**的（那一次攻击没有元素伤害才附加；有元素就只增幅）。
 * 「可共存」= 狙击干员同时吃两种附加：他自己的侵蚀 + 术师那条灼燃（反之亦然）。
 * 这里给**同时属于任一组成盟约**的干员登记一份「另一种元素」的附加，并把两边的量都 ×amp。
 *
 * 实现：命中时若 dmg 没有元素 → 按己方职业附加对应元素（单职业档已做）；
 *       本函数额外补上**另一种**元素（狙击补灼燃 / 术师补侵蚀），并把本次的元素伤害 ×amp。
 * 用 suiExtra 挡回自身产生的伤害，避免递归。
 */
function sniCasterCoexist(battle, pid, amp) {
  battle.on('hit', ({ source, target, dmg }) => {
    if (!source || source.ownerId !== pid || source.kind !== 'op' || !target?.alive) return;
    if (dmg?.suiExtra) return;
    const isSn = S.isMember(battle, source, 'sniperShip');
    const isCa = S.isMember(battle, source, 'casterShip');
    if (!isSn && !isCa) return;
    // 本次已带元素伤害 → 只放大
    if (dmg.element) { if (amp > 1) dmg.amount *= amp; return; }
    // 无元素 → 共存：把「那一边」的元素也附加上（两边都是就各补一份）
    const snB = bbOf('sniperShip'), caB = bbOf('casterShip');
    const list = [];
    if (isCa) {
      const pen = num(snB.def_pen_flat_base, 50) + num(snB.def_pen_flat_per_layer, 1.2) * L(battle, pid, 'sniperShip');
      list.push({ el: 'erosion', amount: (num(snB.t2_erosion_base, 25) + pen * num(snB.t2_erosion_per_pen, 2)) * amp });
    }
    if (isSn) {
      const pen = num(caB.res_pen_flat_base, 5) + num(caB.res_pen_flat_per_layer, 0.2) * L(battle, pid, 'casterShip');
      list.push({ el: 'burn', amount: (num(caB.t2_burn_base, 25) + pen * num(caB.t2_burn_per_pen, 20)) * amp });
    }
    for (const { el, amount } of list) {
      if (!(amount > 0)) continue;
      const d = battle.makeDamage({ amount, type: 'element', element: el, tags: ['bond'] });
      d.suiExtra = true;
      battle.dealDamage(source, target, d);
    }
  });
}

/**
 * 狙击 / 术师 3 人档（_bonds-mod.txt 2026-10-13）：
 *   「若该次攻击没有附带元素伤害，则攻击对敌方造成 N 的<侵蚀/灼燃>损伤；
 *     若附带元素伤害，则元素伤害提升 M%」
 *
 * 判据是**这次攻击本身**有没有元素伤害：dmg.element 存在即视为「附带元素伤害」。
 *   • 无元素 → 额外施加一份元素损伤（走 applyElement，填对方元素槽），带上 suiExtra 标记防止自触发。
 *   • 有元素 → 放大这一击的元素伤害量（amount 与 mul 都算），也就是「元素伤害提升 M%」。
 * 与 hitExtra 同理，附加的那一份也会再发 'hit'，所以必须用 suiExtra 挡回，否则无限递归。
 */
function sniperCasterT2(battle, pid, el, amount, amp) {
  battle.on('hit', ({ source, target, dmg }) => {
    if (!source || source.ownerId !== pid || source.kind !== 'op' || !target?.alive) return;
    if (dmg?.suiExtra) return;
    if (!S.isMember(battle, source, el === 'erosion' ? 'sniperShip' : 'casterShip')) return;
    if (dmg.element) {
      // 附带元素伤害 → 该次元素伤害提升
      if (amp > 0) dmg.amount *= 1 + amp;
      return;
    }
    // 没有元素伤害 → 附加一份元素损伤（元素槽积累，可触发爆发）
    if (!(amount > 0)) return;
    // type 必须是 'element' —— dealDamage 只看 type 分流，element 字段只是「哪一种元素」。
    // （makeDamageInfo 的 type 缺省是 'phys'，只给 element 会被当成物理伤害。）
    const d = battle.makeDamage({ amount, type: 'element', element: el, tags: ['bond'] });
    d.suiExtra = true;
    battle.dealDamage(source, target, d);
  });
}

/** 每次命中补一段伤害（狙击/术师 3 人档、狙击术师 T2）。成员名单动态判定（部署会变化）。
 *  附加伤害本身也走 dealDamage → 会再发 'hit'：必须打 suiExtra 标记并在入口挡回，否则无限递归（伤害爆炸）。 */
function hitExtra(battle, pid, key, makeDmg, ...profBondIds) {
  battle.on('hit', ({ source, target, dmg }) => {
    if (!source || source.ownerId !== pid || source.kind !== 'op' || !target?.alive) return;
    if (dmg?.suiExtra) return;
    if (!profBondIds.some((b) => S.isMember(battle, source, b))) return;
    const v = makeDmg(source.s.atk);
    // 附加伤害自己也走 dealDamage → 会再发 'hit'：suiExtra 标记挡回，否则无限递归（伤害爆炸）。
    // 经 battle.makeDamage 造标准 DamageInfo 后再补标记（makeDamageInfo 会丢自定义字段，须在 _norm 之后设置）。
    const d = battle.makeDamage({ amount: v.amount, type: v.type, tags: ['bond'] });
    d.suiExtra = true;
    battle.dealDamage(source, target, d);
  });
}

/**
 * 辅助 3 人档（_bonds-mod.txt）：「攻击范围内我方攻击速度提升（15 + 每层*0.5）」。
 * 与 supportAura 同构，但作用对象是**我方**：在每名成员的实际攻击范围（rangeKeys）内的友方 op 挂 aspd buff。
 * 用 0.25s poll 跟随移动/增删（灵巧/辅助的既有做法）。
 */
function supportOwnAura(battle, pid, mods) {
  const KEY_A = 'bond:supportShip:ally';
  const poll = () => {
    const next = new Set();
    for (const u of S.playerOps(battle, pid)) {
      if (!S.isMember(battle, u, 'supportShip') || !S.onField(u)) continue;
      const keys = u.rangeKeySet ?? u.rangeKeys;
      if (!keys) continue;
      for (const a of S.playerOps(battle, pid)) {
        if (a === u || !S.onField(a)) continue;
        if (S.onKeys(a, keys)) next.add(a);
      }
    }
    const cur = battle._suiSupportAllyAura ?? (battle._suiSupportAllyAura = new Map());
    for (const [a] of cur) if (!next.has(a)) { battle.removeBuff(a, KEY_A); cur.delete(a); }
    for (const a of next) {
      S.passiveBuff(battle, a, KEY_A, mods);   // refresh:'replace'，重复挂同一份即可
      if (!cur.has(a)) cur.set(a, true);
    }
  };
  poll();
  battle.every(0.25, poll);
}

/** 辅助 debuff aura：成员在场时，其攻击范围内敌方挂 DEF/RES/移速 debuff（0.25s poll）。 */
function supportAura(battle, pid, mods) {
  const poll = () => {
    const next = new Set();
    for (const u of S.playerOps(battle, pid)) {
      if (!S.isMember(battle, u, 'supportShip') || !S.onField(u)) continue;
      for (const e of battle.enemiesInRadius(u.x, u.y, 2.5)) next.add(e);
    }
    const cur = battle._suiSupportAura ?? (battle._suiSupportAura = new Map());
    for (const [e] of cur) if (!next.has(e)) { battle.removeBuff(e, 'bond:supportShip:debuff'); cur.delete(e); }
    for (const e of next) {
      if (cur.has(e)) continue;
      battle.addBuff(e, { key: 'bond:supportShip:debuff', mods, refresh: 'replace' });
      cur.set(e, true);
    }
  };
  poll();
  battle.every(0.25, poll);
}


export function registerMeta() { /* 效果全 battle 侧 */ }
export default { install, registerMeta };
