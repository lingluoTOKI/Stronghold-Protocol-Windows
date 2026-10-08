// ui/gameLogic/shortcuts.js — in-match keyboard shortcuts and the player's key map (设置 → 快捷键, 0.2.0: the community
// request 「快捷键可不可以自己设置」, the owner's decision of 2026-10-07). Re-exported from ../gameLogic.js.

import { isObj } from './shared.js';


// ---- the key map ------------------------------------------------------------------------------------------------

/** The rebindable shortcuts in the settings' order — the UPSTREAM 0.2.0 baseline (the ready key also pauses / resumes a
 * solo battle). Anything that does not specify a profile sees exactly these six (vanilla == upstream 1303321). */
export const HOTKEY_ACTIONS = Object.freeze(['refresh', 'freeze', 'levelUp', 'retreat', 'sell', 'ready']);

/** Default key of each upstream action (a KeyboardEvent.code): the keys of 0.1.4, so nothing changes for a player who
 * never rebinds. */
export const DEFAULT_HOTKEYS = Object.freeze({ refresh: 'KeyR', freeze: 'KeyF', levelUp: 'KeyD', retreat: 'KeyQ', sell: 'KeyX', ready: 'Space' });

// Rhine-only extensions (the owner's fan build; legacy has no shortcuts file): buy / chat / battle speed. Gated to the
// rhine profile — never present upstream, so KeyE stays idle and Space stays the only ready key under vanilla.
export const RHINE_EXTRA_ACTIONS = Object.freeze(['buy', 'chat', 'speed']);
export const RHINE_EXTRA_HOTKEYS = Object.freeze({ buy: 'KeyB', chat: 'KeyE', speed: 'KeyV' });

/** The bindable actions for a data profile: upstream six, plus buy/chat/speed only under rhine (the extras slot in
 * before `ready`, matching the original nine-key layout). */
export const hotkeyActionsFor = (profile) => {
  if (profile !== 'rhine') return [...HOTKEY_ACTIONS];
  const out = [];
  for (const a of HOTKEY_ACTIONS) { if (a === 'ready') out.push(...RHINE_EXTRA_ACTIONS); out.push(a); }
  return out;
};

/** The default key map for a data profile: upstream six, with buy/chat/speed added only under rhine. */
export const defaultHotkeysFor = (profile) => (profile === 'rhine' ? { ...DEFAULT_HOTKEYS, ...RHINE_EXTRA_HOTKEYS } : { ...DEFAULT_HOTKEYS });

/** The actions a given key map actually carries (its own keys) — so a 6-key upstream map never resolves buy/chat/speed
 * and a 9-key rhine map does, without the caller knowing the profile. */
const actionsOf = (keys) => Object.keys(keys || {});


// The keys a shortcut may use → the `key` value each types on a US layout (lower case): letters, digits, Space, the
// punctuation keys, and six named keys whose `key` equals their `code`. Everything else stays with the interface: Esc
// (closes; cancels a rebind), Tab / Enter / the arrows (focus, buttons, the facing wheel, lists), F1–F12 (the browser's),
// the modifiers.
const KEY_OF = new Map([
  ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => [`Key${c}`, c.toLowerCase()]),
  ...[...'0123456789'].map((c) => [`Digit${c}`, c]),
  ['Space', ' '], ['Backquote', '`'], ['Minus', '-'], ['Equal', '='], ['BracketLeft', '['], ['BracketRight', ']'],
  ['Backslash', '\\'], ['Semicolon', ';'], ['Quote', "'"], ['Comma', ','], ['Period', '.'], ['Slash', '/'],
  ...['Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].map((k) => [k, k]),
]);
const CODE_OF = new Map([...KEY_OF].map(([code, key]) => [key, code]));

/** A key press's `key`, lower case when it is one character ('' when absent). */
const keyValue = (e) => {
  const k = e?.key;
  return typeof k !== 'string' ? '' : k.length === 1 ? k.toLowerCase() : k;
};

/**
 * Whether a KeyboardEvent.code may be a shortcut's key.
 * @param {any} code
 * @returns {boolean}
 */
export const isBindableCode = (code) => typeof code === 'string' && KEY_OF.has(code);

/**
 * The label a key is shown with ('KeyQ' → 'Q', 'Digit1' → '1', 'Comma' → ',', 'Space', 'Delete'); '' for any other code.
 * @param {any} code
 */
export function hotkeyLabel(code) {
  if (!isBindableCode(code)) return '';
  if (code === 'Space') return 'Space';
  const k = KEY_OF.get(code);
  return k.length === 1 ? k.toUpperCase() : k;
}

/**
 * Sanitize a persisted key map: each action keeps a saved key that may be a shortcut, else gets its default; a map in
 * which two actions would share a key is bad data — the defaults instead. The action set and defaults come from
 * `defaults` (the upstream six by default; the nine-key rhine map under rhine), so vanilla stays byte-identical.
 * @param {any} raw
 * @param {Record<string,string>} [defaults]
 * @returns {Record<string, string>}
 */
export function sanitizeHotkeys(raw, defaults = DEFAULT_HOTKEYS) {
  const r = isObj(raw) && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const a of actionsOf(defaults)) out[a] = Object.hasOwn(r, a) && isBindableCode(r[a]) ? r[a] : defaults[a];
  return new Set(Object.values(out)).size === actionsOf(defaults).length ? out : { ...defaults };
}

/**
 * Bind `action` to `code`. A key another action holds is swapped, never shared: that action takes the old key of
 * `action`, so every action keeps exactly one key and no key does two things.
 * @param {any} keys the current map
 * @param {string} action
 * @param {string} code
 * @returns {{ keys: Record<string, string>, changed: boolean, swapped: string|null }} swapped: the action that took the old key
 */
export function rebindHotkey(keys, action, code) {
  const cur = { ...(isObj(keys) && !Array.isArray(keys) ? keys : DEFAULT_HOTKEYS) };
  if (!actionsOf(cur).includes(action) || !isBindableCode(code) || cur[action] === code) return { keys: cur, changed: false, swapped: null };
  const swapped = actionsOf(cur).find((a) => cur[a] === code) ?? null;
  const next = { ...cur, [action]: code };
  if (swapped) next[swapped] = cur[action];
  return { keys: next, changed: true, swapped };
}

/** Whether a map is the default one (its own default set). @param {any} keys @param {Record<string,string>} [defaults] */
export const isDefaultHotkeys = (keys, defaults = DEFAULT_HOTKEYS) => {
  const k = sanitizeHotkeys(keys, defaults);
  return actionsOf(defaults).every((a) => k[a] === defaults[a]);
};

/**
 * The bindable key a key press names: the character typed — the label on the player's keycap (AZERTY, Dvorak) — else
 * the physical key (a non-Latin layout, an IME, Shift + a digit); null when neither may be a shortcut.
 * @param {{ key?: string, code?: string }} e
 * @returns {string|null}
 */
export function hotkeyOf(e) {
  const typed = CODE_OF.get(keyValue(e));
  if (typed) return typed;
  return isBindableCode(e?.code) ? e.code : null;
}

/**
 * The one lookup of every shortcut handler: the action a key press triggers under the key map — the action bound to the
 * character typed, else the one bound to the physical key (as the fixed keys of 0.1.4 matched `code === 'KeyR' ||
 * key === 'r'`: a Russian layout or an IME still works by position). No modifier or focus checks (shortcutFor).
 * @param {{ key?: string, code?: string }} e
 * @param {any} [keys] the player's map (settings `keys`); the defaults when omitted
 * @returns {'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'|null}
 */
export function actionForKey(e, keys = DEFAULT_HOTKEYS) {
  // A saved map is valid when every action has exactly one distinct key; a corrupt one (two actions on one key) acts as
  // the upstream defaults, never resolving the doubled key.
  const clean = (keys && Object.keys(keys).length && new Set(Object.values(keys)).size === Object.keys(keys).length) ? keys : DEFAULT_HOTKEYS;
  const find = (code) => (code ? actionsOf(clean).find((a) => clean[a] === code) ?? null : null);
  return find(CODE_OF.get(keyValue(e))) ?? find(typeof e?.code === 'string' ? e.code : null);
}

// keys that only modify another (pressed alone while the settings wait for a key: ignored)
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper', 'Fn', 'FnLock', 'CapsLock',
  'NumLock', 'ScrollLock', 'Symbol', 'SymbolLock']);

/**
 * What a key press does while the settings wait for a new key: Esc cancels (the dialog stays open), Tab leaves (the focus
 * moves on), a lone modifier or an auto-repeat is ignored, a key held with Ctrl / ⌘ / Alt or one the interface keeps is
 * refused (the wait goes on), any other key is the new key.
 * @param {{ key?: string, code?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, repeat?: boolean }} e
 * @returns {{ kind: 'cancel'|'leave'|'ignore' } | { kind: 'refuse', reason: 'modifier'|'reserved', name: string } | { kind: 'key', code: string }}
 */
export function captureHotkey(e) {
  const key = typeof e?.key === 'string' ? e.key : '';
  if (key === 'Escape') return { kind: 'cancel' };
  if (key === 'Tab') return { kind: 'leave' };
  if (!e || e.repeat || MODIFIER_KEYS.has(key)) return { kind: 'ignore' };
  const name = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key || e.code || '?';
  if (e.ctrlKey || e.metaKey || e.altKey) return { kind: 'refuse', reason: 'modifier', name };
  const code = hotkeyOf(e);
  return code ? { kind: 'key', code } : { kind: 'refuse', reason: 'reserved', name };
}


// ---- keyboard ---------------------------------------------------------------------------------------------------

/**
 * Map a keydown to a game shortcut under the player's key map (defaults: R refresh, F freeze, D level-up, Q retreat,
 * X sell, Space ready) or Esc (close; fixed). A shortcut key means its action even while a HUD button has focus (a
 * mouse click leaves the shop card / 刷新 focused, and Space must not re-trigger it); the caller prevents the button's
 * own activation. Enter still activates buttons (it cannot be a shortcut). Nothing while Ctrl / ⌘ / Alt is held or a
 * text field has the focus.
 * @param {{ key?: string, code?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, repeat?: boolean, target?: any }} e
 * @param {any} [keys] the player's map (settings `keys`)
 * @returns {'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'|'escape'|null}
 */
export function shortcutFor(e, keys = DEFAULT_HOTKEYS) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target;
  const tag = t && typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return null;
  if (e.key === 'Escape') return 'escape';
  if (e.repeat) return null;
  return actionForKey(e, keys);
}

/**
 * Whether the facing wheel swallows a key press: no ready / shop action while a facing is chosen — Space (a focused
 * button must not activate either) and every key bound to a shortcut.
 * @param {{ key?: string, code?: string }} e
 * @param {any} [keys] the player's map
 */
export const facingSwallows = (e, keys = DEFAULT_HOTKEYS) => e?.key === ' ' || actionForKey(e, keys) != null;

/**
 * Whether a press on the field closes the open detail card: a card opened from the field itself (an own piece — tap,
 * right-click or long press — or a battle / teammate unit). Shop, reward, bond-member and intel (enemy) cards stay.
 * @param {{ kind?: string }|null|undefined} detail
 */
// a card opened BY a field press (a piece, a unit, a special terrain tile: issue #184) closes on the next press of
// the field; the ones opened from the shop / hand / HUD stay until their own close button (or the flow that opened them)
export const closesOnFieldPress = (detail) => detail?.kind === 'piece' || detail?.kind === 'unit' || detail?.kind === 'terrain';

/**
 * Whether an open overlay swallows a game shortcut: a modal / the guide own the keyboard (Esc included — they close
 * themselves); the 本局信息 / 敌方情报 drawer is a dialog too — only Esc (it closes the drawer) passes, the other
 * shortcuts never act behind it.
 * @param {'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'|'escape'|null} act shortcutFor
 * @param {{ modal?: boolean, drawer?: boolean }} open
 */
export function shortcutBlocked(act, { modal = false, drawer = false } = {}) {
  if (!act) return true;
  if (modal) return true;
  return !!drawer && act !== 'escape';
}
