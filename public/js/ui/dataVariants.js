// 干员调配's 口径 switches (DESIGN §23.42): the room's 干员练度 (满练度 or the official status) and 部署位上限 (12 or the
// official 8). The tables and the patch helpers live in shared/dataVariants.js — the data build, the server and this
// module read the same ones.
//
// Precedence: a ROOM's `variants` (the host's choice, broadcast in room.state) decides what the match plays; without a
// room the player's stored preference is used, and that preference also seeds `room.create` — so hosting remembers the
// last choice.
//
// The switches are match-level (the operator pool is shared by every seat), host-only and refused once a match runs: the
// new value applies from the NEXT match, exactly like the 干员调配 loadout ("修改将在下一局生效").
//
// Both are baked into the built files, so the LOCAL REVISION arrives as a patch (`data/official.json`, served by the
// server with the fan pack's own records merged in) which applyPatch() writes in place on the records every screen
// shares (`data.js` hands out the same objects), recording what it overwrote (per switch, per path) so switching one
// back restores the shipped values without a second copy of the data, and so the switches flip independently.
// `data/` ships the OFFICIAL 口径 (shared/dataVariants.js DEFAULT_VARIANTS): a switch ON means "patch it to 满练度 / 12".
import { store, createStore, useStore, loadPref, savePref } from '../store.js';
import { data } from '../data.js';
import {
  VARIANT_KEYS, VARIANT_DATA_KEYS, normalizeVariants, sameVariants,
  variantPatch, applyPatch, inversePatch,
} from '../../../shared/dataVariants.js';
import { N_ } from '../../../shared/i18n.js';

export const PREF_KEY = 'variants';

/** The data file the 练度 / 部署位 patches come from (`data/official.json`, served merged with the fan pack's own). */
const PATCH_SOURCE = 'official';

/** A 口径 with `key` on and every other switch at its default — the patch of ONE switch (for the per-switch inverse). */
const aloneOn = (key) => Object.fromEntries(VARIANT_KEYS.map((k) => [k, k === key]));

/** The 口径 of every switch, as the UI renders it (label + the text of both states). */
export const VARIANT_ROWS = Object.freeze([
  Object.freeze({
    key: 'training', micro: 'TRAINING', label: N_('干员练度'),
    on: N_('满练度'), off: N_('官方'), onNote: N_('满练度：技能 7、精锐 专三 + 3 级模组 + 星级满级'), offNote: N_('官方：按官方等级与技能（精锐 专一）'),
  }),
  Object.freeze({
    key: 'deploy', micro: 'DEPLOY', label: N_('部署位上限'),
    on: N_('12 位'), off: N_('8 位'), onNote: N_('上限 12（人事部文档 +1 = 13）'), offNote: N_('官方上限 8（人事部文档 +1 = 9）'),
  }),
]);

/** Persisted local preference (default: the 口径 data/ ships with). */
export const variantStore = createStore(normalizeVariants(loadPref(PREF_KEY, null)));

variantStore.subscribe((s) => savePref(PREF_KEY, normalizeVariants(s)));
// a preference change must re-patch the loaded data too (in a room the host's value still wins — syncVariants reads the
// room first), so 干员调配's roster / 局内数值 and the 装备总览 follow the switches immediately
variantStore.subscribe(() => syncVariants());

/** Preact hook: the stored preference object. */
export const useVariantPrefs = () => useStore((s) => s, sameVariants, variantStore);

/**
 * Revision of the patched data, bumped whenever a switch rewrote a record. The patch is in place and notifies nobody, so
 * a screen that MEMOIZED tier- or status-derived rows (the 干员调配 roster, the two codex lists, the stat blocks) must
 * depend on this to re-render when the 口径 changes under it — a room can switch it while such an overlay is open.
 */
export const variantDataStore = createStore({ rev: 0 });
export const useVariantRevision = () => useStore((s) => s.rev, Object.is, variantDataStore);

/** The 口径 a room plays with (`room.state.variants`), or the local preference when there is no room. */
export function variantsOf(room, pref = variantStore.get()) {
  return room && room.variants && typeof room.variants === 'object' ? normalizeVariants(room.variants) : normalizeVariants(pref);
}

// `${switchKey}` → `${section}` → patch path → the value a patch overwrote (the shipped 口径; recorded once)
const inverse = new Map();
// `${section}` → the data object the recorded baselines belong to: `data.js` replaces a file's object on (re)load, and a
// baseline recorded against the NEW records would be a patched value — that is what the identity check throws away.
const baselineRef = new Map();
const inverseMap = (key, section) => {
  let bySection = inverse.get(key);
  if (!bySection) inverse.set(key, bySection = new Map());
  let m = bySection.get(section);
  if (!m) bySection.set(section, m = new Map());
  return m;
};

/** Forget the baselines of a section whose records were replaced (they point at objects nobody holds any more). */
function forgetBaselines(section) {
  for (const bySection of inverse.values()) bySection.get(section)?.clear();
}

/** Restore the paths the `key` switch's patch overwrote, and forget them (`$del` drops a key it had created). */
function revertSwitch(key) {
  const bySection = inverse.get(key);
  if (!bySection) return 0;
  let n = 0;
  for (const [section, m] of bySection) {
    if (!m.size) continue;
    const target = data.get(section);
    if (target) n += applyPatch(target, inversePatch(m));
    m.clear();
  }
  return n;
}

/**
 * Patch the browser's loaded maps to `variants`, in place: every screen reads the same objects from `data.js`, so the
 * roster, 局内数值, the 装备总览 and the detail cards all follow without knowing about the switches. Safe to call before
 * the data (or the patch file) is loaded — the load's own notify re-applies.
 * @param {any} variants @returns {number} records changed
 */
export function applyVariantData(variants) {
  const v = normalizeVariants(variants);
  let n = 0;
  const files = [data.get(PATCH_SOURCE)];
  for (const key of VARIANT_DATA_KEYS) {
    if (!v[key]) { n += revertSwitch(key); continue; } // this switch is back at the shipped 口径
    const sections = variantPatch(files, aloneOn(key));
    if (!sections) continue; // the patch file has not arrived (yet) — the load notify re-applies
    for (const [section, patch] of Object.entries(sections)) {
      const target = data.get(section);
      if (!target || typeof target !== 'object') continue;
      if (baselineRef.get(section) !== target) { forgetBaselines(section); baselineRef.set(section, target); }
      n += applyPatch(target, patch, inverseMap(key, section));
    }
  }
  return n;
}

/** Apply the 口径 the current room plays with (or the local preference with no room). @returns {number} records changed */
export function syncVariants() {
  const v = variantsOf(store.get().room);
  // the patch file is only needed by the built-in-value switches; fetching it is what makes them visible
  if ((v.training || v.deploy) && !data.get(PATCH_SOURCE)) data.load(PATCH_SOURCE);
  const n = applyVariantData(v);
  if (n) variantDataStore.set({ rev: variantDataStore.get().rev + 1 });
  return n;
}

/** @type {{ send: (t: string, msg: object) => void } | null} */
let netRef = null;
/** @type {(() => void) | null} the `data.js` subscription of the LAST install (installing twice must not double-patch) */
let uninstall = null;

/**
 * Wire the switches to the network and to the data store (called once from main.js).
 * @param {{ net?: { send: Function } }} [deps]
 */
export function installVariants({ net } = {}) {
  if (net) netRef = net;
  // a (re)loaded data file arrives un-patched: the fresh records need the 口径 again. Re-applying is enough — a section
  // whose records were replaced is spotted by identity (see baselineRef), so a notify that arrives twice cannot make a
  // patched value look like the shipped one.
  uninstall?.();
  uninstall = data.subscribe(() => syncVariants());
  syncVariants();
}

/** Store a preference (no room, or the player is not the host): it decides the next room this player hosts. */
export function setVariantPref(key, on) {
  if (!VARIANT_KEYS.includes(key)) return;
  variantStore.set({ [key]: !!on });
}

/**
 * Can this player switch the running room's 口径 right now? Host of a room whose match has not started.
 * @returns {boolean}
 */
export function canSendVariants() {
  const s = store.get();
  const room = s.room;
  return !!(netRef && room && !room.inMatch && room.hostId === s.me.playerId);
}

/** Ask the server to switch one switch of the room's 口径 (host, before the match). @returns {boolean} whether it was sent */
export function sendVariant(key, on) {
  if (!canSendVariants() || !VARIANT_KEYS.includes(key)) return false;
  netRef.send('room.variants', { key, on: !!on });
  return true;
}
