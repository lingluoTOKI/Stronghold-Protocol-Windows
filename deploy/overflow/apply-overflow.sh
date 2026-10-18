#!/bin/bash
# apply-overflow.sh — 给「溢流服」（杭州 116.62.39.28:3000，0.2.1）加主服满员才开放的分流
#
# 用法：把本目录整个传到目标机的 /root/ 下，然后
#   cd /root/overflow-patch && bash apply-overflow.sh /root/stronghold
#
# 做的事：
#   1) 新建 server/overflow.js（前两服人数查询 + 15 秒缓存 + 后台刷新）
#   2) shared/constants.js 加 OVERFLOW_CLOSED 错误码与文案
#   3) server/net.js 的 hello 握手处：新会话在溢流服关闭时拒绝（重连不受影响）
#   4) server/index.js 启动时开启 watcher
#
# 幂等：已经改过的会跳过；改之前自动备份到 /root/backups/overflow-<时间戳>/

set -e
ROOT="${1:-/root/stronghold}"
STAMP=$(date +%Y%m%d-%H%M%S)
BAK="/root/backups/overflow-$STAMP"

if [ ! -d "$ROOT/server" ]; then
  echo "❌ $ROOT 看起来不是项目根目录"
  exit 1
fi

echo "════════ 备份 ════════"
mkdir -p "$BAK"
for f in shared/constants.js server/net.js server/index.js; do
  [ -f "$ROOT/$f" ] && cp -a "$ROOT/$f" "$BAK/$(basename $f)"
done
echo "  -> $BAK"

echo ""
echo "════════ 1) 写 server/overflow.js ════════"
cat > "$ROOT/server/overflow.js" <<'OVERFLOW_JS'
// server/overflow.js — 溢流服的分流判断（改编版，2026-10-18）。
//
// 这台机器当「溢流服」：主服（3000）满员时开放。
// 主服没满的时候玩家该去主服 —— 那里是包月的，这台是按量计费，流量贵得多。
// 契约服不再作为前置条件（它常年只有 1–2 人，两服都满等于永不开放）。
//
// 判断依据是前两服 /api/online 的 humans（房内真人），不是连接数：
// 挂着大厅没进房间的人不算，否则一个挂机会让溢流服误以为「满了」。

/** 前两服的地址。 */
export const OVERFLOW_SOURCES = Object.freeze([
  { name: '主服', url: 'https://game.lingluotoki.dpdns.org/api/online' },
  { name: '契约服', url: 'https://alliance.lingluo-toki.top/api/online' },
]);

/** 主服达到这个人数就算「满了」，溢流服才开放。 */
export const OVERFLOW_THRESHOLD = 10;

const CACHE_MS = 15_000;
const TIMEOUT_MS = 2_500;

/** @type {{ at: number, open: boolean, detail: string } | null} */
let cache = null;
/** @type {{ open: boolean, detail: string } | null} 最近一次已知结果（缓存过期时先拿它顶着） */
let last = null;

async function readHumans(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.humans === 'number' && Number.isFinite(j.humans) ? j.humans : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 溢流服现在是否该开放。缓存 15 秒，握手很频繁不能每次打外部接口。
 * @param {{ log?: { info: Function, warn: Function } }} [opts]
 * @returns {Promise<{ open: boolean, detail: string }>}
 */
export async function overflowOpen({ log } = {}) {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return { open: cache.open, detail: cache.detail };

  const results = await Promise.all(OVERFLOW_SOURCES.map(async (s) => ({ ...s, humans: await readHumans(s.url) })));
  const detail = results.map((r) => `${r.name} ${r.humans == null ? '?' : r.humans}/${OVERFLOW_THRESHOLD}`).join(' · ');
  // 主服读不到就当没满 —— 宁可让人去包月的主服，
  // 也不要因为一次网络抖动就把人放进按量计费的机器。
  // 只要「主服」满员就开放，不要求契约服也满。
  // 契约服常年只有 1–2 人，「两服都满」等于永远不开放，这台按量计费的机器白买。
  const main = results.find((r) => r.name === '主服');
  const open = !!main && main.humans != null && main.humans >= OVERFLOW_THRESHOLD;

  if (!cache || cache.open !== open) {
    try { log?.info?.(`[overflow] ${open ? '开放' : '关闭'}（${detail}）`); } catch { /* 日志坏了不影响判断 */ }
  }
  cache = { at: now, open, detail };
  last = { open, detail };
  return { open, detail };
}

/** 同步取最近一次已知结果（缓存过期也返回它，拿不到时当作「关闭」）。 */
export function overflowOpenSync() {
  return last ? { open: last.open, detail: last.detail } : { open: false, detail: '尚未判断' };
}

/** 后台定时刷新，保证 overflowOpenSync 总是新鲜的。 */
export function startOverflowWatcher({ log, everyMs = CACHE_MS } = {}) {
  const tick = () => { overflowOpen({ log }).catch(() => { /* 下个周期再试 */ }); };
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** 测试用。 */
export function clearOverflowCache() { cache = null; last = null; }
OVERFLOW_JS
echo "  ✅ server/overflow.js"

echo ""
echo "════════ 2) shared/constants.js ════════"
node -e '
const fs=require("fs");
const p=process.argv[1];
let c=fs.readFileSync(p,"utf8");
if(c.includes("OVERFLOW_CLOSED")){ console.log("  已存在，跳过"); process.exit(0); }
const a="  ROOM_FULL: \x27ROOM_FULL\x27,";
if(!c.includes(a)){ console.log("  ❌ 未找到 ROOM_FULL"); process.exit(1); }
c=c.replace(a, a+"\n  /** 溢流服未开放（改编版，2026-10-18）：前两服没满时不放新玩家进来 */\n  OVERFLOW_CLOSED: \x27OVERFLOW_CLOSED\x27,");
const t="  ROOM_FULL: N_(\x27房间已满\x27),";
if(c.includes(t)) c=c.replace(t, "  ROOM_FULL: N_(\x27房间已满\x27),\n  OVERFLOW_CLOSED: N_(\x27这边流量按量计费，主服和契约服有空位时不开放\x27),");
fs.writeFileSync(p,c,"utf8");
console.log("  ✅ 加了 OVERFLOW_CLOSED");
' "$ROOT/shared/constants.js"

echo ""
echo "════════ 3) server/net.js ════════"
node -e '
const fs=require("fs");
const p=process.argv[1];
let c=fs.readFileSync(p,"utf8");
if(c.includes("overflowOpenSync")){ console.log("  已存在，跳过"); process.exit(0); }

// import
if(!c.includes("from \x27./overflow.js\x27")){
  const m=c.match(/import \{ ERR, ERR_TEXT[^}]*\} from \x27\.\.\/shared\/constants\.js\x27;/);
  if(m) c=c.replace(m[0], m[0]+"\nimport { overflowOpenSync } from \x27./overflow.js\x27;");
  else {
    const lines=c.split("\n");
    let last=-1;
    lines.forEach((l,i)=>{ if(/^import .* from /.test(l)) last=i; });
    lines.splice(last+1,0,"import { overflowOpenSync } from \x27./overflow.js\x27;");
    c=lines.join("\n");
  }
}

const s="        session = this.registry.create(name);";
if(!c.includes(s)){ console.log("  ❌ 未找到 registry.create"); process.exit(1); }
const guard=[
"        // 改编版（2026-10-18）：这台是溢流服，主服与契约服都没满时不放新玩家进来。",
"        // 只拦「新会话」—— 带 token 的重连走上面的 resumed 分支，不受影响。",
"        // 判断结果由 startOverflowWatcher 每 15 秒在后台刷新，这里只读，不阻塞握手。",
"        {",
"          const of = overflowOpenSync();",
"          if (!of.open) {",
"            this.log.info(`[net] refuse new player ${name}: overflow closed (${of.detail})`);",
"            this.reply(conn, errorMsg(ERR.OVERFLOW_CLOSED, rid, `overflow server: ${of.detail}`));",
"            return;",
"          }",
"        }",
].join("\n");
c=c.replace(s, guard+"\n"+s);
fs.writeFileSync(p,c,"utf8");
console.log("  ✅ 握手处加了分流检查");
' "$ROOT/server/net.js"

echo ""
echo "════════ 4) server/index.js ════════"
node -e '
const fs=require("fs");
const p=process.argv[1];
let c=fs.readFileSync(p,"utf8");
if(c.includes("startOverflowWatcher")){ console.log("  已存在，跳过"); process.exit(0); }

const lines=c.split("\n");
let last=-1;
lines.forEach((l,i)=>{ if(/^import .* from /.test(l)) last=i; });
lines.splice(last+1,0,"import { startOverflowWatcher } from \x27./overflow.js\x27;");
c=lines.join("\n");

const re=/(\n)(  const server = http\.createServer)/;
if(!re.test(c)){ console.log("  ❌ 未找到 createServer"); fs.writeFileSync(p,c,"utf8"); process.exit(1); }
c=c.replace(re, "$1  // 改编版（2026-10-18）：溢流服每 15 秒刷新一次「主服与契约服是否都满了」，握手时同步读这个结果。\n  startOverflowWatcher({ log });$1$2");
fs.writeFileSync(p,c,"utf8");
console.log("  ✅ 启动 watcher");
' "$ROOT/server/index.js"

echo ""
echo "════════ 5) 语法检查 ════════"
for f in shared/constants.js server/net.js server/overflow.js server/index.js; do
  if node --check "$ROOT/$f" 2>/dev/null; then echo "  ✅ $f"; else echo "  ❌ $f"; fi
done

echo ""
echo "════════ 6) 实测判断逻辑 ════════"
cd "$ROOT" && node --input-type=module -e '
import { overflowOpen, OVERFLOW_THRESHOLD } from "file://'"$ROOT"'/server/overflow.js";
console.log("  门槛:", OVERFLOW_THRESHOLD, "人");
const r = await overflowOpen({ log: { info: (m) => console.log("  " + m) } });
console.log("  当前:", JSON.stringify(r));
'

echo ""
echo "════════ 完成 ════════"
echo "  备份: $BAK"
echo "  下一步: systemctl restart stronghold"
