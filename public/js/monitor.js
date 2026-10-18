// 主服（上海 3000）/ 3001 独立部署 / 备用服（杭州）：域名访问走同源 HTTPS 反代（/alliance、/backup），否则直连 IP:端口。
const onDomain = location.hostname === 'game.lingluotoki.dpdns.org';
const MAIN_BASE = onDomain ? location.origin : 'http://101.132.104.41:3000';
const ALLIANCE_BASE = onDomain ? location.origin + '/alliance' : 'http://101.132.104.41:3001';
const BACKUP_BASE = onDomain ? location.origin + '/backup' : 'http://116.62.39.28:3000';
const SRVS = [
  { base: MAIN_BASE,    el:'0', role:'main',     label:'上海 · 主服',       url:'http://101.132.104.41:3000' },
  { base: ALLIANCE_BASE, el:'1', role:'alliance', label:'3001 · 独立部署',   url:'http://101.132.104.41:3001' },
  { base: BACKUP_BASE,  el:'2', role:'backup',   label:'杭州 · 备用服',     url:'http://116.62.39.28:3000' },
];
// 公告目标：三台都能发（2026-10-17 起）。
// 早先这里只放主服 + 备用服，注释写「3001 是独立部署、版本落后，不纳入公告推送」——
// 那会儿 3001 还跑着 0.2.1。现在 3001 已经是并列的联盟服（有独立域名和 /alliance 运维接口），
// 公告接口和主服一样，所以把三台都纳进来；界面上的勾选框也可以每一台单独选。
const ANNOUNCE_SRVS = [SRVS[0], SRVS[1], SRVS[2]];

let ipPlain = localStorage.getItem('sp_ip_plain') === '1';
const MASK_HOST = '***.***.***.***';
let localTest = localStorage.getItem('sp_local_test') === '1';
let localBase  = localStorage.getItem('sp_local_base')  || 'http://127.0.0.1:3000';
let localBase2 = localStorage.getItem('sp_local_base2') || 'http://127.0.0.1:3001';
// 本地测试：本机同时跑 3000（莱茵）与 3001（盟约）两台，都纳入监控
function activeSrvs(){
  if(!localTest) return SRVS;
  return [
    { base: localBase,  el:'0', role:'main',     label:'上海 · 主服',     url:localBase  },
    { base: localBase2, el:'1', role:'alliance', label:'3001 · 独立部署', url:localBase2 },
  ];
}
function announceSrvs(){
  if(localTest){
    // 本地测试：勾选「主服」= 本地3000、「盟约」= 本地3001；「备用」不适用
    const targets = [];
    if($('annT0').checked) targets.push({ base: localBase,  el:'0' });
    if($('annT1').checked) targets.push({ base: localBase2, el:'1' });
    return targets;
  }
  const sel = [$('annT0').checked, $('annT1').checked, $('annT2').checked];
  return SRVS.filter((s,i)=> sel[i] && ANNOUNCE_SRVS.includes(s));
}

const history = { 0:[], 1:[], 2:[] };
const $ = id => document.getElementById(id);
let lastUpdated = null;

const PHASE_CN = {
  LOBBY:'等待中', INFO_CHECK:'确认本局信息', BAND_DRAFT:'选择策略', BATTLE_CHECK:'协议启动',
  ROUND_START:'回合开始', SP_DRAFT:'机变阶段', PREP:'休整期', COMBAT:'作战中', UNITE:'联防阶段',
  SETTLE:'结算', RESULT:'对局结束', FINAL_ASSAULT:'最终突袭', HIDDEN_CORE:'隐藏核心'
};
const ROUND_REF = 12;

function saveToken(){
  localStorage.setItem('sp_admin_token', $('token').value.trim());
  $('annMsg').innerHTML = '<span style="color:#4f8">✅ token 已保存（仅存本机浏览器）</span>';
}
$('token').value = localStorage.getItem('sp_admin_token') || '';

function maskHost(url){ return url.replace(/^(https?:\/\/)[^/:]+/, `$1${MASK_HOST}`); }
function maskAddr(s){ return /^\d{1,3}(\.\d{1,3}){3}$/.test(s || '') ? MASK_HOST : s; }

function renderIpMode(){
  const act = activeSrvs();
  act.forEach((s,i)=>{
    const el = $('url'+s.el);
    if(el) el.textContent = ipPlain ? s.base : maskHost(s.base);
  });
  $('ipModeBtn').textContent = ipPlain ? 'IP: 明文（点击屏蔽）' : 'IP: 星号屏蔽（点击看明文）';
  document.querySelectorAll('.p .ip').forEach((el) => {
    el.textContent = ipPlain ? el.dataset.raw : maskAddr(el.dataset.raw);
  });
}
function toggleIpMode(){
  ipPlain = !ipPlain;
  localStorage.setItem('sp_ip_plain', ipPlain ? '1' : '0');
  renderIpMode();
}

function toggleLocalTest(){
  localTest = !localTest;
  localStorage.setItem('sp_local_test', localTest ? '1' : '0');
  renderLocalTest();
  tick();
}
function renderLocalTest(){
  const on = localTest;
  $('localTestBtn').textContent = '本地测试: ' + (on ? '开' : '关');
  $('localTestBanner').style.display = on ? '' : 'none';
  document.querySelector('.grid').classList.toggle('single', on);
  document.querySelector('.grid').classList.toggle('local', on);
  // 本地测试：显示 3000 + 3001 两台，隐藏备用卡；正常模式三台全显
  ['1','2'].forEach(el=>{ const n=$('svr'+el); if(n) n.style.display = (on && el==='2') ? 'none' : ''; });
  const totalLabel = $('totalLabel');
  if(totalLabel) totalLabel.textContent = on ? '本地测试服务器在线连接总数' : '三台服务器在线连接总数';
  renderIpMode();
}

async function adminFetch(svr, path){
  const token = $('token').value.trim();
  if(!token) throw new Error('请先输入并保存 admin token');
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${svr.base}${path}${sep}token=${encodeURIComponent(token)}`, { cache:'no-store' });
  return await r.json().catch(()=>({}));
}

function dtToMs(v){ if(!v) return undefined; const d = new Date(v); return isNaN(d.getTime()) ? undefined : d.getTime(); }

// ============ 服务器管理面板（折叠） ============
// 公告编辑器与一键踢人默认收起，把首屏高度让给服务器状态与房间列表。
// 展开状态记在 localStorage，刷新后保持；有未发布内容时不会自动收起。
const MGMT_KEY = 'sp_monitor_mgmt_open';
function setMgmt(open){
  const box = $('mgmt'), bar = $('mgmtBar');
  if(!box || !bar) return;
  box.classList.toggle('is-open', !!open);
  bar.setAttribute('aria-expanded', open ? 'true' : 'false');
  try{ localStorage.setItem(MGMT_KEY, open ? '1' : '0'); }catch(e){}
}
function toggleMgmt(){
  const box = $('mgmt');
  setMgmt(!(box && box.classList.contains('is-open')));
}
// 页面加载时恢复上次的展开状态
try{ if(localStorage.getItem(MGMT_KEY) === '1') setMgmt(true); }catch(e){}

// ============ 公告编辑器 ============
async function publishAnnounce(){
  const title = ($('annTitle').value || '').trim() || '服务器更新公告';
  const content = ($('annContent').value || '').trim();
  if(!content){ alert('请输入公告正文'); return; }
  const force = $('annForce').checked;
  const startAt = dtToMs($('annStart').value);
  const expireAt = dtToMs($('annExpire').value);
  if(startAt && expireAt && expireAt <= startAt){ alert('下架时间必须晚于上架时间'); return; }
  const targets = announceSrvs();
  if(!targets.length){ alert('请至少勾选一个公告目标服务器'); return; }
  let path = `/api/admin/announce?title=${encodeURIComponent(title)}&content=${encodeURIComponent(content)}&force=${force?'true':'false'}`;
  if(startAt) path += `&startAt=${startAt}`;
  if(expireAt) path += `&expireAt=${expireAt}`;
  const mode = force ? '强制弹窗公告' : '普通公告';
  if(!confirm(`确认发布【${mode}】到 ${targets.length} 台服务器？\n标题：${title}\n上架：${$('annStart').value || '立即'}${expireAt? '  下架：'+$('annExpire').value : ''}`)) return;
  const msg = $('annMsg');
  msg.textContent = '发布中…';
  let ok=0, fail=0; const msgs=[];
  for(const svr of targets){
    try{ const j = await adminFetch(svr, path); if(j.ok) ok++; else { fail++; msgs.push(`${svr.base}: ${j.error||'发布失败'}`); } }
    catch(e){ fail++; msgs.push(`${svr.base}: ${e.message}`); }
  }
  msg.innerHTML = ok
    ? `<span style="color:#4f8">✅ ${mode}已发布到 ${ok} 台服务器${force? '，客户端进游戏即强制弹窗':''}</span>`
    : `<span style="color:#f44">❌ 发布失败（${fail} 台）</span>`;
  msg.title = msgs.join('\n');
  tick();
}

async function announceClearAll(){
  const targets = announceSrvs();
  if(!targets.length){ alert('请至少勾选一个公告目标服务器'); return; }
  if(!confirm(`确认撤回全部强制公告（${targets.length} 台服务器）？\n客户端将不再强制弹出更新弹窗（普通公告保留）。`)) return;
  const msg = $('annMsg');
  msg.textContent = '撤回中…';
  let ok=0, fail=0, removed=0; const msgs=[];
  for(const svr of targets){
    try{ const j = await adminFetch(svr, '/api/admin/announce-clear'); if(j.ok){ ok++; removed += j.removed||0; } else { fail++; msgs.push(`${svr.base}: ${j.error||'撤回失败'}`); } }
    catch(e){ fail++; msgs.push(`${svr.base}: ${e.message}`); }
  }
  msg.innerHTML = ok
    ? `<span style="color:#4f8">✅ 已撤回 ${ok} 台服务器的强制公告（移除 ${removed} 条）</span>`
    : `<span style="color:#f44">❌ 撤回失败（${fail} 台）</span>`;
  msg.title = msgs.join('\n');
  tick();
}

function resetAnnounce(){
  $('annTitle').value = '服务器即将更新维护';
  $('annContent').value = '服务器即将进行版本更新维护，更新期间可能出现短暂断线。\n请提前保存好对局进度，如遇断线请稍后重新连接。\n给您带来不便敬请谅解。';
  $('annStart').value = ''; $('annExpire').value = ''; $('annForce').checked = true;
  $('annMsg').textContent = '';
}

// ============ 一键踢所有人 ============
async function kickAll(){
  const act = activeSrvs();
  if(!confirm(`确认执行：踢掉 ${act.length} 台服务器上所有在线玩家，并在 10 分钟内禁止重连？此操作不可撤销！`)) return;
  const out = $('adminOpResult');
  out.textContent = '执行中…';
  let total=0, fail=0; const msgs=[];
  for(const svr of act){
    try{ const j = await adminFetch(svr, '/api/admin/kickall'); if(j.ok) total += j.kicked||0; else { fail++; msgs.push(`${svr.base}: ${j.error||'执行失败'}`); } }
    catch(e){ fail++; msgs.push(`${svr.base}: ${e.message}`); }
  }
  out.innerHTML = fail
    ? `<span style="color:#f88">⚠️ 已踢 ${total} 人，${fail} 台服务器执行失败</span>`
    : `<span style="color:#4f8">✅ 已踢出全部 ${total} 名在线玩家，10 分钟内禁止重连</span>`;
  out.title = msgs.join('\n');
  tick();
}

function fmtUptime(s){
  if(s==null) return '--';
  s = Math.floor(s);
  const d = Math.floor(s/86400); s%=86400;
  const h = Math.floor(s/3600); s%=3600;
  const m = Math.floor(s/60);
  return (d? d+'天 ':'') + (h? h+'时 ':'') + m+'分';
}
function drawChart(el, data){
  const w = el.clientWidth, h = el.clientHeight;
  if(data.length < 2){ el.innerHTML=''; return; }
  const max = Math.max(4, ...data);
  const step = w/(data.length-1);
  const pts = data.map((v,i)=>`${(i*step).toFixed(1)},${(h - v/max*(h-6) - 3).toFixed(1)}`).join(' ');
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#4ed8af" stroke-width="2" opacity=".8"/></svg>`;
}

async function fetchHealth(svr){
  const el = svr.el;
  const t0 = performance.now();
  try{
    const r = await fetch(svr.base+'/healthz', {cache:'no-store'});
    if(!r.ok) throw new Error(r.status);
    const j = await r.json();
    const lat = Math.round(performance.now()-t0);
    $('dot'+el).classList.remove('off');
    $('svr'+el).classList.remove('offline');
    $('lat'+el).textContent = lat + 'ms';
    $('s'+el+'_sockets').textContent = j.sockets ?? '--';
    $('s'+el+'_humans').textContent  = j.humans ?? '--';
    $('s'+el+'_bots').textContent    = j.bots ?? '--';
    $('s'+el+'_rooms').textContent  = j.rooms ?? '--';
    $('s'+el+'_matches').textContent = j.matches ?? '--';
    $('s'+el+'_spect').textContent  = j.spectators ?? 0;
    $('s'+el+'_uptime').textContent = '运行 ' + fmtUptime(j.uptimeSec);
    $('s'+el+'_build').textContent  = 'build ' + (j.build||'--').slice(0,8);
    history[el].push(j.sockets||0);
    if(history[el].length > 40) history[el].shift();
    drawChart($('ch'+el), history[el]);
    return j;
  }catch(e){
    $('dot'+el).classList.add('off');
    $('svr'+el).classList.add('offline');
    $('lat'+el).textContent = '';
    ['sockets','humans','bots','rooms','matches','spect'].forEach(k=>{ $('s'+el+'_'+k).textContent='×'; });
    $('s'+el+'_uptime').textContent = '离线';
    return null;
  }
}

// Stability is a same-origin, token-protected operations service. Backup server is excluded.
const guardBusy = {0:false, 1:false};
async function stabilityRequest(el, control){
  const token = $('token').value.trim();
  if(!token) throw new Error('请先输入并保存 admin token');
  const endpoint = control ? '/api/admin/stability/control' : '/api/admin/stability';
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 5000);
  try {
    const r = await fetch(`${location.origin}${endpoint}?port=${el==='1'?3001:3000}&token=${encodeURIComponent(token)}`, {
      method:control?'POST':'GET', cache:'no-store', signal:controller.signal,
      ...(control?{headers:{'Content-Type':'application/json'},body:JSON.stringify(control)}:{})
    });
    const result = await r.json();
    if(!r.ok || !result.ok) {
      if(r.status===403) throw new Error('管理 token 不正确或权限不足');
      if(r.status===409) throw new Error('保护尚未启用，需要先批准维护重启');
      throw new Error('稳定性服务暂不可用');
    }
    return result;
  } finally { clearTimeout(timeout); }
}
async function fetchStability(svr){
  const el=svr.el;
  if(!['0','1'].includes(el)) return;
  const state=$('guard'+el+'_state'), metrics=$('guard'+el+'_metrics'), reason=$('guard'+el+'_reason');
  const pause=$('guard'+el+'_pause'), resume=$('guard'+el+'_resume');
  if(!state) return;
  pause.disabled=true; resume.disabled=true;
  state.dataset.mode='';
  if(!onDomain || localTest){ state.textContent='未接入'; return; }
  if(!$('token').value.trim()) { state.textContent='未认证'; reason.textContent='输入管理 token 查看保护状态'; return; }
  try{
    const j=await stabilityRequest(el);
    const host=j.host||{}, service=j.service||{}, a=j.admission, limits=a?.limits||j.pendingLimits||{};
    const rss=Number(service.MemoryCurrent);
    const load=Array.isArray(host.load)?host.load.map(v=>Number(v).toFixed(2)).join(' / '):'--';
    $('guard'+el+'_available').textContent=(host.availableMB??'—')+' MB';
    $('guard'+el+'_rss').textContent=Number.isFinite(rss)?Math.round(rss/1048576)+' MB':'—';
    $('guard'+el+'_capacity').textContent=(a?.matches??service.health?.matches??'—')+' / '+(limits.maxMatches??'—');
    $('guard'+el+'_away').textContent=service.awayRooms??'—';
    $('guard'+el+'_detail').textContent=`swap ${host.swapUsedMB??'—'} MB · 负载 ${load} · 房间 ${a?.rooms??service.health?.rooms??'—'}/${limits.maxRooms??'—'} · 采样 ${j.observationAgeSec??'—'} 秒前`+(a?` · 事件循环 ${Number(a.lagMs||0).toFixed(0)} ms`:'');
    if(j.observationStale){state.textContent='数据过期';state.dataset.mode='warn';reason.textContent='监测超过两分钟未更新';return;}
    if(!j.active){
      state.textContent='待启用';state.dataset.mode='warn';
      reason.textContent='监测正常 · 开局保护等待维护启用';
      return;
    }
    const full=a.matches>=limits.maxMatches;
    const roomsFull=a.rooms>=limits.maxRooms;
    state.textContent=a.manualPaused?'已暂停':a.pressure?'资源保护':full?'对局已满':roomsFull?'房间已满':'自动保护';
    state.dataset.mode=a.manualPaused||a.pressure||full||roomsFull?'warn':'ok';
    reason.textContent=a.manualPaused?'新开局已暂停 · 已有对局继续':a.pressure?'资源紧张 · 暂缓新开局':full?'等待已有对局结束后恢复':roomsFull?'已有房间可继续开局':'运行正常 · 已有对局与重连优先';
    pause.disabled=guardBusy[el]||a.manualPaused;
    resume.disabled=guardBusy[el]||!a.manualPaused;
    const restartBtn=$('guard'+el+'_restart');
    if(restartBtn) restartBtn.disabled=guardBusy[el];
  }catch(error){state.textContent='暂不可用';state.dataset.mode='warn';reason.textContent=error.name==='AbortError'?'请求超时，请稍后重试':error.message;}
}
async function setAdmissionPause(el,paused){
  if(guardBusy[el]) return;
  guardBusy[el]=true;
  $('guard'+el+'_pause').disabled=true; $('guard'+el+'_resume').disabled=true;
  const message=$('guard'+el+'_message');
  try {
    await stabilityRequest(el,{paused});
    message.textContent=paused?'已暂停新开局，已有对局不受影响。':'已恢复自动保护；资源不足或满额时仍会暂缓新开局。';
  }catch(error){message.textContent=error.message;}
  finally {guardBusy[el]=false; await fetchStability(SRVS[Number(el)]);}
}


/**
 * 重启本服务（大屏的「重启服务」按钮）。
 *
 * 服务端 /api/admin/restart 先把 {ok:true} 刷给浏览器再 process.exit(0)，systemd 的 Restart= 负责拉起。
 * 点两次确认：这个操作会中断所有进行中的对局，误点代价很大。
 */
async function restartService(el){
  if(guardBusy[el]) return;
  const svr = SRVS[Number(el)];
  const message = $('guard'+el+'_message');
  const label = (svr && svr.label) || ('端口 '+el);
  if(!confirm('确定重启「'+label+'」？\n\n这会中断所有进行中的对局，玩家需要重新进入。')) return;
  if(!confirm('再次确认：真的要现在重启吗？')) return;
  guardBusy[el]=true;
  const btn = $('guard'+el+'_restart');
  if(btn) btn.disabled=true;
  if(message) message.textContent='正在重启…（约 5–15 秒后恢复）';
  try{
    const token = $('token').value.trim();
    if(!token) throw new Error('请先输入并保存 admin token');
    const port = Number(el)===1 ? 3001 : 3000;
    const r = await fetch(location.origin+'/api/admin/restart?port='+port+'&token='+encodeURIComponent(token)+'&reason=monitor', {cache:'no-store'});
    const j = await r.json().catch(()=>({}));
    if(r.status===403) throw new Error('管理 token 不正确或权限不足');
    if(r.status===409) throw new Error('该服务器未启用重启（缺少 SP_ALLOW_RESTART=1）');
    if(!r.ok || !j.ok) throw new Error(j.error || '重启请求失败');
    if(message) message.textContent='已发送重启命令，服务正在重新启动…';
    setTimeout(()=>{ fetchStability(SRVS[Number(el)]); }, 12000);
  }catch(error){
    if(message) message.textContent=error.message;
  }finally{
    guardBusy[el]=false;
    if(btn) btn.disabled=false;
  }
}

// ============ 房间对局 + 在线玩家 合并渲染 ============
const roomData = {
  0:{ rooms:null, groups:new Map(), lobby:[], playersUnsupported:false },
  1:{ rooms:null, groups:new Map(), lobby:[], playersUnsupported:false },
  2:{ rooms:null, groups:new Map(), lobby:[], playersUnsupported:false },
};

async function fetchRooms(svr){
  const el = svr.el;
  const token = $('token').value.trim();
  const d = roomData[el];
  if(!token){ d.rooms=null; renderCombined(el); return; }
  try{
    const r = await fetch(`${svr.base}/api/admin/rooms?token=${encodeURIComponent(token)}`, {cache:'no-store'});
    if(r.status === 403){ renderCombined(el,'token 错误或服务器未配置 SP_ADMIN_TOKEN'); return; }
    if(r.status === 404 || r.status === 405){ d.rooms=null; renderCombined(el); return; }
    if(!r.ok) throw new Error(r.status);
    const j = await r.json();
    d.rooms = j.rooms || [];
  }catch(e){ d.rooms=null; }
  renderCombined(el);
}

async function fetchPlayers(svr){
  const el = svr.el;
  const token = $('token').value.trim();
  const d = roomData[el];
  if(!token){ d.groups=new Map(); d.lobby=[]; renderCombined(el); return; }
  try{
    const r = await fetch(`${svr.base}/api/admin/players?token=${encodeURIComponent(token)}`, {cache:'no-store'});
    if(r.status === 403){ d.groups=new Map(); d.lobby=[]; renderCombined(el); return; }
    if(r.status === 404 || r.status === 405){ d.playersUnsupported=true; d.groups=new Map(); d.lobby=[]; renderCombined(el); return; }
    if(!r.ok) throw new Error(r.status);
    const j = await r.json();
    const groups = new Map(); const lobby=[];
    for(const p of (j.players||[])){
      if(p.roomCode){
        if(!groups.has(p.roomCode)) groups.set(p.roomCode, { inMatch: !!p.inMatch, list: [] });
        groups.get(p.roomCode).list.push(p);
      } else lobby.push(p);
    }
    d.groups=groups; d.lobby=lobby; d.playersUnsupported=false;
  }catch(e){ d.playersUnsupported=true; }
  renderCombined(el);
}

function renderCombined(el, hint){
  const box = $('s'+el+'_roomlist');
  const cnt = $('s'+el+'_rcount');
  const d = roomData[el];
  const token = $('token').value.trim();
  if(!token){ box.innerHTML = '<div class="empty">输入 admin token 后显示房间对局与玩家</div>'; cnt.textContent=''; return; }
  if(hint){ box.innerHTML = `<div class="empty">${hint}</div>`; cnt.textContent=''; return; }

  let html='';
  let totalHumans=0;

  if(d.rooms===null){
    if(d.playersUnsupported){ box.innerHTML='<div class="empty">该服未开启管理接口（无法查看玩家、不可踢人）</div>'; cnt.textContent=''; return; }
    const groups = [...d.groups.entries()].sort((a,b)=>(b[1].inMatch?1:0)-(a[1].inMatch?1:0));
    for(const [code,g] of groups){
      totalHumans += g.list.length;
      html += `<div class="room-card${g.inMatch?' is-match':''}">
        <div class="rc__hd"><span class="rc__code">${esc(code)}</span><span class="rc__tag${g.inMatch?' on':''}">${g.inMatch?'对局中':'等待中'}</span><span class="rc__meta">${g.list.length} 人</span><button class="kickroom-mini" onclick="doKickRoom('${el}','${esc(code)}')">踢整房</button></div>
        <div class="rc__players">${g.list.map(p=>playerRow(el,p)).join('')}</div>
      </div>`;
    }
    if(d.lobby && d.lobby.length){
      totalHumans += d.lobby.length;
      html += `<div class="room-card"><div class="rc__hd"><span class="rc__code">大厅（未进房）</span><span class="rc__meta">${d.lobby.length} 人</span></div><div class="rc__players">${d.lobby.map(p=>playerRow(el,p)).join('')}</div></div>`;
    }
    cnt.textContent = html? (totalHumans+' 人') : '';
    box.innerHTML = html || '<div class="empty">当前无在线玩家</div>';
    return;
  }

  // rooms 可用：按「有人在线优先 → 对局中优先 → 回合数倒序 → 玩家数倒序」排序。
  // 「无人在线」的房间（全员掉线、宽限内或 solo 保留 24h）排到最后并标灰 —— 它们不是"正在进行的房间"，
  // 只是等人的空壳；踢整房对它们无效（那个接口只列在线玩家），要清就点「关房」。
  const hasLive = (r)=> (r.connectedHumans ?? r.humanCount ?? r.seatCount ?? 0) > 0;
  const rooms = [...d.rooms].sort((a,b)=>{
    if(hasLive(a) !== hasLive(b)) return hasLive(a) ? -1 : 1;
    if((b.inMatch?1:0) !== (a.inMatch?1:0)) return (b.inMatch?1:0)-(a.inMatch?1:0);
    const rb = (b.round||0), ra = (a.round||0);
    if(rb !== ra) return rb - ra;
    const pb = (b.humanCount ?? b.seatCount ?? 0), pa = (a.humanCount ?? a.seatCount ?? 0);
    return pb - pa;
  });
  const awayOnes = rooms.filter((r)=> !hasLive(r));
  // 老服务器（<0.2.4）的 /api/admin/rooms 没有 connectedHumans，也没有 /api/admin/room/close。
  // 那种服上不渲染「关房」——点了只会 404 —— 退化为原来的「踢整房」，等于只读展示。
  const canClose = rooms.some((r)=> Object.prototype.hasOwnProperty.call(r, 'connectedHumans'));
  if(!canClose) html += `<div class="empty">该服为旧版（无在线判定与关房接口）：此处只读展示，「关房」不可用</div>`;
  for(const room of rooms){
    const code = room.code;
    const g = d.groups.get(code);
    const players = g? g.list : [];
    totalHumans += players.length;
    const live = hasLive(room);
    const phaseName = room.phase ? (PHASE_CN[room.phase] || room.phase) : '等待中';
    const phaseCls = room.phase ? ('p-'+room.phase) : 'p-LOBBY';
    const pct = room.inMatch ? Math.min(100, Math.round((room.round||0)/ROUND_REF*100)) : 0;
    const human = room.humanCount ?? room.seatCount ?? players.length;
    const modeName = esc(room.mode||'');
    const awayTxt = room.awaySec ? fmtUptime(room.awaySec)+'前掉线' : '无人在线';
    html += `<div class="room-card${room.inMatch?' is-match':''}${live?'':' is-away'}">
      <div class="rc__hd">
        <span class="rc__code">${esc(code)}</span>
        <span class="rc__tag${live && room.inMatch?' on':''}">${live ? (room.inMatch?'对局中':'等待中') : '无人在线'}</span>
        <span class="rc__meta">${room.rhine?'莱茵':'原版'} · ${esc(room.difficulty||'')} · 第${room.matchNo||0}局</span>
        ${(live || !canClose) ? `<button class="kickroom-mini" onclick="doKickRoom('${el}','${esc(code)}')">踢整房</button>`
                              : `<button class="kickroom-mini b-close" onclick="doCloseRoom('${el}','${esc(code)}')">关房</button>`}
      </div>
      <div class="rc__body">
        <span class="rc__phase ${phaseCls}">${phaseName}</span>
        <span class="rc__round">回合 ${room.round||0}</span>
        <span class="rc__ppl">${live ? human+' 人' : awayTxt} · ${modeName}</span>
      </div>
      ${room.inMatch?`<div class="rc__bar"><div class="rc__bar-in" style="width:${pct}%"></div></div>`:''}
      ${players.length?`<div class="rc__players">${players.map(p=>playerRow(el,p)).join('')}</div>`:''}
    </div>`;
  }
  if(d.lobby && d.lobby.length){
    totalHumans += d.lobby.length;
    html += `<div class="room-card"><div class="rc__hd"><span class="rc__code">大厅（未进房）</span><span class="rc__meta">${d.lobby.length} 人</span></div><div class="rc__players">${d.lobby.map(p=>playerRow(el,p)).join('')}</div></div>`;
  }
  const liveCount = rooms.length - awayOnes.length;
  cnt.textContent = rooms.length + ' 房 · ' + totalHumans + ' 人' + (awayOnes.length? ` · ${awayOnes.length} 空房` : '') + (canClose? '' : ' · 旧版');
  box.innerHTML = html || '<div class="empty">当前无房间</div>';
}

/** 关掉一个无人在线的房间（管理员）：释放座位与对局，客户端收到「该同盟已被管理员关闭」。 */
async function doCloseRoom(el, roomCode){
  const svr = SRVS[+el];
  const token = $('token').value.trim();
  if(!confirm(`确认关闭房间 ${roomCode}？\n该房当前无人在线；关闭后座位与对局记录一并释放，凭密钥再加入会开一个新房间。`)) return;
  try{
    const r = await fetch(`${svr.base}/api/admin/room/close?token=${encodeURIComponent(token)}&code=${encodeURIComponent(roomCode)}`, {cache:'no-store'});
    const j = await r.json().catch(()=>({}));
    if(r.ok && j.ok) alert(`房间 ${roomCode} 已关闭`);
    else if(r.status === 409) alert(`房间 ${roomCode} 里还有 ${j.connected||'?'} 人在线，未关闭（请先踢整房）`);
    else alert('关房失败: ' + (j.error || j.detail || r.status));
    tick();
  }catch(e){ alert('关房请求失败: ' + e.message); }
}

function playerRow(el, p){
  return `<div class="p">
    <span class="nm" title="${esc(p.name)}">${esc(p.name)}</span>
    <span class="rc">${p.roomCode? ('房 '+esc(p.roomCode)) : '大厅'}</span>
    <span class="ip" data-raw="${esc(p.addr)}">${esc(ipPlain? p.addr : maskAddr(p.addr))}${p.lastSeenAgoSec!=null? ' · '+p.lastSeenAgoSec+'s前':''}</span>
    <button onclick="doKick('${el}','${esc(p.playerId)}',${JSON.stringify(p.name).replace(/"/g,'&quot;')})">踢</button>
  </div>`;
}

function esc(s){ return String(s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function kickOne(svr, playerId){
  const token = $('token').value.trim();
  return await fetch(`${svr.base}/api/admin/kick?token=${encodeURIComponent(token)}&playerId=${encodeURIComponent(playerId)}`);
}

async function doKick(el, playerId, name){
  if(!confirm(`确认踢掉玩家「${name}」？\n将立即断线，且 10 分钟内无法自动重连 / 刷新恢复。`)) return;
  const svr = SRVS[+el];
  try{
    const r = await kickOne(svr, playerId);
    const j = await r.json().catch(()=>({}));
    if(r.ok && j.ok){ alert(`已踢掉 ${name}（${j.banSec||600}s 内无法重连）`); tick(); }
    else alert('踢人失败: ' + (j.error || j.detail || r.status));
  }catch(e){ alert('踢人请求失败: ' + e.message); }
}

async function doKickRoom(el, roomCode){
  const svr = SRVS[+el];
  const token = $('token').value.trim();
  try{
    const r = await fetch(`${svr.base}/api/admin/players?token=${encodeURIComponent(token)}`, {cache:'no-store'});
    if(!r.ok) throw new Error(r.status);
    const j = await r.json();
    const ps = (j.players||[]).filter(p=>p.roomCode===roomCode);
    if(!ps.length){
      alert('该房间已无在线玩家。\n它现在只是等人的空房 —— 用「关房」按钮可以把它收掉。');
      tick(); return;
    }
    if(!confirm(`确认踢掉房间 ${roomCode} 内全部 ${ps.length} 名玩家？\n将立即断线，且 10 分钟内无法重连。`)) return;
    let ok=0, fail=0;
    for(const p of ps){ const kr = await kickOne(svr, p.playerId); if(kr.ok) ok++; else fail++; }
    alert(`房间 ${roomCode}：已踢 ${ok} 人` + (fail? `，失败 ${fail} 人`:''));
    tick();
  }catch(e){ alert('整房踢人失败: ' + e.message); }
}

function renderSvrChips(healthArr){
  const chipBox = $('svrchips');
  const act = activeSrvs();
  let html = '';
  act.forEach((s,i)=>{
    const j = healthArr[i];
    const cls = j ? 'up' : 'down';
    const name = s.role==='main' ? '上海' : s.role==='alliance' ? '3001' : s.role==='backup' ? '杭州' : '本地';
    const val = j ? j.sockets : '×';
    html += `<span class="svrchip ${cls}"><span class="d"></span>${name}: ${val}</span>`;
  });
  chipBox.innerHTML = html;
}

async function tick(){
  if(document.hidden){ lastUpdated = null; return; }
  const act = activeSrvs();
  const health = await Promise.all(act.map(fetchHealth));
  await Promise.all(act.map(fetchRooms));
  await Promise.all(act.map(fetchPlayers));
  await Promise.all(act.map(fetchStability));
  let tSock=0,tHum=0,tRoom=0,tMatch=0,ok=0;
  health.forEach(j=>{ if(!j) return; ok++; tSock+=j.sockets||0; tHum+=j.humans||0; tRoom+=j.rooms||0; tMatch+=j.matches||0; });
  $('totalOnline').textContent  = ok? tSock : '--';
  $('totalHumans').textContent    = ok? tHum  : '--';
  $('totalRooms').textContent    = ok? tRoom : '--';
  $('totalMatches').textContent   = ok? tMatch: '--';
  $('ts').textContent = new Date().toLocaleTimeString('zh-CN');
  renderSvrChips(health);
  lastUpdated = new Date();
  $('updInfo').textContent = '上次刷新 ' + lastUpdated.toLocaleTimeString('zh-CN');
}

// 性能优化：页面隐藏时暂停轮询（避免对服务器产生无效请求），恢复可见时立即刷新一次
document.addEventListener('visibilitychange', ()=>{
  if(!document.hidden) tick();
});

// ============ 事件绑定（CSP 要求）============
// 页面 CSP 是 `script-src 'self'`，**HTML 里的 onclick= 内联处理器会被直接拦截**
// （控制台报 "Executing inline event handler violates the following Content Security Policy"），
// 表现为所有按钮点了没反应——包括「保存」token，于是 token 存不进 localStorage、刷新就丢。
// 因此这里统一用 addEventListener 绑定，HTML 不再写任何 on* 属性。
function bindUi(){
  const on = (id, fn, ev) => { const el = $(id); if (el) el.addEventListener(ev || 'click', fn); };
  on('btnSaveToken', saveToken);
  ['0','1'].forEach(el=>{on('guard'+el+'_pause',()=>setAdmissionPause(el,true));on('guard'+el+'_resume',()=>setAdmissionPause(el,false));on('guard'+el+'_restart',()=>restartService(el));});
  on('ipModeBtn', toggleIpMode);
  on('localTestBtn', toggleLocalTest);
  on('btnPublish', publishAnnounce);
  on('btnAnnClear', announceClearAll);
  on('btnAnnReset', resetAnnounce);
  on('btnKickAll', kickAll);
  // 折叠面板：点击 + 键盘（Enter / Space）
  const bar = $('mgmtBar');
  if (bar) {
    bar.addEventListener('click', toggleMgmt);
    bar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMgmt(); }
    });
  }
}
bindUi();

renderIpMode();
renderLocalTest();
tick();
setInterval(tick, 3000);
window.addEventListener('resize', ()=>{ ['0','1','2'].forEach(el=>{ if(history[el].length) drawChart($('ch'+el),history[el]); }); });
