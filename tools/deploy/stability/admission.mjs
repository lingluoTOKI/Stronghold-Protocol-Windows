import fs from 'node:fs';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const MB = 1024 * 1024;
export function resources() {
  let availableMB = os.freemem() / MB;
  try {
    const match = /^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    if (match) availableMB = Number(match[1]) / 1024;
  } catch { /* Portable fallback for local verification. */ }
  return { availableMB, rssMB: process.memoryUsage().rss / MB };
}

// Admission only: never disconnect, dispose, restart, or alter an existing match.
export function installAdmission(lobby, {
  maxMatches = 24, maxRooms = 64, minAvailableMB = 128, resumeAvailableMB = 224,
  maxRssMB = 700, maxLagMs = 250, sample = resources, now = Date.now,
  intervalMs = 5000, statusFile = null, policyFile = null,
} = {}) {
  const original = new Map();
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  let blockedUntil = 0;
  let pressure = false;
  let stopped = false;
  let last = {};
  const sampleState = () => {
    const r = sample();
    const lagMs = Number.isFinite(lag.mean) ? lag.mean / 1e6 : 0;
    lag.reset();
    if (r.availableMB < minAvailableMB || r.rssMB > maxRssMB || lagMs > maxLagMs) {
      pressure = true;
      blockedUntil = now() + 15000;
    } else if (now() >= blockedUntil && r.availableMB >= resumeAvailableMB && r.rssMB <= maxRssMB * 0.9) {
      pressure = false;
    }
    last = { ...r, lagMs, pressure, sampledAt: now() };
    return last;
  };
  sampleState();
  const manualPaused = () => {
    if (!policyFile) return false;
    try { return JSON.parse(fs.readFileSync(policyFile, 'utf8')).paused === true; }
    catch (e) { return e.code === 'ENOENT' ? false : true; }
  };
  const reason = (starting = false) => {
    // Sample on admission as well: memory can change between timer ticks.
    sampleState();
    if (manualPaused()) return 'new games temporarily paused by administrator';
    if (pressure) return 'server temporarily busy; existing games and reconnects remain available';
    if (maxRooms > 0 && lobby.rooms.size >= maxRooms && !starting) return 'server room capacity reached';
    if (starting && maxMatches > 0 && [...lobby.rooms.values()].filter(r => !!r.match).length >= maxMatches) return 'server match capacity reached';
    return null;
  };
  const failure = detail => ({ error: 'RATE', detail });
  const wrap = (name, replacement) => {
    if (typeof lobby[name] !== 'function') return;
    const fn = lobby[name];
    original.set(name, fn);
    lobby[name] = function (...args) { return replacement.call(this, fn, args); };
  };
  wrap('create', function (fn, args) { const why = reason(); return why ? failure(why) : fn.apply(this, args); });
  wrap('startMatch', function (fn, args) { const why = reason(true); return why ? failure(why) : fn.apply(this, args); });
  // Check before queue removal: do not form rooms then discover the admission cap.
  wrap('tryMatch', function (fn, args) {
    if (!reason(true) && !reason()) return fn.apply(this, args);
  });
  wrap('resolveMatch', function (fn, args) {
    const why = reason(true) || reason(); return why ? failure(why) : fn.apply(this, args);
  });
  const snapshot = () => ({ ...last, pid: process.pid, manualPaused: manualPaused(), rooms: lobby.rooms.size,
    matches: [...lobby.rooms.values()].filter(r => !!r.match).length,
    limits: { maxMatches, maxRooms, minAvailableMB, resumeAvailableMB, maxRssMB, maxLagMs } });
  const timer = intervalMs > 0 ? setInterval(() => {
    sampleState();
    if (statusFile) {
      try { fs.writeFileSync(statusFile + '.tmp', JSON.stringify(snapshot())); fs.renameSync(statusFile + '.tmp', statusFile); }
      catch (e) { console.warn('[stability] status write failed:', e.message); }
    }
    // A full queue retained during pressure is retried once capacity recovers.
    if (lobby.matchPool && typeof lobby.tryMatch === 'function') {
      for (const difficulty of [...lobby.matchPool.keys()]) {
        if (reason(true) || reason()) break;
        lobby.tryMatch(difficulty);
      }
    }
  }, intervalMs) : null;
  timer?.unref();
  return { snapshot, refresh: sampleState, stop() {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    lag.disable();
    for (const [name, fn] of original) lobby[name] = fn;
  } };
}
