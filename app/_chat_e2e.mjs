// 端到端测试：两个 WS 连接 建房→对局→发 g.chat→断言双方收到 m.chat。
// 运行：cd app && node _chat_e2e.mjs   （服务器需已在本机 3100 端口起）
import WebSocket from 'ws';
import { PROTOCOL_VERSION, DIFFICULTIES } from './shared/constants.js';

const URL = 'ws://127.0.0.1:3100/ws';
const DIFF = DIFFICULTIES[0];

function client(name) {
  const ws = new WebSocket(URL);
  const handlers = {};
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d.toString()); } catch { return; }
    if (handlers[m.t]) for (const f of handlers[m.t]) f(m);
    if (handlers['*']) for (const f of handlers['*']) f(m);
  });
  const wait = (t, ms = 8000) => new Promise((res, rej) => {
    const f = (m) => { cleanup(); res(m); };
    const cleanup = () => { clearTimeout(timer); delete handlers[t]; delete handlers['error']; };
    const timer = setTimeout(() => { cleanup(); rej(new Error(`${name}: timeout waiting ${t}`)); }, ms);
    handlers[t] = [f];
    handlers['error'] = [(m) => { if (m.rid != null) { cleanup(); rej(new Error(`${name}: ${t} error ${m.code} ${m.msg||''}`)); } }];
  });
  const send = (obj) => ws.send(JSON.stringify(obj));
  const open = () => new Promise((res) => ws.on('open', res));
  return { ws, open, send, wait, name };
}

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  [PASS]', label); } else { fail++; console.log('  [FAIL]', label); } }

async function main() {
  const a = client('A'); const b = client('B');
  await a.open(); await b.open();

  // A 建房
  a.send({ t: 'hello', name: '测试博士A', version: PROTOCOL_VERSION });
  await a.wait('welcome');
  a.send({ t: 'room.create', mode: 'coop', difficulty: DIFF });
  const rs = await a.wait('room.state');
  const code = rs.code; ok(!!code, `A 建房 code=${code}`);

  // B 加入
  b.send({ t: 'hello', name: '测试博士B', version: PROTOCOL_VERSION });
  await b.wait('welcome');
  b.send({ t: 'room.join', code });
  await b.wait('room.state');
  // room.start 要求其他人类玩家已 ready：B 先点准备
  b.send({ t: 'room.ready', ready: true });
  await b.wait('room.state');

  // A 开始对局
  a.send({ t: 'room.start' });
  // 等双方进入 match（m.public phase != LOBBY）
  const waitPhase = (c) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${c.name}: no m.public`)), 10000);
    c.wait('m.public').then((m) => { clearTimeout(t); if (m.phase === 'LOBBY') return waitPhase(c); res(m); }).catch(rej);
  });
  const pa = await waitPhase(a);
  const pb = await waitPhase(b);
  ok(pa && pb && pa.phase !== 'LOBBY' && pb.phase !== 'LOBBY', `双方进入对局 phase=${pa.phase}`);

  // 监听 m.chat
  let aGot = null, bGot = null;
  const ca = (m) => { aGot = m; };
  const cb = (m) => { bGot = m; };
  a.ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.t === 'm.chat' && !aGot) aGot = m; } catch {} });
  b.ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.t === 'm.chat' && !bGot) bGot = m; } catch {} });

  // A 发一条带表情标记的聊天
  const chatText = '小心敌人！[emoji:autochess_battle_happy]稳住[emoji:autochess_battle_angry]';
  a.send({ t: 'g.chat', text: chatText });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && (!aGot || !bGot)) await new Promise((r) => setTimeout(r, 100));

  ok(aGot !== null, 'A 收到自己广播的 m.chat');
  ok(bGot !== null, 'B 收到 A 的 m.chat');
  if (bGot) {
    ok(bGot.text === chatText, `B 收到的文本一致 (${bGot.text.slice(0, 24)}…)`);
    ok(bGot.name === '测试博士A', `B 收到的发送者昵称=${bGot.name}`);
    ok(bGot.playerId === aGot?.playerId, 'playerId 一致');
  }

  // B 回一条
  b.send({ t: 'g.chat', text: '收到！' });
  const deadline2 = Date.now() + 5000;
  let bBack = null;
  while (Date.now() < deadline2) {
    if (aGot && aGot.text === '收到！') { bBack = aGot; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  ok(bBack !== null, 'A 收到 B 的回复');

  // 清理：A 退出
  try { a.send({ t: 'room.leave' }); } catch {}
  a.ws.close(); b.ws.close();

  console.log(`\nRESULT: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(2); });
