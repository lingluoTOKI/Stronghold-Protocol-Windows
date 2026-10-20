// Private worker: synchronous SQLite never waits for disk on the game event loop.
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
mkdirSync(dirname(workerData.file), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(workerData.file);
try { chmodSync(workerData.file, 0o600); } catch { /* Windows ACLs are managed by the operator. */ }
db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
const version = db.prepare('PRAGMA user_version').get().user_version;
if (version !== 0 && version !== 1) throw new Error('Unsupported recovery database version');
db.exec(`CREATE TABLE IF NOT EXISTS checkpoints (
 id TEXT PRIMARY KEY, compatibility TEXT NOT NULL, status TEXT NOT NULL,
 payload BLOB NOT NULL, hash TEXT NOT NULL, previous BLOB, previous_hash TEXT,
 updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS recovery_facts (id TEXT PRIMARY KEY, used_ai INTEGER NOT NULL DEFAULT 0, departed TEXT NOT NULL DEFAULT '[]');
 PRAGMA user_version=1;`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const methods = {
 put({ id, compatibility, status, payload }) {
  if (!id || !compatibility || !['active','finished'].includes(status) || !(payload instanceof Uint8Array) || payload.length > 8*1024*1024) throw new Error('Invalid checkpoint');
  db.exec('BEGIN IMMEDIATE');
  try {
   const old = db.prepare('SELECT status FROM checkpoints WHERE id=?').get(id);
   if (old?.status === 'finished' && status === 'active') throw new Error('Finished match cannot be resurrected');
   db.prepare(`INSERT INTO checkpoints(id,compatibility,status,payload,hash,updated) VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET compatibility=excluded.compatibility,status=excluded.status,
    previous=CASE WHEN checkpoints.status='active' AND excluded.status='active' THEN checkpoints.payload ELSE NULL END,
    previous_hash=CASE WHEN checkpoints.status='active' AND excluded.status='active' THEN checkpoints.hash ELSE NULL END,
    payload=excluded.payload,hash=excluded.hash,updated=excluded.updated`).run(id,compatibility,status,payload,hash(payload),Date.now());
   db.prepare("DELETE FROM checkpoints WHERE status='finished' AND updated<?").run(Date.now()-8*86400000);
   db.exec('COMMIT'); return true;
  } catch(e) { db.exec('ROLLBACK'); throw e; }
 },
 fact({id,usedAI=false,departed=null}) {
  if(typeof id!=='string'||(departed!==null&&typeof departed!=='string'))throw new Error('Invalid recovery fact');
  const previous=db.prepare('SELECT * FROM recovery_facts WHERE id=?').get(id);
  const left=new Set(JSON.parse(previous?.departed||'[]'));if(departed)left.add(departed);
  db.prepare('INSERT INTO recovery_facts(id,used_ai,departed) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET used_ai=excluded.used_ai,departed=excluded.departed').run(id,usedAI||previous?.used_ai?1:0,JSON.stringify([...left]));return true;
 },
 list() {
  return db.prepare("SELECT * FROM checkpoints WHERE status='active' OR updated>? ORDER BY updated").all(Date.now()-86400000).map(row => {
   const facts=db.prepare('SELECT * FROM recovery_facts WHERE id=?').get(row.id);row.facts={usedAI:!!facts?.used_ai,departed:JSON.parse(facts?.departed||'[]')};
   if (hash(row.payload)===row.hash) return {...row,previous:undefined,previous_hash:undefined};
   if (row.status==='active' && row.previous && hash(row.previous)===row.previous_hash) return {...row,payload:row.previous,fallback:true,previous:undefined,previous_hash:undefined};
   return {id:row.id,compatibility:row.compatibility,status:row.status,error:'Checkpoint checksum mismatch'};
  });
 },
 flush() { return true; },
 backup({file}) { mkdirSync(dirname(file),{recursive:true,mode:0o700});db.prepare('VACUUM INTO ?').run(file);try{chmodSync(file,0o600);}catch{}return true; },
 close() { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); return true; },
};
parentPort.on('message', ({ seq, method, args }) => {
 try { if (!Object.hasOwn(methods,method)) throw new Error('Unknown store operation'); parentPort.postMessage({seq,value:methods[method](args)}); }
 catch(e) { parentPort.postMessage({seq,error:e.message}); }
});
parentPort.postMessage({ready:true});
