// Versioned PREP codec. Transport objects, timers and battle engines are rebuilt, never persisted.
import { serialize, deserialize } from 'node:v8';
import { PHASE } from '../../shared/constants.js';
import { restoreRng } from '../sim/rng.js';
const OMIT=new Set(`opts log sendFn broadcastFn onEndFn data gd ds registry dispatcher BattleClass sched ownsScheduler players order pool itemPool stage rngSetup rngShop rngWaves rngDraft rngBots rngMeta fields runner pacer spectators watchers _timers _phaseTimer _infoAdvanceTimer _turnTimer _pubTimer _pubDirty _lastPubAt _lastPubJson _privDirty _progressTimer _bossClock _poolTimer _bossPubTimer _bossPubAt _lastPoolAt _offerTimers _offerResume _rehearsalTasks recoveryWaiting recoveryError recoveryConfirmed handle onLeave onReconnect`.split(' '));
const PLAYER_OMIT=new Set(['m','gd','diyStock','_deployMap','_deployField','_diyRecords']);
const RNG=['rngSetup','rngShop','rngWaves','rngDraft','rngBots','rngMeta'];
const OPTIONS=['roomCode','mode','difficulty','modeId','aiPicksLast','seats','hostId','seed','matchNo','cs','vs','bossHp','clientCombat','verify','timerScale','combatSpeed','botRehearsal'];
function plain(value,seen=new Set()) {
 if(value==null||['string','number','boolean','undefined'].includes(typeof value))return;
 if(typeof value!=='object')throw new Error('Checkpoint contains executable state');
 if(seen.has(value))return;seen.add(value);
 if(value instanceof Map){for(const [k,v]of value){plain(k,seen);plain(v,seen);}return;}
 if(value instanceof Set){for(const v of value)plain(v,seen);return;}
 if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw new Error('Checkpoint contains unsupported state class');
 for(const v of Object.values(value))plain(v,seen);
}
const pick=(object,omit)=>Object.fromEntries(Object.entries(object).filter(([k])=>!omit.has(k)));
export function encodePrep(match) {
 if(match.phase!==PHASE.PREP||match.ended||match.disposed||match.test||match.requireCs||match.offers.length||match._rehearsalTasks.size)throw new Error('Match is not at a supported PREP checkpoint');
 const state=pick(match,OMIT);
 const players=match.order.map(ps=>({...pick(ps,PLAYER_OMIT),diyEntries:ps.diyStock.entries}));
 const options=Object.fromEntries(OPTIONS.filter(k=>Object.hasOwn(match.opts,k)).map(k=>[k,match.opts[k]]));
 const snapshot={version:1,options,state,players,pool:match.pool.entries,itemDebt:match.itemPool.debt,
  rng:Object.fromEntries(RNG.map(k=>[k,match[k].state()])),remainingMs:Math.max(0,match.deadline-match.sched.now())};
 plain(snapshot);return serialize(snapshot);
}
export function restorePrep(match,bytes) {
 const saved=deserialize(bytes);
 if(saved.version!==1||saved.state.phase!==PHASE.PREP||saved.players.length!==match.order.length)throw new Error('Incompatible PREP checkpoint');
 plain(saved);
 for(const key of Object.keys(saved.state))if(OMIT.has(key)||['__proto__','prototype','constructor'].includes(key))throw new Error('Invalid checkpoint field');
 Object.assign(match,saved.state);
 match.stage=match.stageId?match.gd.stage(match.stageId):null;
 match.pool.entries=saved.pool;match.itemPool.debt=saved.itemDebt;
 for(const row of saved.players){
  const ps=match.players.get(row.playerId);if(!ps)throw new Error('Checkpoint seat mismatch');
  const {diyEntries,...values}=row;
  for(const key of Object.keys(values))if(PLAYER_OMIT.has(key)||['__proto__','prototype','constructor'].includes(key))throw new Error('Invalid player field');
  Object.assign(ps,values);ps.setDiy(ps.diy);ps.diyStock.entries=diyEntries;
  ps.connected=ps.isBot;ps.ready=false;ps._deployMap=null;ps._deployField=undefined;
 }
 for(const key of RNG)match[key]=restoreRng(saved.rng[key]);
 match.deadline=0;match._prepEndQueued=false;match.recoveryWaiting=true;match.recoveryConfirmed=new Set();
 return saved;
}
export function prepOptions(bytes){const s=deserialize(bytes);if(s.version!==1)throw new Error('Unknown checkpoint codec');return s.options;}
export function resumePrep(match,remainingMs) {
 match.recoveryWaiting=false;
 match.setDeadline(match.soloUntimed?null:Math.max(1,remainingMs/1000),()=>match.prepDeadline());
 let i=0;for(const ps of match.alivePlayers())if(ps.botControlled)match.scheduleBotPrep(ps,i++);
 match.markPublic();for(const ps of match.order)match.markPrivate(ps);match.flush(true);
}
