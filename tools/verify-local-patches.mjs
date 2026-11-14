#!/usr/bin/env node
// 改编版独有资产校验器
//
// 用途：每次从上游同步（merge / cherry-pick）之后跑一遍，逐项确认
//      「本改编版独有功能与补丁」一个都没丢。
//
// 用法：node tools/verify-local-patches.mjs
//      退出码 0 = 全部保留；1 = 有缺失项（表格里标 FAIL / MISSING）
//
// 说明：这份清单与 docs/1UPSTREAM-SYNC-PROMPT.md 的「附·第五节」一一对应。
//      新增独有功能时，请同步在这里加一条检查。

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 读取文件内容；不存在返回 null */
function read(rel) {
  const abs = join(ROOT, rel);
  try {
    if (!existsSync(abs) || statSync(abs).isDirectory()) return null;
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 检查项：
 *   group   分组（对应文档里的功能编号）
 *   label   人类可读的说明
 *   file    相对路径（单文件检查）
 *   files   多文件存在性检查
 *   pattern 必须出现的内容（正则）
 *   absent  必须不出现的内容（正则）
 *   count   精确计数：{ pattern, expect }
 */
const CHECKS = [
  // ── 1. 六人房全套 ─────────────────────────────────────────────
  { group: '1 六人房', label: 'MAX_SEATS = 6', file: 'shared/constants.js', pattern: /MAX_SEATS\s*=\s*6/ },
  { group: '1 六人房', label: 'largeRoomBountyCards（九张悬赏）', file: 'server/match/choices.js', pattern: /largeRoomBountyCards/ },
  { group: '1 六人房', label: 'SIX_PLAYER_BEACON_ROUNDS', file: 'server/match/match/phases.js', pattern: /SIX_PLAYER_BEACON_ROUNDS/ },
  { group: '1 六人房', label: 'openingBans.js 存在', file: 'shared/openingBans.js', pattern: /BAN/ },
  { group: '1 六人房', label: 'bossHpOverride（六人血池 ×200%）', file: 'server/match/gamedata.js', pattern: /bossHpOverride/ },
  { group: '1 六人房', label: 'startingSeatCount（Match 构造）', file: 'server/match/Match.js', pattern: /startingSeatCount/ },

  // ── 2/4. 倍速与跳过本场 ───────────────────────────────────────
  { group: '2 倍速', label: 'cycleSpeed', file: 'public/js/battle/runner.js', pattern: /cycleSpeed/ },
  { group: '2 倍速', label: 'SpeedButton', file: 'public/js/ui/hud.js', pattern: /SpeedButton/ },
  { group: '4 跳过', label: 'skipBattle', file: 'public/js/battle/runner.js', pattern: /skipBattle/ },
  { group: '4 跳过', label: 'skipReady', file: 'public/js/battle/runner.js', pattern: /skipReady/ },
  { group: '4 跳过', label: 'SkipButton', file: 'public/js/ui/hud.js', pattern: /SkipButton/ },

  // ── 5. 聊天 ──────────────────────────────────────────────────
  { group: '5 聊天', label: 'chat.js 存在', file: 'public/js/ui/chat.js', pattern: /chat/ },
  { group: '5 聊天', label: 'g.chat 协议', file: 'shared/protocol.js', pattern: /chat/ },
  { group: '5 聊天', label: 'CHAT_COOLDOWN_MS', file: 'shared/constants.js', pattern: /CHAT_COOLDOWN_MS/ },
  { group: '5 聊天', label: 'intents 处理 chat', file: 'server/match/match/intents.js', pattern: /chat/ },

  // ── 6. 公告栏 ────────────────────────────────────────────────
  { group: '6 公告', label: 'announcements.json 存在', file: 'announcements.json', pattern: /updatedAt/ },
  { group: '6 公告', label: 'announcements.js 服务端', file: 'server/http/announcements.js', pattern: /.+/ },
  { group: '6 公告', label: 'GET /api/announcements', file: 'server/http/routes.js', pattern: /api\/announcements/ },
  { group: '6 公告', label: '公告轮询 60 秒', file: 'public/js/screens/title.js', pattern: /60000/ },

  // ── 7. 在线人数 ──────────────────────────────────────────────
  { group: '7 在线人数', label: 'GET /api/online', file: 'server/http/routes.js', pattern: /api\/online/ },

  // ── 8. 公共匹配 ──────────────────────────────────────────────
  { group: '8 匹配', label: 'MATCH_TARGET', file: 'server/lobby.js', pattern: /MATCH_TARGET/ },
  { group: '8 匹配', label: 'setBossHp（房间设置）', file: 'server/lobby.js', pattern: /setBossHp/ },

  // ── 9. 监控大屏 ──────────────────────────────────────────────
  { group: '9 监控', label: 'monitor.html 存在', file: 'public/monitor.html', pattern: /monitor/ },
  { group: '9 监控', label: 'monitor.html 无内联 onclick（应为 0）', file: 'public/monitor.html', count: { pattern: /onclick=/g, expect: 0 } },
  { group: '9 监控', label: 'monitor.js 存在', file: 'public/js/monitor.js', pattern: /.+/ },
  { group: '9 监控', label: 'api/admin/restart（应为 1）', file: 'server/http/routes.js', count: { pattern: /api\/admin\/restart/g, expect: 1 } },
  { group: '9 监控', label: 'api/admin/kickall', file: 'server/http/routes.js', pattern: /kickall/ },

  // ── 10. 本机/PC/安卓联机 ─────────────────────────────────────
  { group: '10 联机', label: '3 个 bat 齐全', files: ['本机当服务器.bat', '启动游戏.bat', '连接服务器.bat'] },
  { group: '10 联机', label: "launch.mjs 监听 '::'", file: 'scripts/launch.mjs', pattern: /env\.HOST\s*\|\|\s*'::'/ },
  { group: '10 联机', label: "DEFAULT_BIND_HOST = '::'", file: 'server/http/config.js', pattern: /DEFAULT_BIND_HOST\s*=\s*'::'/ },
  { group: '10 联机', label: 'proxy.js proxyTo', file: 'server/http/proxy.js', pattern: /proxyTo/ },

  // ── 补丁：首领血量 / 部署位 ──────────────────────────────────
  { group: '补丁', label: 'BOSS_HP_OPTIONS [1, 3.25]', file: 'shared/constants.js', pattern: /BOSS_HP_OPTIONS\s*=\s*Object\.freeze\(\s*\[1,\s*3\.25\]\s*\)/ },
  { group: '补丁', label: 'BossHpPicker（房间 UI）', file: 'public/js/screens/room.js', pattern: /BossHpPicker/ },
  { group: '补丁', label: '.bosshp 样式', file: 'public/css/screens/room.css', pattern: /bosshp/ },
  { group: '补丁', label: 'deployCap = 8', file: 'data/config.json', pattern: /"deployCap"\s*:\s*8/ },

  // ── 补丁：素材守卫 / BGM / 长缓存 ────────────────────────────
  { group: '补丁', label: '素材守卫（≥10 人才拦，title.js）', file: 'public/js/screens/title.js', pattern: /humans\s*>=\s*10/ },
  { group: '补丁', label: 'countImportedFiles（素材导入计数）', file: 'public/js/screens/title.js', pattern: /countImportedFiles/ },
  { group: '补丁', label: 'BGM 启动时强制关', file: 'public/js/ui/settings.js', pattern: /bgm\s*:\s*0/ },
  { group: '补丁', label: 'BGM 默认值 = 0', file: 'public/js/ui/gameLogic/settings.js', pattern: /bgm\s*:\s*0/ },
  { group: '补丁', label: 'IMMUTABLE_JSON（/data/ 长缓存）', file: 'server/http/static.js', pattern: /IMMUTABLE_JSON/ },

  // ── 未提交：账号绑定子系统（半成品，必须整体保留）──────────
  { group: '账号', label: 'challenges.js', file: 'server/accounts/challenges.js', pattern: /.+/ },
  { group: '账号', label: 'client.js', file: 'server/accounts/client.js', pattern: /.+/ },
  { group: '账号', label: 'store.js', file: 'server/accounts/store.js', pattern: /.+/ },
  { group: '账号', label: 'worker.js', file: 'server/accounts/worker.js', pattern: /.+/ },
  { group: '账号', label: 'http.js（已入库）', file: 'server/accounts/http.js', pattern: /createAccounts|createAccountStore/ },
  { group: '账号', label: 'index.js 接线 createAccounts', file: 'server/index.js', pattern: /createAccounts/ },
  { group: '账号', label: 'ACCOUNT-BINDING-PLAN.md', file: 'docs/ACCOUNT-BINDING-PLAN.md', pattern: /.+/ },
  { group: '账号', label: '5 个 account 测试', files: [
    'test/account-browser-e2e.test.js', 'test/account-challenges.test.js',
    'test/account-e2e-live.test.js', 'test/account-http.test.js', 'test/account-store.test.js',
  ] },

  // ── 未提交：其他新增 ────────────────────────────────────────
  { group: '新增', label: 'dailyChallenges.js', file: 'server/dailyChallenges.js', pattern: /.+/ },
  { group: '新增', label: 'recovery/service.js', file: 'server/recovery/service.js', pattern: /.+/ },
  { group: '新增', label: 'achievementCollection.js', file: 'public/js/ui/achievementCollection.js', pattern: /.+/ },
  { group: '新增', label: 'funReport.js', file: 'public/js/ui/funReport.js', pattern: /.+/ },
  { group: '新增', label: 'localActivities.js', file: 'public/js/ui/localActivities.js', pattern: /.+/ },
  { group: '新增', label: 'assetImport.js', file: 'public/js/ui/assetImport.js', pattern: /.+/ },
  { group: '新增', label: 'test/bot/ 存在', file: 'test/bot/README.md', pattern: /.+/ },
];

function runOne(c) {
  // 多文件存在性
  if (c.files) {
    const missing = c.files.filter((f) => !existsSync(join(ROOT, f)));
    return missing.length === 0
      ? { ok: true, note: '全部存在' }
      : { ok: false, note: '缺: ' + missing.join(', ') };
  }

  const text = read(c.file);
  if (text == null) return { ok: false, note: '文件不存在' };

  if (c.count) {
    const n = (text.match(c.count.pattern) || []).length;
    return n === c.count.expect
      ? { ok: true, note: `计数 ${n}` }
      : { ok: false, note: `计数 ${n}，应为 ${c.count.expect}` };
  }

  if (c.absent) {
    return c.absent.test(text)
      ? { ok: false, note: '出现了不该有的内容' }
      : { ok: true, note: '已确认不含' };
  }

  if (c.pattern) {
    return c.pattern.test(text)
      ? { ok: true, note: '命中' }
      : { ok: false, note: '未命中' };
  }

  return { ok: true, note: '存在' };
}

// ── 执行 ──────────────────────────────────────────────────────
const rows = [];
let failed = 0;

for (const c of CHECKS) {
  const r = runOne(c);
  if (!r.ok) failed++;
  rows.push({ ...c, ...r });
}

const groups = [...new Set(rows.map((r) => r.group))];
const width = Math.max(...rows.map((r) => r.label.length));

console.log('');
console.log('改编版独有资产校验 — ' + ROOT);
console.log('='.repeat(78));

for (const g of groups) {
  console.log('\n【' + g + '】');
  for (const r of rows.filter((x) => x.group === g)) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    console.log(
      `  ${mark}  ${r.label.padEnd(width)}  ${(r.file || (r.files || []).join(', '))}` +
      (r.ok ? '' : `   ← ${r.note}`)
    );
  }
}

console.log('\n' + '='.repeat(78));
console.log(`合计 ${rows.length} 项：通过 ${rows.length - failed}，失败 ${failed}`);
if (failed) {
  console.log('\n有独有资产缺失，先别提交/部署。对照 docs/1UPSTREAM-SYNC-PROMPT.md 第五节逐项修回。');
  process.exit(1);
}
console.log('\n全部保留。');
