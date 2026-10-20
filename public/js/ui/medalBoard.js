// Opt-in, read-only full-screen showcase. No fetches, polling or unlock mutations.
import { render } from '../../vendor/preact.module.js';
import { useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
import { t } from '../../../shared/i18n.js';
import { PermanentMedal } from './permanentMedal.js';
import { ChallengeMedal } from './challengeMedal.js';
import { CovenantRequirement } from './covenantRequirement.js';
// Mount outside the scrolling stats pane: mobile WebKit can clip fixed descendants there.
export function MedalBoard(props) {
  const host = useRef(null);
  useLayoutEffect(() => {
    const node = document.createElement('div');node.className = 'medal-showcase-root';
    document.body.appendChild(node);host.current = node;
    return () => { render(null, node);node.remove();host.current = null; };
  }, []);
  useLayoutEffect(() => { render(html`<${MedalBoardView} ...${props} />`, host.current); });
  return null;
}
function MedalBoardView({ data, division, daily = false, failed = false, onClose }) {
  const [group, setGroup] = useState(division), [selected, setSelected] = useState(null);
  const items = (daily ? data?.dailyDefinitions : data?.achievements) || [];
  const earned = (daily ? data?.daily : data?.unlocked)?.[group] || {};
  const progress = data?.progress?.[group] || {};
  const image = (a) => daily
    ? html`<${ChallengeMedal} kind=${a.id} earned=${!!earned[a.id]} label=${t(a.name)} />`
    : html`<${PermanentMedal} id=${a.id} earned=${!!earned[a.id]} label=${t(a.name)} />`;
  const frame = useRef(null), [scale, setScale] = useState(0);
  const width = daily ? 800 : 1000, height = daily ? 320 : 510;
  useLayoutEffect(() => {
    const node = frame.current;
    const resize = () => setScale(Math.max(0, Math.min((node.clientWidth - 24) / width, (node.clientHeight - 24) / height)));
    const observer = new ResizeObserver(resize);observer.observe(node);resize();
    return () => observer.disconnect();
  }, [width, height]);
  const positions = daily ? items.map((a, i) => ({ a, x: 70 + (i % 7) * 100 + (Math.floor(i / 7) % 2) * 50, y: 65 + Math.floor(i / 7) * 95, size: 100 })) : [
    ...items.filter(a => a.category === 'collection').map((a, i) => ({ a, x: 440 + i * 120, y: 110, size: 112.5 })),
    ...items.filter(a => a.category === 'core').map((a, i) => ({ a, x: [230,330,200,300,670,770,700,800][i], y: [70,70,165,165,70,70,165,165][i], size: 90 })),
    ...items.filter(a => a.category === 'other').map((a, i) => ({ a, x: 300 + (i % 5) * 100, y: 265 + Math.floor(i / 5) * 90, size: 90 })),
    ...items.filter(a => !['collection','core','other'].includes(a.category)).map((a, i) => ({ a, x: i < 3 ? 90 : 910, y: 200 + (i % 3) * 100, size: 90 })),
  ];
  return html`<${Modal} open=${true} onClose=${onClose} class="medal-showcase" veilClass="medal-showcase-veil" closeOnBackdrop=${false}>
    <header class="medal-showcase__header">
      <${Button} onClick=${onClose} aria-label=${t('返回')}>←<//>
      <h2>${daily ? t('每日挑战') : t('永久成就')}</h2>
      <span class="medal-showcase__count">${data ? `${items.filter(a => !!earned[a.id]).length} / ${items.length}` : '—'}</span>
    <div class="medal-showcase__tabs" role="group" aria-label=${t('榜单分组')}>
      <${Button} variant=${group === 'solo' ? 'primary' : 'secondary'} aria-pressed=${group === 'solo'} onClick=${() => { setGroup('solo');setSelected(null); }} aria-label=${t('单人收藏')}>${t('单人')}<//>
      <${Button} variant=${group === 'coop' ? 'primary' : 'secondary'} aria-pressed=${group === 'coop'} onClick=${() => { setGroup('coop');setSelected(null); }} aria-label=${t('多人收藏（2–6 真人）')}>${t('多人')}<//>
    </div>
    </header>
    <div ref=${frame} class="medal-showcase__canvas">
      ${failed ? html`<p role="alert">${t('永久成就暂不可用，请关闭后重试。')}</p>` : !data ? html`<p role="status">${t('正在读取永久收藏…')}</p>` : null}
      <div class="medal-showcase__composition" style=${{ width: `${width}px`, height: `${height}px`, transform: `translate(-50%, -50%) scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}>
        ${positions.map(({ a, x, y, size }) => html`<button key=${a.id} type="button" class=${`medal-showcase__medal${earned[a.id] ? ' is-earned' : ''}`} style=${{ left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` }} aria-label=${`${t(a.name)} · ${earned[a.id] ? t('已获得') : t('未获得')}`} onClick=${() => setSelected(a)}>${image(a)}</button>`)}
      </div>
    </div>
    ${selected ? html`<${Modal} open=${true} onClose=${() => setSelected(null)} title=${t(selected.name)} class="medal-showcase-detail" veilClass="medal-showcase-detail-veil" actions=${html`<${Button} onClick=${() => setSelected(null)}>${t('返回')}<//>`}>
      ${image(selected)}<p>${t(selected.goal)}</p>
      <${CovenantRequirement} covenant=${daily ? selected.covenant : selected.count ? selected : null} />
      ${!daily ? html`<p>${t('累计进度：{n} / {target}', { n: progress[selected.id] || 0, target: selected.target })}</p>` : null}
      <p>${earned[selected.id] ? t('首次获得：{time}', { time: new Date(earned[selected.id]).toLocaleString() }) : t('未获得')}</p>
    <//>` : null}
  <//>`;
}
