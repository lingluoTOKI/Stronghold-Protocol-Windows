// ui/gameLogic/draft.js — 机变 and band-draft normalisation. Re-exported from ../gameLogic.js.

import { isObj } from './shared.js';
import { PHASE } from '../../../../shared/constants.js';
import { t } from '../../../../shared/i18n.js';


// ---- 机变 / band draft normalisation ----------------------------------------------------------------------

/**
 * Normalise m.public.draft ({order, turn, picks, skips?}) — tolerant of index/playerId turns and
 * object/array picks.
 * @param {any} draft
 * @param {any[]} [players]
 * @returns {{ order: string[], turnPid: string|null, picks: Map<string,string>, skipsLeft: Map<string, number>, done: boolean }}
 */
export function normalizeDraft(draft, players = []) {
  const ids = (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
  const order = Array.isArray(draft?.order) && draft.order.length ? draft.order.filter((x) => typeof x === 'string') : ids;
  let turnPid = null;
  if (typeof draft?.turn === 'string') turnPid = draft.turn;
  else if (Number.isInteger(draft?.turn) && draft.turn >= 0 && draft.turn < order.length) turnPid = order[draft.turn];
  const picks = new Map();
  const src = draft?.picks;
  if (Array.isArray(src)) {
    src.forEach((v, i) => {
      if (typeof v === 'string' && order[i]) picks.set(order[i], v);
      else if (isObj(v) && typeof v.playerId === 'string' && typeof v.bandId === 'string') picks.set(v.playerId, v.bandId);
    });
  } else if (isObj(src)) {
    for (const [k, v] of Object.entries(src)) if (typeof v === 'string' && v) picks.set(k, v);
  }
  const skipsLeft = new Map();
  const sk = draft?.skipsLeft ?? draft?.skips;
  if (isObj(sk)) for (const [k, v] of Object.entries(sk)) if (Number.isFinite(v)) skipsLeft.set(k, v);
  const done = order.length > 0 && order.every((pid) => picks.has(pid));
  return { order, turnPid, picks, skipsLeft, done };
}

/**
 * Normalise m.public.sp ({family, cards, turn, picks, order?}).
 * Cards: string ids or objects; picks: {playerId: cardIdx} | [{playerId, idx}] | card.takenBy.
 * @param {any} sp
 * @param {any[]} [players]
 */
/** 契约选择（2/8/12 回合）的个人牌桌：卡面在 m.private.sp，公共视图只带各玩家的已选（pickedNames）。 */
function normalizeContractSp(sp, players = []) {
  const ids = (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
  const order = Array.isArray(sp.order) && sp.order.length ? sp.order.filter((x) => typeof x === 'string') : ids;
  const cards = (Array.isArray(sp.cards) ? sp.cards : []).slice(0, 9).map((c, idx) => {
    const card = typeof c === 'string' ? { id: c } : isObj(c) ? { ...c } : {};
    // 归组：服务端卡自带 group；无 group 的老视图按扁平 idx 推（我方 0..2、中立 3..5、敌方其后）
    if (!card.group) card.group = idx < 3 ? 'self' : idx < 6 ? 'neutral' : 'enemy';
    return { ...card, idx, takenBy: null };
  });
  const picks = new Map(); // playerId → { self, neutral, enemy }
  for (const [pid, v] of Object.entries(isObj(sp.picks) ? sp.picks : {})) {
    if (!isObj(v)) continue;
    picks.set(pid, {
      self: Number.isInteger(v.self) ? v.self : null,
      neutral: Number.isInteger(v.neutral) ? v.neutral : null,
      enemy: Number.isInteger(v.enemy) ? v.enemy : null,
    });
  }
  // refreshed：服务端下发每组的**已刷新次数**（计数）。兼容旧布尔（true ⇒ 已用掉 1 次）。
  // 我方契约可刷新 2 次、中立/敌方各 1 次（用户 2026-10-14），所以这里保留计数交给 UI 判定。
  const LIMIT = { self: 2, neutral: 1, enemy: 1 };
  const r = sp.refreshed;
  const asCount = (v) => (v === true ? 1 : (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0));
  const counts = isObj(r)
    ? { self: asCount(r.self), neutral: asCount(r.neutral), enemy: asCount(r.enemy) }
    : { self: asCount(r), neutral: 0, enemy: 0 };
  const refreshed = { self: counts.self >= LIMIT.self, neutral: counts.neutral >= LIMIT.neutral, enemy: counts.enemy >= LIMIT.enemy };
  return {
    contract: true,
    family: typeof sp.family === 'string' ? sp.family : 'contract',
    name: typeof sp.name === 'string' && sp.name ? sp.name : null,
    desc: typeof sp.desc === 'string' && sp.desc ? sp.desc : null,
    untimed: !!sp.untimed,
    cards, order, turnPid: null, pickOf: new Map(), takenBy: new Map(), pickedCount: 0,
    picks,
    pickedNames: isObj(sp.pickedNames) ? sp.pickedNames : {},
    refreshed,
    myPick: isObj(sp.myPick) ? sp.myPick : { self: null, neutral: null, enemy: null },
    done: !!sp.done,
  };
}

export function normalizeSp(sp, players = []) {
  if (!isObj(sp)) return null;
  if (sp.contract) return normalizeContractSp(sp, players);
  const ids = (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
  const order = Array.isArray(sp.order) && sp.order.length ? sp.order.filter((x) => typeof x === 'string') : ids;
  const cards = (Array.isArray(sp.cards) ? sp.cards : []).slice(0, 6).map((c, idx) => {
    const card = typeof c === 'string' ? { id: c } : isObj(c) ? { ...c } : {};
    return { ...card, idx, takenBy: typeof card.takenBy === 'string' ? card.takenBy : null };
  });
  const takenBy = new Map(); // idx → playerId
  const pickOf = new Map(); // playerId → idx
  const src = sp.picks;
  const add = (pid, idx) => {
    if (typeof pid !== 'string' || !Number.isInteger(idx) || idx < 0 || idx >= cards.length) return;
    takenBy.set(idx, pid);
    pickOf.set(pid, idx);
  };
  if (Array.isArray(src)) src.forEach((v, i) => { if (isObj(v)) add(v.playerId, v.idx); else if (Number.isInteger(v) && order[i]) add(order[i], v); });
  else if (isObj(src)) for (const [k, v] of Object.entries(src)) add(k, v);
  if (isObj(sp.taken)) for (const [k, v] of Object.entries(sp.taken)) add(v, Number(k));
  for (const c of cards) if (c.takenBy) add(c.takenBy, c.idx);
  for (const c of cards) c.takenBy = takenBy.get(c.idx) ?? null;
  let turnPid = null;
  if (typeof sp.turn === 'string') turnPid = sp.turn;
  else if (Number.isInteger(sp.turn) && sp.turn >= 0 && sp.turn < order.length) turnPid = order[sp.turn];
  return {
    family: typeof sp.family === 'string' ? sp.family : null,
    name: typeof sp.name === 'string' && sp.name ? sp.name : null,
    desc: typeof sp.desc === 'string' && sp.desc ? sp.desc : null,
    untimed: !!sp.untimed,
    cards, order, turnPid, pickOf, takenBy, pickedCount: pickOf.size,
  };
}

/** Adapt only the recipient's current PREP choice; never write it into the public draft. */
export function normalizePersonalChoice(pub, priv, myId) {
  const choice = priv?.personalChoice;
  if (pub?.phase !== PHASE.PREP || !priv || priv.playerId !== myId || priv.alive === false
    || !choice || choice.round !== pub.round) return null;
  // 教鞭的悬赏选择 / 诗怀雅【天选明星】的两步选择（先选干员、再选强化类型）：同一套「个人选择」载体，
  // 只是标题与卡面不同 —— lm 标记让界面按龙门选择渲染，step 'kind' 时换成第二步的文案。
  const lm = choice.kind === 'lungmen';
  const kindStep = lm && choice.step === 'kind';
  return {
    ...normalizeSp({
      family: lm ? 'lungmen' : 'bounty',
      name: lm ? (kindStep ? t('天选明星 · 选择强化') : t('天选明星 · 选择干员')) : t('教鞭 · 战术特训'),
      desc: lm ? (kindStep ? t('为选定的龙门干员挑选一种强化') : t('选择一位龙门干员，他将获得强化')) : t('请选择一项战术特训'),
      cards: choice.cards, turn: myId, order: [myId], picks: {},
    }),
    id: choice.id,
    lungmen: lm,
  };
}
