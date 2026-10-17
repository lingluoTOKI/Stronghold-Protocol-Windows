// 标题页的「素材包下载」（原「下载完整素材」，2026-10-17 改）：
//
// 之前这个按钮点下去会把整套素材（16,705 个文件 / 723 MB）全部从本服务器拉一遍，
// 几个玩家同时点就能把小主机的带宽吃满，对局本身都卡。现在改为**不再从服务器全量下载**：
// 按钮只负责说明 + 指路，玩家去 QQ 群文件取素材包 zip，再用旁边的「导入素材包」导入。
// 服务器零流量，导入走浏览器本地，比全量下载快得多。
//
// 不用素材包也能玩：素材本来就是按需加载的，第一局随用随下（通常几十 MB）。
// 已经导入过素材的玩家什么都不用做 —— 「导入素材包」直接命中缓存。
import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
import { t } from '../../../shared/i18n.js';

/** 素材包在哪拿：QQ 群号（改这一处即可）。 */
export const ASSET_PACK_QQ_GROUP = '1104628970';

/** 素材包下载: 纯说明弹窗，指路到 QQ 群，不从服务器拉取任何素材。 */
export function AssetDownloadButton() {
  const [open, setOpen] = useState(false);
  return html`<div class="title-assets__item">
    <${Button} variant="secondary" block=${true} size="sm" data-testid="asset-download"
      aria-describedby="title-asset-download-hint" onClick=${() => setOpen(true)}>${t('素材包下载')}<//>
    <small id="title-asset-download-hint">${t('从群文件下载素材包，进游戏更快、也更省服务器带宽。')}</small>
    <${Modal} open=${open} onClose=${() => setOpen(false)} title=${t('素材包下载')} class="asset-download"
      actions=${html`<${Button} variant="primary" onClick=${() => setOpen(false)}>${t('知道了')}<//>`}>
      <p role="status">${t('素材包不在这台服务器上下载——那会把开服机器的带宽占满，影响正在对局的人。')}</p>
      <p><b>${t('下载方式')}</b></p>
      <ol class="t-lo" style="margin:.1rem 0 .1rem .2rem;padding:0">
        <li>${t('加入 QQ 群')}<b class="num">${ASSET_PACK_QQ_GROUP}</b></li>
        <li>${t('在「群文件」里下载对应版本的素材包 zip（只需一次）')}</li>
        <li>${t('回到这个页面，点「导入素材包」，选择下载好的 zip')}</li>
      </ol>
      <p class="t-lo">${t('导入约 1–2 分钟，之后进对局几乎不下载素材。')}</p>
      <p class="t-lo">${t('不用素材包也能玩：素材按需加载，第一局会随用随下（通常几十 MB）。')}</p>
      <p class="t-lo">${t('安卓安装包已经内置素材，不需要这一步。')}</p>
    <//>
  </div>`;
}
