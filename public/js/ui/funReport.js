// Compatibility path for previously loaded clients; entertainment titles have been retired.
import { html } from './components.js';
import { ACHIEVEMENTS } from '../../../shared/achievements.js';
import { t } from '../../../shared/i18n.js';

export function NewAchievements({ newAchievements = [] }) {
  const added = Array.isArray(newAchievements) ? newAchievements.filter(a => ACHIEVEMENTS.some(c => c.id === a?.id) && ['solo', 'coop'].includes(a.division)) : [];
  if (!added.length) return null;
  return html`<section class="local-activities permanent-new" data-testid="new-achievements">
    <h2>${t('本局新获得 · 永久成就')}</h2>
    <ul>${added.map(a => html`<li key=${a.id}>${t(ACHIEVEMENTS.find(c => c.id === a.id).name)} · ${a.division === 'solo' ? t('单人收藏') : t('多人收藏（2–6 真人）')}</li>`)}</ul>
    <p>${t('已加入永久收藏，不参与每日积分。请在「统计 → 永久成就」查看章面和获得时间。')}</p>
  </section>`;
}
export const FunReport = NewAchievements;
