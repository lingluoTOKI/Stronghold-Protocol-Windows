import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
import { funReport } from '../../../shared/funReport.js';

export function FunReport({ record }) {
  const badges = funReport(record);
  if (!badges.length) return null;
  return html`<section class="local-activities" data-testid="fun-report">
    <h2>${t('趣味战报')}</h2>
    <p>${t('个人娱乐称号，不参与官方评语或全服排名。')}</p>
    <div class="local-activities__grid">${badges.map(b => html`<article key=${b.name}>
      <h3>${t(b.name)}</h3><p>${t(b.detail, { n: b.n })}</p>
    </article>`)}</div>
  </section>`;
}

