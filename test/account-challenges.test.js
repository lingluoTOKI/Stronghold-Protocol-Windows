import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountChallenges } from '../server/accounts/challenges.js';

test('public code alone cannot consume login; successful consumption is one-time', () => {
  const api = createAccountChallenges();
  const c = api.create({ purpose: 'login' });
  assert.throws(() => api.consume(c.code, c.secret), /NOT_VERIFIED/);
  api.verify(c.code, 'official-bot:sender');
  assert.throws(() => api.consume(c.code, '0'.repeat(64)), /WRONG_BROWSER/);
  assert.equal(api.consume(c.code, c.secret).subject, 'official-bot:sender');
  assert.throws(() => api.consume(c.code, c.secret), /EXPIRED/);
});
test('expiry and bounded pending requests', () => {
  let clock = 0;
  const api = createAccountChallenges({ now: () => clock, ttl: 10, capacity: 1 });
  const c = api.create({ purpose: 'login' });
  assert.throws(() => api.create({ purpose: 'login' }), /BUSY/);
  clock = 10;
  assert.throws(() => api.verify(c.code, 'qq'), /EXPIRED/);
  assert.ok(api.create({ purpose: 'login' }));
});
test('competing identities invalidate a binding; expected identity cannot be replaced', () => {
  const api = createAccountChallenges();
  const c = api.create({ purpose: 'bind', accountId: 'account' });
  api.verify(c.code, 'first');
  assert.throws(() => api.verify(c.code, 'second'), /CONFLICT/);
  assert.throws(() => api.consume(c.code, c.secret), /CONFLICT/);
  const d = api.create({ purpose: 'login', expectedSubject: 'first' });
  assert.throws(() => api.verify(d.code, 'second'), /WRONG_QQ/);
  api.verify(d.code, 'first');
  assert.equal(api.consume(d.code, d.secret).subject, 'first');
});
