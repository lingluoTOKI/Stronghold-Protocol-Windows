import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { t, N_ } from '../../../shared/i18n.js';
import { challengeDay } from './dailyChallenges.js';
import { identity } from '../net.js';
import { ChallengeMedal } from './challengeMedal.js';
import { ChallengeIdentity } from './challengeIdentity.js';
const LEVELS = [N_('基础挑战'), N_('进阶挑战'), N_('高阶挑战')];

export function DailyActivities() {
  const [now, setNow] = useState(() => Date.now());
  const [board, setBoard] = useState(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [division, setDivision] = useState('solo');
  const [visible, setVisible] = useState(() => !globalThis.document?.hidden);
  const day = challengeDay(now);
  useEffect(() => {
    if (!lastRefresh) return;
    const timer = setTimeout(() => setNow(Date.now()), 15000);
    return () => clearTimeout(timer);
  }, [lastRefresh]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const token = identity.getToken();
    setFailed(false);
    setBoard(null);
    fetch(`/api/daily-challenges?division=${division}`, { credentials: 'same-origin', signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async response => {
        if (!response.ok) throw new Error('daily unavailable');
        const value = await response.json();
        if (!value.ok || value.division !== division || !Array.isArray(value.challenges) || !Array.isArray(value.rows)) throw new Error('invalid daily data');
        if (!controller.signal.aborted) setBoard(value);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [day, revision, division, visible]);
  useEffect(() => {
    const tick = () => { setNow(Date.now());setVisible(!globalThis.document?.hidden); };
    const timer = setInterval(tick, 60000);
    globalThis.document?.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); globalThis.document?.removeEventListener('visibilitychange', tick); };
  }, []);
  const completed = new Set(board?.self?.completed || []);
  const allDone = board?.challenges?.length === 3 && board.challenges.every(c => completed.has(c.id));
  const refresh = () => {
    if (Date.now() - lastRefresh < 15000) return;
    setLastRefresh(Date.now());setRevision(v => v + 1);
  };
  return html`<div data-testid="daily-activities">
    <section class="local-activities">
      <h2>${t('每日挑战')} <small>${board?.day || day} · ${t('北京时间')}</small></h2>
      <div class="daily-division" role="group" aria-label=${t('榜单分组')}>
        <${Button} variant=${division === 'solo' ? 'primary' : 'secondary'} size="sm" aria-pressed=${division === 'solo'} onClick=${() => setDivision('solo')}>${t('单人榜')}<//>
        <${Button} variant=${division === 'coop' ? 'primary' : 'secondary'} size="sm" aria-pressed=${division === 'coop'} onClick=${() => setDivision('coop')}>${t('多人榜（2–6 真人）')}<//>
      </div>
      <p><strong>${t('入榜要求：终极模拟、官方 1 倍首领血量、全程无 AI 队友及 AI 托管。')}</strong></p>
      <p>${t('单人榜仅收独立模拟；多人榜仅收开局 2–6 名真人的同盟模拟。开局人数决定分组，不按结算剩余人数改组。')}</p>
      <p>${t('任意队友开启过 AI 托管，整局不计分，关闭托管也不恢复资格；普通掉线重连不会直接取消资格。')}</p>
      <p>${t('每天固定三项，均须本人存活到结算。一局可同时完成多项；每项每榜 1 分，每榜每日最多 3 分，同分并列。')}</p>
      <p>${t('北京时间零点重置，跨日对局按服务器结算日期计分。单人、多人积分及蚀刻章分别记录，本地导入不能入榜。')}</p>
      <p>${t('服务器自动登记本浏览器身份；同名不合并，同一浏览器共享身份。请导出恢复码，以便清理数据或换设备后找回成绩。')}</p>
      <${ChallengeIdentity} onRestored=${() => setRevision(v => v + 1)} />
      <details class="medal-preview">
        <summary>${t('查看蚀刻章获得前后效果')}</summary>
        <p>${t('效果示意，不代表已经获得。完成挑战后，灰色蚀刻章恢复彩色金属章面；没有战斗属性加成。')}</p>
        <div class="medal-preview__pair">
          <figure><${ChallengeMedal} kind="rounds" earned=${false} label=${t('效果示意')} /><figcaption>${t('未获得')}</figcaption></figure>
          <figure><${ChallengeMedal} kind="rounds" earned=${true} label=${t('效果示意')} /><figcaption>${t('完成后获得')}</figcaption></figure>
        </div>
      </details>
      ${failed ? html`<p role="alert">${t('排行榜暂不可用，未用本地战绩替代服务器积分。')}</p>` : null}
      ${!board && !failed ? html`<p role="status">${t('正在读取服务器挑战档案…')}</p>` : null}
      <div class="local-activities__grid">${(board?.challenges || []).map(c => html`<article key=${c.id} class=${completed.has(c.id) ? 'is-complete' : ''}>
        <span class="local-activities__state">${t(LEVELS[c.tier])}</span>
        <${ChallengeMedal} kind=${c.id} earned=${completed.has(c.id)} label=${t(c.name)} />
        <span class="local-activities__state">${completed.has(c.id) ? t('已获得') : t('待挑战')}</span>
        <h3>${t(c.name)}</h3><p>${t(c.goal)}</p>
      </article>`)}</div>
      ${board ? html`<div class="daily-collection"><${ChallengeMedal} kind="collection" earned=${allDone} label=${t('协约履行章')} />
        <div><h3>${t('协约履行章')}</h3><p>${t('当日 3 项全部完成后获得组合蚀刻章，不额外加分。')}</p>
        <p>${t('本榜今日积分：{n} / 3', { n: board.self?.points || 0 })}</p></div></div>` : null}
    </section>
    <section class="local-activities daily-ranking" data-testid="daily-ranking">
      <h2>${t('每日挑战积分榜')}</h2>
      <p><strong>${division === 'solo' ? t('单人榜') : t('多人榜（2–6 真人）')}</strong></p>
      <p>${t('本服每日榜 · 展示前 100 条，个人名次单独显示 · 同分不比完成时间')}</p>
      <${Button} variant="secondary" size="sm" disabled=${now - lastRefresh < 15000} onClick=${refresh}>${t('刷新榜单')}<//>
      ${board?.self ? html`<p>${t('我的名次：{rank} · 积分：{points}', { rank: board.self.rank, points: board.self.points })}</p>` : null}
      ${board?.rows.length ? html`<table><thead><tr><th>${t('名次')}</th><th>${t('博士代号')}</th><th>${t('积分')}</th></tr></thead>
        <tbody>${board.rows.map((r, i) => html`<tr key=${i} class=${r.mine ? 'is-self' : ''}><td>${r.rank}</td><td>${r.name}</td><td>${r.points} / 3</td></tr>`)}</tbody></table>`
        : board ? html`<p>${t('今日暂无完成挑战的博士。')}</p>` : null}
    </section>

  </div>`;
}
