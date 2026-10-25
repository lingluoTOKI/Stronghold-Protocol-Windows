// Recovery orchestration. The injected store is the only persistence dependency.
import { serialize, deserialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Room } from '../lobby.js';
import { Session } from '../net.js';
import { encodePrep, restorePrep, prepOptions, resumePrep } from './checkpoint.js';
import { DEFAULT_VERSION } from '../../shared/versions.js';
import { ERR } from '../../shared/constants.js';

export async function recoveryCompatibility(root,content) {
 // Only the persisted state shape decides whether a checkpoint can be replayed: the match tree plus the codec itself.
 // The orchestration layer (this file, the sqlite store) never changes the bytes on disk, so editing it must not
 // invalidate live saves — that used to wipe every in-progress game on each recovery fix.
 const hash=createHash('sha256').update('prep-v1:'+content);
 async function walk(dir){for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.name.endsWith('.js'))hash.update(p.slice(root.length)).update(await readFile(p));}}
 await walk(join(root,'server/match'));
 hash.update('codec:').update(await readFile(join(root,'server/recovery/checkpoint.js')));
 return hash.digest('hex');
}
const ROOM_KEYS=['code','mode','difficulty','bossHp','aiPicksLast','hostId','seats','matchCount','content','version','soloUnlimited','aiTakeover'];
const SESSION_KEYS=['playerId','token','name','loadout','ops','notOwned','diy','skins'];
const pick=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o[k]]));
export function createRecoveryService({store,lobby,compatibility,log=console}) {
 let closing=false;const jobs=new Set();const failures=new Map();
 function track(p,id){jobs.add(p);p.catch(e=>{failures.set(id,e.message);log.error('[recovery]',id,e.message);}).finally(()=>jobs.delete(p));return p;}
 function envelope(room,ctx){return {version:1,room:pick(room,ROOM_KEYS),challenge:ctx.challenge,
  sessions:room.seats.filter(s=>s&&!s.isBot&&!s.left).map(s=>{const session=lobby.registry.byId(s.playerId);if(!session)throw new Error('Missing reconnect identity');return {...pick(session,SESSION_KEYS),challengeIdentity:lobby.dailyBoard?.recoveryIdentity(session)||null};})};}
 function put(room,ctx,status,payload){return store.put({id:ctx.challenge.runId,compatibility,status,payload:serialize(payload)});}
 function save(room,ctx){
  if(closing||ctx.ended||room.modded||room.test||(room.version && room.version!==DEFAULT_VERSION))return;
  try{const payload={...envelope(room,ctx),checkpoint:encodePrep(ctx.match)};
   track(put(room,ctx,'active',payload).then(()=>{failures.delete(ctx.challenge.runId);}),ctx.challenge.runId);
  }catch(e){failures.set(ctx.challenge.runId,e.message);log.error('[recovery] checkpoint unavailable',room.code,e.message);}
 }
 function attach(room,ctx){
  const m=ctx.match;if(room.modded||room.test||(room.version && room.version!==DEFAULT_VERSION))return;
  // A resumed match waits for every remaining human to explicitly confirm with the existing Ready action.
  const handle=m.handle.bind(m);
  m.handle=(id,msg)=>{
   if(msg.t==='g.autoplay' && !m.recoveryWaiting){
    const ps=m.players.get(id);if(!ps||ps.left||ps.isBot)return {error:ERR.NOT_IN_ROOM};
    track(store.fact({id:ctx.challenge.runId,usedAI:!!msg.on}).then(()=>{if(!m.disposed)handle(id,msg);}),ctx.challenge.runId);return {ok:true};
   }
   if(!m.recoveryWaiting)return handle(id,msg);
   const ps=m.players.get(id);if(!ps||ps.isBot||ps.left)return {error:ERR.NOT_IN_ROOM};
   if(msg.t==='g.watch')return handle(id,msg);
   if(msg.t!=='g.ready')return {error:ERR.WRONG_PHASE,detail:'Confirm restored game with Ready'};
   m.recoveryConfirmed.add(id);
   if(m.order.filter(p=>!p.isBot&&!p.left).every(p=>p.connected&&m.recoveryConfirmed.has(p.playerId)))resumePrep(m,m._recoveryRemainingMs);
   else {m.markPublic();m.flush(true);}
   return {ok:true};
  };
  const maybeResume=()=>{
   const humans=m.order.filter(p=>!p.isBot&&!p.left);
   if(m.recoveryWaiting&&!m.ended&&humans.length&&humans.every(p=>p.connected&&m.recoveryConfirmed.has(p.playerId)))resumePrep(m,m._recoveryRemainingMs);
  };
  // 重连即视为确认：客户端没有单独的「确认恢复」流程，只等 g.ready 会让玩家卡在恢复帧里。
  const reconnect=m.onReconnect.bind(m);
  m.onReconnect=id=>{reconnect(id);m.recoveryConfirmed.add(id);maybeResume();};
  const leave=m.onLeave.bind(m);
  m.onLeave=id=>{track(store.fact({id:ctx.challenge.runId,departed:id}).then(()=>{if(!m.disposed){leave(id);maybeResume();}}),ctx.challenge.runId);};
 }
 async function finish(room,ctx,summary,done){
  if(ctx.recoveryFinishing)return;ctx.recoveryFinishing=true;
  const messages=ctx.recoveryResults||[];
  const payload={...envelope(room,ctx),summary,messages,publicFrame:ctx.lastPublic,usedAI:ctx.match.challengeUsedAI};
  await put(room,ctx,'finished',payload); // Commit terminal state before any award or result reaches a player.
  ctx.recoveryCommitted=true;
  for(const [id,msg]of messages)lobby.matchSend(room,ctx,id,msg);
  await lobby.dailyBoard?.flush();
  done();
 }
 async function restore(){
  const rows=(await store.list()).sort((a,b)=>(a.status===b.status?b.updated-a.updated:a.status==='active'?-1:1));
  for(const row of rows){
   if(row.error){failures.set(row.id,row.error);continue;}
   // A build change must not vaporise a game people are still playing: an active save is replayed whenever the codec
   // can still read it. Finished replays stay strict — they are only kept for review and are cheap to drop.
   const stale=row.compatibility!==compatibility;
   if(stale&&row.status!=='active'){failures.set(row.id,'Version mismatch; replay retained');continue;}
   // Finished replays stay on disk (cheap to keep) but are only rebuilt in memory while someone could still be
   // looking at them: the reconnect window is 60 s everywhere now, so an older settlement has no one coming back.
   // Keeping them for a day made every restart resurrect all of yesterday's rooms, filling maxRooms until the
   // 60 s sweep removed them again.
   if(row.status==='finished'&&Date.now()-row.updated>60000)continue;
   try{
    const payload=deserialize(row.payload);if(payload.version!==1||payload.challenge.runId!==row.id)throw new Error('Invalid recovery envelope');
    const r=payload.room;if(row.status==='finished' && (lobby.rooms.has(r.code)||payload.sessions.some(s=>lobby.registry.byId(s.playerId))))continue;
    if(lobby.rooms.has(r.code))throw new Error('Recovered room code conflict');
    for(const s of payload.sessions)if(lobby.registry.byId(s.playerId)||lobby.registry.byTokenMap.has(s.token)||!/^([a-f0-9]{32})$/.test(s.token))throw new Error('Reconnect identity conflict');
    const room=new Room(r.code,r.mode,r.difficulty,lobby.now());Object.assign(room,r);room.version=r.version||DEFAULT_VERSION;room.spectators=[];
    for(const s of room.seats)if(s){s.connected=s.isBot;s.ready=false;}
    const added=[];
    try{
     // 恢复出的房间只等 60 秒：和普通掉线重连同一节奏，没人回来立刻释放，绝不留僵尸房。
     // 恢复出的会话从一开始就是掉线状态：没有 disconnectedAt 的话 isExpired 永远为假，无人回来的房间会永久占着名额。
     const keepMs=60000;
     for(const saved of payload.sessions){const s=new Session({...saved,now:lobby.now()});Object.assign(s,pick(saved,SESSION_KEYS));s.roomCode=room.code;s.resumeWindowMs=keepMs;
      if(!s.connected)s.disconnectedAt=lobby.now();
      lobby.registry.byPlayerId.set(s.playerId,s);lobby.registry.byTokenMap.set(s.token,s);lobby.dailyBoard?.restoreRecoveryIdentity(s,saved.challengeIdentity);added.push(s);}
     lobby.rooms.set(room.code,room);
     if(row.status==='finished'){
      lobby.dailyBoard?.record(room,payload.summary,lobby.registry,{...payload.challenge,usedAI:payload.usedAI});await lobby.dailyBoard?.flush();
      room.lastSummary=payload.summary;
      room.replay={publicFrame:payload.publicFrame||null,frames:new Map(payload.messages.map(([id,msg])=>[id,JSON.stringify(msg)])),pending:new Set(payload.sessions.map(s=>s.playerId))};
     }else{
      const opts=prepOptions(payload.checkpoint);const result=lobby.startMatch(room,null,{...payload,options:opts});
      if(result.error)throw new Error('Could not reconstruct match');
      if(row.facts?.usedAI)room.match.challengeUsedAI=true;
      for(const id of row.facts?.departed||[]){
       const ps=room.match.players.get(id);if(ps){ps.left=true;ps.connected=false;ps.alive=false;ps.autoplay=false;}
       const seat=room.seatOf(id);if(seat)seat.left=true;
       const session=lobby.registry.byId(id);if(session)lobby.registry.remove(session);
      }
      // Departure changes team accounting. Refuse instead of guessing a new team state from an older checkpoint.
      if(row.facts?.departed?.some(id=>!deserialize(payload.checkpoint).players.find(p=>p.playerId===id)?.left))throw new Error('Departure after checkpoint; retained for operator review');
      if(row.fallback)log.warn('[recovery] used previous checkpoint',room.code);
      if(stale)log.warn('[recovery] replayed a save from an older build',room.code,'(codec-compatible)');
     }
    }catch(e){for(const s of added)lobby.registry.remove(s);lobby.rooms.delete(room.code);room.match?.dispose();throw e;}
   }catch(e){failures.set(row.id,e.message);log.error('[recovery] retained unreadable match',row.id,e.message);}
  }
 }
 return {
  save,attach,restore,
  restoreMatch(room,ctx,payload){const saved=restorePrep(ctx.match,payload.checkpoint);ctx.match._recoveryRemainingMs=saved.remainingMs;ctx.challenge=payload.challenge;attach(room,ctx);},
  bufferResult(ctx,id,msg){if(ctx.recoveryCommitted)return false;(ctx.recoveryResults||= []).push([id,msg]);return true;},
  finish(room,ctx,summary,done){track(finish(room,ctx,summary,done),ctx.challenge.runId);},
  abandon(room,ctx,reason){if(!ctx||closing||reason==='shutdown'||ctx.recoveryFinishing||ctx.ended)return;track(put(room,ctx,'finished',{...envelope(room,ctx),summary:{players:[],reason},messages:[]}),ctx.challenge.runId);},
  async close(){closing=true;while(jobs.size)await Promise.allSettled([...jobs]);await store.close();},
  async flush(){while(jobs.size)await Promise.all([...jobs]);await store.flush();},
  status(){return {enabled:true,pending:jobs.size,failures:[...failures].map(([id,error])=>({id,error}))};},
 };
}
