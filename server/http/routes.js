// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD`;
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, sockets, sessions,
//     rooms, matches), never cached;
//   * everything else → the static files (static.js).
// A route that throws is logged and answers 500.

import { createHash, timingSafeEqual } from 'node:crypto';
import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';
import { CLOSE } from '../net.js';

const MAX_URL_LENGTH = 4096;
/** 管理员踢人后拒绝该玩家自动重连 / 恢复的窗口（毫秒）。 */
const ADMIN_KICK_BAN_MS = 10 * 60 * 1000;

/** 常量时间比较两个字符串（先 sha256 定长摘要，避免 timingSafeEqual 长度不一致抛错与长度侧信道）。 */
function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a ?? '')).digest();
  const hb = createHash('sha256').update(String(b ?? '')).digest();
  try { return timingSafeEqual(ha, hb); } catch { return false; }
}

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
 *           health: Parameters<typeof healthReport>[0], log: object }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log, announcements = null }) {
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
    // 监控大屏从别的 origin 打开 /healthz 与 admin 接口：方法闸之后才加，故 405/414/400 错误响应不带 CORS 头。
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');

    // ---- 监控运维接口（规格 D）：token 走 query 参数；未配置 SP_ADMIN_TOKEN 一律 403 ----
    const ADMIN_TOKEN = process.env.SP_ADMIN_TOKEN || '';
    const adminAuthorized = () => {
      if (!ADMIN_TOKEN) return false;
      const q = new URLSearchParams(parts.query || '');
      return safeEqual(q.get('token') || '', ADMIN_TOKEN);
    };

    if (parts.rawPath === '/api/admin/players') {
      if (!adminAuthorized()) { sendError(req, res, 403, '拒绝 · Forbidden'); return; }
      const inMatchByCode = new Map();
      for (const [code, r] of health.lobby.rooms) inMatchByCode.set(code, !!r.match);
      const list = [];
      for (const s of health.registry.byPlayerId.values()) {
        if (!s.connected) continue;
        list.push({
          playerId: s.playerId, name: s.name, roomCode: s.roomCode || null,
          inMatch: s.roomCode ? !!inMatchByCode.get(s.roomCode) : false,
          addr: s.addr || '?', lastSeenAgoSec: s.lastSeen ? Math.round((Date.now() - s.lastSeen) / 1000) : null,
        });
      }
      sendJson(req, res, 200, { ok: true, count: list.length, players: list });
      return;
    }
    if (parts.rawPath === '/api/admin/kick') {
      if (!adminAuthorized()) { sendError(req, res, 403, '拒绝 · Forbidden'); return; }
      const q = new URLSearchParams(parts.query || '');
      const pid = q.get('playerId') || '';
      const s = health.registry.byId(pid);
      if (!s) { sendError(req, res, 404, '未找到玩家 · player not found'); return; }
      // 先加封禁再关连接：客户端收到 CLOSE.KICKED 会停止自动重连；封禁窗口内同 token 恢复也会被握手拒绝。
      health.registry.ban(pid, ADMIN_KICK_BAN_MS);
      if (s.connected && s.ws) { try { s.ws.close(CLOSE.KICKED, 'admin-kicked'); } catch { /* ignore */ } }
      sendJson(req, res, 200, { ok: true, kicked: pid, name: s.name, banSec: Math.round(ADMIN_KICK_BAN_MS / 1000) });
      return;
    }
    if (parts.rawPath === '/api/admin/kickall') {
      if (!adminAuthorized()) { sendError(req, res, 403, '拒绝 · Forbidden'); return; }
      let kicked = 0;
      for (const s of health.registry.byPlayerId.values()) {
        if (!s.connected || !s.ws) continue;
        health.registry.ban(s.playerId, ADMIN_KICK_BAN_MS);
        try { s.ws.close(CLOSE.KICKED, 'admin-kickall'); } catch { /* ignore */ }
        kicked++;
      }
      sendJson(req, res, 200, { ok: true, kicked, banSec: Math.round(ADMIN_KICK_BAN_MS / 1000) });
      return;
    }
    if (parts.rawPath === '/api/admin/rooms') {
      if (!adminAuthorized()) { sendError(req, res, 403, '拒绝 · Forbidden'); return; }
      const out = [];
      for (const [code, r] of health.lobby.rooms) {
        const m = r.match;
        out.push({
          code, mode: r.mode, difficulty: r.difficulty,
          inMatch: !!m, matchNo: r.matchCount || 0,
          phase: m ? m.phase : null, round: m ? m.round : 0,
          seatCount: (r.seats || []).filter(Boolean).length,
          humanCount: typeof r.activeHumans === 'function' ? r.activeHumans().length : 0,
          hostId: r.hostId || null,
        });
      }
      sendJson(req, res, 200, { ok: true, count: out.length, rooms: out });
      return;
    }

    // ---- 公开只读接口（规格 C）----
    if (parts.rawPath === '/api/online') {
      sendJson(req, res, 200, { online: Math.max(health.network.connectionCount, 0) });
      return;
    }
    if (announcements && parts.rawPath === '/api/announcements') {
      sendJson(req, res, 200, { ok: true, ...announcements() });
      return;
    }

    // /api/healthz 为监控大屏（file:// 打开的 monitor.html）使用的别名，与 /healthz 同体；两者都带 CORS 头。
    if (parts.rawPath === '/healthz' || parts.rawPath === '/api/healthz') {
      sendJson(req, res, 200, healthReport(health));
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
