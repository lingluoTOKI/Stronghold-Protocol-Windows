// This page and its atlas load only when the player deliberately opens the permanent collection.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { t, N_ } from '../../../shared/i18n.js';
import { identity } from '../net.js';
import { MedalBoard } from './medalBoard.js';
import { PermanentMedal } from './permanentMedal.js';
import { ChallengeIdentity } from './challengeIdentity.js';
import { CovenantRequirement } from './covenantRequirement.js';
const CATEGORIES = [['all', N_('全部')], ['general', N_('通用')], ['core', N_('核心盟约')], ['other', N_('其他盟约')], ['collection', N_('总章')], ['legacy', N_('旧章')]];

export function AchievementCollection() {
  const [showBoard, setShowBoard] = useState(false);
  const [category, setCategory] = useState('all'), [filter, setFilter] = useState('all');
  const [data, setData] = useState(null), [failed, setFailed] = useState(false);
  const [division, setDivision] = useState('solo'), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();const token = identity.getToken();
    setFailed(false);
    fetch('/api/achievements', { credentials: 'same-origin', signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async r => { if (!r.ok) throw new Error('unavailable');return r.json(); })
      .then(value => {
        if (!value.ok || !Array.isArray(value.achievements) || !value.unlocked || typeof value.unlocked !== 'object') throw new Error('invalid collection');
        if (!controller.signal.aborted) setData(value);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [revision]);
  const unlocked = data?.unlocked?.[division] || {};
  const progress = data?.progress?.[division] || {};
  return html`<section class="local-activities permanent-collection" data-testid="achievement-collection">
    <h2>${t('永久成就收藏册')}</h2>
    <p><strong>${t('永久保存，不随每日榜重置，不增加挑战积分。')}</strong></p>
    <div class="daily-division" role="group" aria-label=${t('榜单分组')}>
      <${Button} size="sm" variant=${division === 'solo' ? 'primary' : 'secondary'} aria-pressed=${division === 'solo'} onClick=${() => setDivision('solo')}>${t('单人收藏')}<//>
      <${Button} size="sm" variant=${division === 'coop' ? 'primary' : 'secondary'} aria-pressed=${division === 'coop'} onClick=${() => setDivision('coop')}>${t('多人收藏（2–6 真人）')}<//>
      <${Button} class="medal-showcase-entry" variant="secondary" aria-haspopup="dialog" onClick=${() => setShowBoard(true)}>${t('奖章背景板')}<//>
    </div>
    ${showBoard ? html`<${MedalBoard} data=${data} division=${division} failed=${failed} onClose=${() => setShowBoard(false)} />` : null}
    <div class="permanent-tools"><details class="medal-preview"><summary>${t('获得规则与计次说明')}</summary>
    <p>${t('旧成就、获得日期和进度保留。新增累计章承接可核实的次数下限，无法证明的历史次数不补算。本地导入不补发服务器成就。')}</p>
    <p>${t('获得条件：终极模拟、官方 1 倍首领血量、全程无 AI 队友及 AI 托管。')}</p>
    <p>${t('单人榜仅收独立模拟；多人榜仅收开局 2–6 名真人的同盟模拟。开局人数决定分组，不按结算剩余人数改组。')}</p>
    <p>${t('任意队友开启过 AI 托管，整局不计分，关闭托管也不恢复资格；普通掉线重连不会直接取消资格。')}</p>
    <p>${t('无漏怪要求个人整局漏怪总数为零，不是仅有若干无漏怪回合。所有成就都须本人存活到结算。')}</p>
    <p>${t('盟约章按最后一场战斗本人有效盟约档位判断，不借用队友盟约，不要求全局维持；旧炎章保留 6 人档，新章要求 9 人档。')}</p>
    <p>${t('每场符合条件的结算最多累计一次；未满次数时保存进度，达到目标后永久解锁。')}</p>
    </details>
    <${ChallengeIdentity} onRestored=${() => { setData(null);setRevision(v => v + 1); }} /></div>
    <div class="collection-filters" role="group" aria-label=${t('成就分类')}>${CATEGORIES.map(([id,label]) => html`<${Button} key=${id} variant=${category === id ? 'primary' : 'secondary'} onClick=${() => setCategory(id)}>${t(label)}<//>`)}</div>
    <div class="collection-filters" role="group" aria-label=${t('获得状态')}>${[['all',t('全部')],['earned',t('已获得')],['locked',t('未获得')]].map(([id,label]) => html`<${Button} key=${id} variant=${filter === id ? 'primary' : 'secondary'} onClick=${() => setFilter(id)}>${label}<//>`)}</div>
    ${failed ? html`<p role="alert">${t('永久成就暂不可用，请关闭后重试。')}</p>` : null}
    ${!data && !failed ? html`<p role="status">${t('正在读取永久收藏…')}</p>` : null}
    <div class="local-activities__grid permanent-grid">${(data?.achievements || []).filter(a => (category === 'all' || a.category === category) && (filter === 'all' || (filter === 'earned' ? !!unlocked[a.id] : !unlocked[a.id]))).map(a => html`<article key=${a.id} class=${unlocked[a.id] ? 'permanent-card is-complete' : 'permanent-card'}>
      <${PermanentMedal} id=${a.id} earned=${!!unlocked[a.id]} label=${t(a.name)} />
      <h3>${t(a.name)}</h3><p>${t(a.goal)}</p><${CovenantRequirement} covenant=${a.count ? a : null} />
      <p class="permanent-progress-label">${t('累计进度：{n} / {target}', { n: progress[a.id] || 0, target: a.target })}</p>
      <progress class="permanent-progress" value=${progress[a.id] || 0} max=${a.target} aria-label=${t(a.name)}></progress>
      <p>${unlocked[a.id] ? t('首次获得：{time}', { time: new Date(unlocked[a.id]).toLocaleString() }) : t('未获得')}</p>
    </article>`)}</div>
  </section>`;
}
