// shared/dataVariants.js — the two runtime 口径 switches of a match (DESIGN §23.41 / §23.42). `data/` ships the
// OFFICIAL tables; a switch that is `true` turns the local revision ON, `false` leaves the official values the files
// already hold:
//
//   training  干员练度  满练度 (`--max-training`: 技能 7 / 精锐 专三+模组3 / 星级满级) or the official status
//   deploy    部署位    12 (`--max-deploy`) or the official 8 (人事部文档 +1 either way: 13 / 9)
//             人事部文档 is a RELATIVE +1 since 2026-10-10 (`equip_destory_deployment_cnt_add` → ps.deployCapBonus),
//             so this switch only has to move `config.economy.deployCap` for it — the `items` / `effects` sections below
//             were needed while the item carried an absolute "cap = 9" and must NOT hold a rewritten `count` for it any
//             more (a stale `count: 13` would now read as +13 deploy).
//
// Both are baked into the built files (stats, skills, talents, module blackboards, token variants, an item's text,
// `config.economy.deployCap`), so they cannot be recomputed at runtime: the build writes the LOCAL revision's values of
// every field a switch moves into `data/official.json` (and a content pack's `variants.json` for its own records) — a patch over
// the official tables the files hold — and the match resolves them with withDataVariants() / the browser with applyPatch().
//
// TIER_DEVIATIONS below (DESIGN §23.41: 录武官 and 谢拉格不融冰 at 3 阶) is NOT switchable — the build writes the deviated
// tier and the runtime never touches it; the table keeps both columns so the deviation can be read against the official
// tiers (教程 `docs/research/*`) and a build without it stays one edit away.
//
// The variant patch format (data/official.json): `{ [switch]: { [section]: { … } } }`, where a section is a patch over
// the same-named data section (`chess`, `tokens`, `items`, `effects`, `config`). A patch mirrors the shape of the value
// it patches: objects recurse, and a LEAF is `{ $: value }` — or `{ $del: true }` for a key the official build does not
// have. Everything else (arrays included) is atomic and replaced wholesale.

import { N_ } from './i18n.js';

/** The switch keys, in the order the UI lists them. */
export const VARIANT_KEYS = Object.freeze(['training', 'deploy']);

/** The 口径 the built files hold: the official tables (`false` = the build ran without the local revision). */
export const DEFAULT_VARIANTS = Object.freeze({ training: false, deploy: false });

/** The switches that move built-in VALUES (i.e. read `data/official.json`). */
export const VARIANT_DATA_KEYS = Object.freeze(['training', 'deploy']);

/** Which data sections each switch moves (the build writes the delta per switch; the applier merges them). */
export const VARIANT_SECTIONS = Object.freeze({
  training: Object.freeze(['chess', 'tokens', 'config']),
  deploy: Object.freeze(['config', 'items', 'effects']),
});

/**
 * The 口径 of a raw value: only an explicit `true` turns a switch on — a missing / malformed field of an older client,
 * a `null` room, … must never silently move the data away from the official tables the files hold.
 * @param {any} raw @returns {{ training: boolean, deploy: boolean }}
 */
export function normalizeVariants(raw) {
  const out = {};
  for (const key of VARIANT_KEYS) out[key] = !!(raw && raw[key] === true);
  return out;
}

/** Is `raw` the 口径 the built data already holds (nothing to patch)? @param {any} raw @returns {boolean} */
export function isDefaultVariants(raw) {
  const v = normalizeVariants(raw);
  return VARIANT_KEYS.every((key) => !v[key]);
}

/** The two 口径 are equal? @param {any} a @param {any} b @returns {boolean} */
export function sameVariants(a, b) {
  const va = normalizeVariants(a), vb = normalizeVariants(b);
  return VARIANT_KEYS.every((key) => va[key] === vb[key]);
}

// ===== 商店品阶 (fixed by the build, DESIGN §23.41) ============================================================

/**
 * Shop-tier deviations (DESIGN §23.41): two records the owner sells one tier lower than the official tables say. Keyed
 * by the NORMAL id; the elite record (`…_b`) and both qualities of an item follow through the same key. NOT a runtime
 * switch — `tools/build-data.mjs` writes `deviated` and the runtime never looks at a record's tier; `official` is
 * kept so the deviation can be read against the official tables (and the build can be flipped back in one edit).
 * @type {Readonly<Record<string, { official: number, deviated: number, name: string }>>}
 */
export const TIER_DEVIATIONS = Object.freeze({
  chess_char_5_23_a: Object.freeze({ official: 5, deviated: 3, name: N_('录武官') }),
  chess_item_5_02_e_a: Object.freeze({ official: 5, deviated: 3, name: N_('谢拉格不融冰') }),
});

export const TIER_DEVIATION_IDS = Object.freeze(Object.keys(TIER_DEVIATIONS));

// ===== the built-in values (training / deploy): a patch over the built data ======================================

/** A leaf of a variant patch: `{ $: value }`, or `{ $del: true }` for a key the official build does not have. */
const isLeaf = (node) => !!node && typeof node === 'object' && !Array.isArray(node) && (Object.hasOwn(node, '$') || node.$del === true);

/**
 * Merge two patches over the SAME value (two switches, or the official and the fan pack's files). Nested patch objects
 * combine key by key — a shallow spread would drop one of two switches that patch the same sub-object (both move
 * `config.build`); a leaf always replaces whatever it meets, since leaves are whole values.
 * @param {object|undefined} a @param {object|undefined} b @returns {object|undefined}
 */
export function mergePatch(a, b) {
  if (!a) return b;
  if (!b) return a;
  const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isLeaf(a) || isLeaf(b) || !plain(a) || !plain(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Object.hasOwn(out, k) ? mergePatch(out[k], v) : v;
  return out;
}

/**
 * A canonical JSON string (object keys sorted) — the comparison used by the build's own composition check and the tests
 * that compare a built data directory with a patched one. Key ORDER of two builds may differ, values may not.
 * @param {any} v @returns {string}
 */
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}

/**
 * The difference between the shipped section and its official twin, as a variant patch (see the file header). `undefined`
 * when the two are equal.
 * @param {any} official @param {any} shipped @returns {object | undefined}
 */
export function diffVariant(official, shipped) {
  if (canonicalJson(official) === canonicalJson(shipped)) return undefined;
  const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!plain(official) || !plain(shipped)) return official === undefined ? { $del: true } : { $: official };
  let out = null;
  for (const k of new Set([...Object.keys(official), ...Object.keys(shipped)])) {
    const d = diffVariant(official[k], shipped[k]);
    if (d !== undefined) (out ??= {})[k] = d;
  }
  return out ?? undefined;
}

/**
 * The patch to apply for `variants`, merged over the given variant files (`data/official.json`, and
 * a content pack's `variants.json` when one is loaded — its sections patch the same `chess` / `tokens` maps the
 * server merges the pack into).
 * @param {Array<object|null|undefined>} files variant files
 * @param {any} variants
 * @returns {Record<string, object> | null} `{ section: patch }`, or null when nothing has to change
 */
export function variantPatch(files, variants) {
  const v = normalizeVariants(variants);
  const out = {};
  let any = false;
  for (const file of files) {
    if (!file || typeof file !== 'object') continue;
    for (const key of VARIANT_DATA_KEYS) {
      if (!v[key]) continue;
      const sections = file[key];
      if (!sections || typeof sections !== 'object') continue;
      for (const [name, patch] of Object.entries(sections)) {
        if (!patch || typeof patch !== 'object') continue;
        // two files may patch the same section (official + fan pack): their keys are disjoint (ids), and a shared
        // sub-object (config.build) is merged, not replaced
        out[name] = mergePatch(out[name], patch);
        any = true;
      }
    }
  }
  return any ? out : null;
}

/**
 * A copy of `node` with `patch` applied, copying ONLY the branches the patch walks into (the server's data is frozen and
 * shared, so it must never be mutated). Leaves replace their branch; `$del` drops the key.
 * @param {any} node @param {object} patch @returns {any}
 */
export function patchedCopy(node, patch) {
  const out = Array.isArray(node) ? [...node] : { ...(node && typeof node === 'object' ? node : {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (isLeaf(v)) { if (v.$del) delete out[k]; else out[k] = v.$; }
    else out[k] = patchedCopy(node && typeof node === 'object' ? node[k] : undefined, v);
  }
  return out;
}

/**
 * In-place `patch` application (the browser's data store hands the same records to every screen). Records the values it
 * overwrites as an INVERSE patch in `inverse` (keyed by patch path), so the caller can switch back to the shipped 口径
 * without keeping a second copy of the data: an inverse leaf is `{ $: previous }`, or `{ $del: true }` when the path did
 * not exist. A path already recorded is never overwritten (the first record IS the shipped value).
 * @param {any} target @param {object} patch @param {Map<string, object> | null} [inverse]
 * @param {string} [path] @returns {number} leaves written
 */
export function applyPatch(target, patch, inverse = null, path = '') {
  let n = 0;
  if (!target || typeof target !== 'object') return n;
  for (const [k, v] of Object.entries(patch)) {
    const at = path ? `${path}.${k}` : k;
    if (isLeaf(v)) {
      const had = target && typeof target === 'object' && Object.hasOwn(target, k);
      if (inverse && !inverse.has(at)) inverse.set(at, had ? { $: target[k] } : { $del: true });
      if (!target || typeof target !== 'object') continue;
      if (v.$del) delete target[k]; else target[k] = v.$;
      n++;
    } else {
      if (!target[k] || typeof target[k] !== 'object') {
        if (inverse && !inverse.has(at)) inverse.set(at, { $del: true });
        target[k] = Array.isArray(v) ? [] : {};
      }
      n += applyPatch(target[k], v, inverse, at);
    }
  }
  return n;
}

/**
 * The inverse of a recorded application: an inverse map (see applyPatch) becomes a patch again. Keys whose parent was
 * itself recorded as missing are dropped by the applier (its parent is deleted anyway).
 * @param {Map<string, object>} inverse @returns {object}
 */
export function inversePatch(inverse) {
  const root = {};
  for (const [path, leaf] of inverse) {
    const parts = path.split('.');
    let node = root;
    for (const p of parts.slice(0, -1)) node = node[p] ??= {};
    node[parts[parts.length - 1]] = leaf;
  }
  return root;
}

/**
 * A copy of a data object with the chosen 口径 applied (the variant patches of `data/official.json`). Returns `data`
 * itself when nothing has to change — the shipped data already holds the local revision, so the default path keeps the
 * object identity (and with it sim/simdata.js's DataSource cache).
 * @param {object} data server data object (frozen; never mutated)
 * @param {any} variants
 * @param {Array<object|null|undefined>} [files] variant files
 */
export function withDataVariants(data, variants, files = [data && data.official, data && data['official-custom']]) {
  const v = normalizeVariants(variants);
  const sections = variantPatch(files, v);
  if (!sections) return data;
  const out = { ...data };
  for (const [name, patch] of Object.entries(sections)) {
    if (!out[name] || typeof out[name] !== 'object') continue;
    out[name] = patchedCopy(out[name], patch);
  }
  return out;
}
