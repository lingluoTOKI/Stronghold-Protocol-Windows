import { AccountMeChip } from '../ui/accounts.js';
import { isOwnerName, decorateOwnerName } from '../ui/ownerName.js';
import { enabled as federationEnabled } from '../federation.js';
import { MatchmakingCount } from '../ui/matchmaking.js';
import { Emblem } from './title.js';
import { useHubBackdrop, HubBackdrop, HubRadar, BackdropSettings, BackdropGlyph, backdropTheme } from '../ui/hubBackdrop.js';
// Lobby screen — a hub (owner's request, 2026-10-13): an original backdrop (ui/hubBackdrop.js: generated night scenes or
// the player's own picture) with the game's dot-matrix emblem in the middle, a left column (密钥加入 · tips), a right
// column (缺人同盟 card · S.W.E.E.P.报告 (screens/sweep.js) · 干员调配) and four big entries at the bottom right:
// 独立模拟 / 同盟模拟 / 无限火力 open the start sheet (difficulty 标准/险境/绝境/终极, 无限火力's variant, private room,
// 快速匹配, create), 搜寻队友 opens the room list. The 密钥加入 dialog joins with a 同盟密钥 (recent codes remembered) —
// as a player (加入同盟) or in one of its MAX_SPECTATORS spectator seats (观战: room.spectate, also while its match
// runs; community report #26). The server is picked on the title screen.
//
// Difficulty descriptions come from data/config.json `modes[modeId]` when present, else from the
// official act2autochess `modeDataDict` texts embedded below (desc + effectDescList), so the
// screen is complete before data is generated. Rounds: solo 标准 = 9, everything else 14 (+R15
// hidden core on 险境+), per research 00-INDEX §2. Battlefield pool (`modes[].stages`): 标准 always
// plays 战场#01, 险境 draws one of 8, 绝境 / 终极 one of 7 (m01 excluded).
// Texts go through t() (docs/I18N.md); the module-level tables hold msgids (N_) translated where they are shown, the
// config.json mode texts come localized from data.js.
//
// 开发者入口（本地端 + 开发者模式才显示，见 server/lobby.js 的门禁）：全量模拟 (dev 试验场) 与 无限模拟 (AC-5)。
// 无限模拟也走同一页「选择模拟协议」—— 只是那一页里**只有一张卡**（ENDLESS_CARD / endlessInfo，ProtocolSelect
// 的 `endless`），文案与 终极模拟 (AC-4) 同款（用户 2026-10-17）。

import { ResumeMatchButton } from '../ui/resumeMatch.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, ROOM_CODE_LEN, MAX_SEATS, MAX_SPECTATORS, modeIdFor, ERR, ERR_TEXT,
  ENDLESS_NAME, ENDLESS_CODE, ENDLESS_COLOR } from '../../../shared/constants.js';
import { RANDOM_MODE } from '../../../shared/randomMode.js';
import { html, Button, Icon, MicroLabel, Panel, TextField, PingPill, AvatarFrame, Tooltip, Spinner, DifficultyIcon, doctorNo, InfinityGlyph } from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { GuideButton, openGuide } from '../ui/guide.js';
import { openStats } from './stats.js';
import { SettingsButton, useDevMode } from '../ui/settings.js';
import { PwaInstallButton, fullscreen } from '../ui/device.js';
import { LoadoutButton } from './loadout.js';
import { SweepReport } from './sweep.js';
import { useBondScope, setBondScope } from '../ui/bondScope.js';
import { ProtocolScene } from '../ui/protocolScene.js';
import { SearchPanel, RadarScene, CreateArt, JoinArt } from '../ui/matchFlow.js';
import { useLeave } from '../ui/transitions.js';
import { C2S } from '../../../shared/protocol.js';
import { net, identity } from '../net.js';
import { store, useStore, shallowEqual, loadPref, savePref } from '../store.js';
import { getConfig, getMode, getStage, useData } from '../data.js';
import { t, tc, N_ } from '../../../shared/i18n.js';

// What the server offers: shared/protocol.js is the server's own message list, so a deployment without 搜寻队友 /
// 快速匹配 (match.queue), 无限火力 (room.setRandom), 私密房间 (room.setPrivate) or the public room list (room.list)
// gets the hub without those entries and requests (all four exist here).
const HAS = (type) => !!C2S && Object.hasOwn(C2S, type);
const CAN_QUEUE = HAS('match.queue');
const CAN_FIREPOWER = HAS('room.setRandom');
const CAN_PRIVATE = HAS('room.setPrivate');
const CAN_LIST = HAS('room.list');
// 创建同盟时可带的人机（AI 队友）数量上限：MAX_SEATS 个席位里房主自己占一个
const MAX_BOTS = Math.max(0, MAX_SEATS - 1);
const ALLY_BOTS_PREF = 'lobby.allyBots';
// 开发者功能（dev-ext 移植，2026-10-15）：本地端 welcome.devAllowed 时显示的「全量模拟」入口，
// room.create 强制打这张试验场图（server/lobby.js 门禁：仅本地端 + solo + 已加载的图）。
const FULL_SIM_STAGE = 'dev_full_sim';

/** Official mode texts (activity_table act2autochess.modeDataDict), fallback when config.json is absent. */
export const MODE_TEXT = {
  single: {
    FUNNY: { code: 'AC-1', desc: N_('时长较短的模拟训练'), effects: [N_('可以快速完成作战'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
  multi: {
    FUNNY: { code: 'AC-1', desc: N_('敌方攻击强度较低的模拟训练'), effects: [N_('作战环境较为温和'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
};

/** Battlefield pool per difficulty when config.json is absent (the modes' `stages` lists; same for solo and co-op). */
export const STAGE_POOL = { FUNNY: ['act1autochess_m01'], NORMAL: 8, HARD: 7, ABYSS: 7 };

/**
 * 「无限模拟」AC-5（用户 2026-10-17）：**单独一页**「选择模拟协议」，里面只有它这一张卡 —— 外观与 终极模拟 (AC-4)
 * 完全同款（同一个场景图 / 同一套配色 / 同一张 pcard 骨架），只有三处文案是它自己的：关卡名 AC-5、回合数
 * 「无限回合」、效果两行。卡片的其余字段（关卡名除外）都从 终极模拟 那一档取。
 *
 * 口径就是用户给的四句：「无限模拟 / 敌方攻击强度达到无限的模拟训练 / 开局 ban 同终极模拟 / 作战环境异常困难 /
 * 出现无限的敌人 / AC-5 / 无限回合 / 战场随机（共7）」——
 *  - **开局 BAN 与 终极模拟 同一条**：不再抄一遍数字，第一行效果直接取 AC-4 卡片自己的开头那一行
 *    （config.json `mode_single_abyss.effectDescList[0]`，即「开局 BAN：核心 3 / 附加 4」），改配置就跟着走。
 *  - **战场 7 张 = 终极模拟那一档**（AC-4 的 `stages` 有 7 张）：AC-5 以 AC-4 为底，多出来的只是回合不封顶。
 *  - 对局本身由服务端决定（room.create { endless: true }，仅本地端 + solo）：难度就传 `base` = ABYSS，
 *    于是 BAN 数量 / 战场档 / 敌人强度全部走 终极模拟 那一档，R14 首领打完后由越界成长接手
 *    （shared/constants.js ENDLESS_GROWTH，每回合 hp/atk +20 % 加算）。
 */
export const ENDLESS_CARD = {
  name: ENDLESS_NAME,
  en: 'ENDLESS SIMULATION',
  code: ENDLESS_CODE,
  /** 页面左栏 brief 里那句（沿用独立模拟的说法，与 终极模拟 流程同一句） */
  desc: N_('独自调配资金与干员，以自己的节奏完成整场模拟。'),
  /** 卡片自己的说明（config.json 里各档的 `desc` 那一格） */
  cardDesc: N_('敌方攻击强度达到无限的模拟训练'),
  /**
   * 效果行（第一行不在这里 —— 它跟 终极模拟 走，见 endlessInfo）。
   * 用户 2026-10-17 追加三句（「开始模拟那个界面加些话」）：15 回合起出怪更密、怪更硬、叠层无上限。
   * 前两句与 终极模拟 的越界规则同源（waves.js buildEndlessWave / gamedata.js endlessGrowth，
   * 每回合 hp/atk +20% 加算、出怪槽额外抽本模式全部敌人），第三句对应 ENDLESS_LAYER_CAP（叠层不封顶）。
   */
  effects: [
    N_('作战环境异常困难'),
    N_('出现无限的敌人'),
    N_('15回合开始出怪频率提升'),
    N_('怪物数值提升'),
    N_('无限模拟叠层无上限'),
  ],
  rounds: N_('无限回合'),
  stages: 7,
  /** AC-5 自己的配色（紫）：不能借 ABYSS 的红 —— 借了整页（场景线框 / 卡名 / 高光）就还是 终极模拟 的样子 */
  color: ENDLESS_COLOR,
  /** AC-5 以此为底：开局 BAN、战场档、敌人强度都取这一档的配置 */
  base: 'ABYSS',
};

/**
 * difficultyInfo 的「无限模拟」版本：AC-5 那张卡要显示的全部信息（字段与 difficultyInfo 一一对应，
 * 只多一个 `roundsText` —— 回合数不是数字，卡片改用它来显示「无限回合」）。
 * @param {'solo'|'coop'} [roomMode]
 */
export function endlessInfo(roomMode = 'solo') {
  const abyss = difficultyInfo(roomMode, ENDLESS_CARD.base);
  return {
    code: ENDLESS_CARD.code,
    desc: t(ENDLESS_CARD.cardDesc),
    // 第一行 = 终极模拟卡片的第一行（开局 BAN：核心 3 / 附加 4），与数据同源，不会两边对不上。
    // 其余全部取 ENDLESS_CARD.effects（**整表**，不再写死 [0]/[1] —— 早先只取前两条，
    // 后来追加的「15回合开始出怪频率提升 / 怪物数值提升 / 无限模拟叠层无上限」会静默丢掉）。
    effects: [abyss.effects[0], ...ENDLESS_CARD.effects.map((e) => t(e))].filter(Boolean),
    rounds: null,
    roundsText: t(ENDLESS_CARD.rounds),
    // 无限模拟没有隐秘核心：R14 首领打完直接接着出普通怪（Match 的 endless；phases.js isFinalRound）
    hidden: false,
    stageNote: stageNote(ENDLESS_CARD.stages),
  };
}

/**
 * Display name of a stage: stages.json when it is loaded, else derived from the id (act1 m0N → 战场#0N, act2 m0N → 战场#0(N+4)).
 * From the data name only its 战场#NN part (with a (上半) / (下半) mark) — 'Battlefield #NN (First Half)' in English.
 * @param {string} id e.g. 'act1autochess_m01'
 */
export function stageLabel(id) {
  const rec = getStage(id);
  if (rec && typeof rec.name === 'string' && rec.name) {
    const m = rec.name.match(/^(.*?#\d+(?:\s*[(（][^)）]*[)）])?)/);
    return m ? m[1] : rec.name.split(/\s+/)[0];
  }
  const m = String(id || '').match(/^act(\d)autochess_m(\d+)$/);
  return m ? t('战场#{no}', { no: String(Number(m[2]) + (m[1] === '2' ? 4 : 0)).padStart(2, '0') }) : '';
}

/**
 * The battlefield note of a difficulty (official wording): a single-stage pool is fixed ("战场固定为 战场#01"), a larger
 * one is drawn at random ("战场随机（共8张）").
 * @param {string[] | number | null | undefined} stages the mode's `stages` list (or a count)
 * @returns {string} '' when unknown
 */
export function stageNote(stages) {
  if (Array.isArray(stages)) {
    const ids = stages.filter((s) => typeof s === 'string' && s);
    if (ids.length === 1) { const name = stageLabel(ids[0]); return name ? t('战场固定为 {name}', { name }) : t('战场固定'); }
    return ids.length > 1 ? t('战场随机（共{n}张）', { n: ids.length }) : '';
  }
  return Number.isInteger(stages) && stages > 1 ? t('战场随机（共{stages}张）', { stages }) : '';
}

const MODE_CARDS = [
  {
    id: 'solo', name: N_('独立模拟'), en: 'SOLO SIMULATION', icon: 'user',
    desc: N_('独自调配资金与干员，以自己的节奏完成整场模拟。'),
    points: [N_('1 名博士'), N_('休整期与机变阶段不限时')],
  },
  {
    id: 'coop', name: N_('同盟模拟'), en: 'ALLIANCE SIMULATION', icon: 'users',
    desc: N_('与至多 {n} 名博士组成同盟，共享干员池，联防协作抵御敌潮。'), params: { n: MAX_SEATS - 1 },
    points: [N_('1–{n} 名博士 · 邀请真人队友'), N_('联防阶段 · 最终攻势合并生命值')], pointParams: { n: MAX_SEATS },
  },
  {
    id: 'firepower', name: '无限火力', badge: '1.1', en: 'UNLIMITED FIREPOWER', icon: 'dice',
    desc: '强势干员、技能连发，迎战怪潮与悬赏首领，轻松体验阵营成型的快感。',
    points: [`1–${MAX_SEATS} 名博士 · 邀请真人队友`, `${RANDOM_MODE.totalRounds} 回合娱乐乱斗 · 推荐标准难度`],
  },
];

/** 无限火力分支（随机模式 variant）：快速突袭 9 回合 / 持久鏖战 13 回合。 */
const VARIANT_CARDS = [
  {
    id: 'blitz', name: '快速突袭', en: 'BLITZ', desc: `固定 ${RANDOM_MODE.totalRounds} 回合短局，紧凑刺激的数值节奏。`,
  },
  {
    id: 'endurance', name: '持久鏖战', en: 'ENDURANCE', desc: `固定 ${RANDOM_MODE.endurance.totalRounds} 回合长局，曲线平滑拉长，供深度养成构筑。`,
  },
  { id: 'marathon', name: '最长时赛', en: 'MARATHON', desc: `固定 ${RANDOM_MODE.marathon.totalRounds} 回合超长局，逐回合悬赏，极限养成拉锯。` },
];

/** 随机模式分支偏好（localStorage）。 */
export function firepowerVariantPreference() {
  const v = loadPref('lobby.firepowerVariant', 'blitz');
  return v === 'endurance' || v === 'marathon' ? v : 'blitz';
}

/** A presentation choice; the protocol still uses solo/coop plus Room.random. */
export function lobbySimulationPreference() {
  const selected = loadPref('lobby.simulation', null);
  if (MODE_CARDS.some((c) => c.id === selected)) return selected;
  // Preserve the old random toggle, including random solo preferences, as the new dedicated mode.
  if (loadPref('lobby.random', false) === true) return 'firepower';
  return loadPref('lobby.mode', 'coop') === 'solo' ? 'solo' : 'coop';
}

function preferredDifficulty(simulation) {
  const key = simulation === 'firepower' ? 'lobby.firepowerDifficulty' : 'lobby.difficulty';
  const d = loadPref(key, 'FUNNY');
  return DIFFICULTIES.includes(d) ? d : 'FUNNY';
}

/** Keep the explanation tied to the shared balance configuration. */
export function firepowerFeatures(variant = 'blitz') {
  const { multipliers, firepower, shop, lowTier, band, rounds, endurance, marathon, evolution, opening } = RANDOM_MODE;
  const v = variant === 'endurance' ? endurance : variant === 'marathon' ? marathon : { totalRounds: RANDOM_MODE.totalRounds, leaders: rounds.leaders };
  const leaderRounds = Object.keys(v.leaders).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const bossSpan = leaderRounds.length ? `第 ${leaderRounds[0]}–${leaderRounds.at(-1)} 回合` : '中后段回合';
  return [
    { title: '强势阵营', text: `开局逐轮发放无限火力模组：装备后生命与攻击 ×${opening.modBuff.hpMul}，防御提升 ${Math.round((opening.modBuff.defMul - 1) * 100)}%，每场可复活一次；盟约层数无上限成长。` },
    { title: '技能回转', text: `全员技力恢复加速 ${Math.round((firepower.spRecoveryMul - 1) * 100)}%，保留原生技能轴；再部署缩短 ${Math.round((1 - firepower.redeployMul) * 100)}%。` },
    { title: '开局成型', text: `${shop.startLevel} 级商店、${shop.startFunds} 资金开局；干员盲盒 ${shop.revealChoices} 选 1，部署上限 9 人，每人 ${band.picksPerPlayer} 个策略。` },
    { title: '阶段质变', text: `第 ${evolution.rounds.join('/')} 回合休整期三选一：层数共鸣 / 生机坚壁 / 军备充盈。` },
    { title: '轻松也有挑战', text: `${v.totalRounds} 回合密集怪潮，${bossSpan}悬赏首领轮换；每回合随机效果，${lowTier.lowTierMax} 阶及以下干员也有额外强化。` },
  ];
}

function FirepowerBrief({ variant, onVariant }) {
  const rounds = variant === 'endurance' ? RANDOM_MODE.endurance.totalRounds : variant === 'marathon' ? RANDOM_MODE.marathon.totalRounds : RANDOM_MODE.totalRounds;
  return html`<aside class="firepower-brief brackets" aria-label="无限火力模式特点">
    <div class="firepower-brief__head">
      <span class="firepower-brief__title">无限火力</span><span class="mode-beta">1.1</span>
      <span class="firepower-brief__hint">从标准难度开始，享受阵营成型与技能清场</span>
    </div>
    <div class="firepower-variants" role="radiogroup" aria-label="模式分支">
      ${VARIANT_CARDS.map((c) => html`<button key=${c.id} type="button" role="radio" aria-checked=${variant === c.id ? 'true' : 'false'}
          class=${`firepower-variant${variant === c.id ? ' is-selected' : ''}`} onClick=${() => onVariant(c.id)}>
        <span class="firepower-variant__name">${c.name}<span class="firepower-variant__en">${c.en}</span></span>
        <span class="firepower-variant__desc">${c.desc}</span>
      </button>`)}
    </div>
    <div class="firepower-features">${firepowerFeatures(variant).map((f) => html`<div key=${f.title} class="firepower-feature">
      <strong>${f.title}</strong><p>${f.text}</p>
    </div>`)}</div>
  </aside>`;
}

/**
 * Text for a difficulty card, preferring data/config.json.
 * @param {'solo'|'coop'} roomMode
 * @param {string} difficulty
 * @param {{ random?: boolean, variant?: string }} [opts] 随机模式: the room's random flag + variant — the variant's
 *   round count (RANDOM_MODE / variantRounds: blitz 9 / endurance 13) replaces the config's lastRound everywhere
 *   the count is shown.
 * @returns {{ code: string, desc: string, effects: string[], rounds: number, hidden: boolean, stageNote: string }}
 */
export function difficultyInfo(roomMode, difficulty, { random = false, variant = 'blitz' } = {}) {
  const fallback = MODE_TEXT[roomMode === 'single' || roomMode === 'solo' ? 'single' : 'multi'][difficulty] || { code: '', desc: '', effects: [] };
  // modeIdFor() lower-cases the difficulty: never call it with a value the server did not validate.
  const m = DIFFICULTIES.includes(difficulty) ? getMode(modeIdFor(roomMode, difficulty)) : null;
  const effects = Array.isArray(m?.effectDescList)
    ? m.effectDescList.map((e) => String(e).replace(/^[·•\s]+/, '')).filter(Boolean)
    : fallback.effects;
  // 随机模式: the whole run is the variant's rounds (server GameData.applyRandomRounds; variantRounds)
  const rounds = random
    ? (variant === 'endurance' ? RANDOM_MODE.endurance.totalRounds : variant === 'marathon' ? RANDOM_MODE.marathon.totalRounds : RANDOM_MODE.totalRounds)
    : Number.isFinite(m?.lastRound) ? m.lastRound : roomMode === 'solo' && difficulty === 'FUNNY' ? 9 : 14;
  return {
    code: typeof m?.code === 'string' ? m.code : fallback.code,
    desc: typeof m?.desc === 'string' ? m.desc : t(fallback.desc),
    effects,
    rounds,
    hidden: !random && difficulty !== 'FUNNY',
    stageNote: stageNote(Array.isArray(m?.stages) && m.stages.length ? m.stages : STAGE_POOL[difficulty]),
  };
}

const CODE_RE = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LEN}}$`);
/**
 * Normalise user input into a room code: accepts a pasted invite link (`…?room=ABCD`), keeps
 * upper-cased alphanumerics and clamps to the code length.
 * @param {string} v
 * @returns {string}
 */
export function normalizeCode(v) {
  let s = String(v ?? '');
  const m = s.match(/[?&]room=([A-Za-z0-9]+)/);
  if (m) s = m[1];
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LEN);
}

/**
 * A handler that Preact binds as `onClick=${fn}` receives the click EVENT as its first argument, and a default
 * parameter only applies to `undefined` — so `fn(c = code)` would normalise the event target into a nonsense code
 * (`String(el)` → `"[object HTMLElement]"` → "OBJE"). Only a string is ever a code; anything else falls back to the
 * input field. Returns null when neither yields a well-formed code.
 * @param {unknown} arg the argument a handler was called with
 * @param {string} field the current input-field value
 * @returns {string|null}
 */
export function codeArg(arg, field) {
  const k = normalizeCode(typeof arg === 'string' ? arg : field);
  return CODE_RE.test(k) ? k : null;
}

/**
 * Room code from a deep link query string (`?room=CODE`), or null when absent/malformed.
 * Accepts ROOM_CODE_LEN..ROOM_CODE_LEN+2 alphanumerics (the protocol's join limit).
 * @param {string} search e.g. location.search
 * @returns {string|null}
 */
export function parseRoomParam(search) {
  try {
    const raw = new URLSearchParams(search || '').get('room');
    if (!raw) return null;
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]+$/.test(code)) return null;
    return code.length >= ROOM_CODE_LEN && code.length <= ROOM_CODE_LEN + 2 ? code : null;
  } catch {
    return null;
  }
}

/** Recently joined/created co-op room codes (most recent first). */
export function recentRooms() {
  const list = loadPref('recentRooms', []);
  return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && CODE_RE.test(c)).slice(0, 4) : [];
}

/** @param {string} code */
export function rememberRoom(code) {
  if (!CODE_RE.test(code)) return;
  savePref('recentRooms', [code, ...recentRooms().filter((c) => c !== code)].slice(0, 4));
}

const FALLBACK_TIPS = [
  N_('联合模拟在选择策略时可以进行一次跳过'),
  N_('调度中心即使冻结，依然可以主动刷新'),
  N_('两件同名装备可以合成一件更强力的装备'),
  N_('只有达成完美作战的队友可以进行联防'),
];
const TIP_ROTATE_MS = 5000; // matchingTipRotateInterval

/** Rotating tactical tips (config.json `tips`, weighted list of { tip, weight }). */
function TipsPanel() {
  const cfg = getConfig();
  const fallback = FALLBACK_TIPS.map((x) => t(x));
  const tips = Array.isArray(cfg?.tips)
    ? cfg.tips.map((x) => (typeof x === 'string' ? x : x?.tip)).filter((x) => typeof x === 'string' && x)
    : fallback;
  const list = tips.length ? tips : fallback;
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * list.length));
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => i + 1), TIP_ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  const i = ((idx % list.length) + list.length) % list.length;
  return html`<div class="tips brackets">
    <div class="tips__head">
      <${Icon} name="info" />
      <span>${t('作战提示')}</span>
      <${MicroLabel}>TACTICAL TIPS<//>
      <span class="tips__idx num">${String(i + 1).padStart(2, '0')}<span class="t-dim">/${String(list.length).padStart(2, '0')}</span></span>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i - 1 + list.length)} aria-label=${t('上一条')}><${Icon} name="chevronLeft" /></button>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i + 1)} aria-label=${t('下一条')}><${Icon} name="chevronRight" /></button>
    </div>
    <p key=${i} class="tips__text">${list[i]}</p>
  </div>`;
}

/**
 * 缺人同盟: public alliance rooms still waiting for doctors, fewest empty seats first (closest to starting), joinable in
 * one click. A fixed-height card — three rows, or an empty note with a shortcut to create one.
 */
export function recruitingRooms(rooms) {
  return (Array.isArray(rooms) ? rooms : [])
    .filter((r) => r && typeof r.code === 'string' && !r.inMatch && r.humans > 0 && r.humans < (r.maxSeats || MAX_SEATS))
    .sort((a, b) => ((a.maxSeats || MAX_SEATS) - a.humans) - ((b.maxSeats || MAX_SEATS) - b.humans) || b.humans - a.humans);
}

function RecruitCard({ rooms, online, onJoin, onAll, onCreate }) {
  const open = recruitingRooms(rooms);
  return html`<section class="hub-recruit" aria-label=${t('缺人同盟')}>
    <header class="hub-recruit__head">
      <span class=${`hub-recruit__pulse${open.length ? ' is-live' : ''}`} aria-hidden="true"></span>
      <span class="hub-recruit__title">${t('缺人同盟')}</span>
      <span class="hub-recruit__en">RECRUITING</span>
      <span class="hub-recruit__n num">${open.length}</span>
      <button type="button" class="hub-recruit__all" onClick=${onAll}>${t('全部')}<${Icon} name="chevronRight" /></button>
    </header>
    <div class="hub-recruit__list">
      ${open.length ? open.slice(0, 3).map((r) => {
        const max = r.maxSeats || MAX_SEATS;
        const name = r.name || `同盟 #${r.code}`;
        return html`<div key=${`${r.node || ''}:${r.code}`} class="hub-recruit__row" style=${`--d-color:${DIFFICULTY_COLORS[r.difficulty] || 'var(--mint-500)'}`}>
          <span class="hub-recruit__info">
            <span class=${`hub-recruit__name${isOwnerName(r.hostName || r.name) ? ' sp-owner-name' : ''}`}>${name}</span>
            <span class="hub-recruit__meta">
              <${DifficultyIcon} difficulty=${r.difficulty} class="diff-glyph" />
              <span>${DIFFICULTY_NAMES[r.difficulty] ? t(DIFFICULTY_NAMES[r.difficulty]) : r.difficulty}</span>
              ${r.random ? html`<span class="hub-recruit__fp">无限火力</span>` : null}
              ${r.nodeName ? html`<span class="t-dim">${r.nodeName}</span>` : null}
            </span>
          </span>
          <span class="hub-recruit__seats">
            <span class="hub-recruit__pips" aria-hidden="true">${Array.from({ length: max }, (_, i) => html`<i key=${i} class=${i < r.humans ? 'is-on' : ''}></i>`)}</span>
            <span class="hub-recruit__need">${t('缺')}<b class="num">${max - r.humans}</b>${t('人')}</span>
          </span>
          <button type="button" class="hub-recruit__join" disabled=${!online} onClick=${() => onJoin(r.code, r.node)}>${t('加入')}</button>
        </div>`;
      }) : html`<div class="hub-recruit__empty">
        <span>${t('暂时没有缺人的同盟')}</span>
        <button type="button" class="hub-recruit__create" onClick=${onCreate}>${t('创建同盟')}<${Icon} name="chevronRight" /></button>
      </div>`}
    </div>
  </section>`;
}

/** 全屏 / 退出全屏 in the top bar, styled like its neighbours (hidden where the browser has no element fullscreen). */
function HubFullscreenButton() {
  const [on, setOn] = useState(() => fullscreen.active());
  const [ok] = useState(() => fullscreen.supported());
  useEffect(() => {
    const upd = () => setOn(fullscreen.active());
    document.addEventListener('fullscreenchange', upd);
    document.addEventListener('webkitfullscreenchange', upd);
    return () => { document.removeEventListener('fullscreenchange', upd); document.removeEventListener('webkitfullscreenchange', upd); };
  }, []);
  if (!ok) return null;
  const label = on ? t('退出全屏') : t('全屏');
  return html`<${Button} variant="secondary" size="sm" square=${true} icon=${on ? 'collapse' : 'expand'} class="hub-fs-btn"
    title=${label} aria-label=${label} aria-pressed=${on ? 'true' : 'false'} onClick=${() => fullscreen.toggle()} />`;
}

/** Crossed blades in a hexagon: the S.W.E.E.P. plate's glyph (original drawing). */
function SweepGlyph() {
  return html`<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M16 2.5 27.7 9.2v13.6L16 29.5 4.3 22.8V9.2z" fill="none" stroke="currentColor" stroke-width="1.5" />
    <path d="M9 9l12.5 12.5M23 9 10.5 21.5" stroke="currentColor" stroke-width="2.2" />
    <path d="M19.2 23.8l4.6-4.6M8.2 19.2l4.6 4.6M21.6 21.6l2.2 2.2M10.4 21.6l-2.2 2.2" stroke="currentColor" stroke-width="1.8" />
  </svg>`;
}

/** S.W.E.E.P.报告: opens the report (screens/sweep.js — 盟约报告 / 策略报告 / 敌方资料). */
function SweepPlate({ onClick }) {
  return html`<button type="button" class="hub-plate hub-plate--sweep" onClick=${onClick} title=${t('S.W.E.E.P.报告：盟约、策略与敌方资料')}>
    <span class="hub-plate__glyph"><${SweepGlyph} /></span>
    <span class="hub-plate__label">S.W.E.E.P.${t('报告')}</span>
    <span class="hub-plate__tag">REPORT</span>
  </button>`;
}

/** One of the four big entries at the bottom right. */
function HubEntry({ group, name, en, icon, badge, tone = 'mint', count = null, onClick, disabled = false }) {
  return html`<div class="hub-entry-wrap">
    ${group ? html`<span class="hub-entry__group"><${Icon} name=${group.icon} />${group.label}</span>` : html`<span class="hub-entry__group hub-entry__group--blank"></span>`}
    <button type="button" class=${`hub-entry hub-entry--${tone}`} onClick=${onClick} disabled=${disabled}>
      <span class="hub-entry__icon"><${Icon} name=${icon} /></span>
      <span class="hub-entry__en">${en}</span>
      <span class="hub-entry__name">${name}${badge ? html`<span class="mode-beta">${badge}</span>` : null}</span>
      ${count != null ? html`<span class="hub-entry__count"><${MatchmakingCount} count=${count} /></span>` : null}
      <span class="hub-entry__corner" aria-hidden="true"></span>
    </button>
  </div>`;
}

/** A small tile of the side column. */
function HubTile({ icon, label, en, onClick, children }) {
  return html`<button type="button" class="hub-tile" onClick=${onClick}>
    <span class="hub-tile__icon"><${Icon} name=${icon} /></span>
    <span class="hub-tile__text"><span class="hub-tile__label">${label}</span><span class="hub-tile__en">${en}</span></span>
    ${children}
  </button>`;
}

/** Shared frame of the hub's two dialogs (the start sheet, 密钥加入). */
function HubDialog({ open, micro, title, onClose, wide = false, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    addEventListener('keydown', onKey);
    // the lobby chat (z 180, ui/communityChat.js) sits above modals: it steps aside while a hub dialog is open
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, [open]);
  if (!open) return null;
  return html`<div class="modal hub-dialog" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div class=${`modal__box hub-dialog__box brackets${wide ? ' hub-dialog__box--wide' : ''}`} role="dialog" aria-modal="true">
      <div class="modal__stripe" aria-hidden="true"></div>
      <header class="hub-dialog__head">
        <${MicroLabel} tone="mint">${micro}<//>
        <div class="hub-dialog__title-row">
          <h2 class="modal__title">${title}</h2>
          <button type="button" class="mm-modal__close" onClick=${onClose} aria-label="关闭"><${Icon} name="close" /></button>
        </div>
      </header>
      <div class="hub-dialog__body">${children}</div>
    </div>
  </div>`;
}

function DifficultyCard({ roomMode, difficulty, selected, onSelect, matchmaking, random = false, variant = 'blitz' }) {
  const info = difficultyInfo(roomMode, difficulty, { random, variant });
  return html`<button type="button" class=${`diff-card${selected ? ' is-selected' : ''}`}
      style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`} onClick=${() => onSelect(difficulty)} aria-pressed=${selected ? 'true' : 'false'}>
    <span class="diff-card__bar" aria-hidden="true"></span>
    <span class="diff-card__head">
      <${DifficultyIcon} difficulty=${difficulty} class="diff-card__glyph" />
      <span class="diff-card__name">${t(DIFFICULTY_NAMES[difficulty])}</span>
      <span class="diff-card__code num">${info.code}</span>
      ${roomMode === 'coop' && !random ? html`<${MatchmakingCount} count=${matchmaking?.byDifficulty?.[difficulty]} />` : null}
      <span class="diff-card__meta">
        <span class="num">${info.rounds}</span> ${tc('rounds', '回合')}${info.hidden ? html`<span class="diff-card__hidden">${t('+ 隐秘核心')}</span>` : null}
      </span>
    </span>
    <span class="diff-card__desc">${info.desc}</span>
    <span class="diff-card__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}${info.stageNote ? html`<span key="stage" class="diff-card__stage"><${Icon} name="rook" />${info.stageNote}</span>` : null}</span>
    <span class="diff-card__check" aria-hidden="true"><${Icon} name="check" /><span>${t('已选定')}</span></span>
  </button>`;
}

/** The hand-drawn ring of the 已选定 stamp (two loose strokes). */
function StampRing() {
  return html`<svg class="pcard__ring" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
    <path pathLength="1" d="M18 62C6 34 34 8 70 10c34 2 48 30 38 54-10 24-46 32-72 22C20 80 10 66 16 50" />
    <path pathLength="1" d="M30 20c22-14 62-12 78 10 12 18 4 44-16 54" />
  </svg>`;
}

/** 正在加入同盟…: bottom left while the room is being opened, a light running along the bottom edge (css tr-join). */
function JoinLine({ text }) {
  return html`<div class="tr-join" role="status"><span class="tr-join__mark" aria-hidden="true"></span>${text}<span class="tr-join__dots" aria-hidden="true"></span></div>`;
}

/**
 * One difficulty of 选择模拟协议: name, text, effects; the extras (code, rounds, 隐秘核心, battlefields, queue) below.
 * 无限模拟 (AC-5) 复用同一张卡：传 info / name / glyph / color 就换掉整张卡的内容，骨架与 CSS 一个字不动
 * （`info.roundsText` 是给「无限回合」这种非数字回合数用的）。
 */
export function ProtoCard({ roomMode, difficulty, selected, onSelect, matchmaking, random, variant,
  info: infoProp = null, name = null, glyph = null, color = null, glyphNode = null }) {
  const info = infoProp || difficultyInfo(roomMode, difficulty, { random, variant });
  const face = glyph || difficulty;
  return html`<button type="button" class=${`pcard${selected ? ' is-on' : ''}`} style=${`--d-color:${color || DIFFICULTY_COLORS[difficulty]}`}
      onClick=${() => onSelect(difficulty)} aria-pressed=${selected ? 'true' : 'false'}>
    <span class="pcard__glow" aria-hidden="true"></span>
    <span class="pcard__head">
      ${glyphNode || html`<${DifficultyIcon} difficulty=${face} class="pcard__glyph" />`}
      <span class="pcard__name">${t(name || DIFFICULTY_NAMES[difficulty])}</span>
      ${!infoProp && roomMode === 'coop' && !random ? html`<${MatchmakingCount} count=${matchmaking?.byDifficulty?.[difficulty]} />` : null}
    </span>
    <span class="pcard__desc">${info.desc}</span>
    <span class="pcard__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}</span>
    <span class="pcard__meta">
      ${info.code ? html`<span class="num">${info.code}</span>` : null}
      <span>${info.roundsText ? info.roundsText : html`<b class="num">${info.rounds}</b> ${tc('rounds', '回合')}`}${info.hidden ? t(' + 隐秘核心') : ''}</span>
      ${info.stageNote ? html`<span>${info.stageNote}</span>` : null}
    </span>
    <span class="pcard__stamp" aria-hidden="true"><${StampRing} /><span class="pcard__tick"><${Icon} name="check" /></span><span class="pcard__ok">${t('已选定')}</span></span>
  </button>`;
}

/**
 * 模式选择（用户 2026-10-14：与 独立模拟 / 同盟模拟 同规格的一块，放在独立模拟左边）。
 *
 * 两档 = shared/bondScope.js 的显示范围：契约（'mod'，本作新增阵营 + 职业盟约）/ 盟约（'official'，官方阵营）。
 * 与 干员调配 / S.W.E.E.P.报告 共用同一个 store（ui/bondScope.js，localStorage `sp.pref.allianceScope`）——
 * 这里选什么，调配里就只看哪一档的干员，开局时也把这一档随 room.create 带给服务器（对局干员池按档裁剪）。
 *
 * 整块的尺寸、描边、角标与 HubEntry 完全一致（同一个 .hub-entry 骨架），只是内容换成「当前模式 + 两个切换按钮」：
 * 两个档位必须同时可见，否则只能靠点击盲切。
 */
function ModeEntry({ scope, onPick }) {
  const mod = scope !== 'official';
  const chip = (isMod, name, title) => html`<button type="button" role="radio" aria-checked=${(mod === isMod) ? 'true' : 'false'}
      class=${`hub-mode__chip${(mod === isMod) ? ' is-on' : ''}`} data-scope=${isMod ? 'mod' : 'official'}
      title=${title} onClick=${() => onPick(isMod ? 'mod' : 'official')}>${name}</button>`;
  return html`<div class="hub-entry-wrap hub-entry-wrap--mode">
    <span class="hub-entry__group"><${Icon} name="link" />${t('模式选择')}</span>
    <div class=${`hub-entry hub-entry--mode hub-mode--${mod ? 'pact' : 'official'}`} role="radiogroup" aria-label=${t('模式选择')}>
      <span class="hub-entry__icon"><${Icon} name=${mod ? 'link' : 'flag'} /></span>
      <span class="hub-entry__en">${mod ? 'ALLPACT' : 'ALLIANCE'}</span>
      <span class="hub-entry__name">${mod ? t('契约模式') : t('盟约模式')}</span>
      <span class="hub-mode__seg">
        ${chip(true, t('契约'), t('契约模式：本作新增阵营与职业盟约（彩虹小队、莱茵生命、罗德岛、巴别塔、岁、龙门、企鹅物流 …）'))}
        ${chip(false, t('盟约'), t('盟约模式：官方阵营（炎、维多利亚、拉特兰、谢拉格、萨尔贡 …）'))}
      </span>
      <span class="hub-entry__corner" aria-hidden="true"></span>
    </div>
  </div>`;
}

/**
 * 选择模拟协议 (2026-10-13, the owner's request: the event's second screen after 独立模拟): full screen, the picture of
 * the selected difficulty at the left (ui/protocolScene.js, original), the difficulties down the right with the
 * 已选定 stamp, 开始模拟 at the bottom right. Kept from the old start sheet: 无限火力's variants and notes, the private
 * room, 快速匹配, the queue counts, rounds / 隐秘核心 / battlefields and the hints. Esc or ‹ returns to the hub.
 * Comes up from black over the hub (`chained`: straight after 选择同盟方式, already black) and fades back out
 * (ui/transitions.js); the picture is redrawn for each difficulty.
 *
 * `endless`（无限模拟 AC-5，用户 2026-10-17）：同一页，但右栏只有 ENDLESS_CARD 这一张卡（难度选择器不出现），
 * info 走 endlessInfo、场景/配色/图标走 ENDLESS_CARD.base（终极模拟）。其余（标题、brief、开始模拟、Esc 返回）不变。
 */
function ProtocolSelect({ card, roomMode, random, variant, difficulty, onDifficulty, onClose, matchmaking, brief, privateRoom, onPrivate,
  online, maint, busy, isSearching, onCreate, onQueue, purpose = 'create', onSearch, onCancel, mm, onBrowse, chained = false, endless = false }) {
  const [leaving, leave] = useLeave(onClose);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal, .guide')) leave(); };
    addEventListener('keydown', onKey);
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, []);
  const fx = `${leaving ? ' is-leaving' : ''}${chained ? ' is-chained' : ''}`;
  const search = purpose === 'search';
  // 无限模拟 (AC-5)：整页只有它一张卡，难度选择器不出现。
  // **外观也必须是它自己的**（用户 2026-10-17：「点进来为什么还是终极模拟」）：配色换成 AC-5 的紫、
  // 图标换成 ∞、左栏线框换成 protocolScene 的 ENDLESS 版（更多守军 + DEF ∞），不再整套借 终极模拟 的。
  // 对局本身仍按 ABYSS 建（ENDLESS_CARD.base），那是数值口径，跟这一页长什么样无关。
  const face = endless ? ENDLESS_CARD.base : difficulty;
  const color = endless ? ENDLESS_CARD.color : DIFFICULTY_COLORS[face];
  const scene = endless ? 'ENDLESS' : face;
  const info = endless ? endlessInfo(roomMode) : difficultyInfo(roomMode, difficulty, { random, variant });
  const label = maint?.active ? t('维护中 · 暂停开局') : search ? t('开始搜寻') : random ? t('创建无限火力') : roomMode === 'solo' ? t('开始模拟') : t('创建同盟');
  const hint = !online ? t('正在连接服务器…') : maint?.active ? t('服务器即将停机维护，暂时停止开启新的同盟')
    : search ? t('精确搜寻：只与选择相同难度的博士组成同盟，凑齐 4 人即开始')
    : isSearching ? t('正在匹配真人队友，AI 补位已暂停') : roomMode === 'solo' ? t('独自调配阵容，按自己的节奏开始模拟') : t('创建后可邀请好友，AI 队友已暂停');
  // 搜寻队友: while the queue runs, the right column is the 搜寻中 panel (the server's elapsed / matched counts)
  if (search && isSearching) {
    const d = mm?.difficulty && DIFFICULTIES.includes(mm.difficulty) ? mm.difficulty : difficulty;
    return html`<div class=${`proto proto--searching${fx}`} style=${`--d-color:${DIFFICULTY_COLORS[d]}`} data-difficulty=${d} role="dialog" aria-label=${t('搜寻队友')}>
      <div class="proto__bg" aria-hidden="true"></div>
      <header class="proto-top">
        <button type="button" class="proto-back" onClick=${leave} title=${t('返回大厅（继续搜寻）')} aria-label=${t('返回大厅')}>
          <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
        </button>
      </header>
      <div class="proto-body">
        <section class="proto-stage"><${ProtocolScene} key=${d} difficulty=${d} /></section>
        <section class="proto-side proto-side--search">
          <${SearchPanel} elapsed=${mm?.elapsed || 0} onStop=${onCancel} stopping=${busy === 'cancel'}
            note=${t('已找到 {matched}/{target} 名博士', { matched: mm?.matched || 1, target: mm?.target || 4 })}
            tags=${[{ key: 'mode', label: t('精确搜寻'), icon: html`<${Icon} name="search" />` },
              { key: 'diff', label: t(DIFFICULTY_NAMES[d]), color: DIFFICULTY_COLORS[d], icon: html`<${DifficultyIcon} difficulty=${d} />` }]} />
        </section>
      </div>
    </div>`;
  }
  return html`<div class=${`proto${fx}${endless ? ' proto--endless' : ''}`} style=${`--d-color:${color}`} data-difficulty=${scene} role="dialog" aria-label=${t('选择模拟协议')}>
    <div class="proto__bg" aria-hidden="true"></div>
    <header class="proto-top">
      <button type="button" class="proto-back" onClick=${leave} title=${t('返回大厅 (Esc)')} aria-label=${t('返回大厅')}>
        <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
      </button>
      <div class="proto-title">
        <h2>${t('选择模拟协议')}</h2>
        <span class="proto-title__mode">${search ? t('搜寻队友') : t(card.name)}<i>${search ? 'FIND ALLIES' : card.en}</i></span>
      </div>
    </header>
    <div class="proto-body">
      <section class="proto-stage">
        <${ProtocolScene} key=${scene} difficulty=${scene} />
        <div class="proto-brief">
          <span class="proto-brief__code num">${info.code}</span>
          <b class="proto-brief__name">${t(endless ? ENDLESS_CARD.name : DIFFICULTY_NAMES[difficulty])}</b>
          <p>${t(card.desc, card.params)}</p>
        </div>
        ${brief ? html`<div class="proto-fp">${brief}</div>` : null}
      </section>
      <section class="proto-side">
        <div class="proto-list" role="radiogroup" aria-label=${t('模拟难度')}>
          ${endless
            // 无限模拟 (AC-5)：这一页唯一的一张卡，直接是「已选定」状态；∞ 图标 + 紫色，不借 终极模拟 的方框图标
            ? html`<${ProtoCard} roomMode=${roomMode} difficulty=${face} info=${info} name=${ENDLESS_CARD.name} color=${color}
                glyphNode=${html`<${InfinityGlyph} class="pcard__glyph" />`}
                selected=${true} onSelect=${onDifficulty} matchmaking=${matchmaking} random=${random} variant=${variant} />`
            : DIFFICULTIES.map((d) => html`<${ProtoCard} key=${d} roomMode=${roomMode} difficulty=${d} selected=${difficulty === d} onSelect=${onDifficulty}
                matchmaking=${matchmaking} random=${random} variant=${variant} />`)}
        </div>
        <div class="proto-foot">
          ${search ? html`<div class="proto-opts">
            <span class="proto-mode-chip"><${Icon} name="search" />${t('精确搜寻')}</span>
            ${CAN_LIST ? html`<${Button} variant="secondary" size="md" icon="users" onClick=${onBrowse}>${t('浏览公开同盟')}<//>` : null}
          </div>` : roomMode !== 'solo' ? html`<div class="proto-opts">
            ${roomMode !== 'solo' && CAN_PRIVATE ? html`<label class="proto-private" title=${t('不在公开大厅显示，仅通过房间码或邀请加入')}>
              <input type="checkbox" checked=${privateRoom} onChange=${(e) => onPrivate(e.currentTarget.checked)} /><span>${t('私密房间')}</span></label>` : null}
            ${roomMode === 'coop' && CAN_QUEUE ? html`<${Button} variant="secondary" size="md" icon="refresh" loading=${busy === 'queue'} disabled=${!online || maint?.active || isSearching}
              onClick=${onQueue}>${t('快速匹配')}<//>` : null}
          </div>` : null}
          <p class="proto-hint">${hint}</p>
          <button type="button" class="proto-start" disabled=${!online || maint?.active || busy === 'create' || busy === 'queue'} onClick=${search ? onSearch : onCreate}>
            <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>
            <span class="proto-start__label">${busy === 'create' || busy === 'queue' ? html`<${Spinner} size="sm" />` : null}${label}</span>
            <span class="proto-start__deco" aria-hidden="true"></span>
          </button>
        </div>
      </section>
    </div>
    ${busy === 'create' ? html`<${JoinLine} text=${roomMode === 'solo' ? t('正在进入模拟') : t('正在建立同盟')} />` : null}
  </div>`;
}

/**
 * 选择同盟方式 (2026-10-13, the owner's request: the event's screen after 同盟模拟, video 5:22–6:29): the radar at the
 * left (ui/matchFlow.js), 创建同盟 (a room at the remembered difficulty — it is changed in the room) and 加入同盟 (the
 * key field, 观战, recent keys) at the right, 模拟邀约 (the public alliances) and 搜寻队友 between them, 入门协议 (玩法说明)
 * at the bottom left. Esc or ‹ returns to the hub.
 */
function AllianceSelect({ onClose, code, onCode, codeOk, recent, online, maint, busy, onCreate, onJoin, onSpectate, onBrowse, onSearch, recruiting = 0, difficulty, bots = 0, onBots = null }) {
  const [leaving, leave] = useLeave(onClose);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal, .guide')) leave(); };
    addEventListener('keydown', onKey);
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, []);
  const joining = busy === 'create' ? t('正在建立同盟') : busy === 'join' ? t('正在加入同盟') : busy === 'spectate' ? t('正在进入观战') : null;
  return html`<div class=${`proto ally${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label=${t('选择同盟方式')}>
    <div class="proto__bg ally__bg" aria-hidden="true"></div>
    <header class="proto-top">
      <button type="button" class="proto-back" onClick=${leave} title=${t('返回大厅 (Esc)')} aria-label=${t('返回大厅')}>
        <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
      </button>
      <div class="proto-title"><h2>${t('选择同盟方式')}</h2><span class="proto-title__mode ally__mode">${t('同盟模拟')}<i>ALLIANCE SIMULATION</i></span></div>
    </header>
    <div class="proto-body ally-body">
      <section class="ally-stage"><${RadarScene} />
        <button type="button" class="ally-guide" onClick=${() => openGuide(0)}><span class="ally-guide__icon"><${Icon} name="book" /></span>${t('入门协议')}</button>
      </section>
      <section class="ally-side">
        <button type="button" class="ally-card ally-card--create" disabled=${!online || maint?.active || busy === 'create'} onClick=${onCreate}>
          <span class="ally-card__art"><${CreateArt} /></span>
          <span class="ally-card__bar"><span class="ally-card__icon"><${Icon} name="plus" /></span>${maint?.active ? t('维护中 · 暂停开局') : t('创建同盟')}
            ${busy === 'create' ? html`<${Spinner} size="sm" />` : html`<small>${t('难度：{name}（可在同盟内更改）', { name: t(DIFFICULTY_NAMES[difficulty]) })}</small>`}</span>
        </button>
        <!-- 加入人机（用户 2026-10-14：和原版一样，创建同盟时可以选带几个 AI 队友），建立同盟时按这个数填座位 -->
        <div class="ally-bots" role="radiogroup" aria-label=${t('AI 队友')}>
          <span class="ally-bots__label"><${Icon} name="robot" />${t('AI 队友')}</span>
          <span class="ally-bots__chips">
            ${Array.from({ length: MAX_BOTS + 1 }, (_, n) => html`<button key=${n} type="button" role="radio"
              aria-checked=${n === bots ? 'true' : 'false'} data-bots=${n}
              class=${`ally-bots__chip num${n === bots ? ' is-on' : ''}`}
              title=${n ? t('加入 {n} 个人机队友', { n }) : t('不带人机：只等待真人队友加入')}
              onClick=${() => onBots(n)}>${n}</button>`)}
          </span>
          <small class="ally-bots__note">${bots ? t('同盟内将坐满 {n} 个人机（可在同盟里再加/移出）', { n: bots }) : t('不带人机')}</small>
        </div>
        <div class="ally-links">
          ${CAN_QUEUE ? html`<button type="button" class="ally-pill" onClick=${onSearch}><${Icon} name="search" />${t('搜寻队友')}</button>` : null}
          ${CAN_LIST ? html`<button type="button" class="ally-pill ally-pill--invite" onClick=${onBrowse}>${t('模拟邀约')}${recruiting ? html`<b class="num">${recruiting}</b>` : null}<span class="ally-pill__mark" aria-hidden="true"></span></button>` : null}
        </div>
        <div class="ally-card ally-card--join">
          <span class="ally-card__art"><${JoinArt} /></span>
          <label class="ally-key"><${Icon} name="search" />
            <input type="text" value=${code} placeholder=${t('输入同盟密钥')} maxlength="64" autocomplete="off" spellcheck="false"
              onInput=${(e) => onCode(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') onJoin(); }} />
            ${codeOk ? html`<button type="button" class="ally-key__spec" disabled=${!online || busy === 'spectate'} onClick=${onSpectate}
              title=${t('以观战者身份进入：不占博士席位，只能观看（每个同盟最多 {MAX_SPECTATORS} 名，模拟进行中也可进入）', { MAX_SPECTATORS })}><${Icon} name="eye" />${t('观战')}</button>` : null}
          </label>
          ${recent.length ? html`<span class="ally-recent">${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')} onClick=${() => onCode(c)}>${c}</button>`)}</span>` : null}
          <button type="button" class="ally-card__bar ally-card__bar--join" disabled=${!codeOk || !online || busy === 'join'} onClick=${() => onJoin()}>
            <span class="ally-card__icon"><${Icon} name="users" /></span>${t('加入同盟')}${busy === 'join' ? html`<${Spinner} size="sm" />` : null}
          </button>
        </div>
      </section>
    </div>
    ${joining ? html`<${JoinLine} text=${joining} />` : null}
  </div>`;
}

function MatchmakingModal({ open, onClose, onJoin, onSpectate }) {
  const lobbyStats = useStore((s) => s.lobbyStats, shallowEqual);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(() => ({
    online: lobbyStats?.online ?? 1,
    roomsCount: lobbyStats?.roomsCount ?? 0,
    matchesCount: lobbyStats?.matchesCount ?? 0,
    rooms: lobbyStats?.rooms ?? [],
  }));

  useEffect(() => {
    if (federationEnabled && CAN_LIST) {net.request('room.list').then(r=>setData(r)).catch(()=>{});return;}
    if (lobbyStats && typeof lobbyStats.online === 'number') {
      setData({
        online: lobbyStats.online,
        roomsCount: lobbyStats.roomsCount,
        matchesCount: lobbyStats.matchesCount,
        rooms: lobbyStats.rooms,
      });
    }
  }, [lobbyStats]);

  const fetchRooms = async () => {
    if (!CAN_LIST) return;
    setLoading(true);
    try {
      const res = await net.request('room.list');
      if (res && res.ok) {
        setData(res);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    fetchRooms();
    const timer = setInterval(() => { if (!document.hidden) fetchRooms(); }, 4000);
    return () => clearInterval(timer);
  }, [open]);

  if (!open) return null;

  return html`<div class="modal mm-modal" role="presentation"
      onMouseDown=${(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
    <div class="modal__box mm-modal__box brackets" role="dialog" aria-modal="true">
      <div class="modal__stripe" aria-hidden="true"></div>
      <header class="modal__head mm-modal__head">
        <${MicroLabel} tone="mint">MULTIPLAYER MATCHMAKING<//>
        <div class="mm-modal__title-row">
          <h2 class="modal__title mm-modal__title">双服统一大厅</h2>
          <button type="button" class="mm-modal__close" onClick=${onClose} aria-label="关闭">
            <${Icon} name="close" />
          </button>
        </div>
      </header>

      <div class="mm-modal__body">
        <div class="mm-stats-bar">
          <div class="mm-stats-col">
            <span class="mm-stats-num mm-stats-num--mint num">${data.online ?? 1}</span>
            <span class="mm-stats-label">在线博士</span>
          </div>
          <div class="mm-stats-col">
            <span class="mm-stats-num num">${data.roomsCount ?? 0}</span>
            <span class="mm-stats-label">同盟房间</span>
          </div>
          <div class="mm-stats-col">
            <span class="mm-stats-num num">${data.matchesCount ?? 0}</span>
            <span class="mm-stats-label">进行中对局</span>
          </div>
          <button type="button" class="mm-refresh-btn" onClick=${fetchRooms} disabled=${loading}>
            <${Icon} name="refresh" class=${loading ? 'is-spinning' : ''} />
            <span>刷新</span>
          </button>
        </div>

        ${data.partial ? html`<p>部分节点暂未连通，当前列表可能不完整。</p>` : null}
        <div class="mm-room-list">
          ${data.rooms && data.rooms.length > 0
            ? data.rooms.map((r) => html`<div key=${`${r.node || ''}:${r.code}`} class="mm-room-card">
                <div class="mm-room-code num">${r.code}${r.nodeName ? html`<small style="display:block;font-size:11px">${r.nodeName}</small>` : null}</div>
                <div class="mm-room-info">
                  <div class="mm-room-name"><span class=${isOwnerName(r.hostName || r.name) ? "sp-owner-name" : ""}>${r.name || `同盟 #${r.code}`}</span>${["isomer", "凑鹈鹕", "香鹈鹕"].includes(String(r.hostName || r.name || "").trim().toLowerCase()) ? html`<span class="mm-owner-badge" title="服主" style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:2px 6px;border:1px solid #e4bd60;color:#e4bd60;font-size:11px;line-height:1.4;white-space:nowrap;vertical-align:middle"><${Icon} name="crown" />服主</span>` : null}</div>
                  <div class="mm-room-meta">
                    <span class="mm-room-diff" style=${`--d-color:${DIFFICULTY_COLORS[r.difficulty] || 'var(--mint)'}`}>
                      <${DifficultyIcon} difficulty=${r.difficulty} class="diff-glyph" />
                      <span>${DIFFICULTY_NAMES[r.difficulty] || r.difficulty}</span>
                    </span>
                    ${r.random ? html`<span class="mm-room-rm">无限火力 · 1.1 · ${r.variant === 'endurance' ? '持久鏖战' : r.variant === 'marathon' ? '最长时赛' : '快速突袭'}</span>` : null}
                    <span class="mm-room-players">
                      <${Icon} name="users" />
                      <span class="num">${r.humans} / ${r.maxSeats || MAX_SEATS}</span>
                    </span>
                    <span class=${`mm-room-status ${r.inMatch ? 'is-in-match' : 'is-waiting'}`}>
                      ${r.inMatch ? '进行中' : '等待中'}
                    </span>
                  </div>
                </div>
                <div class="mm-room-actions">
                  <${Button}
                    variant="primary"
                    size="md"
                    icon="users"
                    class=${`mm-btn-join ${r.inMatch ? 'is-disabled-match' : ''}`}
                    disabled=${r.inMatch}
                    onClick=${() => { onClose(); onJoin(r.code,r.node); }}>
                    加入
                  <//>
                  <${Button}
                    variant="secondary"
                    size="md"
                    icon="eye"
                    class="mm-btn-spectate"
                    onClick=${() => { onClose(); onSpectate(r.code,r.node); }}>
                    观战
                  <//>
                </div>
              </div>`)
            : html`<div class="mm-room-empty">
                <${Icon} name="search" />
                <span>暂无公开同盟房间，可创建同盟或使用快速匹配</span>
              </div>`
          }
        </div>

        <footer class="mm-modal__foot">
          <div class="mm-foot-tag"><${MicroLabel}>AUTO-REFRESH 4S<//></div>
          <div class="mm-foot-text">列表每 4 秒自动刷新；观战不占博士席位，「进行中」的同盟只能观战。</div>
        </footer>
      </div>
    </div>
  </div>`;
}

/** Lobby screen component. */
export function LobbyScreen() {
  const matchmakingCounts = useStore(s => s.presence?.matchmaking);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  useData('config');
  const [simulation, setSimulation] = useState(lobbySimulationPreference);
  const [difficulty, setDifficulty] = useState(() => preferredDifficulty(lobbySimulationPreference()));
  const [fpVariant, setFpVariant] = useState(firepowerVariantPreference);
  const roomMode = simulation === 'solo' ? 'solo' : 'coop';
  const randomMode = simulation === 'firepower';
  const variant = randomMode ? fpVariant : 'blitz';
  const [code, setCode] = useState('');
  const [privateRoom, setPrivateRoom] = useState(false);
  const [busy, setBusy] = useState(null);
  const [recent] = useState(recentRooms);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);

  const resourcesReady = useStore((s) => !s.session.preloadRequired || s.session.preloadReady);
  const online = conn.status === 'online' && resourcesReady;
  // 开发者功能：仅本地端（服务器 welcome.devAllowed）才显示「全量模拟」入口。非本地端永远看不到这张卡。
  // 每次渲染都重读 net.lastWelcome（而不是只在挂载时读一次）：welcome 可能在 lobby 挂载之前或之后到达，
  // 而重连时 server 的一次所有权竞态会直接丢弃 welcome（net.js 的 _helloToken !== getToken() 分支）——
  // 那条路既不赋值 lastWelcome 也不 emit，所以必须靠 status 变化再补读一次，不能只靠 'welcome' 事件。
  const [devAllowed, setDevAllowed] = useState(() => !!(net.lastWelcome && net.lastWelcome.devAllowed));
  useEffect(() => {
    const sync = () => setDevAllowed(!!(net.lastWelcome && net.lastWelcome.devAllowed));
    sync();
    const offW = net.on('welcome', sync);
    const offS = net.on('status', sync);   // 重连后 status 回到 online → 补读被丢弃的那次 welcome
    const offR = net.on('replaced', () => setDevAllowed(false));
    return () => { offW(); offS(); offR(); };
  }, []);
  // 还要设置里的「开发者模式」开着（ui/settings.js 的 devModeStore）：两道都过才画这张卡。
  const devOn = useDevMode();
  const codeOk = CODE_RE.test(code);
  const mm = useStore((s) => s.matchmaking, shallowEqual);
  const maint = useStore((s) => s.maintenance, shallowEqual);
  const [modalOpen, setModalOpen] = useState(() => new URLSearchParams(location.search).has('modal'));
  const lobbyStats = useStore((s) => s.lobbyStats, shallowEqual);
  const [onlineCount, setOnlineCount] = useState(() => lobbyStats?.online ?? 1);
  const [rooms, setRooms] = useState(() => (federationEnabled ? [] : lobbyStats?.rooms ?? []));
  const bg = useHubBackdrop();
  const bondScope = useBondScope(); // 模式选择：契约（mod）/ 盟约（official）— 干员调配、S.W.E.E.P.报告与开局共用
  const [bgOpen, setBgOpen] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  // The Android shell can ask the local network who hosts a key, so a guest never types an address: the code is enough.
  const nativeShell = globalThis.AndroidNative?.isNativeApp?.() ? globalThis.AndroidNative : null;
  const [lanRoom, setLanRoom] = useState(null);
  const [lanNote, setLanNote] = useState('');
  useEffect(() => {
    if (!nativeShell || roomMode !== 'coop' || !codeOk) { setLanRoom(null); return undefined; }
    let cancelled = false;
    setLanRoom(null);
    setLanNote('正在局域网中查找该房间…');
    globalThis.__onRoomFound = (list) => {
      if (cancelled) return;
      const host = (list || []).find((h) => !h.self);
      if (host) { setLanRoom(host); setLanNote(`已找到房主 ${host.ip}（${host.humans || 0} 人在房）· 点「加入同盟」进入`); }
      else setLanNote('局域网里没有这个房间：确认房主已创建同盟模拟房间，且两台设备在同一网络');
    };
    nativeShell.findRoom(code);
    return () => { cancelled = true; delete globalThis.__onRoomFound; };
  }, [code, roomMode]);
  const isSearching = mm?.status === 'searching';

  useEffect(() => {
    if (!federationEnabled && lobbyStats && Number.isFinite(lobbyStats.online)) {
      setOnlineCount(lobbyStats.online);
    }
  }, [lobbyStats?.online]);
  useEffect(() => {
    if (!federationEnabled && Array.isArray(lobbyStats?.rooms)) setRooms(lobbyStats.rooms);
  }, [lobbyStats?.rooms]);

  useEffect(() => {
    if (!online || !CAN_LIST) return undefined;
    let cancelled = false;
    const poll = () => {
      if (document.hidden) return;
      net.request('room.list').then((res) => {
        if (!cancelled && res && res.ok && Number.isFinite(res.online)) {
          setOnlineCount(res.online);
        }
        if (!cancelled && res && res.ok && Array.isArray(res.rooms)) setRooms(res.rooms);
      }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 10000);
    return () => { cancelled = true; clearInterval(t); };
  }, [online]);

  const pickMode = (m) => {
    if (!MODE_CARDS.some((c) => c.id === m)) return;
    // Normal modes share their difficulty; firepower remembers its own explicitly chosen difficulty.
    if ((m === 'firepower') !== randomMode) setDifficulty(preferredDifficulty(m));
    setSimulation(m);
    savePref('lobby.simulation', m);
    savePref('lobby.mode', m === 'solo' ? 'solo' : 'coop');
    savePref('lobby.random', m === 'firepower');
  };
  const pickDifficulty = (d) => {
    setDifficulty(d);
    savePref(randomMode ? 'lobby.firepowerDifficulty' : 'lobby.difficulty', d);
  };

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('尚未连接到服务器，请稍候'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };
  const pickVariant = (v) => {
    setFpVariant(v);
    savePref('lobby.firepowerVariant', v);
  };

  /**
   * 建立房间。`nBots` = 创建同盟时一起带上的人机（AI 队友，shared/bondScope 无关：server/lobby.js room.addBot），
   * 房主刚建的房间自己就是 host，所以 room.create 之后立刻按这个数补座位（坐满或已开局会被服务端拒绝，忽略即可）。
   */
  const create = (nBots = 0) => run('create', async () => {
    await net.request('room.create', { mode: roomMode, difficulty, scope: bondScope, random: randomMode, private: roomMode !== 'solo' && privateRoom, ...(randomMode ? { variant } : {}) });
    const n = roomMode === 'coop' ? Math.max(0, Math.min(MAX_BOTS, Number(nBots) || 0)) : 0;
    for (let i = 0; i < n; i += 1) {
      try { await net.request('room.addBot'); } catch { break; }
    }
  });
  const queueMatch = () => run('queue', () => net.request('match.queue', { mode: roomMode, difficulty, random: randomMode, ...(randomMode ? { variant } : {}), fillBots: false }));
  // 开发者功能：全量模拟（dev 局）。single + dev + 试验场图：服务端跳过 INFO_CHECK / BAND_DRAFT，直接进对战。
  const createFullSim = () => run('create', async () => {
    await net.request('room.create', { mode: 'solo', difficulty: 'NORMAL', dev: true, stage: FULL_SIM_STAGE });
  });
  // 「无限模拟」AC-5（用户 2026-10-17）：与全量模拟同一道闸（仅本地端 + solo），但**不**跳流程、**不**打试验场 ——
  // 就是一场**终极模拟 (ABYSS)**：同一套开局 BAN（核心 3 / 附加 4）、同一档 7 张战场；一路打到 R14 最终攻势，
  // 击败首领后不结算胜负、继续出普通怪（R15 不再是隐秘核心），回合无上限、盟约叠层封顶取消，越界回合每回合
  // hp / atk +20 %（加算），直到玩家被淘汰。由 EndlessSelect（选择模拟协议 · 只有 AC-5 一张卡）触发。
  const createEndless = () => run('create', async () => {
    await net.request('room.create', { mode: 'solo', difficulty: ENDLESS_CARD.base, endless: true, scope: bondScope });
  });
  const cancelMatch = () => run('cancel', () => net.request('match.cancel'));
  const join = (c = code, federationNode) => {
    // `onClick=${join}` hands the click EVENT as the first argument, and a default parameter only applies to
    // `undefined` — codeArg keeps an event target out of the key and falls back to the input field
    const k = codeArg(c, code);
    if (!CODE_RE.test(k)) { toast(`同盟密钥为 ${ROOM_CODE_LEN} 位字母或数字`, 'warn'); return; }
    // A room found on another phone is a different origin: hand the WebView over to it instead of asking the
    // server we are on, which by definition does not have that room.
    if (nativeShell && lanRoom) {
      nativeShell.connectToHost(lanRoom.ip, k);
      setLanNote(`正在进入 ${lanRoom.ip} 的房间…`);
      return;
    }
    run('join', () => net.request('room.join', { code: k, ...(federationNode ? { federationNode } : {}) }));
  };
  // a spectator seat: no player seat taken, nothing to do but watch (also a match already running)
  const spectate = (c = code, federationNode) => {
    // same guard as join: `onClick=${spectate}` passes the click event, not a code
    const k = codeArg(c, code);
    if (!k) { toast(`同盟密钥为 ${ROOM_CODE_LEN} 位字母或数字`, 'warn'); return; }
    run('spectate', () => net.request('room.spectate', { code: k, ...(federationNode ? { federationNode } : {}) }).catch((err) => {
      // Clearer than the bare ERR_TEXT: the usual cause is a code that is not the host's (a remembered one from an
      // earlier room, or another machine's) — the server can only answer "no such room".
      if (err?.code === ERR.ROOM_NOT_FOUND) {
        toast(t('没有找到密钥 {k} 对应的同盟：请和房主核对密钥（同盟结束后密钥即失效）', { k }), 'warn');
        return;
      }
      if (err?.code === ERR.ALREADY) {
        toast(t('你已经是该同盟的博士：先离开同盟，才能以观战身份进入'), 'warn');
        return;
      }
      throw err;
    }));
  };
  const backToTitle = () => {
    identity.setEntered(false);
    store.set((s) => ({ session: { ...s.session, entered: false } }));
  };
  // hub dialogs: the start sheet of a picked mode, 密钥加入 (opened by an invite code in the URL too)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetPurpose, setSheetPurpose] = useState('create'); // 'create' | 'search' (搜寻队友)
  const [allyOpen, setAllyOpen] = useState(false);            // 选择同盟方式
  const [sheetChained, setSheetChained] = useState(false);    // opened from 选择同盟方式: no darkening of the hub between
  const [endlessOpen, setEndlessOpen] = useState(false);      // 选择模拟协议 · 无限模拟 (AC-5)：整页只有这一张卡
  const [joinOpen, setJoinOpen] = useState(false);
  // 创建同盟时带上几个 AI 队友（人机，用户 2026-10-14：原版一样可以在这里选）：0 … MAX_SEATS-1，记住上次的选择
  const [allyBots, setAllyBots] = useState(() => Math.max(0, Math.min(MAX_BOTS, Number(loadPref(ALLY_BOTS_PREF, 0)) || 0)));
  const pickAllyBots = (n) => {
    const v = Math.max(0, Math.min(MAX_BOTS, Number(n) || 0));
    setAllyBots(v);
    savePref(ALLY_BOTS_PREF, v);
  };
  // 同盟模拟 → 选择同盟方式（同盟要选加入/创建，仍需一层）；独立模拟 / 无限火力 → 弹出选择模拟协议
  // （2026-10-14：主界面上的整块模式/难度选择撤掉，难度选择回到 sheet 里）。
  const openMode = (m) => {
    pickMode(m);
    if (m === 'coop') setAllyOpen(true);
    else { setSheetPurpose('create'); setSheetChained(false); setSheetOpen(true); }
  };
  const openSearch = () => { pickMode('coop'); setSheetChained(allyOpen); setAllyOpen(false); setSheetPurpose('search'); setSheetOpen(true); };
  const modeCard = MODE_CARDS.find((c) => c.id === simulation) || MODE_CARDS[0];

  return html`<div class="screen lobby-screen lobby-hub" data-hub-theme=${backdropTheme(bg)}>
    <${HubBackdrop} bg=${bg} />
    <header class="topbar hub-topbar">
      <div class="topbar__left">
        <${Button} variant="ghost" size="sm" icon="chevronLeft" onClick=${backToTitle} title=${t('返回标题')}>${t('返回')}<//>
        <${PingPill} ms=${conn.ping} online=${online} />
        <span class="topbar__sep" aria-hidden="true"></span>
        <div class="topbar__tools">
          <${SettingsButton} class="lobby-settings" variant="secondary" square=${true} />
          <${GuideButton} class="lobby-guide" variant="secondary" square=${true} />
          <${Button} variant="secondary" size="sm" square=${true} class="hub-bg-btn" onClick=${() => setBgOpen(true)}
            title=${t('大厅背景')} aria-label=${t('大厅背景')}><${BackdropGlyph} /><//>
          <${HubFullscreenButton} />
          <${PwaInstallButton} class="lobby-pwa" square=${true} />
        </div>
      </div>
      <div class="topbar__right">
        <span class="hub-online"><span class="online-pill__dot"></span><span class="num">${onlineCount}</span><span>${t('名博士在线')}</span></span>
        <${ResumeMatchButton} />
        <${AccountMeChip} player=${me} onStats=${openStats} />
      </div>
    </header>

    <main class="hub-stage">
      <div class="hub-center">
        <div class="hub-center__mark"><${HubRadar} bg=${bg} /><${Emblem} /></div>
        <div class="hub-center__en">STRONGHOLD PROTOCOL <b>${bondScope === 'official' ? 'ALLIANCE' : 'ALLPACT'}</b></div>
        <h1 class="hub-center__title">${t('卫戍协议')}：${t(bondScope === 'official' ? '盟约' : '契约')}</h1>
      </div>

      <aside class="hub-side">
        <${HubTile} icon="key" label=${t('密钥加入')} en="JOIN WITH KEY" onClick=${() => setJoinOpen(true)} />
        <${TipsPanel} />
      </aside>

      <aside class="hub-right">
        <${RecruitCard} rooms=${rooms} online=${online} onJoin=${join} onAll=${() => setModalOpen(true)} onCreate=${() => openMode('coop')} />
        <div class="hub-right__plates">
          <${SweepPlate} onClick=${() => setSweepOpen(true)} />
          <${LoadoutButton} from="lobby" size="lg" class="hub-plate hub-plate--loadout" label=${t('干员调配')} />
        </div>
      </aside>

      <section class="hub-entries" aria-label=${t('模拟方式')}>
        ${isSearching ? html`<div class="matchmaking-hud brackets hub-searching">
            <div class="matchmaking-hud__info">
              <${Spinner} size="sm" />
              <span class="matchmaking-hud__text">正在匹配同盟 (${mm?.matched || 1}/${mm?.target || 4})...</span>
              <span class="matchmaking-hud__time num">${String(Math.floor((mm?.elapsed || 0) / 60)).padStart(2, '0')}:${String((mm?.elapsed || 0) % 60).padStart(2, '0')}</span>
            </div>
            <${Button} variant="danger" size="md" loading=${busy === 'cancel'} onClick=${cancelMatch}>取消匹配<//>
          </div>` : null}
        ${maint?.active ? html`<div class="hub-maint">${t('服务器即将维护，暂停开启新的模拟')}</div>` : null}
        <div class="hub-entries__row">
          <${ModeEntry} scope=${bondScope} onPick=${(s) => { setBondScope(s); }} />
          <${HubEntry} group=${{ icon: 'user', label: t('独立模拟') }} name=${t('独立模拟')} en="SOLO" icon="user" onClick=${() => openMode('solo')} />
          <${HubEntry} group=${{ icon: 'users', label: t('同盟模拟') }} name=${t('同盟模拟')} en="ALLIANCE" icon="users" count=${matchmakingCounts?.total} onClick=${() => openMode('coop')} />
          ${/* 无限模拟（用户 2026-10-17）：不需要开发者模式，排在同盟模拟右侧，外观与独立 / 同盟模拟一致 */ ''}
          <${HubEntry} group=${{ icon: 'users', label: t('同盟模拟') }} name=${t('无限模拟')} en="ENDLESS SIMULATION" icon="refresh" onClick=${() => setEndlessOpen(true)} />
          ${/* 全量模拟仍只在本地端 + 开发者模式开时出现，排在无限模拟右侧 */ ''}
          ${devAllowed && devOn ? html`<${HubEntry} group=${{ icon: 'sword', label: t('开发者') }} name=${t('全量模拟')} en="FULL SIMULATION" icon="sword" tone="green" badge="DEV" onClick=${createFullSim} />` : null}
          ${CAN_QUEUE ? html`<${HubEntry} name=${t('搜寻队友')} en="FIND ALLIES" icon="search" tone="bright" onClick=${openSearch} />` : null}
        </div>
      </section>
    </main>

    ${sheetOpen ? html`<${ProtocolSelect} card=${modeCard} roomMode=${roomMode} random=${randomMode} variant=${variant} difficulty=${difficulty}
      onDifficulty=${pickDifficulty} onClose=${() => setSheetOpen(false)} matchmaking=${matchmakingCounts}
      brief=${randomMode ? html`<${FirepowerBrief} variant=${fpVariant} onVariant=${pickVariant} />` : null}
      privateRoom=${privateRoom} onPrivate=${setPrivateRoom} online=${online} maint=${maint} busy=${busy} isSearching=${isSearching}
      onCreate=${() => create(roomMode === 'coop' ? allyBots : 0)} onQueue=${async () => { await queueMatch(); setSheetOpen(false); }}
      purpose=${sheetPurpose} onSearch=${queueMatch} onCancel=${cancelMatch} mm=${mm} onBrowse=${() => setModalOpen(true)} chained=${sheetChained} />` : null}

    ${endlessOpen ? html`<${ProtocolSelect} card=${ENDLESS_CARD} roomMode="solo" random=${false} variant=${fpVariant} difficulty=${ENDLESS_CARD.base}
      endless=${true} onDifficulty=${() => {}} onClose=${() => setEndlessOpen(false)} matchmaking=${matchmakingCounts}
      online=${online} maint=${maint} busy=${busy} onCreate=${createEndless} onBrowse=${() => setModalOpen(true)} />` : null}

    ${allyOpen ? html`<${AllianceSelect} onClose=${() => setAllyOpen(false)} code=${code} onCode=${(v) => setCode(normalizeCode(v))} codeOk=${codeOk}
      recent=${recent} online=${online} maint=${maint} busy=${busy} difficulty=${difficulty} recruiting=${recruitingRooms(rooms).length}
      bots=${allyBots} onBots=${pickAllyBots}
      onCreate=${() => create(allyBots)} onJoin=${() => join()} onSpectate=${() => spectate()} onBrowse=${() => setModalOpen(true)} onSearch=${openSearch} />` : null}

    <${HubDialog} open=${joinOpen} micro="JOIN WITH ALLIANCE KEY" title=${t('密钥加入')} onClose=${() => setJoinOpen(false)}>
      <div class="join-row">
        <${TextField} size="code" icon="key" value=${code} placeholder=${t('输入同盟密钥 / 粘贴邀请链接')}
          transform=${normalizeCode} onInput=${(v) => setCode(normalizeCode(v))} onEnter=${() => join()} />
      </div>
      <div class="join-row hub-join__buttons">
        <${Button} variant="amber" size="lg" icon="users" loading=${busy === 'join'} disabled=${!codeOk || !online} onClick=${() => join()}>${t('加入同盟')}<//>
        <${Tooltip} text=${t('以观战者身份进入：不占博士席位，只能观看（每个同盟最多 {MAX_SPECTATORS} 名，模拟进行中也可进入）', { MAX_SPECTATORS })}>
          <${Button} variant="secondary" size="lg" icon="eye" class="join-spectate" loading=${busy === 'spectate'} disabled=${!codeOk || !online} onClick=${spectate}>${t('观战')}<//>
        <//>
      </div>
      ${lanNote && nativeShell ? html`<p class="t-dim">${lanNote}</p>` : null}
      <div class="join-foot">
        ${recent.length ? html`<span class="t-lo">${t('最近的同盟')}</span>
          ${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')}
            onClick=${() => setCode(c)}>${c}</button>`)}`
          : html`<span class="t-dim">${t('向同伴索取 {ROOM_CODE_LEN} 位同盟密钥，或直接打开邀请链接', { ROOM_CODE_LEN })}</span>`}
      </div>
    <//>

    <${HubDialog} open=${bgOpen} micro="LOBBY BACKDROP" title=${t('大厅背景')} onClose=${() => setBgOpen(false)}>
      <${BackdropSettings} bg=${bg} />
    <//>

    <${MatchmakingModal} open=${modalOpen} onClose=${() => setModalOpen(false)} onJoin=${join} onSpectate=${spectate} />
    ${sweepOpen ? html`<${SweepReport} onClose=${() => setSweepOpen(false)} />` : null}
  </div>`;
}
