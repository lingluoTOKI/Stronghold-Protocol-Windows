// Loaded only with the deliberately opened daily page. Recovery files contain identity, never score edits.
import { useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { identity } from '../net.js';
import { t } from '../../../shared/i18n.js';

export function ChallengeIdentity({ onRestored }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function exportIdentity() {
    if (busy) return;
    setBusy(true);setMessage('');
    try {
      const response = await fetch('/api/daily-challenges/identity', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('unavailable');
      const value = await response.json();
      if (!value.ok || typeof value.recoveryCode !== 'string') throw new Error('invalid identity');
      const blob = new Blob([JSON.stringify({ format: 'sp-challenge-identity-v1', server: location.origin, recoveryCode: value.recoveryCode })], { type: 'application/json' });
      const url = URL.createObjectURL(blob);const a = document.createElement('a');
      a.href = url;a.download = 'stronghold-challenge-identity.json';document.body.appendChild(a);a.click();a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setMessage(t('已生成积分恢复码文件，请确认下载成功并妥善保存。'));
    } catch { setMessage(t('恢复码操作失败，请确认文件正确、服务器可用后重试。')); }
    finally { setBusy(false); }
  }
  async function restoreIdentity(event) {
    const file = event.currentTarget.files?.[0];event.currentTarget.value = '';
    if (!file || busy) return;
    setBusy(true);setMessage('');
    try {
      if (file.size > 4096) throw new Error('oversized file');
      const value = JSON.parse(await file.text());
      if (value.format !== 'sp-challenge-identity-v1' || typeof value.recoveryCode !== 'string' || value.recoveryCode.length > 100) throw new Error('invalid identity file');
      const token = identity.getToken();
      const response = await fetch('/api/daily-challenges/identity', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ recoveryCode: value.recoveryCode }) });
      if (!response.ok) throw new Error('invalid recovery code');
      setMessage(t('积分身份已恢复，榜单已重新读取。'));onRestored();
    } catch { setMessage(t('恢复码操作失败，请确认文件正确、服务器可用后重试。')); }
    finally { setBusy(false); }
  }
  return html`<details class="medal-preview">
    <summary>${t('积分数据保存与恢复')}</summary>
    <p>${t('积分及获章记录保存在服务器，重启和清空本机战绩不会删除。服务器在积分变更时保存主文件和备份。')}</p>
    <p>${t('恢复码用于找回积分身份，不能修改分数。请自行保存，不要公开；清理浏览器或换设备后可导入。')}</p>
    <p>${t('本服最近 8 天的每日记录会保留，到期清理不属于意外丢失；恢复码不能找回已过期的记录。')}</p>
    <div class="daily-division">
      <${Button} size="sm" variant="secondary" disabled=${busy} onClick=${exportIdentity}>${t('导出积分恢复码')}<//>
      <${Button} size="sm" variant="secondary" disabled=${busy} onClick=${() => input.current?.click()}>${t('导入积分恢复码')}<//>
      <input ref=${input} type="file" accept="application/json,.json" hidden onChange=${restoreIdentity} />
    </div>
    ${message ? html`<p role="status">${message}</p>` : null}
  </details>`;
}
