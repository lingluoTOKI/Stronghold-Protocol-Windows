// server/http/proxy.js — 联机（本机客户端）模式的反向代理（改编独有；上游没有这个概念）。
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
// 这个进程用**本机磁盘上的客户端与素材**，只把实时状态与接口转发给中心服务器：
//   * `/ws`    → 整条交给远端的 Network（握手 + 双向转发）
//   * `/api/*` → 转发给远端的 HTTP
// 对浏览器而言这些请求**仍然是同源的**（页面在 127.0.0.1），所以不需要 CORS，客户端代码一行都不用改 ——
// 这正是选「本机代理」而不是「页面直连远端」的理由：会话凭证按 origin 存，直连会把凭证发到别处。
//
// `/healthz` 故意**不**转发：它报的是本机这一份代码的 build 标记，客户端的 buildGuard（public/js/ui/buildGuard.js）
// 要拿它与本机页面比对，转发过去就会拿中心服务器的标记去刷本机页面。
//
// 启用方式：startServer 的 `opts.proxyTo` 或环境变量 `SP_PROXY_TO`（server/index.js 里接线）。
// 上游地址**只**来自启动器写入的 scripts/launcher.config.json，不吃命令行 / URL 参数。

import http from 'node:http';
import https from 'node:https';
import { WebSocket } from 'ws';
import { sendError } from './common.js';

/**
 * `opts.proxyTo` / `SP_PROXY_TO` → 一个 URL，或 null（未设置 / 无效）。
 *
 * 接受 `host[:port]`（按 https 处理）或完整的 `http(s)://` origin；末尾斜杠会去掉。
 * @param {string | undefined} raw
 * @returns {URL | null}
 */
export function parseProxyOrigin(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.pathname = '/';
    u.search = '';
    u.hash = '';
    return u;
  } catch { return null; }
}

/**
 * 一台服务器的代理：HTTP 转发、WebSocket 转发，以及关服时要收掉的上游连接。
 * @param {{ origin: URL, log: object, maxPayload: number }} deps
 */
export function createProxy({ origin, log, maxPayload }) {
  /** @type {Set<import('ws').WebSocket>} 代理出去的 WebSocket，关服时要一起收掉 */
  const upstreams = new Set();

  /** 把一条 HTTP 请求原样转发给上游；上游的状态码与响应头照搬。 */
  function proxyHttp(req, res) {
    const lib = origin.protocol === 'https:' ? https : http;
    const upstream = lib.request({
      protocol: origin.protocol,
      hostname: origin.hostname,
      port: origin.port || undefined,
      method: req.method,
      path: req.url || '/',
      headers: { ...req.headers, host: origin.host },
    }, (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', (e) => {
      log.warn(`[proxy] ${origin.origin} 不可达：${e?.message || e}`);
      if (!res.headersSent) sendError(req, res, 502, '上游服务器不可达 · Upstream unreachable');
      else res.destroy();
    });
    req.pipe(upstream);
  }

  /**
   * 把一条 WebSocket 连接双向转发给上游。
   *
   * 关闭码与原因**原样透传**：客户端靠 4001（会话被顶）/ 4002（hello 超时）决定要不要自动重连，把它们
   * 换成 1006 会让重连策略走错分支。上游还没连上时先缓存几条客户端消息（页面加载后立刻发 hello，而到远端
   * 握手要一个 RTT），连上即补发。
   */
  function forwardUpgrade(wss, req, socket, head) {
    const target = `${origin.protocol === 'https:' ? 'wss:' : 'ws:'}//${origin.host}${req.url || '/ws'}`;
    wss.handleUpgrade(req, socket, head, (client) => {
      let upstream;
      try {
        upstream = new WebSocket(target, { perMessageDeflate: false, maxPayload });
      } catch (e) {
        log.warn(`[proxy] 无法连接 ${target}：${e?.message || e}`);
        try { client.close(1011, 'proxy connect failed'); } catch { /* ignore */ }
        return;
      }
      upstreams.add(upstream);
      const pending = [];
      const drop = () => { upstreams.delete(upstream); };
      const forward = (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) { try { upstream.send(data, { binary: isBinary }); } catch { /* ignore */ } }
        else if (upstream.readyState === WebSocket.CONNECTING) pending.push([data, isBinary]);
      };
      upstream.on('open', () => { for (const [d, b] of pending.splice(0)) { try { upstream.send(d, { binary: b }); } catch { /* ignore */ } } });
      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) { try { client.send(data, { binary: isBinary }); } catch { /* ignore */ } }
      });
      upstream.on('close', (code, reason) => {
        drop();
        const c = Number.isInteger(code) && code >= 1000 && code <= 4999 ? code : 1011;
        try { client.close(c, reason && reason.length ? reason : undefined); } catch { try { client.terminate(); } catch { /* ignore */ } }
      });
      upstream.on('error', (e) => {
        drop();
        log.warn(`[proxy] ${target} 出错：${e?.message || e}`);
        try { client.close(1011, 'upstream error'); } catch { try { client.terminate(); } catch { /* ignore */ } }
      });
      client.on('message', forward);
      client.on('close', () => { drop(); try { upstream.close(); } catch { /* ignore */ } });
      client.on('error', () => { drop(); try { upstream.terminate(); } catch { /* ignore */ } });
    });
  }

  /** 关服时把代理出去的连接收掉（startServer 的 close）。 */
  function close() {
    for (const up of upstreams) { try { up.close(1001, 'server shutting down'); } catch { /* ignore */ } }
    upstreams.clear();
  }

  return { origin, proxyHttp, forwardUpgrade, close };
}
