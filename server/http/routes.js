// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD`;
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, sockets, sessions,
//     rooms, matches), never cached;
//   * everything else → the static files (static.js).
// A route that throws is logged and answers 500.

import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';
import { CLOSE } from '../net.js';

const MAX_URL_LENGTH = 4096;
// 管理员踢人后，多少毫秒内拒绝该玩家自动重连 / 刷新恢复（客户端会收到 CLOSE.KICKED 并停止重连）。
const ADMIN_KICK_BAN_MS = 10 * 60 * 1000;

/**
 * The GET /healthz body.
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby }} health
 */
export function healthReport({ startedAt, network, registry, lobby }) {
  return {
    ok: true, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
    // older than this reloads itself, so a deploy reaches clients that never reload
    build: buildTag(),
    sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
  };
}

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           health: Parameters<typeof healthReport>[0], log: object,
 *           proxy?: ReturnType<import('./proxy.js').createProxy> | null,
 *           announcements?: (() => object) | null,
 *           announcePublish?: ((title: string, content: string) => { ok: boolean, error?: string }) | null,
 *           announceClear?: (() => { ok: boolean, error?: string }) | null }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log, proxy = null, announcements = null, announcePublish = null, announceClear = null }) {
  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    // 大屏监控需要跨域读取 /healthz 与 admin 接口（监控页面从别的 origin 打开）。
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    // admin token：环境变量 SP_ADMIN_TOKEN；未设置时 admin 接口一律 403。
    const ADMIN_TOKEN = process.env.SP_ADMIN_TOKEN || '';
    // 本扩展：反向代理模式 —— /api/* 一律转发给中心服务器（在线人数、房间数、公告都以那边为准）。
    // 注意放在 /healthz 之前、方法闸之后：只转发 GET / HEAD，healthz 始终由本机回答。
    // admin 接口放在代理之前：代理模式下也能本机管理当前进程的连接。
    if (parts.rawPath === '/api/admin/players') {
      if (!ADMIN_TOKEN) { sendError(req, res, 403, 'admin token not configured'); return; }
      const q = new URLSearchParams(parts.query || '');
      if (q.get('token') !== ADMIN_TOKEN) { sendError(req, res, 403, 'bad admin token'); return; }
      const list = [];
      const inMatchByCode = new Map();
      for (const [code, r] of health.lobby.rooms) inMatchByCode.set(code, !!r.match);
      for (const s of health.registry.byPlayerId.values()) {
        if (!s.connected) continue;
        list.push({
          playerId: s.playerId, name: s.name, roomCode: s.roomCode || null,
          inMatch: s.roomCode ? !!inMatchByCode.get(s.roomCode) : false,
          addr: s.addr || '?', lastSeenAgoSec: s.lastSeen ? Math.round((Date.now() - s.lastSeen)/1000) : null,
        });
      }
      sendJson(req, res, 200, { ok: true, count: list.length, players: list });
      return;
    }
    if (parts.rawPath === '/api/admin/kick') {
      if (!ADMIN_TOKEN) { sendError(req, res, 403, 'admin token not configured'); return; }
      const q = new URLSearchParams(parts.query || '');
      if (q.get('token') !== ADMIN_TOKEN) { sendError(req, res, 403, 'bad admin token'); return; }
      const pid = q.get('playerId') || '';
      const s = health.registry.byId(pid);
      if (!s) { sendError(req, res, 404, 'player not found'); return; }
      // 先加封禁再关连接：客户端收到 CLOSE.KICKED 会停止自动重连；封禁窗口内即使手动刷新 / 换标签
      // 用同一 token 恢复也会被握手拒绝，避免“踢了秒回”。
      health.registry.ban(pid, ADMIN_KICK_BAN_MS);
      if (s.connected && s.ws) { try { s.ws.close(CLOSE.KICKED, 'admin-kicked'); } catch {} }
      sendJson(req, res, 200, { ok: true, kicked: pid, name: s.name, banSec: Math.round(ADMIN_KICK_BAN_MS / 1000) });
      return;
    }
    // 本扩展：一键踢走当前进程内所有在线连接，统一封禁 10 分钟（复用单踢的封禁窗口）。
    if (parts.rawPath === '/api/admin/kickall') {
      if (!ADMIN_TOKEN) { sendError(req, res, 403, 'admin token not configured'); return; }
      const q = new URLSearchParams(parts.query || '');
      if (q.get('token') !== ADMIN_TOKEN) { sendError(req, res, 403, 'bad admin token'); return; }
      let kicked = 0;
      for (const s of health.registry.byPlayerId.values()) {
        if (!s.connected || !s.ws) continue;
        health.registry.ban(s.playerId, ADMIN_KICK_BAN_MS);
        try { s.ws.close(CLOSE.KICKED, 'admin-kickall'); } catch {}
        kicked++;
      }
      sendJson(req, res, 200, { ok: true, kicked, banSec: Math.round(ADMIN_KICK_BAN_MS / 1000) });
      return;
    }
    // 本扩展：房间对局进程——返回每个房间的实时对局阶段 / 回合 / 人数 / 档案，供监控大屏展示。
    if (parts.rawPath === '/api/admin/rooms') {
      if (!ADMIN_TOKEN) { sendError(req, res, 403, 'admin token not configured'); return; }
      const q = new URLSearchParams(parts.query || '');
      if (q.get('token') !== ADMIN_TOKEN) { sendError(req, res, 403, 'bad admin token'); return; }
      const rooms = [];
      for (const [code, r] of health.lobby.rooms) {
        const m = r.match;
        rooms.push({
          code, mode: r.mode, difficulty: r.difficulty, rhine: !!r.rhineEnabled,
          inMatch: !!m, matchNo: r.matchCount || 0,
          phase: m ? m.phase : null, round: m ? m.round : 0,
          seatCount: (r.seats || []).filter(Boolean).length,
          humanCount: typeof r.activeHumans === 'function' ? r.activeHumans().length : 0,
          hostId: r.hostId || null,
        });
      }
      sendJson(req, res, 200, { ok: true, count: rooms.length, rooms });
      return;
    }
    // 本扩展：发布「服务器更新强制公告」——在 announcements.json 顶部插入一条 force 公告，客户端进游戏即强制弹窗。
    if (parts.rawPath === '/api/admin/announce') {
      if (!ADMIN_TOKEN) { sendError(req, res, 403, 'admin token not configured'); return; }
      const q = new URLSearchParams(parts.query || '');
      if (q.get('token') !== ADMIN_TOKEN) { sendError(req, res, 403, 'bad admin token'); return; }
      if (!announcePublish) { sendError(req, res, 501, 'server does not support force announce'); return; }
      const title = (q.get('title') || '').trim() || '服务器更新公告';
      const content = (q.get('content') || '').trim();
      if (!content) { sendError(req, res, 400, 'content required'); return; }
      // 上架 / 下架时间（可选）：epoch 毫秒。上架前不显示、下架后自动隐藏；缺省则立即上架、永久显示。
      const startAt = q.get('startAt');
      const expireAt = q.get('expireAt');
      // force：缺省 true（强制弹窗）；显式传 false / 0 则作为普通公告发布（进公告栏、不弹窗）。
      const forceRaw = q.get('force');
      const force = forceRaw !== 'false' && forceRaw !== '0';
      const r = announcePublish(title, content, {
        force,
        startAt: (startAt && /^\d+$/.test(startAt)) ? Number(startAt) : undefined,
        expireAt: (expireAt && /^\d+$/.test(expireAt)) ? Number(expireAt) : undefined,
      });
      if (!r.ok) { sendError(req, res, 500, r.error || 'announce write failed'); return; }
      sendJson(req, res, 200, { ok: true, updatedAt: r.updatedAt, forceId: r.forceId });
      return;
    }
    // 本扩展：撤回全部强制公告——删除 announcements.json 里所有 force 项（普通公告保留）。
    if (parts.rawPath === '/api/admin/announce-clear') {
      if (!ADMIN_TOKEN) { sendError(req, res, 403, 'admin token not configured'); return; }
      const q = new URLSearchParams(parts.query || '');
      if (q.get('token') !== ADMIN_TOKEN) { sendError(req, res, 403, 'bad admin token'); return; }
      if (!announceClear) { sendError(req, res, 501, 'server does not support clearing force announce'); return; }
      const r = announceClear();
      if (!r.ok) { sendError(req, res, 500, r.error || 'announce clear failed'); return; }
      sendJson(req, res, 200, { ok: true, updatedAt: r.updatedAt, removed: r.removed });
      return;
    }
    if (proxy && parts.rawPath.startsWith('/api/')) {
      proxy.proxyHttp(req, res);
      return;
    }
    if (parts.rawPath === '/healthz') {
      sendJson(req, res, 200, healthReport(health));
      return;
    }
    // 本扩展：实时在线人数与房间数（主界面每 5s 轮询 /api/online）。
    // 代理模式下这两条会先被上面的 /api/* 分支转发走，所以报的是中心服务器的数字。
    if (parts.rawPath === '/api/online') {
      sendJson(req, res, 200, { online: Math.max(health.network.connectionCount, 0) });
      return;
    }
    if (parts.rawPath === '/api/status') {
      sendJson(req, res, 200, {
        online: Math.max(health.network.connectionCount, 0), activeRooms: health.lobby.stats().matches,
      });
      return;
    }
    // 本扩展：服务器公告栏（本机 announcements.json，mtime 热更新；缺失即空公告）。
    if (announcements && parts.rawPath === '/api/announcements') {
      sendJson(req, res, 200, { ok: true, ...announcements() });
      return;
    }
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  return (req, res) => {
    setSecurityHeaders(res);
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  };
}
