// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * /studio and /studio/… → the plugin studio (server/studio/index.js: for this machine and the local network only — any
//     other client gets the 404 page; its API also takes POST / PUT / DELETE), when the server has one;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD`;
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, the vanilla content
//     hash `content.vanilla`, the modded content sets in use `content.sets` and — only when there are some — how many
//     unofficial plugins the server has, `content.plugins` (the title screen's count before any hello) — DESIGN §32 —,
//     sockets, sessions,
//     rooms, matches), never cached; `?traffic=1` adds the traffic counters (traffic.js: bytes by category since the
//     start, WebSocket wire and payload bytes) for a loopback or private-network client only — the maintainer's
//     decision of 2026-10-12: the figures are the host's, so any other client, also one a tunnel or proxy on this
//     machine forwards, gets the plain report (net.js clientAddress, honouring TRUST_PROXY like the WebSocket limits);
//   * everything else → the static files (static.js).
// Every response's body bytes count in the traffic counters (traffic.js meter). A route that throws is logged and
// answers 500.

import { createHash, timingSafeEqual } from 'node:crypto';
import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';
import { CLOSE, clientAddress, isLocalIp } from '../net.js';

const MAX_URL_LENGTH = 4096;
/** 管理员踢人后拒绝该玩家自动重连 / 恢复的窗口（毫秒）。 */
const ADMIN_KICK_BAN_MS = 10 * 60 * 1000;

/** 常量时间比较两个字符串（先 sha256 定长摘要，避免 timingSafeEqual 长度不一致抛错与长度侧信道）。 */
function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a ?? '')).digest();
  const hb = createHash('sha256').update(String(b ?? '')).digest();
  try { return timingSafeEqual(ha, hb); } catch { return false; }
}

/** `{ plugins: n }` when the server has n > 0 unofficial plugins (the lobby's visual sets count them), else nothing. */
function pluginCount(lobby) {
  let n;
  try { n = Number(lobby?.plugins?.unofficial?.()) || 0; } catch { n = 0; }
  return n > 0 ? { plugins: n } : {};
}

/** The content sets with gameplay plugins rooms hold now (DESIGN §32.6; 0 without any). */
function contentSets(lobby) {
  try { return Number(lobby?.plugins?.contentInUse?.()) || 0; } catch { return 0; }
}

/**
 * The GET /healthz body (`withTraffic`: plus the traffic counters and the asset index's state, `?traffic=1`).
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby, content?: { cs: string } | null,
 *           traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter>,
 *           assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null,
 *           views?: ReturnType<typeof import('./assetViews.js').createManifestViews> | null }} health
 *   content: the server's vanilla content (server/plugins/identity.js)
 * @param {boolean} [withTraffic]
 */
export function healthReport({ startedAt, network, registry, lobby, content = null, traffic, assetIndex, views, trusted }, withTraffic = false) {
  const report = {
    ok: true, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
    // older than this reloads itself, so a deploy reaches clients that never reload
    build: buildTag(),
    // what its rooms play (DESIGN §32): the vanilla content hash, and how many content sets with gameplay plugins rooms
    // hold now (P1c, §32.6 — a room's cosmetic plugins leave its cs the vanilla one, §32.3); how many unofficial plugins
    // it has, when it has some (a page's title screen says so; P1a)
    ...(content ? { content: { vanilla: content.cs, sets: contentSets(lobby), ...pluginCount(lobby) } } : {}),
    sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
  };
  if (trusted && Object.keys(trusted).length) report.plugins = trusted;
  if (withTraffic && traffic) report.traffic = traffic.snapshot();
  // content-hashed asset URLs (assetIndex.js / assetViews.js): off, building, or ready with how many files and URLs
  if (withTraffic) report.assetHashes = assetIndex ? { ...assetIndex.stats(), views: views ? views.stats() : null } : null;
  return report;
}

/** Does the query ask for the traffic counters (`traffic`, `traffic=1`, `traffic=true`)? */
const wantsTraffic = (query) => /(?:^|&)traffic(?:=(?:1|true|yes))?(?:&|$)/i.test(query || '');

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           health: Parameters<typeof healthReport>[0], log: object, trustProxy?: 'auto' | boolean,
 *           csp?: string | null,
 *           studio?: { handles: (rawPath: string) => boolean, handle: (req: any, res: any, rawPath: string, query: string) => Promise<void> } | null }} deps
 *   trustProxy: whose forwarding headers name the client (net.js clientAddress; the server's TRUST_PROXY); studio: the
 *   plugin studio (server/studio/index.js), or none
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log, trustProxy = 'auto', studio = null, csp = null, trustedRuntime = null, announcements = null, announcePublish = null, announceClear = null, proxy = null }) {
  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (trustedRuntime && parts.rawPath.startsWith('/x/') && await trustedRuntime.route(req,res,parts.rawPath)) return;
    if (studio && studio.handles(parts.rawPath)) { await studio.handle(req, res, parts.rawPath, parts.query); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    // 监控大屏从别的 origin 打开 /healthz 与 admin 接口：方法闸之后才加，故 405/414/400 错误响应不带 CORS 头。
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');

    // ---- 监控运维接口（改编独有）：token 走 query 参数；未配置 SP_ADMIN_TOKEN 一律 403 ----
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
      const now = Date.now();
      for (const [code, r] of health.lobby.rooms) {
        const m = r.match;
        const active = typeof r.activeHumans === 'function' ? r.activeHumans() : [];
        const connected = typeof r.connectedHumans === 'function' ? r.connectedHumans() : active.filter((s) => s.connected);
        const away = active.map((s) => (s.connected || !s.disconnectedAt ? 0 : now - s.disconnectedAt));
        out.push({
          code, mode: r.mode, difficulty: r.difficulty,
          inMatch: !!m, matchNo: r.matchCount || 0,
          phase: m ? m.phase : null, round: m ? m.round : 0,
          seatCount: (r.seats || []).filter(Boolean).length,
          humanCount: active.length,
          connectedHumans: connected.length,
          spectatorCount: Array.isArray(r.spectators) ? r.spectators.length : 0,
          // 'live' 有人在线 / 'away' 只剩掉线座位（等人的空房，宽限或 solo 24h 内仍保留）
          audience: connected.length ? 'live' : 'away',
          awaySec: away.length ? Math.round(Math.max(...away) / 1000) : 0,
          hostId: r.hostId || null,
        });
      }
      sendJson(req, res, 200, { ok: true, count: out.length, rooms: out });
      return;
    }
    // 关闭一个房间（监控大屏）：等不到人回来的空房、或卡住的房，管理员直接收掉。
    if (parts.rawPath === '/api/admin/room/close') {
      if (!adminAuthorized()) { sendError(req, res, 403, '拒绝 · Forbidden'); return; }
      const q = new URLSearchParams(parts.query || '');
      const code = String(q.get('code') || '').toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) { sendError(req, res, 400, '同盟密钥无效 · bad room code'); return; }
      const room = health.lobby.rooms.get(code);
      if (!room) { sendError(req, res, 404, '房间不存在 · room not found'); return; }
      const connected = typeof room.connectedHumans === 'function' ? room.connectedHumans().length : 0;
      // 满员的对局默认不关：管理员真要对正在玩的房间动手，得显式带上 force=1。
      if (connected > 0 && q.get('force') !== '1') {
        sendJson(req, res, 409, { ok: false, error: 'room has connected players', connected, hint: 'add force=1 to close anyway' });
        return;
      }
      health.lobby.disposeRoom(room, 'admin');
      sendJson(req, res, 200, { ok: true, code, closed: true, kicked: connected });
      return;
    }

    // ---- 公告发布 / 撤回（监控大屏运维接口，token 走 query）----
    // 发布一条公告：force 缺省 true（玩家进游戏强制弹窗）；显式 force=false 作为普通公告进公告栏。
    if (parts.rawPath === '/api/admin/announce') {
      if (!adminAuthorized()) { sendError(req, res, 403, '拒绝 · Forbidden'); return; }
      if (!announcePublish) { sendError(req, res, 501, '服务器不支持发布公告 · announce disabled'); return; }
      const q = new URLSearchParams(parts.query || '');
      const title = (q.get('title') || '').trim() || '服务器更新公告';
      const content = (q.get('content') || '').trim();
      if (!content) { sendError(req, res, 400, '公告正文不能为空 · content required'); return; }
      const startAt = q.get('startAt');
      const expireAt = q.get('expireAt');
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
    // 撤回全部强制公告：删除 announcements.json 里所有 force 项（普通公告保留）。
    if (parts.rawPath === '/api/admin/announce-clear') {
      if (!adminAuthorized()) { sendError(req, res, 403, '拒绝 · Forbidden'); return; }
      if (!announceClear) { sendError(req, res, 501, '服务器不支持撤回公告 · announce-clear disabled'); return; }
      const r = announceClear();
      if (!r.ok) { sendError(req, res, 500, r.error || 'announce clear failed'); return; }
      sendJson(req, res, 200, { ok: true, updatedAt: r.updatedAt, removed: r.removed });
      return;
    }

    // ---- 联机（本机客户端）模式：/ws 与 /api/* 交给中心服务器（server/http/proxy.js）----
    if (proxy && parts.rawPath.startsWith('/api/')) {
      proxy.proxyHttp(req, res);
      return;
    }

    // ---- 公开只读接口（改编独有）----
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
      const withTraffic = wantsTraffic(parts.query) && isLocalIp(clientAddress(req, trustProxy).ip);
      sendJson(req, res, 200, healthReport(health, withTraffic));
      return;
    }
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  return (req, res) => {
    setSecurityHeaders(res);
    if (csp) res.setHeader('Content-Security-Policy', csp);
    if (health.traffic) health.traffic.meter(res, splitUrl(req.url || '/')?.rawPath || '/');
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  };
}
