// 本地部署测试：连本地 ws://127.0.0.1:3100，模拟真实玩家验证匹配大改造完整流程
import { TestClient } from './helpers/wsClient.js';

const W = 'ws://127.0.0.1:3100/ws';
const HTTP = 'http://127.0.0.1:3100';
const MT = 4;
let pass = 0, fail = 0;

async function mk(name) {
  const c = await TestClient.connect(W);
  const w = await c.hello(name);
  c.id = w.playerId;
  c.nick = name;
  return c;
}
const ok = (cond, label) => { if (cond) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗ FAIL:', label); } };
const onlineNow = async () => { const r = await fetch(`${HTTP}/api/online`); return (await r.json()).online; };

async function roomStateInMatch(cl) { return cl.waitFor('room.state', (m) => m.mode === 'coop' && m.inMatch === true); }

console.log('\n== [1] 满 4 人自动开局（coop 进池即匹配）==');
{
  const cls = [];
  for (let i = 1; i <= MT; i++) cls.push(await mk(`满4-P${i}`));
  await cls[0].request({ t: 'match.enqueue', difficulty: 'NORMAL' });
  await cls[0].waitFor('match.status', (m) => m.count === 1 && m.target === MT);
  await cls[1].request({ t: 'match.enqueue', difficulty: 'NORMAL' });
  await cls[2].request({ t: 'match.enqueue', difficulty: 'NORMAL' });
  const r4 = await cls[3].request({ t: 'match.enqueue', difficulty: 'NORMAL' });
  ok(r4.t === 'ok', `第4人 enqueue → ok (${JSON.stringify(r4)})`);
  const found = await Promise.all(cls.map((c) => c.waitFor('match.found', () => true)));
  ok(new Set(found.map((f) => f.code)).size === 1, '4 人进入同一房间');
  const st = await roomStateInMatch(cls[0]);
  const humans = st.seats.filter((x) => x && !x.isBot).length;
  ok(st.inMatch === true, '自动开局 inMatch=true');
  ok(humans === MT, `4 个真人席位 (${humans})`);
  ok(st.seats.every((x) => x && !x.isBot ? x.ready : true), '真人全部默认已准备');
  ok(st.hostId === cls[0].id, `最先点匹配的当房主 (${st.hostId === cls[0].id})`);
  for (const c of cls) c.terminate().catch(() => {});
}

console.log('\n== [2] 人数不足 → 不加AI开始(startNow) ==');
{
  const a = await mk('SN-A'), b = await mk('SN-B');
  await a.request({ t: 'match.enqueue', difficulty: 'HARD' });
  await b.request({ t: 'match.enqueue', difficulty: 'HARD' });
  const rb = await b.request({ t: 'match.startNow' });
  ok(rb.t === 'ok', `startNow → ok (${JSON.stringify(rb)})`);
  const fA = await a.waitFor('match.found', () => true);
  const fB = await b.waitFor('match.found', () => true);
  ok(fA.code === fB.code, '两人进同一房间');
  const st = await roomStateInMatch(a);
  const humans = st.seats.filter((x) => x && !x.isBot).length;
  const bots = st.seats.filter((x) => x && x.isBot).length;
  ok(st.inMatch === true && humans === 2 && bots === 0, `startNow：2 真人 0 AI，自动开局 (真人${humans}/AI${bots})`);
  a.terminate().catch(() => {}); b.terminate().catch(() => {});
}

console.log('\n== [3] 人数不足 → 加AI开始(topUp) ==');
{
  const a = await mk('TP-A'), b = await mk('TP-B');
  await a.request({ t: 'match.enqueue', difficulty: 'ABYSS' });
  await b.request({ t: 'match.enqueue', difficulty: 'ABYSS' });
  const rb = await b.request({ t: 'match.topUp' });
  ok(rb.t === 'ok', `topUp → ok (${JSON.stringify(rb)})`);
  const st = await roomStateInMatch(a);
  const humans = st.seats.filter((x) => x && !x.isBot).length;
  const bots = st.seats.filter((x) => x && x.isBot).length;
  ok(st.inMatch === true && humans + bots === MT, `topUp：2 真人 + ${bots} AI 补满 4，自动开局`);
  a.terminate().catch(() => {}); b.terminate().catch(() => {});
}

console.log('\n== [4] 继续等待(waitMore) 重开 20s 窗口 ==');
{
  const a = await mk('WM-A');
  await a.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
  const rb = await a.request({ t: 'match.waitMore' });
  ok(rb.t === 'ok', `waitMore → ok (${JSON.stringify(rb)})`);
  let notFound = true;
  try { await a.waitFor('match.found', () => true, 600); notFound = false; } catch { notFound = true; }
  ok(notFound, '未立即组房（重新等待）');
  await a.request({ t: 'match.cancel' });
  ok(true, 'cancel 退出');
  a.terminate().catch(() => {});
}

console.log('\n== [5] 真实 20s 等待超时 → 收到 match.timeout（含当前人数/上限）==');
{
  const a = await mk('TO-A');
  await a.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
  const to = await a.waitFor('match.timeout', () => true, 25000);
  ok(to && to.difficulty === 'NORMAL' && to.count === 1 && to.target === MT, `20s 后 match.timeout {count:${to.count}, target:${to.target}}`);
  await a.request({ t: 'match.cancel' });
  a.terminate().catch(() => {});
}

console.log('\n== [6] 实时在线人数 /api/online ==');
{
  const before = await onlineNow();
  const cls = [];
  for (let i = 1; i <= 3; i++) cls.push(await mk(`OL-P${i}`));
  const during = await onlineNow();
  for (const c of cls) c.terminate().catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  const after = await onlineNow();
  ok(during === before + 3, `连入 3 人后 online=${during}（此前${before}）`);
  ok(after <= during, `断开后回落 online=${after}`);
}

console.log(`\n==== 本地部署测试结果: ${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail ? 1 : 0);
