// Room and match preparation share one profile barrier. Older asynchronous loads never unlock a newer profile.
import { dataProfileId } from '../data.js';
import { t } from '../../shared/i18n.js';

/** A match's fixed profile also works when m.public arrives before the restored room.state. */
export function profileFromState(s) {
  const pub = s?.match?.public;
  // Fall back to the room flag when a match public frame omits rhineEnabled (never let an undefined default to rhine).
  const inMatch = pub && s?.room?.inMatch !== false;
  return dataProfileId(inMatch ? (pub.rhineEnabled ?? s?.room?.rhineEnabled) : s?.room?.rhineEnabled);
}

export function createDataProfilePreparation({ cache, target, files }) {
  let pending = null;
  let pendingGeneration = -1;
  const update = (patch) => {
    const ui = target.get().ui || {};
    if (Object.entries(patch).some(([key, value]) => !Object.is(ui[key], value))) target.patch('ui', patch);
  };
  return function prepare(enabled) {
    const id = dataProfileId(enabled);
    // Publish the barrier before selectProfile notifies hooks or loadout synchronization.
    if (id !== cache.profileId) update({ dataReady: false, dataError: null });
    cache.selectProfile(id);
    const snapshot = cache.snapshot();
    const generation = snapshot.generation;
    const base = { dataProfile: id, dataGeneration: generation };
    if (snapshot.isReady(files)) {
      update({ ...base, dataReady: true, dataError: null });
      return Promise.resolve(true);
    }
    update({ ...base, dataReady: false });
    if (pending && pendingGeneration === generation) return pending;
    pendingGeneration = generation;
    pending = snapshot.loadAll(files).then(() => {
      if (generation !== cache.generation || id !== cache.profileId) return false;
      const missing = files.filter((name) => snapshot.status(name) === 'missing' && !snapshot.isReady(name));
      const ready = snapshot.isReady(files);
      update({ ...base, dataReady: ready, dataError: missing.length ? t('模拟数据载入失败：{0}', { 0: missing.join('、') }) : null });
      return ready;
    });
    return pending;
  };
}
