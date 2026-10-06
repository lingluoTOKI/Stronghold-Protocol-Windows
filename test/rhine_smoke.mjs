// 莱茵扩展冒烟：room.create(rhineEnabled:true) → 6 席 → 数据档 rhine → 加AI → host 开始
import { TestClient } from './helpers/wsClient.js';
const W = 'ws://127.0.0.1:3100/ws';
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.log('  ✗ FAIL:', l); } };

const c = await TestClient.connect(W);
const w = await c.hello('RHINE-SMOKE'); c.id = w.playerId;

const rc = await c.request({ t: 'room.create', mode: 'coop', difficulty: 'ABYSS', rhineEnabled: true });
ok(rc.t === 'ok', `room.create(rhineEnabled:true) → ok (${JSON.stringify(rc)})`);

const st = await c.waitFor('room.state', (m) => m.mode === 'coop');
ok(st.rhineEnabled === true, `房间 rhineEnabled=true（${st.rhineEnabled}）`);
ok(st.seats.length === 6, `6 席位 MAX_SEATS（${st.seats.length}）`);
ok(st.dataProfile === 'rhine' || st.profile === 'rhine', `数据档 rhine（dataProfile=${st.dataProfile}, profile=${st.profile}）`);
ok(!st.inMatch, '处于大厅（未开局）');

const rb = await c.request({ t: 'room.addBot' });
ok(rb.t === 'ok', `room.addBot → ok（${JSON.stringify(rb)}）`);

const rs = await c.request({ t: 'room.start' });
ok(rs.t === 'ok', `host room.start → ok（${JSON.stringify(rs)}）`);
const im = await c.waitFor('room.state', (m) => m.inMatch === true);
ok(im.inMatch === true, `莱茵房自动进入对局 inMatch=true`);

c.terminate().catch(() => {});
console.log(`\n==== 莱茵冒烟: ${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail ? 1 : 0);
