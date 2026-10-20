// UI-only hints. Never authoritatively grants medals or changes collection data.
const KEY = 'sp.achievement-notices.v1';
const listeners = new Set();
let memory;
const delivered = new Set();
function state() {
  if (memory) return memory;
  try { const v = JSON.parse(globalThis.localStorage?.getItem(KEY) || 'null');if (v && Array.isArray(v.known) && Array.isArray(v.unread)) memory = v; } catch { /* storage is optional */ }
  return memory ||= { known: [], unread: [] };
}
function save() { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(state())); } catch { /* keep hints in memory */ } }
export function resetAchievementNotices() { memory = { known: [], unread: [] };delivered.clear();save();for (const fn of listeners) fn('identity'); }
export function unreadAchievements() { return [...state().unread]; }
export function subscribeAchievements(fn) { listeners.add(fn);return () => listeners.delete(fn); }
export function recordAchievementNotice(result) {
  const fingerprint = JSON.stringify([result?.seed, result?.duration, result?.newAchievements, result?.challengeFeedback]);
  if (delivered.has(fingerprint)) return;
  delivered.add(fingerprint);if (delivered.size > 64) delivered.delete(delivered.values().next().value);
  const s = state();
  for (const a of Array.isArray(result?.newAchievements) ? result.newAchievements : []) {
    if (!a || !/^[a-z0-9-]+$/i.test(a.id || '') || !['solo','coop'].includes(a.division) || !Number.isFinite(a.at)) continue;
    const key = `${a.division}:${a.id}:${a.at}`;
    if (s.known.includes(key)) continue;
    s.known.push(key);s.unread.push({ id: a.id, division: a.division, at: a.at });
  }
  s.known = s.known.slice(-256);s.unread = s.unread.slice(-128);save();
  // A replay may invalidate the collection too, but never creates another unread medal.
  for (const fn of listeners) fn('settlement');
}
export function markAchievementsSeen(division, ids) {
  const s = state(), wanted = new Set(ids);
  const next = s.unread.filter(a => a.division !== division || !wanted.has(a.id));
  if (next.length === s.unread.length) return;
  s.unread = next;save();for (const fn of listeners) fn('seen');
}
const celebrated = new Set();
export function claimAchievementCelebration(awards) {
  if (!awards?.length) return false;
  const key = awards.map(a => `${a.division}:${a.id}:${a.at}`).sort().join('|');
  if (celebrated.has(key)) return false;
  celebrated.add(key);
  try { const old = JSON.parse(globalThis.sessionStorage?.getItem(KEY + '.shown') || '[]');if (old.includes(key)) return false;globalThis.sessionStorage?.setItem(KEY + '.shown', JSON.stringify([...old,key].slice(-64))); } catch { /* once per loaded page */ }
  return true;
}
