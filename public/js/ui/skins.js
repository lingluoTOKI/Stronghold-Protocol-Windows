// 干员皮肤 (operator skins, docs/SKINS.md) — the catalogue lookups and the storage format of the per-browser skin
// choice, shared by the 皮肤 section of 干员调配 (ui/skinPicker.js), the sync (ui/loadoutSync.js) and the tests.
//
// Two different things live here, and keeping them apart is what lets the picker offer a skin this install cannot show:
//
//   * the CATALOGUE (data/skins.json, tools/build-skins.mjs) — every skin the project knows about: ids, names, series.
//     No URLs, because a skin that is not installed has no files to point at.
//   * what is INSTALLED (data/assets.json → `chars[charId].skins[skinId]`, tools/inject-skins-assets.mjs) — the skins
//     whose models are on this server. `availableSkins()` marks which is which, and the picker shows the rest as 未安装.
//
// A skin *choice* is keyed by CHESS id (`chess_char_1_01_a`, the piece the player fields) while the catalogue and the
// asset manifest are keyed by OPERATOR id (`char_498_inside`): mixing the two is silent — the picker renders an empty
// section and the server drops every entry. The choice itself is `{ [chessId]: skinId }`, persisted in localStorage
// (`sp.pref.skins` = `{ v, skins }`) and mirrored to the server by ui/loadoutSync.js installSkinsSync (`room.skins`).

import { checkSkins, SKIN_LIMITS, isSkinId } from '../../../shared/protocol.js';
import { data } from '../data.js';

/** localStorage key (store.js loadPref/savePref prefix `sp.pref.`) and format version. */
export const SKIN_PREF = 'skins';
export const SKIN_VERSION = 1;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Structurally valid selection out of a raw value (junk dropped): `{ [chessId]: skinId }`, at most SKIN_LIMITS.entries
 * pairs, both sides strings.
 * @param {any} raw
 * @returns {Record<string, string>}
 */
export function cleanSkins(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [chessId, skinId] of Object.entries(raw)) {
    if (Object.keys(out).length >= SKIN_LIMITS.entries) break;
    if (typeof chessId !== 'string' || !chessId || chessId.length > 64 || !isSkinId(skinId)) continue;
    out[chessId] = skinId;
  }
  return out;
}

/** Parse a stored setting (any junk → {}): `{ v, skins }` or a bare map from an older build. */
export function parseStoredSkins(raw) {
  if (isObj(raw) && 'skins' in raw) return cleanSkins(raw.skins);
  return cleanSkins(raw);
}

/** Serialised form for localStorage. */
export const toStoredSkins = (skins) => ({ v: SKIN_VERSION, skins: cleanSkins(skins) });

/**
 * The selection to keep / send against the loaded data: base chess records this build knows only (checkSkins, the same
 * rule the server applies), so a stale entry of another build is dropped here rather than by the server.
 * @param {any} skins @param {(id: string) => any} getChess
 * @returns {Record<string, string>}
 */
export function sanitizeSkins(skins, getChess) {
  const res = checkSkins(cleanSkins(skins), getChess);
  return res && res.ok ? res.skins : {};
}

/**
 * Every skin of an operator, in the catalogue's order (the game's own), each with whether this install has its model.
 *
 * Takes the OPERATOR id (`char_498_inside`), not the chess id (`chess_char_1_01_a`) — see the header.
 * Every skin of an operator, in the catalogue's order (the game's own), each with whether this install has its model
 * and whether this install has its own half-body portrait (`portrait`): a chosen skin without one still draws the
 * operator's base portrait in the 半身像 slots (the owner's ruling of 2026-10-12), so the picker marks such a skin.
 *
 * @param {string} charId
 * @returns {{ id: string, name: string, group: string, installed: boolean, portrait: boolean, avatar: string|null }[]}
 */
export function availableSkins(charId) {
  const list = data.get('skins') && data.get('skins').chars ? data.get('skins').chars[charId] : null;
  if (!Array.isArray(list)) return [];
  return list.map((s) => ({
    id: s.id,
    name: s.name || s.id,
    group: s.group || '',
    installed: !!skinSpine(charId, s.id),
    portrait: !!skinPortraitFile(charId, s.id),
    avatar: skinAvatar(charId, s.id),
  }));
}

/** A skin's own 180×360 half-body portrait URL (chars[charId].skins[skinId].portrait), or null. */
export function skinPortraitFile(charId, skinId) {
  const s = skinRecord(charId, skinId);
  return (s && typeof s.portrait === 'string' && s.portrait) || null;
}

/** The installed skin record of an operator (`chars[charId].skins[skinId]`), or null. */
function skinRecord(charId, skinId) {
  const chars = data.get('assets') && data.get('assets').chars;
  const rec = chars ? chars[charId] : null;
  return (rec && rec.skins && rec.skins[skinId]) || null;
}

/** The Spine entry a skin's model is drawn from, or null when this install does not have it. */
export const skinSpine = (charId, skinId) => {
  const s = skinRecord(charId, skinId);
  return (s && s.spine && s.spine.front) || null;
};

/** A skin's own 180×180 avatar (the picker's tile), or null (the operator's own face is used then). */
export function skinAvatar(charId, skinId) {
  const s = skinRecord(charId, skinId);
  return (s && typeof s.avatar === 'string' && s.avatar) || null;
}

/**
 * Whether a skin id is one this operator actually has (the picker's guard: a stored choice may name a skin another
 * build had, or a skin of a different operator).
 * @param {string} charId @param {string} skinId
 */
export function isSkinsSkin(charId, skinId) {
  const list = data.get('skins') && data.get('skins').chars ? data.get('skins').chars[charId] : null;
  return Array.isArray(list) && list.some((s) => s.id === skinId);
}

/** Load what the picker and the renderer read (the catalogue and the manifest that says what is installed). */
export function loadSkinData() {
  data.load('skins').catch(() => {});
  data.load('assets').catch(() => {});
}

// =====================================================================================================================
// 兼容导出：`skinsStore` / `setSkins`（大厅 UI mod 的 干员调配 会 import 这两个）
//
// 背景：上游 0.2.5 把皮肤当成「一个纯本地的选择」，所以那个 UI mod 直接从 skins.js 拿
// `skinsStore`（本地 store）与 `setSkins`。本作的皮肤是**有服务端同步的完整功能**
// （docs/SKINS.md：loadoutSync.setSkins 会持久化 + 同步到 room.skins，导入导出也带皮肤）。
//
// 所以这两个名字**不是**拿来降级的 shim，而是转发到本作真正的实现：`loadoutStore.skins` 就是那份选择，
// `setSkins` 用 loadoutSync 的那个（它写 localStorage 并触发同步）。mod 里那三处调用因此保持完整语义。
//
// 放在文件末尾避免循环 import：loadoutSync 已经 import 本模块的 cleanSkins / SKIN_PREF。
export const skinsStore = {
  /** @returns {{ entries: Record<string, string> }} 与上游 skinsStore 同形（`{ entries }`）。 */
  get: () => ({ entries: loadoutSyncRef()?.loadoutStore?.get?.().skins ?? {} }),
  /**
   * 上游的写入口。这里只接受 `{ entries }` 形状，转交给真正的 setSkins（持久化 + 同步）。
   * @param {{ entries?: Record<string, string> }} v
   */
  set(v) {
    const next = v && typeof v === 'object' && v.entries && typeof v.entries === 'object' ? v.entries : {};
    loadoutSyncRef()?.setSkins?.(next);
  },
};

/**
 * 真正的 `setSkins`（loadoutSync 版：持久化 + 同步到 room.skins）。
 *
 * 用惰性引用而不是顶层 `import`，因为 loadoutSync.js 会 import 本模块 —— 顶层互相 import 会成环。
 * @param {Record<string, string>} skins
 */
export function setSkins(skins) {
  const m = loadoutSyncRef();
  if (m?.setSkins) return m.setSkins(skins);
  return undefined;
}

/** 惰性拿到 loadoutSync 模块（浏览器里是同一个模块实例，import 只执行一次）。 */
let _loadoutSync = null;
function loadoutSyncRef() {
  return _loadoutSync;
}

/** 由 loadoutSync.js 在加载完成后回填（见那里的 registerSkinBridge）。 */
export function registerSkinBridge(mod) {
  _loadoutSync = mod;
}
