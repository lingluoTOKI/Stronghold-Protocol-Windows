// Compatibility path for previously loaded clients; entertainment titles have been retired.
import { html } from './components.js';
import { ACHIEVEMENTS } from '../../../shared/achievements.js';
import { t, N_, tName } from '../../../shared/i18n.js';

const REASONS = {
  difficulty: N_('本局未计入：需要终极模拟。'),
  'boss-hp': N_('本局未计入：需要官方 1 倍首领血量。'),
  ai: N_('本局未计入：存在 AI 队友或曾开启 AI 托管。'),
  test: N_('本局未计入：测试对局不计成绩。'),
  content: N_('本局未计入：玩法插件对局不计成绩。'),
  mode: N_('本局未计入：需要单人独立模拟或 2–6 真人同盟模拟。'),
  survival: N_('本局未计入：需要本人存活通关。'),
  identity: N_('本局无法登记挑战成绩，请确认身份恢复码与服务器状态。'),
};
export function NewAchievements({ newAchievements = [], challengeFeedback = null }) {
  const added = Array.isArray(newAchievements) ? newAchievements.filter(a => ACHIEVEMENTS.some(c => c.id === a?.id) && ['solo', 'coop'].includes(a.division)) : [];
  if (!added.length && !challengeFeedback) return null;
  return html`<section class="local-activities permanent-new" data-testid="new-achievements">
    ${challengeFeedback?.reason ? html`<p>${t(REASONS[challengeFeedback.reason] || REASONS.identity)}</p>` : null}
    ${challengeFeedback && !challengeFeedback.reason ? html`<h2>${t('本局挑战成果')}</h2><p>${challengeFeedback.day} · ${t('本局新增积分：{n}', { n: challengeFeedback.pointsAdded || 0 })}</p>
      <ul>${(challengeFeedback.tasks || []).map(c => html`<li key=${c.id}>${t(c.name)} ${tName(c.covenant?.bondName || '')} · ${challengeFeedback.completed?.includes(c.id) ? t('已完成') : t('未达成')}<small> · ${t(c.goal)}</small></li>`)}</ul>
      <ul>${(challengeFeedback.changes || []).map(c => html`<li key=${c.id}>${t(ACHIEVEMENTS.find(a => a.id === c.id)?.name || c.id)} · ${c.before} → ${c.after} / ${c.target}</li>`)}</ul>` : null}
    ${added.length ? html`<h2>${t('本局新获得 · 永久成就')}</h2>` : null}
    <ul>${added.map(a => html`<li key=${a.id}>${t(ACHIEVEMENTS.find(c => c.id === a.id).name)} · ${a.division === 'solo' ? t('单人收藏') : t('多人收藏（2–6 真人）')}</li>`)}</ul>
    ${added.length ? html`<p>${t('已加入永久收藏，不参与每日积分。请在「统计 → 永久成就」查看章面和获得时间。')}</p>` : null}
  </section>`;
}
export const FunReport = NewAchievements;
