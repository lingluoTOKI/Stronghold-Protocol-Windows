// Original generated etched artwork, one shared transparent WebP atlas; no external image hosting.
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
const cells = { rounds: [0, 0], equipment: [1, 0], merges: [2, 0], perfect: [3, 0],
  bonds: [0, 1], victory: [1, 1], refresh: [2, 1], core: [3, 1], collection: [0, 1] };
export function ChallengeMedal({ kind, earned, label }) {
  const [col, row] = cells[kind] || cells.collection;
  return html`<svg class=${`challenge-medal${earned ? ' is-earned' : ''}`} viewBox="0 0 384 512" role="img" aria-label=${`${label} · ${earned ? t('已获得') : t('未获得')}`}>
    <image href="/icons/challenge-medals-v2.webp" x=${-col * 384} y=${-row * 512} width="1536" height="1024" />
  </svg>`;
}
