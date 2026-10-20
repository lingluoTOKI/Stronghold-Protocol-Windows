// Settlement-only daily ranking. No client-submitted results, per-tick work, match hosts or art downloads.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { challengeDay, dailyChallenges, DAILY_VERSION, ROTATING_CHALLENGES, challengePreview } from '../shared/dailyChallenges.js';
import { ACHIEVEMENTS, earnedAchievements, updateCollectionAwards } from '../shared/achievements.js';

const COOKIE = 'sp_challenge_identity';
const CAP = 2000;
const RETAIN_DAYS = 8;
export async function createDailyChallengeBoard({ file, legacyFile = null, now = Date.now, log = console }) {
  let data = { version: 2, rules: DAILY_VERSION, secret: randomBytes(32).toString('hex'), days: {}, achievements: {}, rotationStart: challengeDay(now() + 86400000) };
  let healthy = true, writing = Promise.resolve();
  let cachedDay = null, cachedRows = {};
  async function load(source) {
    if ((await fs.stat(source)).size > 16 * 1024 * 1024) throw new Error('leaderboard data too large');
    const raw = await fs.readFile(source, 'utf8');
    const parsed = JSON.parse(raw);
    if (![1, 2].includes(parsed.version) || !/^[a-f0-9]{64}$/.test(parsed.secret) || !parsed.days || typeof parsed.days !== 'object' || Array.isArray(parsed.days)) throw new Error('invalid leaderboard data');
    if (parsed.version === 2 && ![3, DAILY_VERSION].includes(parsed.rules)) throw new Error('unsupported rules version; preserve data');
    if (parsed.version !== 2 || ![3, DAILY_VERSION].includes(parsed.rules)) {
      // Preserve identity and the old file; easy-task scores never become ultimate/no-AI scores.
      await fs.copyFile(source, source + '.previous-rules', 1).catch(e => { if (e.code !== 'EEXIST') throw e; });
      parsed.version = 2;parsed.rules = DAILY_VERSION;parsed.days = {};
    }
    if (parsed.rules === 3) await fs.copyFile(source, source + '.pre-rotation', 1).catch(e => { if (e.code !== 'EEXIST') throw e; });
    if (!parsed.rotationStart) parsed.rotationStart = challengeDay(now() + 86400000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.rotationStart)) throw new Error('invalid rotation start');
    parsed.rules = DAILY_VERSION;
    if (Object.keys(parsed.days).length > RETAIN_DAYS) throw new Error('too many retained days');
    for (const [day, divisions] of Object.entries(parsed.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !divisions || typeof divisions !== 'object' || Array.isArray(divisions)
        || Object.keys(divisions).some(key => !['solo', 'coop'].includes(key))) throw new Error('invalid daily board');
      for (const rows of Object.values(divisions)) {
        if (!rows || typeof rows !== 'object' || Array.isArray(rows) || Object.keys(rows).length > CAP) throw new Error('invalid division');
        for (const [id, row] of Object.entries(rows)) {
        if (!/^[a-f0-9]{32}$/.test(id) || typeof row?.name !== 'string' || row.name.length > 24
          || !Array.isArray(row.completed) || row.completed.length > 3 || new Set(row.completed).size !== row.completed.length
          || row.completed.some(task => !ROTATING_CHALLENGES.some(c => c.id === task))) throw new Error('invalid score entry');
        }
      }
    }
    if (!Object.hasOwn(parsed, 'achievements')) parsed.achievements = {};
    if (!parsed.achievements || typeof parsed.achievements !== 'object' || Array.isArray(parsed.achievements) || Object.keys(parsed.achievements).length > 10000) throw new Error('invalid permanent collection');
    for (const [id, divisions] of Object.entries(parsed.achievements)) {
      if (!/^[a-f0-9]{32}$/.test(id) || !divisions || typeof divisions !== 'object' || Array.isArray(divisions)) throw new Error('invalid collector');
      for (const [division, state] of Object.entries(divisions)) {
        if (!['solo', 'coop'].includes(division) || !state || typeof state !== 'object' || Array.isArray(state)
          || !Array.isArray(state.recent) || state.recent.length > 32 || state.recent.some(k => !/^[a-f0-9]{32}$/.test(k))) throw new Error('invalid collection division');
        for (const field of ['progress', 'unlocked']) {
          if (!state[field] || typeof state[field] !== 'object' || Array.isArray(state[field])) throw new Error('invalid collection state');
          for (const [key, value] of Object.entries(state[field])) {
            const def = ACHIEVEMENTS.find(a => a.id === key);
            if (!def || !Number.isSafeInteger(value) || value <= 0
              || (field === 'progress' ? value > def.target : state.progress[key] !== def.target)) throw new Error('invalid achievement value');
          }
        }
      }
    }
    // Backfill only a provable lower bound: overlapping old counters cannot be summed.
    for (const divisions of Object.values(parsed.achievements)) for (const state of Object.values(divisions)) {
      if (!state.daily) state.daily = {};
      if (!state.legacyDaily) state.legacyDaily = {};
      if (typeof state.legacyDaily !== 'object' || Array.isArray(state.legacyDaily) || Object.entries(state.legacyDaily).some(([k,v]) => k !== 'collection' || !/^\d{4}-\d{2}-\d{2}$/.test(v))) throw new Error('invalid legacy medal');
      if (typeof state.daily !== 'object' || Array.isArray(state.daily)) throw new Error('invalid daily collection');
      for (const [key, at] of Object.entries(state.daily)) if (!ROTATING_CHALLENGES.some(c => c.id === key) || !Number.isSafeInteger(at) || at <= 0) throw new Error('invalid daily collection');
      const lower = Math.max(0, ...Object.entries(state.progress).filter(([id]) => !['all-core', 'all-covenants'].includes(id)).map(([, n]) => n));
      for (const id of ['clear-ten', 'clear-thirty']) {
        const target = ACHIEVEMENTS.find(a => a.id === id).target;
        state.progress[id] = Math.max(state.progress[id] || 0, Math.min(lower, target));
        if (!state.progress[id]) delete state.progress[id];
        if (state.progress[id] === target && !state.unlocked[id]) state.unlocked[id] = now();
      }
      updateCollectionAwards(state, now());
    }
    for (const [day, divisions] of Object.entries(parsed.days)) for (const [division, rows] of Object.entries(divisions)) for (const [id, row] of Object.entries(rows)) {
      const own = parsed.achievements[id] ||= {};
      const state = own[division] ||= { progress: {}, unlocked: {}, recent: [], daily: {} };
      for (const task of row.completed) state.daily[task] ||= Date.parse(day + 'T12:00:00+08:00');
      state.legacyDaily ||= {};
      if (day < parsed.rotationStart && ['victory','perfect','core'].every(k => row.completed.includes(k))) state.legacyDaily.collection ||= day;
    }
    return parsed;
  }
  try { data = await load(file); }
  catch (primaryError) {
    try {
      data = await load(file + '.backup');
      log.info?.('[daily] recovered score store from backup');
    } catch (backupError) {
      if (primaryError.code === 'ENOENT' && backupError.code === 'ENOENT') {
        if (legacyFile) {
          try { data = await load(legacyFile); }
          catch (e) { if (e.code !== 'ENOENT') { healthy = false;log.error('[daily] unreadable legacy store'); } }
        }
      } else { healthy = false;log.error('[daily] no readable store or backup; ranking disabled, game unaffected'); }
    }
  }
  const identities = new WeakMap();
  const signature = id => createHmac('sha256', data.secret).update(id).digest('hex');
  function recoveryIdentity(raw) {
    if (typeof raw !== 'string' || !/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(raw)) return null;
    const [id, sig] = raw.split('.');
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(signature(id), 'hex')) ? id : null;
  }
  function cookieIdentity(req) {
    const raw = String(req.headers?.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    return recoveryIdentity(raw);
  }
  function setCookie(res, id) {
    res.setHeader('Set-Cookie', `${COOKIE}=${id}.${signature(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  }
  function ensureCookie(req, res) {
    let id = cookieIdentity(req);
    if (!id && healthy) { id = randomBytes(16).toString('hex');setCookie(res, id); }
    return id;
  }
  function bindRequest(session, req) {
    const id = cookieIdentity(req);
    if (id && session && !identities.has(session)) identities.set(session, id);
  }
  function sessionOf(req, registry) {
    const bearer = /^Bearer ([a-f0-9]{32})$/i.exec(String(req.headers.authorization || ''));
    return bearer ? registry.byToken(bearer[1]) : null;
  }
  function persist() {
    const snapshot = JSON.stringify(data);
    writing = writing.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const out = await fs.open(file + '.tmp', 'w', 0o600);
      try { await out.writeFile(snapshot);await out.sync(); } finally { await out.close(); }
      await fs.rename(file + '.tmp', file);
      await fs.copyFile(file, file + '.backup.tmp');
      await fs.rename(file + '.backup.tmp', file + '.backup');
      const archive = path.join(path.dirname(file), 'challenge-backups');
      await fs.mkdir(archive, { recursive: true });
      const archiveName = `daily-${challengeDay(now())}.json`;
      await fs.copyFile(file, path.join(archive, archiveName), 1).catch(e => { if (e.code !== 'EEXIST') throw e; });
      const old = (await fs.readdir(archive)).filter(n => /^daily-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().slice(0, -7);
      for (const name of old) await fs.unlink(path.join(archive, name));
    }).catch(() => { healthy = false; log.error('[daily] persistence failed; ranking disabled, game unaffected'); });
    return writing;
  }
  if (healthy) await persist(); // Persist the signing secret before issuing identities.
  function trim() {
    const oldest = challengeDay(now() - (RETAIN_DAYS - 1) * 86400000);
    for (const day of Object.keys(data.days)) if (day < oldest) delete data.days[day];
  }
  function snapshot(id, division = 'solo', includeRows = true) {
    const day = challengeDay(now());
    if (!includeRows) {
      const own = data.days[day]?.[division]?.[id];
      return { ok: healthy, day, division, rotationStart: data.rotationStart, challenges: dailyChallenges([], now(), data.rotationStart).challenges,
        rows: [], self: own ? { ...own, points: own.completed.length, mine: true } : null };
    }
    if (cachedDay !== day) { cachedRows = {};cachedDay = day; }
    if (!cachedRows[division]) {
      const rows = Object.entries(data.days[day]?.[division] || {}).map(([key, value]) => ({ key, ...value, points: value.completed.length }));
      rows.sort((a, b) => b.points - a.points || a.key.localeCompare(b.key));
      let rank = 0, previous = -1;
      cachedRows[division] = rows.map((r, i) => {
        if (r.points !== previous) rank = i + 1;
        previous = r.points;
        return { key: r.key, rank, name: r.name, points: r.points, completed: r.completed };
      });
    }
    const publicRow = ({ key, ...r }) => ({ ...r, mine: key === id });
    const ranked = cachedRows[division];
    const own = ranked.find(r => r.key === id);
    return { ok: healthy, day, division, challenges: dailyChallenges([], now(), data.rotationStart).challenges, rotationStart: data.rotationStart,
      rows: includeRows ? ranked.slice(0, 100).map(publicRow) : [], total: ranked.length, self: own ? publicRow(own) : null };
  }
  return {
    // Trusted server-only recovery adapter; never accepted as a client result or identity claim.
    recoveryIdentity: session => identities.get(session) || null,
    restoreRecoveryIdentity(session, id) { if (typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)) identities.set(session, id); },
    ensureCookie,
    bindRequest,
    collection(req, res, registry) {
      const id = ensureCookie(req, res), session = sessionOf(req, registry);
      if (session?.connected && id && !identities.has(session)) identities.set(session, id);
      const own = data.achievements[id] || {};
      const body = JSON.stringify({ ok: healthy, achievements: ACHIEVEMENTS, unlocked: { solo: own.solo?.unlocked || {}, coop: own.coop?.unlocked || {} },
        legacyDaily: { solo: own.solo?.legacyDaily || {}, coop: own.coop?.legacyDaily || {} },
        daily: { solo: own.solo?.daily || {}, coop: own.coop?.daily || {} }, dailyDefinitions: ROTATING_CHALLENGES.map(({ pass, ...c }) => c),
        progress: { solo: own.solo?.progress || {}, coop: own.coop?.progress || {} } });
      res.statusCode = healthy ? 200 : 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Length', Buffer.byteLength(body));res.end(req.method === 'HEAD' ? undefined : body);
    },
    async identity(req, res, registry) {
      const reply = (status, value) => {
        const body = JSON.stringify(value);res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Content-Length', Buffer.byteLength(body));res.end(body);
      };
      if (!healthy) { reply(503, { ok: false });return; }
      if (req.method === 'GET') {
        const id = cookieIdentity(req);
        reply(id ? 200 : 403, id ? { ok: true, recoveryCode: `${id}.${signature(id)}` } : { ok: false });return;
      }
      if (req.method !== 'POST') { reply(405, { ok: false });return; }
      const origin = req.headers.origin;
      if (origin && (() => { try { return new URL(origin).host !== req.headers.host; } catch { return true; } })()) { reply(403, { ok: false });return; }
      const length = Number(req.headers['content-length']);
      if (!Number.isInteger(length) || length <= 0 || length > 512 || !String(req.headers['content-type']).startsWith('application/json')) { reply(400, { ok: false });return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 512) { reply(413, { ok: false });return; } }
      let id;
      try { id = recoveryIdentity(JSON.parse(body).recoveryCode); } catch { /* invalid recovery file */ }
      if (!id) { reply(400, { ok: false });return; }
      setCookie(res, id);
      const session = sessionOf(req, registry);
      if (session?.connected) identities.set(session, id);
      reply(200, { ok: true });
    },
    // Binding requires the existing live session bearer token. The signed HttpOnly cookie survives a restart;
    // same browser shares one ranking identity, while its multiple game sessions cannot accumulate >3/day.
    async handle(req, res, registry) {
      const division = new URL(req.url || '/', 'http://localhost').searchParams.get('division') || 'solo';
      if (!['solo', 'coop'].includes(division)) {
        res.statusCode = 400;res.setHeader('Content-Type', 'application/json');res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ ok: false, error: 'invalid division' }));return;
      }
      const id = ensureCookie(req, res);
      const session = sessionOf(req, registry);
      if (session?.connected && !identities.has(session)) identities.set(session, id);
      const includeRows = new URL(req.url || '/', 'http://localhost').searchParams.get('ranking') !== '0';
      const view = snapshot(id, division, includeRows);
      if (!includeRows) view.preview = challengePreview(now(), data.rotationStart);
      const body = JSON.stringify(view);
      res.statusCode = healthy ? 200 : 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Length', Buffer.byteLength(body));
      res.end(req.method === 'HEAD' ? undefined : body);
    },
    record(room, result, registry, proof) {
      if (!healthy || result?.difficulty !== 'ABYSS' || room.test === true || result?.test === true || (room.content && room.content.vanilla !== true) || !Array.isArray(result?.players)) return;
      if (!proof || !/^[a-f0-9]{32}$/.test(proof.runId) || proof.usedAI !== false || proof.difficulty !== 'ABYSS' || proof.bossHp !== 1 || !Array.isArray(proof.participants)) return;
      const { participants, mode: division } = proof;
      const ids = new Set(participants.map(p => p.playerId));
      if (participants.some(p => p.isBot !== false) || ids.size !== participants.length
        || (division === 'solo' ? participants.length !== 1 : division !== 'coop' || participants.length < 2 || participants.length > 6)
        || result.players.length !== participants.length || result.players.some(p => !ids.has(p?.playerId) || p.isBot)) return;
      if (proof.durableRecovery && data.recoveryReceipts?.[proof.runId]) return {};
      trim();
      const startedAt = Number.isFinite(proof.startedAt) && proof.startedAt > 0 && proof.startedAt <= now() ? proof.startedAt : now();
      const day = challengeDay(startedAt);
      const dailyEligible = day >= challengeDay(now() - (RETAIN_DAYS - 1) * 86400000);
      let changed = false;
      const newlyUnlocked = {};
      Object.defineProperty(newlyUnlocked, 'feedback', { value: {} });
      for (const player of result.players) {
        if (!player?.playerId || player.isBot || player.left) continue;
        const seat = room.seatOf(player.playerId);
        const session = registry.byPlayerId.get(player.playerId);
        const id = session && identities.get(session);
        if (!id || !seat || seat.isBot || seat.left) continue;
        const earned = earnedAchievements(result, player.playerId);
        if (!earned.length) continue;
        if (data.achievements[id]?.[division]?.recent.includes(proof.runId)) continue;
        if (data.achievements[id] || Object.keys(data.achievements).length < 10000) {
          const collection = data.achievements[id] || (data.achievements[id] = {});
          const state = collection[division] || (collection[division] = { progress: {}, unlocked: {}, recent: [], daily: {} });
          state.recent = [...state.recent, proof.runId].slice(-32);
          const added = [], at = now();
          const changes = [];
          newlyUnlocked.feedback[player.playerId] = { day, changes, completed: [], tasks: dailyChallenges([], startedAt, data.rotationStart).challenges };
          for (const key of earned) {
            const target = ACHIEVEMENTS.find(a => a.id === key).target;
            if ((state.progress[key] || 0) >= target) continue;
            const before = state.progress[key] || 0;
            state.progress[key] = before + 1;changed = true;
            changes.push({ id: key, before, after: state.progress[key], target });
            if (state.progress[key] === target) { state.unlocked[key] = at;added.push({ id: key, division, at }); }
          }
          for (const key of updateCollectionAwards(state, at)) { added.push({ id: key, division, at });changed = true; }
          if (added.length) newlyUnlocked[player.playerId] = added;
        }
        const record = { ...result, end: 'settled', t: startedAt, selfId: player.playerId, content: null };
        const done = dailyChallenges([record], record.t, data.rotationStart).challenges.filter(c => c.done).map(c => c.id);
        if (newlyUnlocked.feedback[player.playerId]) newlyUnlocked.feedback[player.playerId].completed = done;
        const state = data.achievements[id]?.[division];
        if (state) for (const key of done) if (!state.daily[key]) { state.daily[key] = now();changed = true; }
        if (!done.length || !dailyEligible) continue;
        const dayBoards = data.days[day] || (data.days[day] = {});
        const board = dayBoards[division] || (dayBoards[division] = {});
        if (!board[id] && Object.keys(board).length >= CAP) continue;
        const previous = board[id]?.completed || [];
        if (newlyUnlocked.feedback[player.playerId]) newlyUnlocked.feedback[player.playerId].pointsAdded = done.filter(key => !previous.includes(key)).length;
        const completed = [...new Set([...previous, ...done])].slice(0, 3);
        if (state && day < data.rotationStart && completed.length === 3) {
          state.legacyDaily ||= {};
          if (!state.legacyDaily.collection) { state.legacyDaily.collection = day;changed = true; }
        }
        if (completed.length === previous.length) continue;
        board[id] = { name: String(session.name || player.name || '').slice(0, 24), completed };
        changed = true;
      }
      if (proof.durableRecovery) {
        data.recoveryReceipts ||= {};
        for (const [id, at] of Object.entries(data.recoveryReceipts)) if (at < now() - 8 * 86400000) delete data.recoveryReceipts[id];
        data.recoveryReceipts[proof.runId] = now();
        changed = true;
      }
      if (changed) { cachedRows[division] = null; void persist(); }
      return newlyUnlocked;
    },
    flush: () => writing,
    snapshot: (division = 'solo') => snapshot(null, division),
  };
}
