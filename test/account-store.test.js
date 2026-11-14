import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccountStore } from '../server/accounts/store.js';

test('verified sender owns account, QQ display does not; shared identity and separate realms persist', () => {
  const dir = mkdtempSync(join(tmpdir(),'sp-account-')), file = join(dir,'accounts.sqlite');
  let s = openAccountStore(file);
  try {
    const a = s.login({subject:'bot:alice',qq:'123456',nickname:'博士'});
    const b = s.login({subject:'bot:bob',qq:'123456',nickname:'博士'});
    assert.notEqual(a.profile.id,b.profile.id);
    assert.equal(s.login({subject:'bot:alice',qq:'999999',nickname:'冒名'}).profile.nickname,'博士');
    s.link({token:a.token,realm:'3000',identity:'a'.repeat(32)});
    assert.throws(() => s.link({token:b.token,realm:'3000',identity:'a'.repeat(32)}),/LINK_CONFLICT/);
    assert.throws(() => s.link({token:a.token,realm:'3000',identity:'b'.repeat(32)}),/LINK_CONFLICT/);
    s.link({token:a.token,realm:'3001',identity:'b'.repeat(32)});
    s.rename({token:a.token,nickname:'随时改名'});
    s.upload({token:a.token,realm:'3000',records:[{id:'one',name:'旧昵称'}]});
    assert.equal(s.upload({token:a.token,realm:'3000',records:[{id:'one',name:'覆盖'}]}).added,0);
    assert.equal(s.records({token:a.token,realm:'3001'}).records.length,0);
    assert.equal(s.records({token:b.token,realm:'3000'}).records.length,0);
    s.close(); s = openAccountStore(file);
    assert.equal(s.me({token:a.token}).nickname,'随时改名');
    assert.deepEqual(s.me({token:a.token}).linkedRealms,['3000','3001']);
    assert.equal(s.records({token:a.token,realm:'3000'}).records[0].name,'旧昵称');
    const code = s.recovery({token:a.token}).code;
    const recovered = s.recover({code});
    assert.throws(() => s.recover({code}),/INVALID_RECOVERY/);
    assert.throws(() => s.me({token:a.token}),/LOGIN_REQUIRED/);
    assert.equal(s.me({token:recovered.token}).id,a.profile.id);
    assert.throws(() => s.recover({code:'a'.repeat(32)+'.'+'b'.repeat(64)}),/INVALID_RECOVERY/);
  } finally { s.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('archive quota rolls back entire batch rather than deleting previous records', () => {
  const dir = mkdtempSync(join(tmpdir(),'sp-account-')), s = openAccountStore(join(dir,'db'));
  try {
    const {token} = s.login({subject:'bot:a',qq:'123456',nickname:'甲'});
    s.upload({token,realm:'3000',records:[{id:'original'}]});
    assert.throws(() => s.upload({token,realm:'3000',records:Array.from({length:1000},(_,i)=>({id:String(i)}))}),/ARCHIVE_FULL/);
    assert.deepEqual(s.records({token,realm:'3000'}).records,[{id:'original'}]);
  } finally { s.close(); rmSync(dir,{recursive:true,force:true}); }
});
