// 本地部署测试：验证「直接建立」路径（room.create coop → 大厅 → 加AI → host 手动开始）
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.log('  ✗ FAIL:', l); } };

const srv = await startServer({ port: 0, quiet: true });
const port = srv.port;
const a = await TestClient.connect(`ws://127.0.0.1:${port}/ws`);
const w = await a.hello('直接建-A');
console.log('\n== [直接建立] coop 建房 → 大厅 → 加AI → 开始 ==');
const rc = await a.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
ok(rc.t === 'ok', `room.create(coop) → ok (${JSON.stringify(rc)})`);
const st1 = await a.waitFor('room.state', (m) => m.mode === 'coop');
ok(st1.inMatch === false, '进房间大厅 inMatch=false（非匹配自动开局）');
ok(st1.hostId === w.playerId, '建房者为 host');
ok(st1.seats.filter((s) => s && !s.isBot).length === 1, '初始 1 名真人（无 AI 自动补位）');
const ra = await a.request({ t: 'room.addBot' });
ok(ra.t === 'ok', 'host 手动加 1 名 AI 队友');
const st2 = await a.waitFor('room.state', (m) => m.seats.some((s) => s && s.isBot));
ok(st2.seats.filter((s) => s && s.isBot).length === 1, '房间出现 1 AI');
const rs = await a.request({ t: 'room.start' });
ok(rs.t === 'ok', `host 手动开始 (${JSON.stringify(rs)})`);
const st3 = await a.waitFor('room.state', (m) => m.inMatch === true);
ok(st3.inMatch === true, '手动开局 inMatch=true');

// 匹配路径仍可用（quick check）
console.log('\n== [匹配队友] 仍在（进池上限4）==');
const b = await TestClient.connect(`ws://127.0.0.1:${port}/ws`);
await b.hello('匹配-B');
const rq = await b.request({ t: 'match.enqueue', difficulty: 'NORMAL' });
ok(rq.t === 'ok', `match.enqueue → ok (${JSON.stringify(rq)})`);
const sts = await b.waitFor('match.status', (m) => m.count >= 1 && m.target === 4);
ok(sts.target === 4, `进池 match.status target=${sts.target}`);
await b.request({ t: 'match.cancel' });

console.log(`\n==== 本地部署测试(直接建立): ${pass} 通过 / ${fail} 失败 ====`);
b.terminate().catch(() => {}); a.terminate().catch(() => {});
await srv.close();
process.exit(fail ? 1 : 0);
