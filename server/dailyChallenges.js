// Settlement-only daily ranking. No client-submitted results, per-tick work, match hosts or art downloads.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { challengeDay, dailyChallenges, DAILY_VERSION } from '../shared/dailyChallenges.js';

const COOKIE = 'sp_challenge_identity';
const CAP = 2000;
const RETAIN_DAYS = 8;
export async function createDailyChallengeBoard({ file, legacyFile = null, now = Date.now, log = console }) {
  let data = { version: 2, rules: DAILY_VERSION, secret: randomBytes(32).toString('hex'), days: {} };
  let healthy = true, writing = Promise.resolve();
  let cachedDay = null, cachedRows = {};
  async function load(source) {
    if ((await fs.stat(source)).size > 8 * 1024 * 1024) throw new Error('leaderboard data too large');
    const raw = await fs.readFile(source, 'utf8');
    const parsed = JSON.parse(raw);
    if (![1, 2].includes(parsed.version) || !/^[a-f0-9]{64}$/.test(parsed.secret) || !parsed.days || typeof parsed.days !== 'object' || Array.isArray(parsed.days)) throw new Error('invalid leaderboard data');
    if (parsed.version !== 2 || parsed.rules !== DAILY_VERSION) {
      // Preserve identity and the old file; easy-task scores never become ultimate/no-AI scores.
      await fs.copyFile(source, source + '.previous-rules', 1).catch(e => { if (e.code !== 'EEXIST') throw e; });
      parsed.version = 2;parsed.rules = DAILY_VERSION;parsed.days = {};
    }
    if (Object.keys(parsed.days).length > RETAIN_DAYS) throw new Error('too many retained days');
    for (const [day, divisions] of Object.entries(parsed.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !divisions || typeof divisions !== 'object' || Array.isArray(divisions)
        || Object.keys(divisions).some(key => !['solo', 'coop'].includes(key))) throw new Error('invalid daily board');
      for (const rows of Object.values(divisions)) {
        if (!rows || typeof rows !== 'object' || Array.isArray(rows) || Object.keys(rows).length > CAP) throw new Error('invalid division');
        for (const [id, row] of Object.entries(rows)) {
        if (!/^[a-f0-9]{32}$/.test(id) || typeof row?.name !== 'string' || row.name.length > 24
          || !Array.isArray(row.completed) || row.completed.length > 3 || new Set(row.completed).size !== row.completed.length
          || row.completed.some(task => !dailyChallenges([], Date.parse(day + 'T12:00:00+08:00')).challenges.some(c => c.id === task))) throw new Error('invalid score entry');
        }
      }
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
    }).catch(() => { healthy = false; log.error('[daily] persistence failed; ranking disabled, game unaffected'); });
    return writing;
  }
  if (healthy) await persist(); // Persist the signing secret before issuing identities.
  function trim() {
    const oldest = challengeDay(now() - (RETAIN_DAYS - 1) * 86400000);
    for (const day of Object.keys(data.days)) if (day < oldest) delete data.days[day];
  }
  function snapshot(id, division = 'solo') {
    const day = challengeDay(now());
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
    return { ok: healthy, day, division, challenges: dailyChallenges([], now()).challenges,
      rows: ranked.slice(0, 100).map(publicRow), total: ranked.length, self: own ? publicRow(own) : null };
  }
  return {
    ensureCookie,
    bindRequest,
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
      const body = JSON.stringify(snapshot(id, division));
      res.statusCode = healthy ? 200 : 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Length', Buffer.byteLength(body));
      res.end(req.method === 'HEAD' ? undefined : body);
    },
    record(room, result, registry, proof) {
      if (!healthy || result?.difficulty !== 'ABYSS' || room.test === true || result?.test === true || (room.content && room.content.vanilla !== true) || !Array.isArray(result?.players)) return;
      if (!proof || proof.usedAI !== false || proof.difficulty !== 'ABYSS' || proof.bossHp !== 1 || !Array.isArray(proof.participants)) return;
      const { participants, mode: division } = proof;
      const ids = new Set(participants.map(p => p.playerId));
      if (participants.some(p => p.isBot !== false) || ids.size !== participants.length
        || (division === 'solo' ? participants.length !== 1 : division !== 'coop' || participants.length < 2 || participants.length > 6)
        || result.players.length !== participants.length || result.players.some(p => !ids.has(p?.playerId) || p.isBot)) return;
      trim();
      const day = challengeDay(now());
      let changed = false;
      for (const player of result.players) {
        if (!player?.playerId || player.isBot || player.left) continue;
        const seat = room.seatOf(player.playerId);
        const session = registry.byPlayerId.get(player.playerId);
        const id = session && identities.get(session);
        if (!id || !seat || seat.isBot || seat.left) continue;
        const record = { ...result, end: 'settled', t: now(), selfId: player.playerId, content: null };
        const done = dailyChallenges([record], record.t).challenges.filter(c => c.done).map(c => c.id);
        if (!done.length) continue;
        const dayBoards = data.days[day] || (data.days[day] = {});
        const board = dayBoards[division] || (dayBoards[division] = {});
        if (!board[id] && Object.keys(board).length >= CAP) continue;
        const previous = board[id]?.completed || [];
        const completed = [...new Set([...previous, ...done])];
        if (completed.length === previous.length) continue;
        board[id] = { name: String(session.name || player.name || '').slice(0, 24), completed };
        changed = true;
      }
      if (changed) { cachedRows[division] = null; void persist(); }
    },
    flush: () => writing,
    snapshot: (division = 'solo') => snapshot(null, division),
  };
}
