import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, TextField } from './components.js';
import { t } from '../../../shared/i18n.js';
import { identity, net } from '../net.js';
import { store } from '../store.js';
import { exportStats, importStats, loadStats, saveStats } from './stats.js';

async function api(action, data) {
  const response = await fetch('/api/account/' + action, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type':'application/json', Authorization:'Bearer ' + (identity.getToken() || '') },
    ...(data === undefined ? {} : { body:JSON.stringify(data) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'REQUEST_FAILED');
  return result;
}
let account = null, realm = '', uploading = false, timer = null, restoring = false;
const consentKey = () => `sp.account.sync.${realm}.${account?.id}`;
const optedOut = () => localStorage.getItem(consentKey() + '.off') === 'yes';
async function upload() {
  if (!account || uploading || restoring || localStorage.getItem(consentKey()) !== 'yes') return;
  uploading = true;
  try {
    const result = await api('upload',exportStats(loadStats()));
    localStorage.setItem(consentKey() + '.status',JSON.stringify({ ok:true, at:Date.now(), total:result.total }));
    return result;
  } catch (e) {
    localStorage.setItem(consentKey() + '.status',JSON.stringify({ ok:false, at:Date.now(), error:e.message }));
    throw e;
  } finally { uploading = false; }
}
globalThis.addEventListener?.('sp:stats-saved', () => {
  if (restoring) return;
  clearTimeout(timer);
  timer = setTimeout(() => { upload().catch(() => {}); },3000);
});
function adoptName(name) {
  identity.saveName(name);
  store.patch('me',{name});
  net.setName(name);
}

export function GameAccountButton({ plain = false, label = null, class: cls = '', style = null, openToken = 0, onSkip = null } = {}) {
  const [open,setOpen] = useState(false), [state,setState] = useState(null);
  const [qq,setQq] = useState(''), [nickname,setNickname] = useState('');
  const [challenge,setChallenge] = useState(null), [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false), [recovery,setRecovery] = useState('');
  const [newCode,setNewCode] = useState('');
  const syncNote = (kind) => ({
    restored: t('已自动恢复本服成就与积分。'), relinked: t('已自动把本服成就归属改为这台设备。'),
    linked: t('已自动关联本服成就，换设备登录即可恢复。'),
    conflict: t('这台设备本服也有成就，与账号已关联的不一致，请手动点「关联本服旧积分与成就」。'),
    merged: t('已把本机本服成就合并进账号已关联的成绩。'),
    empty: '', none: '', unsupported: '', ready: '',
  }[kind] || '');
  let mergedFor = '';
  async function autoMerge(accountId) {
    const key = realm + '.' + accountId;
    if (mergedFor === key) return 0;
    mergedFor = key;
    let offset = 0, current = loadStats(), added = 0, pages = 0;
    do {
      const page = await api('records?offset=' + offset);
      if (!page.records?.length) break;
      const parsed = importStats({ ...exportStats(current), records:page.records }, current);
      if (parsed.dropped) break;
      added += parsed.added; current = parsed.stats; offset = page.next; pages += 1;
      if (pages >= 25) break;
    } while (offset !== null);
    if (added) { restoring = true; try { saveStats(current); } finally { restoring = false; } }
    return added;
  }
  let syncKey = '';
  async function autoSync(accountId) {
    const key = realm + '.' + accountId;
    if (syncKey === key) return;
    syncKey = key;
    const notes = [];
    try { const r = await api('sync', {}); const note = syncNote(r.sync); if (note) notes.push(note); } catch (_) {}
    try { const added = await autoMerge(accountId); if (added) notes.push(t('已自动合并云端战绩 {n} 条。',{n:added})); } catch (_) {}
    // 绑定 QQ 即视为开启同步：首次自动授权并上传一次本机战绩；用户点过「停止本机自动同步」则不再自动开启。
    if (!localStorage.getItem(consentKey()) && !optedOut()) {
      localStorage.setItem(consentKey(), 'yes');
      upload().catch(() => {});
    }
    if (notes.length) setMessage(notes.join(' '));
  }
  async function refresh() {
    const value = await api('me');
    account = value.profile; realm = value.realm;
    setState(value);
    setNickname(value.profile?.nickname || store.get().me?.name || '');
    if (account && !store.get().room) adoptName(account.nickname);
    if (account) await autoSync(account.id);
  }
  useEffect(() => { refresh().catch(() => setState({enabled:false})); },[]);
  // 外部触发（例如标题页点「开始」）：token 变化时弹出绑定面板并刷新状态。
  const [seenToken, setSeenToken] = useState(0);
  useEffect(() => {
    if (!openToken || openToken === seenToken) return;
    setSeenToken(openToken);
    setOpen(true);
    run(refresh);
  }, [openToken]);
  async function run(fn) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await fn(); } catch (e) { setMessage(t('操作未完成，请保留本机数据。错误：{error}',{error:e.message})); }
    finally { setBusy(false); }
  }
  async function restoreRecords() {
    let offset = 0, current = loadStats(), added = 0;
    do {
      const page = await api('records?offset=' + offset);
      const parsed = importStats({ ...exportStats(current), records:page.records },current);
      if (parsed.dropped) throw new Error('UNSUPPORTED_RECORDS');
      added += parsed.added; current = parsed.stats; offset = page.next;
    } while (offset !== null);
    restoring = true;
    try { if (!saveStats(current)) throw new Error('LOCAL_STORAGE_FULL'); } finally { restoring = false; }
    setMessage(t('已合并 {n} 条对局记录，原有记录保留。',{n:added}));
  }
  const button = (label,fn,variant='secondary') => html`<${Button} size="sm" variant=${variant} disabled=${busy} onClick=${() => run(fn)}>${label}<//>`;
  const maskedQq = state?.profile?.qq ? state.profile.qq.replace(/^(\d{2}).*(\d{2})$/, '$1****$2') : '';
  const shown = label || (maskedQq ? `${t('QQ')} ${maskedQq}` : t('绑定 QQ'));
  const trigger = plain
    ? html`<button type="button" class=${cls} style=${style} onClick=${() => { setOpen(true); run(refresh); }}>${shown}</button>`
    : html`<${Button} size="sm" variant="secondary" class=${cls} style=${style} onClick=${() => { setOpen(true); run(refresh); }}>${shown}<//>`;
  return html`
    ${trigger}
    <${Modal} open=${open} title=${t('QQ 账号与数据')} micro="ACCOUNT" onClose=${() => { if (!busy) { setOpen(false); setNewCode(''); } }}>
      <div class="acc-form">
        ${state?.enabled === false ? html`<p>${t('账号服务尚未启用，当前仍使用本机数据。')}</p>` : null}
        ${state?.enabled && !state.profile ? html`
          <p>${t('不需要游戏密码。填好 QQ 与昵称后生成指令，发到游戏交流群 1104628970 里 @大肥鱼（群里的机器人），机器人回复已验证后再回此页确认。')}</p>
          <${TextField} label=${t('QQ 号码')} micro="QQ" icon="user" value=${qq} maxLength=${12}
            transform=${(v) => v.replace(/[^0-9]/g, '')} onInput=${setQq} hint=${t('仅作展示，不核验号码')} />
          <${TextField} label=${t('游戏昵称')} micro="CALLSIGN" icon="user" value=${nickname} maxLength=${24}
            onInput=${setNickname} hint=${t('可随时修改')} />
          <div class="acc-actions">${button(t('生成群验证指令'),async () => { const ch = await api('start',{qq,nickname}); setChallenge(ch); if (ch?.command) {
    try {
      await navigator.clipboard.writeText(ch.command);
      setMessage(t('授权码已复制到剪贴板，直接到群里粘贴发送'));
      // 居中 toast 弹窗，2秒后消失
      const toast = document.createElement('div');
      toast.innerHTML = '<span style="margin-right:6px;">✓</span>授权码已复制到剪贴板';
      toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-20px);background:rgba(20,32,30,.92);backdrop-filter:blur(8px);color:#4ed8af;padding:10px 20px;border-radius:20px;font-size:13px;z-index:99999;border:1px solid rgba(78,216,175,.3);box-shadow:0 4px 20px rgba(0,0,0,.4);opacity:0;transition:all .3s ease;pointer-events:none;white-space:nowrap;';
      document.body.appendChild(toast);
      requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(0)'; });
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(-10px)'; setTimeout(() => toast.remove(), 300); }, 2000);
    } catch (e) {}
  } },'primary')}${onSkip ? button(t('暂不绑定，直接进入'),() => { setOpen(false); onSkip(); }) : html``}</div>
          ${challenge ? html`
            <p>${t('加入游戏交流群 1104628970，在群里 @大肥鱼（群里的机器人），发送下面这条指令；只验证自己刚发起的请求，5 分钟内有效。')}</p>
            <${TextField} label=${t('群验证指令')} micro="COMMAND" icon="key" readOnly=${true} value=${challenge.command} />
            <div class="acc-actions">${button(t('已发送，确认登录'),async () => { await api('confirm',{}); setChallenge(null); await refresh(); setMessage(t('已登录，本服成绩与云端战绩会自动同步。')); if (onSkip) { setOpen(false); onSkip(); } },'primary')}</div>` : null}
          <details><summary>${t('使用账号恢复码')}</summary>
            <p>${t('旧版成绩恢复文件不能用于账号登录。账号恢复码使用一次即作废。')}</p>
            <${TextField} label=${t('账号恢复码')} micro="RECOVERY" icon="key" type="password" value=${recovery} onInput=${setRecovery} />
            <div class="acc-actions">${button(t('恢复账号'),async () => { const result = await api('recover',{code:recovery.trim()}); setRecovery(''); setNewCode(result.recoveryCode); await refresh(); })}</div>
          </details>
        ` : null}
        ${state?.profile ? html`
          <p>${t('QQ 身份已验证；所填数字号码仅作展示。')}${state.profile.qq.replace(/^(\d{2}).*(\d{2})$/,'$1****$2')}</p>
          <${TextField} label=${t('游戏昵称')} micro="CALLSIGN" icon="user" value=${nickname} maxLength=${24} onInput=${setNickname} hint=${t('可随时修改')} />
          <div class="acc-actions">${button(t('保存昵称'),async () => { await api('rename',{nickname}); await refresh(); setMessage(t('昵称已保存，不影响成绩和绑定。')); })}</div>
          <p>${t('两服共用账号，成绩分服保存。登录后本服成就与积分会自动恢复或关联，战绩在本机与云端双向自动同步；本机素材、背景和未结束对局不属于账号备份。')}</p>
          ${state.scoresSupported ? null : html`<p>${t('本服未接入积分成就模块，可使用战绩备份。')}</p>`}
          <div class="acc-actions">
            ${state.scoresSupported ? button(t('关联本服旧积分与成就'),async () => { await api('link',{}); await refresh(); setMessage(t('本服成绩已关联；已有归属发生冲突时不会覆盖。')); }) : null}
            ${state.scoresSupported ? button(t('恢复本服已关联成绩'),async () => { await api('restore',{}); setMessage(t('已恢复本服成绩身份，请重新打开收藏册。')); }) : null}
            ${button(t('迁移本机战绩并开启同步'),async () => { localStorage.removeItem(consentKey()+'.off'); localStorage.setItem(consentKey(),'yes'); const result = await upload(); setMessage(t('本服云端保存 {n} 条记录；以后本机记录变化时同步。',{n:result.total})); })}
            ${button(t('合并云端战绩到本机'),restoreRecords)}
            ${button(t('停止本机自动同步'),async () => { localStorage.setItem(consentKey()+'.off','yes'); localStorage.removeItem(consentKey()); setMessage(t('已停止本机自动同步，已保存数据保留。')); })}
          </div>
          <p>${t('每服最多保存 1000 条、2 MB 战绩。超出会提示失败，不删除旧记录；备份记录不会增加挑战积分或解锁奖章。')}</p>
          <p>${localStorage.getItem(consentKey()+'.status') ? t('上次同步状态：{status}',{status:localStorage.getItem(consentKey()+'.status')}) : t('本机尚未同步战绩。')}</p>
          <details><summary>${t('账号恢复与退出')}</summary>
            <p>${t('账号恢复码请私密保存，不要发到群里。重新生成会使旧账号恢复码失效。')}</p>
            <div class="acc-actions">
              ${button(t('生成新的账号恢复码'),async () => { const result = await api('recovery',{}); setNewCode(result.code); })}
              ${button(t('退出账号'),async () => { await api('logout',{}); account = null; syncKey = ''; mergedFor = ''; setNewCode(''); await refresh(); })}
            </div>
          </details>
        ` : null}
        ${newCode ? html`<${TextField} label=${t('新的账号恢复码')} micro="RECOVERY" icon="key" readOnly=${true} value=${newCode} hint=${t('请立即私密保存')} />` : null}
        <p role="status">${busy ? t('正在处理…') : message}</p>
      </div>
    <//>`;
}
