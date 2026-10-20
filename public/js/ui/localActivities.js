import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { t, N_, tName } from '../../../shared/i18n.js';
import { challengeDay } from './dailyChallenges.js';
import { identity } from '../net.js';
import { MedalBoard } from './medalBoard.js';
import { ChallengeMedal } from './challengeMedal.js';
import { ChallengeIdentity } from './challengeIdentity.js';
import { CovenantRequirement } from './covenantRequirement.js';
const LEVELS = [N_('基础挑战'), N_('进阶挑战'), N_('高阶挑战')];
export function DailyActivities() {
  const [showBoard, setShowBoard] = useState(false);
  const [now, setNow] = useState(Date.now), [board, setBoard] = useState(null), [failed, setFailed] = useState(false);
  const [division, setDivision] = useState('solo'), [revision, setRevision] = useState(0), [ranking, setRanking] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(0), [collection, setCollection] = useState(null), [showCollection, setShowCollection] = useState(false);
  const [visible, setVisible] = useState(() => !globalThis.document?.hidden);
  const day = challengeDay(now);
  useEffect(() => {
    const tick = () => { setNow(Date.now());setVisible(!document.hidden); };
    const timer = setInterval(tick, 15000);document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer);document.removeEventListener('visibilitychange', tick); };
  }, []);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController(), token = identity.getToken();setFailed(false);setBoard(null);
    fetch(`/api/daily-challenges?division=${division}&ranking=${ranking ? 1 : 0}`, { credentials: 'same-origin', signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async r => { if (!r.ok) throw new Error('unavailable');return r.json(); })
      .then(v => { if (!v.ok || v.division !== division || !Array.isArray(v.challenges)) throw new Error('invalid');if (!controller.signal.aborted) setBoard(v); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [day, revision, division, ranking, visible]);
  useEffect(() => {
    if ((!showCollection && !showBoard) || !visible) return;
    const controller = new AbortController(), token = identity.getToken();
    fetch('/api/achievements', { credentials: 'same-origin', signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async r => { if (!r.ok) throw new Error('unavailable');return r.json(); })
      .then(v => { if (!controller.signal.aborted) setCollection(v); }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [showCollection, showBoard, revision, visible]);
  const completed = new Set(board?.self?.completed || []);
  const seconds = Math.ceil((Date.parse(day + 'T00:00:00+08:00') + 86400000 - now) / 1000);
  const refresh = () => { if (Date.now() - lastRefresh < 15000) return;setLastRefresh(Date.now());setRevision(v => v + 1); };
  return html`<div data-testid="daily-activities"><section class="local-activities">
    <h2>${t('每日挑战')} <small>${day} · ${t('北京时间')} · ${t('距换日：{time}', { time: `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2,'0')}` })}</small></h2>
    <div class="daily-division" role="group" aria-label=${t('榜单分组')}>
      <${Button} variant=${division === 'solo' ? 'primary' : 'secondary'} aria-pressed=${division === 'solo'} onClick=${() => setDivision('solo')}>${t('单人榜')}<//>
      <${Button} variant=${division === 'coop' ? 'primary' : 'secondary'} aria-pressed=${division === 'coop'} onClick=${() => setDivision('coop')}>${t('多人榜（2–6 真人）')}<//>
      <${Button} class="medal-showcase-entry" variant="secondary" aria-haspopup="dialog" onClick=${() => setShowBoard(true)}>${t('奖章背景板')}<//>
    </div>
    ${showBoard ? html`<${MedalBoard} data=${collection} division=${division} daily=${true} failed=${failed} onClose=${() => setShowBoard(false)} />` : null}
    <p><strong>${t('入榜要求：终极模拟、官方 1 倍首领血量、全程无 AI 队友及 AI 托管。')}</strong></p>
    <div class="permanent-tools"><details class="medal-preview"><summary>${t('获得规则与计次说明')}</summary>
      <p>${t('21 个目标分成七天，每天三项，周内目标不重复，第八天重复第一天。每项 1 分，每榜每天最多 3 分，同分并列。')}</p>
      <p>${t('单人榜仅收独立模拟；多人榜仅收开局 2–6 名真人的同盟模拟。开局人数决定分组，不按结算剩余人数改组。')}</p>
      <p>${t('任意队友开启过 AI 托管，整局不计分，关闭托管也不恢复资格；普通掉线重连不会直接取消资格。')}</p>
      <p>${t('开局锁定当天目标，跨零点仍计入开局日期；超过 8 天的对局不补入已清理的日榜。已获得的每日章永久收藏。')}</p>
      <p>${t('不同盟约目标可分不同对局完成，不要求同一局同时激活。全部目标要求本人存活通关。')}</p>
      <p>${t('旧成绩和旧章保留，轮换从更新后的新一天开始。本地导入不能增加服务器积分。')}</p>
    </details>
    <${ChallengeIdentity} onRestored=${() => { setCollection(null);setRevision(v => v + 1); }} /></div>
    ${failed ? html`<p role="alert">${t('排行榜暂不可用，未用本地战绩替代服务器积分。')}</p>` : null}
    ${!board && !failed ? html`<p role="status">${t('正在读取服务器挑战档案…')}</p>` : null}
    <div class="local-activities__grid">${(board?.challenges || []).map(c => html`<article key=${c.id} class=${completed.has(c.id) ? 'is-complete' : ''}>
      <span class="local-activities__state">${t(LEVELS[c.tier])} · 1 ${t('积分')}</span><${ChallengeMedal} kind=${c.id} earned=${completed.has(c.id)} label=${t(c.name)} />
      <h3>${t(c.name)}</h3><p>${t(c.goal)}</p><${CovenantRequirement} covenant=${c.covenant} />
      <strong class="local-activities__state">${completed.has(c.id) ? t('已完成') : t('待挑战')}</strong>
    </article>`)}</div>
    <p>${t('本榜今日积分：{n} / 3', { n: board?.self?.points || 0 })} ${completed.size === 3 ? '✓' : ''}</p>
    ${board?.preview ? html`<details class="medal-preview"><summary>${t('未来七天目标')}</summary>${board.preview.map(p => html`<p key=${p.day}><strong>${p.day}</strong> · ${p.challenges.map(c => `${t(c.name)}${c.covenant ? ' · ' + tName(c.covenant.bondName) : ''}`).join(' / ')}</p>`)}</details>` : null}
    <details class="medal-preview" onToggle=${e => setShowCollection(e.currentTarget.open)}><summary>${t('每日章收藏')}</summary>
      ${showCollection && collection?.legacyDaily?.[division]?.collection ? html`<div class="daily-collection"><${ChallengeMedal} kind="legacy-collection" earned=${true} label=${t('协约履行章')} /><p>${t('协约履行章')} · ${t('旧章')} · ${t('已获得')}</p></div>` : null}
      ${showCollection ? html`<div class="local-activities__grid">${(collection?.dailyDefinitions || []).map(c => html`<article key=${c.id}>
        <${ChallengeMedal} kind=${c.id} earned=${!!collection?.daily?.[division]?.[c.id]} label=${t(c.name)} /><h3>${t(c.name)} ${tName(c.covenant?.bondName || '')}</h3><p>${t(c.goal)}</p><${CovenantRequirement} covenant=${c.covenant} />
        <p>${collection?.daily?.[division]?.[c.id] ? t('已获得') : t('未获得')}</p></article>`)}</div>` : null}
    </details>
  </section>
  <section class="local-activities daily-ranking" data-testid="daily-ranking"><h2>${t('每日挑战积分榜')}</h2>
    <${Button} variant="secondary" onClick=${() => setRanking(v => !v)}>${ranking ? t('收起排行榜') : t('查看排行榜')}<//>
    ${ranking ? html`<${Button} variant="secondary" disabled=${now - lastRefresh < 15000} onClick=${refresh}>${t('刷新榜单')}<//>
      <p>${t('本服每日榜 · 展示前 100 条，个人名次单独显示 · 同分不比完成时间')}</p>
      ${board?.self?.rank ? html`<p>${t('我的名次：{rank} · 积分：{points}', { rank: board.self.rank, points: board.self.points })}</p>` : null}
      ${board?.rows?.length ? html`<table><thead><tr><th>${t('名次')}</th><th>${t('博士代号')}</th><th>${t('积分')}</th></tr></thead><tbody>${board.rows.map((r,i) => html`<tr key=${i} class=${r.mine ? 'is-self' : ''}><td>${r.rank}</td><td>${r.name}</td><td>${r.points} / 3</td></tr>`)}</tbody></table>` : html`<p>${t('今日暂无完成挑战的博士。')}</p>`}` : null}
  </section></div>`;
}
