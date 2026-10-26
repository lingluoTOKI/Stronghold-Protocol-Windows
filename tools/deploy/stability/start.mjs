import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installAdmission } from './admission.mjs';

const root = process.cwd();
const { startServer } = await import(pathToFileURL(path.join(root, 'server/index.js')).href);
const { runMain } = await import(pathToFileURL(path.join(root, 'server/http/boot.js')).href);
const port = Number(process.env.PORT || 3000);
const maxMatches = 0; // No fixed match count cap; resource pressure protection remains.
const maxRooms = 0; // No fixed room count cap.
await runMain(async () => {
  // 掉线重连窗口：官方基础值是 10 分钟（net.js NET_DEFAULTS.reconnectWindowMs）。
  // 小机器上掉线玩家占着的房间会一直模拟，攒出几十个「无人房间」，所以两个都收到 60 秒：
  //   reconnectWindowMs        —— 所有会话的基础窗口（coop 局也走它）
  //   soloReconnectWindowMs    —— 单人局的官方 24 小时窗口；net.js 的 windowOf() 只会取较大值，
  //                               不一起改的话单人局仍然是 24 小时
  const server = await startServer({ maxRooms: Infinity, maxRoomsPerAddr: 0, maxMatchesPerAddr: 0, reconnectWindowMs: 60000, soloReconnectWindowMs: 60000 });
  const statusDir = '/run/stronghold-stability';
  fs.mkdirSync(statusDir, { recursive: true, mode: 0o700 });
  const admission = installAdmission(server.lobby, {
    maxMatches, maxRooms, minAvailableMB: 512, maxRssMB: port === 3001 ? 900 : 1400,
    statusFile: path.join(statusDir, `admission-${port}.json`),
    policyFile: `/var/lib/stronghold-stability/policy-${port}.json`,
  });
  const close = server.close;
  server.close = async () => { admission.stop(); return close(); };
  console.log(`[stability] new-match cap=${maxMatches}; room cap=${maxRooms}; existing games and reconnects preserved`);
  return server;
});
