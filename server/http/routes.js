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

const MAX_URL_LENGTH = 4096;

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
 *           announcements?: (() => object) | null }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log, proxy = null, announcements = null }) {
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
      for (const s of health.registry.byPlayerId.values()) {
        if (!s.connected) continue;
        list.push({
          playerId: s.playerId, name: s.name, roomCode: s.roomCode || null,
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
      if (!s || !s.connected || !s.ws) { sendError(req, res, 404, 'player not connected'); return; }
      try { s.ws.close(1008, 'admin-kick'); } catch {}
      sendJson(req, res, 200, { ok: true, kicked: pid, name: s.name });
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
