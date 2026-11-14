// Short-lived public codes are NOT login credentials. Only the initiating
// browser's secret can consume a verified challenge. No game state is touched.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const digest = value => createHash('sha256').update(String(value)).digest();
export function createAccountChallenges({ now = Date.now, ttl = 300000, capacity = 500 } = {}) {
  const pending = new Map();
  const sweep = () => { for (const [code, item] of pending) if (item.expires <= now()) pending.delete(code); };
  function get(code) {
    sweep();
    const item = pending.get(String(code).toUpperCase());
    if (!item) throw new Error('CHALLENGE_EXPIRED');
    return item;
  }
  function owner(item, secret) {
    if (typeof secret !== 'string' || secret.length !== 64 || !timingSafeEqual(item.owner, digest(secret))) throw new Error('WRONG_BROWSER');
  }
  return {
    create({ purpose, accountId = null, expectedSubject = null }) {
      sweep();
      if (!['bind', 'login'].includes(purpose)) throw new Error('INVALID_PURPOSE');
      if (purpose === 'bind' && !accountId) throw new Error('LOGIN_REQUIRED');
      if (pending.size >= capacity) throw new Error('BUSY');
      const code = randomBytes(8).toString('hex').toUpperCase();
      const secret = randomBytes(32).toString('hex');
      const expires = now() + ttl;
      pending.set(code, { purpose, accountId, expectedSubject, owner: digest(secret), expires, subject: null, conflicted: false });
      return { code, secret, expires };
    },
    // Call only from the authenticated bot bridge with the event's sender ID,
    // never with a QQ number supplied in a browser or in message text.
    verify(code, subject) {
      const item = get(code);
      if (typeof subject !== 'string' || !subject || subject.length > 256) throw new Error('INVALID_SUBJECT');
      if (item.expectedSubject && item.expectedSubject !== subject) throw new Error('WRONG_QQ');
      if (item.subject && item.subject !== subject) item.conflicted = true;
      if (item.conflicted) throw new Error('CHALLENGE_CONFLICT');
      item.subject = subject;
      return { verified: true };
    },
    status(code, secret) {
      const item = get(code);owner(item, secret);
      return { verified: Boolean(item.subject), conflicted: item.conflicted, expires: item.expires };
    },
    consume(code, secret) {
      const item = get(code);owner(item, secret);
      if (item.conflicted) throw new Error('CHALLENGE_CONFLICT');
      if (!item.subject) throw new Error('NOT_VERIFIED');
      pending.delete(String(code).toUpperCase());
      return { purpose: item.purpose, accountId: item.accountId, subject: item.subject };
    },
  };
}
