// 赤刃明霄陈 (Ch'en the Dawnstreak) — a 炎 core-bond operator added by this fork.
//
// She is newer than the pinned client revision the other overlays compile from, so her record does not exist
// in tools/rhine-data-source.json / rainbow-data-source.json. Her numbers are therefore transcribed here from
// PRTS (https://prts.wiki/w/赤刃明霄陈) and the client tables are not consulted for her.
//
// 5★ 近卫 / 术战者 (WARRIOR/musha), 炎盟约, tier 5.
// 天赋 形意洞照: 攻击力+13%，攻击速度+13，造成的物理和法术伤害变为弱点伤害
// 天赋 寒暑觉知: 未受到伤害时，每7秒随机治疗自身一定（攻击力的30%~160%）生命值，并闪避下次物理与法术攻击
// 技能 赤霄·奔夜 / 赤霄·绝影-驰 / 赤霄·天喟

export const CHEN_CHAR_ID = 'char_1050_chen3';
export const CHEN_CHESS_KEY = 'chen3';
export const CHEN_BOND = 'yanShip';

/** Elite-2 / Lv90 attributes (@信赖满 攻击+100). */
const ATTRS = Object.freeze({ maxHp: 2910, atk: 770, def: 425, res: 15, cost: 21, blockCnt: 1, bat: 1.25, aspd: 100, respawnTime: 70 });

/** Stage-2 attributes (used for the normal copy at the tier-5 status). */
const ATTRS_E1 = Object.freeze({ maxHp: 2211, atk: 542, def: 352, res: 10, cost: 21, blockCnt: 1, bat: 1.25, aspd: 100, respawnTime: 70 });

/** 天赋 形意洞照 by grade (E2 / E2 with the 3-level module). */
export const CHEN_TALENT_ATK = Object.freeze([0.13, 0.13]);
export const CHEN_TALENT_ASPD = Object.freeze([13, 13]);

/**
 * Her three skills. Each entry carries the per-skill-level blackboard values the kit reads; Lv.4 is the
 * normal copy's level and Lv.7 the 精锐 copy's, exactly like the rest of the roster.
 */
export const CHEN_SKILLS = Object.freeze([
  {
    skillId: 'skchr_chen3_1', name: '赤霄·奔夜', skillType: 'MANUAL', durationType: 'TIME', duration: 18,
    spType: 'INCREASE_WITH_TIME', spCost: 27, initSp: 6, rangeId: '1-1',
    lv4: { atk: 0.65, hits: 2 }, lv7: { atk: 0.80, hits: 2 },
    desc: (b) => `攻击力+${Math.round(b.atk * 100)}%，攻击变为${b.hits}连击，攻击使目标敌人特殊能力失效持续至技能结束`,
  },
  {
    skillId: 'skchr_chen3_2', name: '赤霄·绝影-驰', skillType: 'MANUAL', durationType: 'TIME', duration: 6,
    spType: 'INCREASE_WITH_TIME', spCost: 25, initSp: 10, rangeId: 'x-1',
    lv4: { slashes: 10, atk_scale: 3.9, atk: 2.3, dodge: 0.4 }, lv7: { slashes: 10, atk_scale: 4.3, atk: 2.6, dodge: 0.5 },
    desc: (b) => `对周围最近的1名敌人发动${b.slashes}次斩击，每次造成攻击力${Math.round(b.atk_scale * 100)}%的法术伤害；斩击结束后攻击力+${Math.round(b.atk * 100)}%，获得${Math.round(b.dodge * 100)}%物理和法术闪避`,
  },
  {
    skillId: 'skchr_chen3_3', name: '赤霄·天喟', skillType: 'MANUAL', durationType: 'TIME', duration: 20,
    spType: 'INCREASE_WITH_TIME', spCost: 29, initSp: 12, rangeId: '3-12',
    lv4: { hp_scale: 0.06, min_scale: 5.3, targets: 3, hits: 3, atk_scale: 1.65 }, lv7: { hp_scale: 0.06, min_scale: 5.5, targets: 3, hits: 3, atk_scale: 1.8 },
    desc: (b) => `技能开启时向前释放一道剑气，对穿过的敌人造成其当前生命值${Math.round(b.hp_scale * 100)}%的法术伤害（至少为攻击力的${Math.round(b.min_scale * 100)}%）；攻击范围扩大，每次攻击对最多${b.targets}名地面敌人造成${b.hits}次攻击力${Math.round(b.atk_scale * 100)}%的法术伤害`,
  },
]);

/** 模组 记忆残页 (AFT-X): 未阻挡敌人时攻击速度+8, and the 寒暑觉知 interval drops to 6 s. */
export const CHEN_MODULES = Object.freeze([
  { uniEquipId: 'uniequip_002_chen3', name: '记忆残页', typeName: 'AFT-X', level: 1, isDefault: true, attr: { maxHp: 420, atk: 60 }, aspdUnblocked: 8, healInterval: 6 },
]);

export const CHEN_DEFAULT_SKILL = 'skchr_chen3_3';
export const CHEN_DEFAULT_MODULE = 'uniequip_002_chen3';
export const CHEN_TIER = 5;
export const CHEN_SUB_NAME = '术战者';
export const CHEN_ATTRS = ATTRS;
export const CHEN_ATTRS_E1 = ATTRS_E1;
