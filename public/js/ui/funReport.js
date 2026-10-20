import { html } from './components.js';
import { ACHIEVEMENTS } from '../../../shared/achievements.js';
import { t } from '../../../shared/i18n.js';
import { funReport } from '../../../shared/funReport.js';

export function FunReport({ record, newAchievements = [] }) {
  const badges = funReport(record);
  const added = Array.isArray(newAchievements) ? newAchievements.filter(a => ACHIEVEMENTS.some(c => c.id === a?.id) && ['solo', 'coop'].includes(a.division)) : [];
  if (!badges.length && !added.length) return null;
  return html`<section class="local-activities" data-testid="fun-report">
    <h2>${t('趣味战报')}</h2>
    ${added.length ? html`<div class="permanent-new" data-testid="new-achievements"><h3>${t('本局新获得 · 永久成就')}</h3>
      <ul>${added.map(a => html`<li key=${a.id}>${t(ACHIEVEMENTS.find(c => c.id === a.id).name)} · ${a.division === 'solo' ? t('单人收藏') : t('多人收藏（2–6 真人）')}</li>`)}</ul>
      <p>${t('已加入永久收藏，不参与每日积分。请在「统计 → 永久成就」查看章面和获得时间。')}</p></div>` : null}
    <p>${t('个人娱乐称号，不参与官方评语或全服排名。')}</p>
    <div class="local-activities__grid">${badges.map(b => html`<article key=${b.name}>
      <h3>${t(b.name)}</h3><p>${t(b.detail, { n: b.n })}</p>
    </article>`)}</div>
  </section>`;
}

