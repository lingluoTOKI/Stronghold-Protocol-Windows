// server/http/announcements.js — 改编独有：服务器公告栏。
//
// 读服务端根目录下的 `announcements.json`，按 mtime 懒热更新：改完文件下一次请求就生效，不用重启。
// 文件缺失或读不动就当作空公告，绝不因此 500（客户端实现员负责创建该文件）。
//
// 由 server/http/routes.js 挂在 GET /api/announcements（`{ ok: true, updatedAt, items }`）。

import fs from 'node:fs';

/**
 * @param {string} filePath announcements.json 的绝对路径
 * @returns {() => { updatedAt: string|null, items: Array<{version?:string,time?:string,title:string,content:string}> }}
 */
export function createAnnouncements(filePath) {
  let cache = null;
  let cacheMtime = -1;
  return () => {
    try {
      const st = fs.statSync(filePath);
      if (st.mtimeMs !== cacheMtime) {
        cache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        cacheMtime = st.mtimeMs;
      }
    } catch { /* 缺失 / 读不动 → 空公告 */ cache = { updatedAt: null, items: [] }; cacheMtime = -1; }
    return cache || { updatedAt: null, items: [] };
  };
}
