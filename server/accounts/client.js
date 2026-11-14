import { Worker } from 'node:worker_threads';
export function createAccountStore(file) {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: { file } });
  const pending = new Map();
  let serial = 0, dead = false;
  const fail = () => {
    dead = true;
    for (const p of pending.values()) p.reject(new Error('STORAGE_UNAVAILABLE'));
    pending.clear();
  };
  worker.on('error', fail);
  worker.on('exit', fail);
  worker.on('message', ({ id, result, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error)); else p.resolve(result);
  });
  return {
    call(method, args = {}) {
      if (dead || pending.size >= 64) return Promise.reject(new Error('STORAGE_UNAVAILABLE'));
      return new Promise((resolve,reject) => { const id = ++serial; pending.set(id,{resolve,reject}); worker.postMessage({id,method,args}); });
    },
    async close() { try { if (!dead) await this.call('close'); } finally { await worker.terminate(); } },
  };
}
