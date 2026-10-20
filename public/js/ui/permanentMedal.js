// Original local artwork; individual files load only when their cards are viewed.
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
export function PermanentMedal({ id, earned, label }) {
  const key = id;
  if (!/^[a-z0-9-]+$/i.test(key || '')) return null;
  return html`<img class=${`permanent-medal${earned ? ' is-earned' : ''}`} src=${'/icons/medals-v2/' + key + '.webp'} loading="lazy" decoding="async" width="256" height="256" alt=${`${label} · ${earned ? t('已获得') : t('未获得')}`} />`;
}
