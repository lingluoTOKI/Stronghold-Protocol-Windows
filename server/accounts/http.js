import { createHash, timingSafeEqual } from 'node:crypto';
import { createAccountStore } from './client.js';
import { createAccountChallenges } from './challenges.js';

const digest = v => createHash('sha256').update(String(v || '')).digest();
const equal = (a,b) => timingSafeEqual(digest(a),digest(b));
export function createAccounts({ file, realm, origin, bridgeKey, namespace, board = null, registry, address = req => req.socket.remoteAddress }) {
  if (!['3000','3001'].includes(realm) || !file || !namespace || !bridgeKey || bridgeKey.length < 32) throw new Error('Invalid account configuration');
  const origins = String(origin).split(",").map(s => s.trim());
  for (const value of origins) { const u = new URL(value); if (u.origin !== value || (u.protocol !== "https:" && !["localhost","127.0.0.1"].includes(u.hostname))) throw new Error("Invalid account origin"); }
  origin = origins[0];
  const base = new URL(origin);
  if (base.origin !== origin || (base.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(base.hostname))) throw new Error('Accounts require HTTPS (except loopback)');
  const store = createAccountStore(file), challenges = createAccountChallenges();
  const cookie = `sp_account_${realm}`, pendingCookie = `sp_account_pending_${realm}`;
  const limits = new Map();
  const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(s => s.trim().split('=')));
  function setCookie(res, key, value, age) {
    const old = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...(Array.isArray(old) ? old : [old]), `${key}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${base.protocol === 'https:' ? '; Secure' : ''}`]);
  }
  function limited(req) {
    const now = Date.now(), key = address(req);
    for (const [k,v] of limits) if (v.until <= now) limits.delete(k);
    const item = limits.get(key) || { n: 0, until: now + 60000 };
    if (limits.size >= 2000 && !limits.has(key)) throw new Error('RATE_LIMITED');
    limits.set(key,item);
    if (++item.n > 200) throw new Error('RATE_LIMITED');
  }
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 2200000) throw new Error('BODY_TOO_LARGE'); chunks.push(chunk); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_BODY');
    return value;
  }
  function idle(req) {
    const bearer = /^Bearer ([a-f0-9]{32})$/i.exec(req.headers.authorization || '');
    const session = bearer && registry?.byToken(bearer[1]);
    if (!session) throw new Error('GAME_SESSION_REQUIRED');
    if (session.roomCode) throw new Error('LEAVE_ROOM_FIRST');
    return session;
  }
  // 绑定/确认允许在登录页发起（此时还没有 hello 会话），只拦「已经在房间里」的请求。
  function noRoom(req) {
    const bearer = /^Bearer ([a-f0-9]{32})$/i.exec(req.headers.authorization || '');
    const session = bearer && registry?.byToken(bearer[1]);
    if (session && session.roomCode) throw new Error('LEAVE_ROOM_FIRST');
    return session || null;
  }
  // 登录后自动同步「本服成就身份」：没有关联就把这台设备的身份关联上；已关联但本机为空就自动恢复；
  // 旧关联指向空身份、而本机有数据时改绑本机，避免「新设备先点关联」把真正的旧身份锁死。
  async function autoSync(req, res, args, session) {
    if (!board) return { sync: 'unsupported' };
    const local = board.identityOf(req);
    let linked = null;
    try { linked = await store.call('linked', args); } catch { linked = null; }
    const localHas = Boolean(local && board.identityHasData(local));
    if (linked) {
      const linkedHas = board.identityHasData(linked.identity);
      if (!local || local === linked.identity) return { sync: linkedHas ? 'ready' : 'empty' };
      if (!localHas && linkedHas) { board.restoreAccountIdentity(res, session, linked.identity); return { sync: 'restored' }; }
      if (localHas && !linkedHas) { await store.call('relink', { ...args, identity: local }); return { sync: 'relinked' }; }
      if (localHas && linkedHas) {
        await board.mergeIdentities(local, linked.identity);
        board.restoreAccountIdentity(res, session, linked.identity);
        return { sync: 'merged' };
      }
      return { sync: 'empty' };
    }
    if (localHas) { await store.call('link', { ...args, identity: local }); return { sync: 'linked' }; }
    return { sync: 'none' };
  }
  return {
    close: () => store.close(),
    async bindSession(session,req) {
      try { session.gameAccountId = (await store.call('me',{token:cookies(req)[cookie]})).id; }
      catch { session.gameAccountId = null; }
    },
    async monitor(sessions) {
      const ids = sessions.map(s => s.gameAccountId).filter(Boolean);
      return new Map((await store.call('monitor',{ids})).map(p => [p.id,p]));
    },
    async handle(req,res,path) {
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Type','application/json; charset=utf-8');
      const send = (value,status = 200) => { res.statusCode = status; res.end(JSON.stringify(value)); };
      try {
        limited(req);
        const key = path.slice('/api/account/'.length);
        if (key === 'bridge') {
          if (req.method !== 'POST' || !equal(req.headers['x-account-bridge'],bridgeKey)) return send({error:'FORBIDDEN'},403);
          const data = await body(req);
          if (typeof data.sender !== 'string' || !data.sender || data.sender.length > 160) throw new Error('INVALID_SUBJECT');
          return send(challenges.verify(data.code,`${namespace}:${data.sender}`));
        }
        if (req.method !== 'GET' && req.method !== 'POST') return send({error:'METHOD_NOT_ALLOWED'},405);
        if (req.method === 'POST' && !origins.includes(req.headers.origin)) return send({error:'FORBIDDEN'},403);
        const raw = cookies(req)[cookie], args = { token: raw, realm };
        if (req.method === 'GET') {
          if (key === 'me') {
            let profile = null;
            try { profile = await store.call('me',args); } catch (e) { if (e.message !== 'LOGIN_REQUIRED') throw e; }
            const bearer = /^Bearer ([a-f0-9]{32})$/i.exec(req.headers.authorization || '');
            const session = bearer && registry?.byToken(bearer[1]);
            if (session) session.gameAccountId = profile?.id || null;
            return send({ enabled:true, realm, profile, scoresSupported: Boolean(board) });
          }
          if (key === 'records') return send(await store.call('records',{...args,offset:new URL(req.url,origin).searchParams.get('offset')}));
          return send({error:'NOT_FOUND'},404);
        }
        const data = await body(req);
        if (key === 'start') {
          noRoom(req);
          if (!/^[1-9][0-9]{4,11}$/.test(data.qq) || typeof data.nickname !== 'string' || !data.nickname.trim() || [...data.nickname].length > 24) throw new Error('INVALID_PROFILE');
          const challenge = challenges.create({ purpose:'login' });
          // Profile fields stay in the private cookie. They are validated again by the store.
          const value = Buffer.from(JSON.stringify({ ...challenge, qq:data.qq,nickname:data.nickname })).toString('base64url');
          setCookie(res,pendingCookie,value,300);
          return send({ code:challenge.code, command:`绑定游戏 ${realm} ${challenge.code}`, expires:challenge.expires });
        }
        if (key === 'status' || key === 'confirm') {
          const pending = JSON.parse(Buffer.from(cookies(req)[pendingCookie] || '', 'base64url').toString());
          if (key === 'status') return send(challenges.status(pending.code,pending.secret));
          const session = noRoom(req);
          const result = challenges.consume(pending.code,pending.secret);
          const account = await store.call('login',{subject:result.subject,qq:pending.qq,nickname:pending.nickname});
          setCookie(res,cookie,account.token,30 * 86400);
          setCookie(res,pendingCookie,'',0);
          const sync = await autoSync(req,res,{ token: account.token, realm },session);
          return send({ profile:account.profile, sync:sync.sync });
        }
        if (key === 'rename') return send({profile:await store.call('rename',{...args,nickname:data.nickname})});
        if (key === 'logout') { idle(req); await store.call('logout',args); setCookie(res,cookie,'',0); return send({ok:true}); }
        if (key === 'link') {
          const session = noRoom(req);
          if (!board) throw new Error('SCORES_NOT_SUPPORTED');
          const id = board.identityOf(req) || board.accountIdentity(req,res);
          if (!id) throw new Error('SCORES_UNAVAILABLE');
          const result = await autoSync(req,res,args,session);
          return send({ profile: await store.call('me',args), sync:result.sync });
        }
        if (key === 'restore') {
          const session = noRoom(req);
          if (!board) throw new Error('SCORES_NOT_SUPPORTED');
          const link = await store.call('linked',args);
          if (!link) throw new Error('NO_LINKED_SCORES');
          board.restoreAccountIdentity(res,session,link.identity);
          return send({ ok:true, sync:'restored' });
        }
        if (key === 'upload') return send(await store.call('upload',{...args,records:data.records}));
        if (key === 'sync') {
          const session = noRoom(req);
          await store.call('me', args); // 必须已登录
          return send(await autoSync(req,res,args,session));
        }
        if (key === 'recovery') return send(await store.call('recovery',args));
        if (key === 'recover') {
          idle(req);
          const result = await store.call('recover',{code:data.code});
          setCookie(res,cookie,result.token,30 * 86400);
          return send({profile:result.profile,recoveryCode:result.recoveryCode});
        }
        return send({error:'NOT_FOUND'},404);
      } catch (error) {
        const message = /^[A-Z_]+$/.test(error.message) ? error.message : 'INVALID_REQUEST';
        send({error:message},message === 'LOGIN_REQUIRED' ? 401 : message === 'RATE_LIMITED' ? 429 : message === 'STORAGE_UNAVAILABLE' ? 503 : 400);
      }
    },
  };
}
