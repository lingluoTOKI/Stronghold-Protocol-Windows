// 皮肤 (skin) section of the 干员调配 screen's detail panel (docs/SKINS.md).
//
// Split like the other screens of this build: `SkinSectionView` is the pure render (it takes the selection and an
// on-pick callback, so the tests drive it directly) and `SkinSection` is the thin container that subscribes to the
// store and to the data files — screens/loadout.js names only <${SkinSection} chess=${chess} />.
//
// Every skin the catalogue lists is offered; one this install has no model for is shown as 未安装 and cannot be picked
// (the choice would draw the operator's own model anyway, so the tile would look like a lie).
//
// The choice is keyed by CHESS id (the piece the player fields) while the catalogue and the asset manifest are keyed by
// OPERATOR id — see ui/skins.js. Choosing is an out-of-match preference like the operator loadout, but it is mirrored
// to the server (room.skins, PUBLIC) and a running match takes it at once: a teammate sees the 时装 you picked.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, MicroLabel } from './components.js';
import { data } from '../data.js';
import { useStore, shallowEqual } from '../store.js';
import { t } from '../../../shared/i18n.js';
import { availableSkins, loadSkinData } from './skins.js';
import { loadoutStore, setSkin } from './loadoutSync.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const NONE = Object.freeze({});

/**
 * The 皮肤 section (pure): the tiles, the 已装配 badge and the 未安装 ones.
 * @param {{ chess: any, skins?: Record<string, string>, onPick?: (skinId: string|null) => void, ready?: boolean }} props
 *   `chess` = the chess record of the detail panel (its `charId` names the catalogue / the manifest, its `chessId` the
 *   stored choice); `skins` = the whole selection; `onPick(null)` clears one's choice
 */
export function SkinSectionView({ chess, skins = NONE, onPick = null, ready = true }) {
  const chessId = chess && chess.chessId;
  const charId = chess && chess.charId;
  if (!chessId || !charId) return null;
  if (!ready) {
    return html`<section class="lo-sec lo-sec--skin" data-testid="skin-section">
      <header class="lo-sec__head">
        <h3>${t('皮肤')}<${MicroLabel}>SKIN<//></h3>
        <span class="lo-sec__note">${t('正在载入皮肤数据…')}</span>
      </header>
    </section>`;
  }
  const list = availableSkins(charId);
  if (!list.length) return null; // this operator has no 时装 to offer — the section is absent, not empty
  const chosen = skins[chessId] || null;
  const none = list.every((x) => !x.installed);
  const noArtN = list.filter((x) => x.installed && !x.portrait).length;
  const pick = (skinId) => { if (typeof onPick === 'function') onPick(skinId); };

  return html`<section class="lo-sec lo-sec--skin" data-testid="skin-section">
    <header class="lo-sec__head">
      <h3>${t('皮肤')}<${MicroLabel}>SKIN<//></h3>
      <span class="lo-sec__note">${t('{n} 款时装可选', { n: list.length })}</span>
    </header>
    <div class="lo-skins" role="radiogroup" aria-label=${t('选择皮肤')}>
      <button type="button" role="radio" aria-checked=${chosen ? 'false' : 'true'} data-skin=""
        class=${cx('lo-skin', 'lo-skin--default', !chosen && 'is-on')} onClick=${() => pick(null)}>
        <span class="lo-skin__art">${art(avatarOf(charId))}</span>
        <span class="lo-skin__text">
          <b class="lo-skin__name">${t('默认')}</b>
          <span class="lo-skin__group num">DEFAULT</span>
        </span>
        ${chosen ? null : html`<span class="lo-skin__badge">${t('已装配')}</span>`}
      </button>
      ${list.map((x) => {
        const on = chosen === x.id;
        const off = !x.installed;
        // 时装本身有模型，但这个安装没有它的半身立绘：仍可选（模型会换），只是干员调配的半身位保留默认立绘
        // —— 说出来，免得看起来像「选了皮肤没生效」
        const noArt = !off && !x.portrait;
        return html`<button key=${x.id} type="button" role="radio" aria-checked=${on ? 'true' : 'false'}
            data-skin=${x.id} disabled=${off}
            class=${cx('lo-skin', on && 'is-on', off && 'is-off', noArt && 'is-noart')}
            onClick=${() => { if (!off) pick(x.id); }}>
          <span class="lo-skin__art">${art(x.avatar || avatarOf(charId))}</span>
          <span class="lo-skin__text">
            <b class="lo-skin__name">${x.name}</b>
            <span class="lo-skin__group">${x.group || 'SPECIAL'}</span>
          </span>
          ${off ? html`<span class="lo-skin__badge lo-skin__badge--off">${t('未安装')}</span>`
            : on ? html`<span class="lo-skin__badge">${t('已装配')}</span>`
              : noArt ? html`<span class="lo-skin__badge lo-skin__badge--soft">${t('无半身像')}</span>` : null}
        </button>`;
      })}
    </div>
    ${noArtN ? html`<p class="lo-skin__hint">${t('其中 {n} 款时装没有自己的半身立绘：装上后在战场上是这身时装，干员调配的半身位仍用默认立绘', { n: noArtN })}</p>` : null}
    ${none ? html`<p class="lo-skin__hint">${t('这几款时装只有立绘与头像，缺少战斗模型（Spine），选它们上场时仍用干员本体的模型')}</p>` : null}
  </section>`;
}

/** The 皮肤 section of the detail panel: the store's selection and the data files, then SkinSectionView. */
export function SkinSection({ chess }) {
  const skins = useStore((v) => v.skins || NONE, shallowEqual, loadoutStore);
  const [, bump] = useState(0);
  const chessId = chess && chess.chessId;

  // the catalogue and the manifest arrive asynchronously (this screen opens them) — data.subscribe fires on every load,
  // so a skin installed while the overlay is open shows up without a timer
  useEffect(() => {
    if (!chessId) return undefined;
    loadSkinData();
    let dead = false;
    const off = data.subscribe(() => { if (!dead) bump((n) => n + 1); });
    return () => { dead = true; off(); };
  }, [chessId]);

  const ready = data.status('assets') === 'ready' && data.status('skins') === 'ready';
  return html`<${SkinSectionView} chess=${chess} skins=${skins} ready=${ready} onPick=${(skinId) => setSkin(chessId, skinId)} />`;
}

/** A tile's picture, or the empty stand-in (a skin with no avatar of its own falls back to the operator's). */
const art = (url) => (url ? html`<img src=${url} alt="" loading="lazy" />` : html`<span class="lo-skin__art--none"></span>`);

/** The operator's own avatar (the 默认 tile), by OPERATOR id. */
function avatarOf(charId) {
  const chars = data.get('assets') && data.get('assets').chars;
  const rec = chars ? chars[charId] : null;
  return (rec && typeof rec.avatar === 'string' && rec.avatar) || null;
}
