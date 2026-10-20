// Compatibility path for previously loaded clients; entertainment titles have been retired.
import { useState } from '../../vendor/hooks.module.js';
import { PermanentMedal } from './permanentMedal.js';
import { ChallengeMedal } from './challengeMedal.js';
import { claimAchievementCelebration } from './achievementNotices.js';
import { html, Button, Modal } from './components.js';
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
  const changes = (challengeFeedback?.changes || []).filter(c => c.after > c.before);
  return html`<section class="local-activities permanent-new reward-report" data-testid="new-achievements">
    ${challengeFeedback?.reason ? html`<div class="reward-reason"><h2>${t('本局未计入挑战')}</h2><p>${t(REASONS[challengeFeedback.reason] || REASONS.identity)}</p></div>` : null}
    ${added.length ? html`<h2>${t('本局新获得 · 永久成就')}</h2><div class="reward-medals">${added.map(a => html`<article key=${a.id} class="reward-medal"><${PermanentMedal} id=${a.id} earned=${true} label=${t(ACHIEVEMENTS.find(c => c.id === a.id).name)} /><div><span class="reward-first">${t('首次获得')}</span><h3>${t(ACHIEVEMENTS.find(c => c.id === a.id).name)}</h3><p>${a.division === 'solo' ? t('单人收藏') : t('多人收藏（2–6 真人）')}</p><small>${t('已永久收藏')}</small></div></article>`)}</div>` : null}
    ${challengeFeedback && !challengeFeedback.reason ? html`<div class="reward-daily-heading"><h2>${t('本局挑战成果')}</h2><strong>${t('本局新增积分：{n}', { n: challengeFeedback.pointsAdded || 0 })}</strong></div><p>${challengeFeedback.day} · ${t('积分以本局合计为准，重复完成不会重复加分。')}</p>
      <div class="reward-tasks">${(challengeFeedback.tasks || []).map(c => { const done = challengeFeedback.completed?.includes(c.id);return html`<article key=${c.id} class=${done ? 'is-complete' : ''}><${ChallengeMedal} kind=${c.id} earned=${!!done} label=${t(c.name)} /><div><h3>${t(c.name)}</h3><strong>${done ? t('目标完成') : t('未达成')}</strong><p>${tName(c.covenant?.bondName || '')} ${t(c.goal)}</p></div></article>`; })}</div>
      <p>${t('每日章获得后永久收藏；这里展示本局完成情况，不代表首次获得。')}</p>` : null}
    ${changes.length ? html`<h3>${t('永久成就进度')}</h3><div class="reward-progress">${changes.map(c => html`<div key=${c.id}><span>${t(ACHIEVEMENTS.find(a => a.id === c.id)?.name || c.id)}</span><strong>${c.before} → ${c.after} / ${c.target}</strong><progress value=${c.after} max=${c.target}></progress></div>`)}</div>` : null}
  </section>`;
}
// Available directly from the main settlement, without opening the full battle report.
export function AchievementResultPanel({ result }) {
  const [open, setOpen] = useState(() => claimAchievementCelebration(result?.newAchievements));
  if (!result?.newAchievements?.length && !result?.challengeFeedback) return null;
  return html`<div class="reward-launch"><${Button} variant="secondary" onClick=${() => setOpen(true)}>${t('本局挑战成果')}${result?.newAchievements?.length ? html`<span class="achievement-new">${t('新')}</span>` : null}<//>
    <${Modal} open=${open} title=${t('本局挑战成果')} onClose=${() => setOpen(false)} class="reward-modal" actions=${html`<${Button} onClick=${() => setOpen(false)}>${t('返回')}<//>`}>
      <${NewAchievements} newAchievements=${result?.newAchievements} challengeFeedback=${result?.challengeFeedback} />
    <//>
  </div>`;
}

export const FunReport = NewAchievements;
