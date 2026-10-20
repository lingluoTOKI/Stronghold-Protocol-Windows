import { html } from './components.js';
import { t, tName } from '../../../shared/i18n.js';
export function CovenantRequirement({ covenant: c }) {
  if (!c) return null;
  return html`<p class="covenant-requirement">${tName(c.bondName)} · ${t('最高档：{n}', { n: c.count })}
    ${c.exact ? t('恰好此数量，且盟约有效') : c.golden ? t('按场上精锐数量计算') : c.hand ? t('计入手牌，按盟约有效人数计算') : t('按盟约有效人数计算')}</p>`;
}
