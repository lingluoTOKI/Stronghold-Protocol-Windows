// ui/gameLogic/settings.js — settings defaults and sanitising. Re-exported from ../gameLogic.js.

import { VOICE_LANGS, sanitizeVoiceOverrides } from '../../voicePrefs.js';
import { OFFICIAL_FX } from '../../render/vfx/tier.js';
export { VOICE_LANGS } from '../../voicePrefs.js';

import { clamp, isObj } from './shared.js';
import { DEFAULT_HOTKEYS, sanitizeHotkeys } from './shortcuts.js';


// ---- settings ------------------------------------------------------------------------------------------------------

/**
 * The operator voice dubs (settings 语音语言): 'cn' 中文 (`audio.voice`, the default), 'jp' 日本語 (`audio.voiceJp`),
 * 'en' English (`audio.voiceEn`) and 'kr' 한국어 (`audio.voiceKr`), each falling back to the Chinese line it lacks
 * (public/js/audio.js voiceLine). Not tied to the interface language. `voiceNative` is the 本土语言 switch: an
 * operator who has `audio.voiceNative` speaks that dub unless their own override says otherwise.
 */

/**
 * 分辨率 / RESOLUTION — how many device pixels the field canvas is allowed to use.
 *
 * Split out of 画质 (quality) on the project owner's request (2026-10-08): a phone whose operator models read blurry
 * needs MORE PIXELS for the sprites, and folding that into 画质 would also turn on the expensive board features the
 * player may not want (the 3D board's PBR fill, shadows). These are pixel-ratio CAPS applied on top of the device's
 * own `devicePixelRatio`, so 'native' (=2) means "up to 2× CSS pixels" and never upscales beyond the screen.
 *   auto  — the 画质 setting decides (upstream behaviour, the default)
 *   720p / 1080p / 1440p — a fixed cap, for a phone that renders at 3× and cannot afford it
 *   native — always the highest cap (2), the "as sharp as the screen allows" choice
 * The 3D board keeps its own, lower cap: it never exceeds the sprite cap, and stays below it on the mid tiers.
 */
export const RESOLUTION_MODES = Object.freeze(['auto', '720p', '1080p', '1440p', 'native']);
export const RES_CAP = Object.freeze({ '720p': 1, '1080p': 1.5, '1440p': 2, native: 2 });
/** The pixel-ratio cap a resolution mode asks for, or null for `auto` (the caller then keeps its quality default). */
export function resolutionCap(res) {
  return RES_CAP[res] ?? null;
}
/** The 3D board's own cap: it never exceeds the sprite cap, and stays below it on the mid tiers. */
export function boardResolutionCap(res) {
  const cap = resolutionCap(res);
  if (cap == null) return null;
  return cap >= 2 ? 2 : cap <= 1 ? 1 : 1.25;
}

/** Keep automatic rendering work bounded when fullscreen increases the canvas area. */
export function canvasPixelRatio(width, height, deviceRatio, cap, pixelBudget) {
  const area = Math.max(1, width * height);
  return Math.max(0.75, Math.min(deviceRatio || 1, cap, Math.sqrt(pixelBudget / area)));
}

/**
 * The steps of 设置 →「文字大小」 (textSize): the interface text root `--t` of css/theme.css — 'sm' is the design's own
 * sizes (`--t: 1rem`), the others lift the phone's 40 px root by a floor and grow the desktop gently. Text only: the
 * layout root `1rem` (and with it the field camera, the detail card's side and the DOM fallback board) never moves.
 */
export const TEXT_SIZES = Object.freeze(['sm', 'md', 'lg', 'xl']);

/** keys: the in-match shortcuts' key map (ui/gameLogic/shortcuts.js; settings → 快捷键). voiceLang: VOICE_LANGS.
 *  textSize: TEXT_SIZES (css/theme.css `--t`, applied by ui/settings.js applyTextSize). menuBgm: MENU_BGM (主界面音乐).
 *  brightness / warmth: 地图「亮度」「冷暖度」(ui/settings.js，实时作用于 3D 战场；
 *    移植自 mod「地图亮度冷暖度控件」maplight v1.0 —— brightness: true = mod 亮档 / false = mod 暗档 /
 *    **null = 0.3.0 官方原始档（默认）**，用官方档才不会把新 PBR 反射/法线细节冲成死白;
 *    warmth: 0 = 冷 · 0.5 = 中性 · 1 = 暖)。
 *  resolution: RESOLUTION_MODES (像素比上限，参考上游 0.2.5 settings.js；'auto' 让 画质 决定)。 */
export const DEFAULT_SETTINGS = Object.freeze({ bgm: 0.6, sfx: 0.8, voice: 0.8, voiceLang: 'jp', voiceOverrides: Object.freeze({}), muted: false, damageNumbers: true, officialDamageNumbers: false, officialFx: 'auto', quality: 'high', resolution: 'auto', textSize: 'sm', menuBgm: 'contract', brightness: null, warmth: 0.5, keys: DEFAULT_HOTKEYS });
const QUALITIES = ['high', 'medium', 'low'];
const MENU_BGM = ['contract', 'alliance'];

/**
 * Sanitize persisted settings.
 * @param {any} raw
 * @returns {{ bgm: number, sfx: number, voice: number, voiceLang: 'cn'|'jp', voiceOverrides: Record<string, string>, muted: boolean, damageNumbers: boolean, officialDamageNumbers: boolean, officialFx: 'auto'|'off'|'lite'|'full', quality: 'high'|'medium'|'low', menuBgm: 'contract'|'alliance',
 *   textSize: 'sm'|'md'|'lg'|'xl', keys: Record<'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready', string> }}
 */
export function sanitizeSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const vol = (v, d) => (Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, 0, 1) : d);
  return {
    bgm: vol(r.bgm, DEFAULT_SETTINGS.bgm),
    sfx: vol(r.sfx, DEFAULT_SETTINGS.sfx),
    voice: vol(r.voice, DEFAULT_SETTINGS.voice),
    voiceLang: VOICE_LANGS.includes(r.voiceLang) ? r.voiceLang : DEFAULT_SETTINGS.voiceLang,
    voiceNative: r.voiceNative === true,
    voiceOverrides: sanitizeVoiceOverrides(r.voiceOverrides),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    damageNumbers: typeof r.damageNumbers === 'boolean' ? r.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
    officialDamageNumbers: typeof r.officialDamageNumbers === 'boolean' ? r.officialDamageNumbers : false,
    officialFx: OFFICIAL_FX.includes(r.officialFx) ? r.officialFx : DEFAULT_SETTINGS.officialFx,
    // brightness 允许三态：true = mod 亮档 / false = mod 暗档 / 其它（null·缺失）= 0.3.0 官方原始档
    brightness: typeof r.brightness === 'boolean' ? r.brightness : DEFAULT_SETTINGS.brightness,
    warmth: Number.isFinite(r.warmth) ? clamp(r.warmth, 0, 1) : DEFAULT_SETTINGS.warmth,
    quality: QUALITIES.includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality,
    resolution: RESOLUTION_MODES.includes(r.resolution) ? r.resolution : DEFAULT_SETTINGS.resolution,
    textSize: TEXT_SIZES.includes(r.textSize) ? r.textSize : DEFAULT_SETTINGS.textSize,
    menuBgm: MENU_BGM.includes(r.menuBgm) ? r.menuBgm : DEFAULT_SETTINGS.menuBgm,
    keys: sanitizeHotkeys(r.keys),
  };
}
