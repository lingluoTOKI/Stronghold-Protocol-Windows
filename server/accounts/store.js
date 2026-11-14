// Runs inside accounts/worker.js. Never import this synchronous store into the game loop.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
export function openAccountStore(file, now = Date.now) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, subject TEXT UNIQUE NOT NULL,
      qq TEXT NOT NULL, nickname TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS links(account TEXT NOT NULL REFERENCES accounts(id), realm TEXT NOT NULL, identity TEXT NOT NULL,
      PRIMARY KEY(account,realm), UNIQUE(realm,identity));
    CREATE TABLE IF NOT EXISTS records(account TEXT NOT NULL REFERENCES accounts(id), realm TEXT NOT NULL, id TEXT NOT NULL,
      payload TEXT NOT NULL, saved INTEGER NOT NULL, PRIMARY KEY(account,realm,id));
    CREATE TABLE IF NOT EXISTS recovery(account TEXT PRIMARY KEY REFERENCES accounts(id), hash TEXT UNIQUE NOT NULL);`);
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function profile(id) {
    const row = db.prepare('SELECT id,qq,nickname FROM accounts WHERE id=?').get(id);
    if (!row) throw new Error('LOGIN_REQUIRED');
    return { ...row, qqVerified: false, linkedRealms: db.prepare('SELECT realm FROM links WHERE account=?').all(id).map(r => r.realm) };
  }
  function session(raw) {
    if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) throw new Error('LOGIN_REQUIRED');
    const row = db.prepare('SELECT account FROM sessions WHERE token=? AND expires>?').get(hash(raw), now());
    if (!row) throw new Error('LOGIN_REQUIRED');
    return row.account;
  }
  function issue(id) {
    const raw = token();
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(raw), id, now() + 30 * 86400000);
    // Bound remembered devices per account without touching other accounts.
    db.prepare('DELETE FROM sessions WHERE account=? AND token NOT IN (SELECT token FROM sessions WHERE account=? ORDER BY expires DESC LIMIT 20)').run(id,id);
    return { token: raw, profile: profile(id) };
  }
  function name(value) {
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 24 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('INVALID_NICKNAME');
    return value.trim();
  }
  return {
    close() { db.close(); },
    login({ subject, qq, nickname }) {
      if (typeof subject !== 'string' || !subject || subject.length > 256) throw new Error('INVALID_SUBJECT');
      if (!/^[1-9][0-9]{4,11}$/.test(qq)) throw new Error('INVALID_QQ');
      return tx(() => {
        let row = db.prepare('SELECT id FROM accounts WHERE subject=?').get(subject);
        if (!row) {
          row = { id: randomBytes(16).toString('hex') };
          db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(row.id, subject, qq, name(nickname), now());
        }
        // A new browser cannot silently rename an existing account or change its display QQ.
        return issue(row.id);
      });
    },
    me({ token: raw }) { return profile(session(raw)); },
    monitor({ ids }) {
      return [...new Set(ids)].slice(0,500).map(id => {
        const p = profile(id);
        const archives = db.prepare('SELECT realm,COUNT(*) AS records,MAX(saved) AS lastSync FROM records WHERE account=? GROUP BY realm').all(id);
        return { id, bound:true, nickname:p.nickname, qq:p.qq.replace(/^(\d{2}).*(\d{2})$/,'$1****$2'), qqFull:p.qq, qqVerified:false, linkedRealms:p.linkedRealms, archives };
      });
    },
    rename({ token: raw, nickname }) {
      const id = session(raw);
      db.prepare('UPDATE accounts SET nickname=? WHERE id=?').run(name(nickname), id);
      return profile(id);
    },
    logout({ token: raw }) { db.prepare('DELETE FROM sessions WHERE token=?').run(hash(String(raw))); return { ok: true }; },
    link({ token: raw, realm, identity }) {
      const id = session(raw);
      if (!/^[a-f0-9]{32}$/.test(identity)) throw new Error('INVALID_IDENTITY');
      return tx(() => {
        const own = db.prepare('SELECT identity FROM links WHERE account=? AND realm=?').get(id, realm);
        const used = db.prepare('SELECT account FROM links WHERE realm=? AND identity=?').get(realm, identity);
        if ((own && own.identity !== identity) || (used && used.account !== id)) throw new Error('LINK_CONFLICT');
        db.prepare('INSERT OR IGNORE INTO links VALUES(?,?,?)').run(id, realm, identity);
        return profile(id);
      });
    },
    relink({ token: raw, realm, identity }) {
      const id = session(raw);
      if (!/^[a-f0-9]{32}$/.test(identity)) throw new Error('INVALID_IDENTITY');
      return tx(() => {
        const used = db.prepare('SELECT account FROM links WHERE realm=? AND identity=?').get(realm, identity);
        if (used && used.account !== id) throw new Error('LINK_CONFLICT');
        const own = db.prepare('SELECT identity FROM links WHERE account=? AND realm=?').get(id, realm);
        if (own) db.prepare('UPDATE links SET identity=? WHERE account=? AND realm=?').run(identity, id, realm);
        else db.prepare('INSERT INTO links VALUES(?,?,?)').run(id, realm, identity);
        return profile(id);
      });
    },
    linked({ token: raw, realm }) { return db.prepare('SELECT identity FROM links WHERE account=? AND realm=?').get(session(raw), realm) || null; },
    upload({ token: raw, realm, records }) {
      const id = session(raw);
      if (!Array.isArray(records) || records.length > 1000) throw new Error('INVALID_RECORDS');
      const rows = records.map(r => {
        const payload = JSON.stringify(r);
        if (!r || typeof r.id !== 'string' || !r.id || r.id.length > 256 || payload.length > 100000) throw new Error('INVALID_RECORDS');
        return [r.id, payload];
      });
      return tx(() => {
        let added = 0;
        for (const [key,payload] of rows) added += Number(db.prepare('INSERT OR IGNORE INTO records VALUES(?,?,?,?,?)').run(id,realm,key,payload,now()).changes);
        const size = db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(length(payload)),0) AS bytes FROM records WHERE account=? AND realm=?').get(id,realm);
        if (size.n > 1000 || size.bytes > 2000000) throw new Error('ARCHIVE_FULL');
        return { added, total: size.n, trusted: false };
      });
    },
    records({ token: raw, realm, offset = 0 }) {
      const id = session(raw);
      const start = Math.max(0,Math.min(1000,Number(offset) || 0));
      const rows = db.prepare('SELECT payload FROM records WHERE account=? AND realm=? ORDER BY saved,id LIMIT 50 OFFSET ?').all(id,realm,start);
      return { records: rows.map(r => JSON.parse(r.payload)), next: rows.length === 50 ? start + 50 : null, trusted: false };
    },
    recovery({ token: raw }) {
      const id = session(raw), code = token();
      db.prepare('INSERT OR REPLACE INTO recovery VALUES(?,?)').run(id,hash(code));
      return { code };
    },
    recover({ code }) {
      if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) throw new Error('INVALID_RECOVERY');
      return tx(() => {
        const row = db.prepare('SELECT account FROM recovery WHERE hash=?').get(hash(code));
        if (!row) throw new Error('INVALID_RECOVERY');
        db.prepare('DELETE FROM sessions WHERE account=?').run(row.account);
        const next = token();
        db.prepare('UPDATE recovery SET hash=? WHERE account=?').run(hash(next),row.account);
        return { ...issue(row.account), recoveryCode: next };
      });
    },
  };
}
