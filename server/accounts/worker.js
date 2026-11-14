import { parentPort, workerData } from 'node:worker_threads';
import { openAccountStore } from './store.js';
const store = openAccountStore(workerData.file);
parentPort.on('message', ({ id, method, args }) => {
  try {
    const result = store[method](args);
    parentPort.postMessage({ id, result });
  } catch (error) {
    const allowed = /^(LOGIN_REQUIRED|INVALID_[A-Z_]+|LINK_CONFLICT|ARCHIVE_FULL)$/;
    parentPort.postMessage({ id, error: allowed.test(error.message) ? error.message : 'STORAGE_UNAVAILABLE' });
  }
});
