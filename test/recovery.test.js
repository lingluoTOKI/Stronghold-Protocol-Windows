import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize, deserialize } from 'node:v8';
import { DatabaseSync } from 'node:sqlite';
import { openRecoveryStore } from '../server/recovery/store.js';
import { encodePrep, restorePrep, resumePrep } from '../server/recovery/checkpoint.js';
import { createRecoveryService } from '../server/recovery/service.js';
import { makeMatch, DATA, checkInvariants } from './match/harness.js';
import { Lobby, Room } from '../server/lobby.js';
import { SessionRegistry, Session } from '../server/net.js';
import { restoreRng } from '../server/sim/rng.js';
const log={info(){},warn(){},error(){},debug(){}};
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'sp-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'matches.sqlite');}
test('SQLite persists both revisions and refuses resurrection after terminal commit',async t=>{
 const file=await fixture(t);let store=await openRecoveryStore(file);
 const put=(status,n)=>store.put({id:'run',compatibility:'v1',status,payload:serialize({n})});
 await put('active',1);await put('active',2);await store.close();
 store=await openRecoveryStore(file);assert.equal(deserialize((await store.list())[0].payload).n,2);
 await store.put({id:'run',compatibility:'v1',status:'finished',payload:serialize({n:3})});
 await assert.rejects(store.put({id:'run',compatibility:'v1',status:'active',payload:serialize({n:4})}),/resurrected/);
 await store.close();
});
test('checksum failure falls back only for active games, preserves damaged evidence',async t=>{
 const file=await fixture(t);let store=await openRecoveryStore(file);
 for(const n of [1,2])await store.put({id:'run',compatibility:'v1',status:'active',payload:serialize({n})});await store.close();
 const db=new DatabaseSync(file);db.exec("UPDATE checkpoints SET hash='broken'");db.close();
 store=await openRecoveryStore(file);const row=(await store.list())[0];assert.equal(row.fallback,true);assert.equal(deserialize(row.payload).n,1);await store.close();
});
for(const humans of [1,6])test(`PREP round trip: ${humans} humans, shops, stock, stats and RNG preserved`,()=>{
 const h=makeMatch({mode:humans===1?'solo':'coop',humans,fake:true,seed:72});h.start();h.toPrep();
 const bytes=encodePrep(h.m);const j=makeMatch({mode:humans===1?'solo':'coop',humans,fake:true,seed:72});
 const saved=restorePrep(j.m,bytes);assert.equal(j.m.recoveryWaiting,true);assert.equal(j.m.deadline,0);
 for(let i=0;i<humans;i++){assert.deepEqual(j.m.order[i].shop,h.m.order[i].shop);assert.deepEqual(j.m.order[i].stats,h.m.order[i].stats);assert.deepEqual(j.m.order[i].board,h.m.order[i].board);}
 assert.deepEqual(j.m.pool.entries,h.m.pool.entries);for(const key of ['rngShop','rngMeta','rngBots','rngDraft'])for(let i=0;i<50;i++)assert.equal(j.m[key](),h.m[key]());
 checkInvariants(j.m);resumePrep(j.m,saved.remainingMs);assert.equal(j.m.recoveryWaiting,false);h.m.dispose();j.m.dispose();
});
test('RNG state zero is restored exactly and malformed states rejected',()=>{assert.equal(restoreRng(0).state(),0);assert.throws(()=>restoreRng(-1));});
test('startup restores private seats, rejects stranger, waits for every human',async t=>{
 const file=await fixture(t);let store=await openRecoveryStore(file);const registry=new SessionRegistry();
 const h=makeMatch({mode:'coop',humans:2,fake:true,seed:9});h.start();h.toPrep();
 const lobby=new Lobby({registry,getData:()=>DATA,log});const room=new Room('TEST','coop','NORMAL',Date.now());room.seats=h.m.opts.seats.map(s=>({...s}));room.hostId='p_0';room.matchCount=1;room.match=h.m;
 for(let i=0;i<2;i++){const s=new Session({playerId:'p_'+i,token:String(i+1).repeat(32),name:'P'+i});s.roomCode='TEST';registry.byPlayerId.set(s.playerId,s);registry.byTokenMap.set(s.token,s);}
 const ctx={match:h.m,challenge:{runId:'run',startedAt:Date.now(),mode:'coop',difficulty:'NORMAL',bossHp:1,participants:h.m.opts.seats}};room.matchCtx=ctx;lobby.rooms.set('TEST',room);
 let service=createRecoveryService({store,lobby,compatibility:'v1',log});service.save(room,ctx);await service.flush();await service.close();h.m.dispose();
 store=await openRecoveryStore(file);const next=new Lobby({registry:new SessionRegistry(),getData:()=>DATA,log});service=createRecoveryService({store,lobby:next,compatibility:'v1',log});next.recovery=service;await service.restore();
 assert.deepEqual(service.status().failures,[]);const m=next.rooms.get('TEST').match;
 assert.equal(next.registry.byToken('1'.repeat(32)).playerId,'p_0');assert.equal(m.recoveryWaiting,true);
 assert.ok(m.handle('stranger',{t:'g.ready',ready:true}).error);assert.ok(m.handle('p_0',{t:'g.refresh'}).error);
 m.onReconnect('p_0');assert.equal(m.recoveryWaiting,true); // p_1 has not come back yet
 m.onReconnect('p_1');assert.equal(m.recoveryWaiting,false); // a reconnect is the confirmation; everyone is back
 await service.close();next.shutdown('shutdown');
});

import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
class FastMatch extends Match { constructor(opts){super({...opts,scheduler:new VirtualScheduler(),botRehearsal:0});} }
function prep(m){for(let i=0;i<10000&&m.phase!=='PREP';i++){for(const p of m.order){if(p.isBot)continue;if(m.phase==='INFO_CHECK')m.handle(p.playerId,{t:'g.infoReady'});if(m.phase==='BAND_DRAFT'&&m.draftTurn()===p.playerId)m.handle(p.playerId,{t:'g.band',bandId:'band_bldsk'});if(m.phase==='SP_DRAFT'&&m.spTurn()===p.playerId)m.handle(p.playerId,{t:'g.choice',idx:m.sp.cards.find(c=>m.sp.taken[c.idx]==null).idx});}m.sched.runNext();}assert.equal(m.phase,'PREP');}
test('real lobby checkpoint hook, AI qualification and durable terminal replay survive restart',async t=>{
 const file=await fixture(t);let store=await openRecoveryStore(file);let registry=new SessionRegistry();let lobby=new Lobby({registry,getData:()=>DATA,log,MatchClass:FastMatch});let service=createRecoveryService({store,lobby,compatibility:'v1',log});lobby.recovery=service;
 const s=registry.create('Doctor');const room=new Room('REAL','solo','NORMAL',Date.now());room.seats[0]={seat:0,playerId:s.playerId,name:s.name,isBot:false,connected:true,ready:true,left:false};room.hostId=s.playerId;s.roomCode='REAL';lobby.rooms.set('REAL',room);
 assert.equal(lobby.startMatch(room).ok,true);prep(room.match);await service.flush();assert.equal((await store.list()).length,1);assert.deepEqual(service.status().failures,[]);
 room.match.handle(s.playerId,{t:'g.autoplay',on:true});room.match.handle(s.playerId,{t:'g.autoplay',on:false});await service.flush();assert.equal(room.match.challengeUsedAI,true);assert.equal(room.match.players.get(s.playerId).autoplay,false);
 room.match.finish({victory:false,reason:'defeat'});await service.flush();assert.equal(room.match,null);assert.equal((await store.list())[0].status,'finished');await service.close();lobby.shutdown('shutdown');
 store=await openRecoveryStore(file);registry=new SessionRegistry();lobby=new Lobby({registry,getData:()=>DATA,log});service=createRecoveryService({store,lobby,compatibility:'v1',log});lobby.recovery=service;await service.restore();
 assert.deepEqual(service.status().failures,[]);assert.equal(lobby.rooms.get('REAL').match,null);assert.ok(lobby.rooms.get('REAL').replay.frames.has(s.playerId));assert.ok(registry.byToken(s.token));await service.close();lobby.shutdown('shutdown');
});
test('incompatible recovery version is retained without loading a room',async t=>{
 const file=await fixture(t);const store=await openRecoveryStore(file);await store.put({id:'run',compatibility:'old',status:'active',payload:serialize({})});
 const lobby=new Lobby({registry:new SessionRegistry(),getData:()=>DATA,log});const service=createRecoveryService({store,lobby,compatibility:'new',log});await service.restore();assert.equal(lobby.rooms.size,0);assert.equal(service.status().failures.length,1);assert.equal((await store.list()).length,1);await service.close();lobby.shutdown('shutdown');
});

test('restored PREP continues to the next round without rerolling shops or changing stats',()=>{
 const h=makeMatch({mode:'coop',humans:2,bots:1,fake:true,seed:17});h.start();h.toPrep();const bytes=encodePrep(h.m);
 const j=makeMatch({mode:'coop',humans:2,bots:1,fake:true,seed:17});const saved=restorePrep(j.m,bytes);for(const ps of j.m.order)ps.connected=true;resumePrep(j.m,saved.remainingMs);
 h.toPrep(2);j.toPrep(2);
 for(let i=0;i<h.m.order.length;i++){assert.deepEqual(j.m.order[i].shop,h.m.order[i].shop);assert.deepEqual(j.m.order[i].stats,h.m.order[i].stats);assert.deepEqual(j.m.order[i].board,h.m.order[i].board);}
 assert.equal(j.m.rngShop.state(),h.m.rngShop.state());assert.deepEqual(j.m.pool.entries,h.m.pool.entries);h.m.dispose();j.m.dispose();
});
import { startServer } from '../server/index.js';
import WebSocket from 'ws';
function welcome(url,token){return new Promise((resolve,reject)=>{const ws=new WebSocket(url);const timer=setTimeout(()=>{ws.terminate();reject(new Error('WebSocket recovery timeout'));},5000);ws.on('error',reject);ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name:'Doctor',token})));ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.t==='welcome'){clearTimeout(timer);ws.close();resolve(m);}});});}
test('HTTP service closes and reopens SQLite; original WebSocket token still resumes',async t=>{
 const file=await fixture(t);const opts={port:0,host:'127.0.0.1',quiet:true,recovery:{file},assetIndex:false,studio:false,dailyChallenges:false,MatchClass:FastMatch};
 let srv=await startServer(opts);const session=srv.registry.create('Doctor');const room=new Room('LIVE','solo','NORMAL',Date.now());room.seats[0]={seat:0,playerId:session.playerId,name:session.name,isBot:false,connected:true,ready:true,left:false};room.hostId=session.playerId;session.roomCode='LIVE';srv.lobby.rooms.set('LIVE',room);srv.lobby.startMatch(room);prep(room.match);await srv.lobby.recovery.flush();await srv.close();
 srv=await startServer(opts);try{assert.equal(srv.lobby.rooms.get('LIVE').match.recoveryWaiting,true);const w=await welcome(`ws://127.0.0.1:${srv.port}/ws`,session.token);assert.equal(w.resumed,true);assert.equal(w.playerId,session.playerId);const health=await (await fetch(`http://127.0.0.1:${srv.port}/healthz`)).json();assert.equal(health.recovery.failures,0);}finally{await srv.close();}
});

import { spawn } from 'node:child_process';
import { once } from 'node:events';
test('acknowledged checkpoint survives abrupt process termination and consistent backup',async t=>{
 const file=await fixture(t);const moduleUrl=new URL('../server/recovery/store.js',import.meta.url).href;
 const code=`import {openRecoveryStore} from ${JSON.stringify(moduleUrl)};const s=await openRecoveryStore(${JSON.stringify(file)});await s.put({id:'crash',compatibility:'v1',status:'active',payload:new Uint8Array([1,2,3])});console.log('COMMITTED');`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('child commit timeout')),10000);child.once('error',reject);child.stdout.on('data',data=>{if(String(data).includes('COMMITTED')){clearTimeout(timer);resolve();}});});
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 const store=await openRecoveryStore(file);assert.deepEqual([...((await store.list())[0].payload)],[1,2,3]);const backup=file+'.backup';await store.backup(backup);await store.close();
 const copied=await openRecoveryStore(backup);assert.equal((await copied.list())[0].id,'crash');await copied.close();
});
