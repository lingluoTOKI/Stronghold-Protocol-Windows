import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createAccounts } from '../server/accounts/http.js';

test('browser ownership, bridge secret, CSRF and old score linking are enforced over HTTP', async () => {
  const dir = mkdtempSync(join(tmpdir(),'sp-account-http-'));
  const game = { roomCode:null }, origin = 'http://127.0.0.1';
  const account = createAccounts({file:join(dir,'db'),realm:'3000',origin,bridgeKey:'b'.repeat(32),namespace:'official',
    registry:{byToken: t => t === 'a'.repeat(32) ? game : null},
    // 登录后会自动同步「本服成就身份」，board 必须提供 identityOf / identityHasData / mergeIdentities。
    // identityHasData 返回 true = 本机有成绩，confirm 时才会真的建立关联，后续 restore 才有得可恢复
    // （线上版 restore 要求先有关联，否则报 NO_LINKED_SCORES）。
    board:{ accountIdentity:()=> 'c'.repeat(32),restoreAccountIdentity:()=>{},
      identityOf:()=> 'd'.repeat(32),identityHasData:()=> true,mergeIdentities:()=>{} }});
  const server = createServer((req,res) => account.handle(req,res,new URL(req.url,origin).pathname));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/account/`;
  const post = (path,data,headers={}) => fetch(base+path,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+'a'.repeat(32),'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  try {
    assert.equal((await post('start',{qq:'123456',nickname:'甲'},{Origin:'https://evil.example'})).status,403);
    const start = await post('start',{qq:'123456',nickname:'甲'});
    const pending = start.headers.getSetCookie()[0].split(';')[0], {code} = await start.json();
    assert.equal((await post('bridge',{code,sender:'alice'})).status,403);
    assert.equal((await post('bridge',{code,sender:'alice'},{'x-account-bridge':'b'.repeat(32)})).status,200);
    assert.equal((await post('confirm',{})).status,400);
    const logged = await post('confirm',{}, {Cookie:pending});
    assert.equal(logged.status,200);
    const cookie = logged.headers.getSetCookie().find(c=>c.startsWith('sp_account_3000=')).split(';')[0];
    assert.equal((await post('confirm',{}, {Cookie:pending})).status,400);
    assert.equal((await post('link',{}, {Cookie:cookie})).status,200);
    game.roomCode='ABCD';
    const denied = await post('restore',{}, {Cookie:cookie});
    assert.equal((await denied.json()).error,'LEAVE_ROOM_FIRST');
    game.roomCode=null;
    assert.equal((await post('restore',{}, {Cookie:cookie})).status,200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await account.close(); rmSync(dir,{recursive:true,force:true});
  }
});
