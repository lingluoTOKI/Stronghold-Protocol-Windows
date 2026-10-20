// Original local artwork; individual files load only when their cards are viewed.
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
export function ChallengeMedal({ kind, earned, label }) {
  if (kind === 'legacy-collection') return html`<svg class=${`challenge-medal${earned ? ' is-earned' : ''}`} viewBox="0 0 384 512" role="img" aria-label=${label}>
    <image href="/icons/challenge-medals-v2.webp" x="0" y="-512" width="1536" height="1024" /></svg>`;
  const key = kind;
  if (!/^[a-z0-9-]+$/i.test(key || '')) return null;
  return html`<img class=${`challenge-medal${earned ? ' is-earned' : ''}`} src=${'/icons/medals-v2/daily-' + key + '.webp'} loading="lazy" decoding="async" width="256" height="256" alt=${`${label} · ${earned ? t('已获得') : t('未获得')}`} />`;
}
