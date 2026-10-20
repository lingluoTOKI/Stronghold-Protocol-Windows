// A dedicated six-medal atlas, deliberately imported only by the permanent collection page.
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
const ids = ['ultimate-clear', 'flawless-clear', 'hidden-core', 'bond-yan', 'bond-laterano', 'bond-kjerag'];
export function PermanentMedal({ id, earned, label }) {
  const index = ids.indexOf(id);
  if (index < 0) return null;
  return html`<svg class=${`permanent-medal${earned ? ' is-earned' : ''}`} viewBox="0 0 256 256" role="img" aria-label=${`${label} · ${earned ? t('已获得') : t('未获得')}`}>
    <image href="/icons/permanent-medals-v1.webp" x=${-(index % 3) * 256} y=${-Math.floor(index / 3) * 256} width="768" height="512" />
  </svg>`;
}
