// Storage boundary: put/list/flush/close. Callers know nothing about SQL or workers.
import { Worker } from 'node:worker_threads';
export async function openRecoveryStore(file) {
 const worker=new Worker(new URL('./sqlite-worker.js',import.meta.url),{workerData:{file},execArgv:[]});
 const pending=new Map();let seq=0,dead=null,closed=false;
 const fail=e=>{dead=e;for(const p of pending.values())p.reject(e);pending.clear();};
 worker.on('error',fail);worker.on('exit',code=>{if(!closed)fail(new Error(`Recovery worker exited (${code})`));});
 worker.on('message',m=>{if(!m.seq)return;const p=pending.get(m.seq);if(!p)return;pending.delete(m.seq);if(m.error)p.reject(new Error(m.error));else p.resolve(m.value);});
 await new Promise((resolve,reject)=>{worker.once('message',m=>m.ready?resolve(undefined):reject(new Error('Recovery startup failed')));worker.once('error',reject);});
 function call(method,args={}) {
  if(dead||closed)return Promise.reject(dead||new Error('Recovery store closed'));
  if(pending.size>=128)return Promise.reject(new Error('Recovery write queue full'));
  const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({seq:id,method,args});});
 }
 return {
  put: row=>call('put',row), fact: row=>call('fact',row), list:()=>call('list'),
  backup:file=>call('backup',{file}),
  flush:()=>call('flush').then(()=>undefined),
  async close(){if(closed)return;try{await call('close');}finally{closed=true;await worker.terminate();}},
 };
}
