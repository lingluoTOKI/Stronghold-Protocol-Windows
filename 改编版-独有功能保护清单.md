# 改编版「独有功能」保护清单（官服 0.2.3 纯净基线 + 独有功能）

- 分支：`clean/vanilla-0.2.3-plus`，基点 = 官服上游 `1db8e510`（0.2.3）。
- 做法（策略 A）：从官服 0.2.3 纯净基线切出，把下列独有功能当特性补丁重新移植；**不包含任何莱茵生命插件与 vanilla/rhine 双档案分流**。
- 本清单逐项给出：功能 → live 旧实现位置 → 新分支实现位置 → 静态验证结果。
- 验证脚本与原始规格在 `scratch/`（不入库）：`smoke-http.mjs`、`smoke-ws.mjs`、`smoke-sixrules.mjs`、`smoke-presence.mjs`、`check-client-imports.mjs`；四份移植规格在 `scratch/specs/`。

## 本轮已做的自动化验证（全部通过）
| 验证 | 范围 | 结果 |
|---|---|---|
| `node --check` 全量 | server/、shared/、public/js、scripts、tools 所有 js/mjs | 全部通过 |
| 启动冒烟 | `startServer({port:0})` 启动→关闭 | BOOT_OK / CLOSE_OK |
| HTTP 集成 `smoke-http.mjs` | `/healthz`、`/api/healthz`、CORS、`/api/online`、`/api/announcements`、admin 鉴权 | 11/11 通过 |
| WebSocket 端到端 `smoke-ws.mjs` | 6 真人建房坐满 6 座；2 人排队+补 AI 成 6 座 | 7/7 通过 |
| 六人数值规则 `smoke-sixrules.mjs` | 开局少 BAN、血池×200%、存活缩放 | 9/9 通过 |
| 功能符号落地 `smoke-presence.mjs` | 服务端/客户端/monitor 关键符号、新增文件、禁用符号 | 60/60 通过 |
| 客户端导入图 `check-client-imports.mjs` | public/js + shared 共 535 个项目内 import | 0 缺文件/缺导出 |
| vendor 离线构建 | `node tools/vendor.mjs` 生成 pixi/preact/hooks/htm/three | 成功（纯离线） |
| 禁用符号 grep | dataProfile/rhineEnabled/maxSeatsFor/setRhine/rhine*/卡兹戴尔/dpdns/SP_PROXY_TO | server/shared/public/scripts/根文件 **0 命中** |

> 未做（按你的要求留给你实测）：浏览器内真实对局玩法与视觉/手感（素材 `public/assets` 未下载、未起浏览器）、monitor 对真实玩家踢人、launcher 交互菜单与安卓打包。下方每项已尽量用数据级/接口级测试替代。

---

## 1. 六人房 / 六人匹配（全套规则）
| 子项 | live 旧位置 | 新分支位置 | 验证 |
|---|---|---|---|
| 房间容量=6（座位/加入/机器人/踢人/观战） | live `server/lobby.js` `maxSeatsFor(rhineEnabled)`（挂在莱茵开关上，且 rollback 已半失效） | `shared/constants.js` `MAX_SEATS=6`；`server/lobby.js` Room/seats/freeSeat/join/addBot 统一按 MAX_SEATS，**无任何标志分流** | WS：空房 seats 长度 6、6 真人坐满 ✅ |
| 开局占用席位数（人机同计） | live `Match.js` | `server/match/Match.js:248-256` 按 seats 的 playerId 去重数 `startingPlayerCount` 传 `GameData` | 导入图/数据级 ✅ |
| 第三行「九张悬赏」 | live `choices.js largeRoomBountyCards` | `server/match/choices.js`：非单人且开局≥5 人，bounty 在基础 6 张上追加 I/II/II 三档凑 9；`shared/protocol.js` `g.choice` idx 上限 5→8；客户端 `public/js/ui/choiceOverlay.js` `spov__grid--many` + `public/css/screens/game-panels.css` | 符号落地 ✅；**9 张牌实际渲染留你实测** |
| 开局少 BAN（5 人少1/6 人少2/最少0） | live `shared/openingBans.js`（基础值被改成 1/4） | 新 `shared/openingBans.js`（**基础值对齐官服** FUNNY0/NORMAL·HARD·ABYSS core3，仅做人数减免）；`gamedata.js bans()` 接入；大厅 `screens/lobby.js` openingBanNote 预览 | 数据级：NORMAL 4/5/6 人 core=3/2/1、addon 恒 4、FUNNY 6 人=0 ✅ |
| 第 10/12/14 回合信标（14 回合领完立即转商店） | live `phases.js`/`builtinMeta.js` | `server/match/match/phases.js` `SIX_PLAYER_BEACON_ROUNDS={10,12,14}`、`ROUND_BEACON_ITEM='chess_item_5_04_e_a'` + 发放块（`acquireItem`+`meta.sixPlayerBeaconRound`+`counters` 防重发）；`server/match/builtinMeta.js` 14 回合立即 `grantChess`+`giftTicker` | 符号落地、node --check ✅；**回合触发留你实测** |
| 首领/最终攻势共享血池=四人基准×200% | live `gamedata.js sixPlayerHp` | `server/match/gamedata.js bossPoolShare()` 叠 `sixPlayerHp = startingPlayerCount===6?2:1`；`finalAssault.js pairPlayers`/fieldId 通用，6 人自动产生第三场 b3（无需特判） | 数据级：4 人满血池=4、6 人=8（×2）✅ |
| 场上最多四人位（部署位） | live 未改部署 | **保持官服 `deployCap=8` 不变**（`gamedata.js`/`config.json` 未触碰） | ⚠️ 口径疑点见文末，待你确认 |
| 淘汰后血池随存活人数缩放 | live `bossPoolShareOf`/`bossRounds` | 沿用官服 `gamedata.js bossPoolShareOf`（`aliveFull=4` 封顶 `coop×min(alive,4)`），再与六人 ×2 相乘；`bossRounds.js bossPoolHp(gd,bossId,alive.length)` | 数据级：6 人存活 4/3/2/1 → 血池 8/6/4/2 ✅ |
| 客户端 6 座/队伍条 | live room.js/teamPanel.js（混莱茵） | `screens/room.js` `--seat-count` + `public/css/screens/room.css`（6 座网格/窄屏两排）；`ui/teamPanel.js` `team--large`（保留官服双击观战）；HUD/血池按 MAX_SEATS 动态派生，无写死 4 | 符号落地 ✅ |

## 2. 战斗倍速 1×/2×/4×
- 新分支位置：`public/js/battle/runner.js`（`SPEED_OPTIONS=[1,2,4]`、`speedControllable`、`userSpeed`、`targetTick`、`reanchor`、`applySpeed`、`setUserSpeed`、`cycleSpeed`）；`public/js/ui/hud.js` `SpeedButton`；`screens/game.js` 透传；`ui/gameLogic/shortcuts.js` 热键 `KeyV`；`public/css/screens/game.css` 按钮样式。
- 机制：纯客户端**播放倍率**（每实秒跑更多固定 `TICK=1/30`），不改 tick 内容/顺序/种子，切速靠 `reanchor` 重锚 t0 保证 `gt` 连续不跳帧；不回传服务端、不影响他人，**确定性安全**。
- 验证：符号落地、node --check、导入图 0 问题 ✅；**切换手感留你实测**。

## 3. 倒计时平滑流动
- 新分支位置：`runner.js battleClock()`（读 `Battle.time/timeLimit`）；`ui/hud.js useBattleCountdown()`（200ms ticker，`ceil((timeLimit-time)/2)`），准备/休整阶段倒计时平滑流动；TopBar 时钟区挂载。
- 验证：符号落地、node --check ✅；**视觉流动留你实测**。

## 4. 跳过本场（单人 + 多人）
- 新分支位置：`runner.js spawnDone()`（以 `battle._pending` 为空 = 怪全部出完才允许跳过）、`skipBattle()→forceEnd('timeout')`；`ui/hud.js SkipButton`（双段确认，未出完置灰）。
- 服务端：**复用官服** `server/sim` 的 `_timeout()` 结算（残存非 Boss 怪记漏、未出完从 total 剔除不扣血、漏怪按 `min(lpCapPerRound,leaks)` 扣 LP 后进入下一买卖回合）；各场独立跳过，无需房主同意。
- 重要：**保留官服 `clientCombat.js verifyJob` 校验与 runner 的 pending/prepare/endBattle 架构**（live 曾删除，未跟随）。默认 `SP_VERIFY=off` 下跳过结果被接受；若运维设 `SP_VERIFY=all`，无头复算可能用自然结局覆盖提前跳过（见文末疑点）。
- 验证：符号落地、node --check ✅；**跳过手感/扣血留你实测**。

## 5. 可拖拽聊天框（表情 + 冷却）
- 新分支位置：新文件 `public/js/ui/chat.js`（`ChatDock`：标题栏拖拽、手柄缩放、位置/尺寸存 `localStorage(sp-chat-pos/size)`、1s 冷却、200 字上限、`[emoji:<id>]` 复用官服表情）；接线 `store.js`/`ui/gameActions.js`/`main.js`（`net.on('m.chat')`）/`screens/game.js`；`ui/gameComponents.js` 补 drag/resize 字形；CSS。
- 服务端：`server/match/match/intents.js` `case 'g.chat'` + `chat()`（`CHAT_COOLDOWN_MS=1000`、`CHAT_MAX_LEN=200`，向同对局所有席位广播 `m.chat{id,name,text,ts}`）；常量在 `shared/constants.js`、消息在 `shared/protocol.js`。
- **与官服表情轮盘 `g.emote` 并存**（live 曾用聊天框顶替表情，已纠正为并存）。
- 验证：符号落地、协议白名单、导入图 0 问题 ✅；**拖拽/表情/广播留你实测**。

## 6. 公告栏（announcements.json 热加载 + 游戏内入口）
- 新分支位置：根 `announcements.json`（干净骨架 `{updatedAt,items:[]}`，无任何莱茵公告）；新文件 `server/http/announcements.js`（按 mtime 懒热读，缺失/损坏返回空公告不 500）；`server/http/routes.js` `GET /api/announcements`；`server/index.js` 装配；客户端 `screens/title.js` `UrgentNoticeHost`（force/forceId 强制弹窗去重、startAt/expireAt 时间窗）+ `BulletinButton`，`screens/lobby.js` 入口，`public/css/screens/title.css`。
- startAt/expireAt 的上下架过滤在客户端，服务端原样透传 items。
- 验证：HTTP `/api/announcements` 200 且文件缺失也安全；骨架校验 ✅；**弹窗视觉留你实测**。

## 7. 在线人数显示
- 大厅在线总数：`server/http/routes.js` `GET /api/online → {online:network.connectionCount}`；客户端 `screens/lobby.js` online-pill 每 5s 轮询。
- 房间人数：走官服 `room.state.seats`（已为 6 座）。
- 验证：HTTP 200 `{online:0}`；WS room.state 6 座 ✅。

## 8. 公共 / 快速匹配
- 服务端：`server/lobby.js` 新增 `matchPool/matchMeta/matchTimers` 三 Map 与 `match.enqueue/cancel/topUp/startNow/waitMore` 五个 case，及 `matchEnqueue/matchCancel/matchTopUp/matchStartNow/matchWaitMore/tryMatch/resolveMatch/formMatchRoom/broadcastMatchStatus/startMatchTimer`；`MATCH_TARGET=6`、`MATCH_TIMEOUT_MS=30000`；AI 补位用官服 BOT_NAMES；S2C 推 `match.status{difficulty,count,target}` / `match.timeout{difficulty}` / `match.found{code,difficulty,target}`。
- 客户端：`screens/lobby.js` 快速匹配按钮、队列状态、超时三选一（补 AI/立即开/再等等）UI 与 CSS。
- 时序：凑齐/补人后 `formMatchRoom` 坐下并置 ready → `broadcastState` 推 `room.state`（客户端据此进房）→ 推 `match.found` → 自动 `startMatch`。
- 协议：`shared/protocol.js` C2S 5 条 + S2C 3 条。
- 验证：WS 端到端——2 人排队 status(count=2,target=6) → topUp → found → 房间 6 座（2 真人+4 AI）✅。

## 9. monitor.html 运维大屏（按房间分组 + 踢人）
- 新分支位置：根 `monitor.html`（**改造为单本机服**：同源/可填服务器地址存 `sp_monitor_base`，token 存 `sp_admin_token`；按房间分组展示玩家、单人踢/一键踢光；已删除三服扇出、公告编辑器、莱茵/原版标签、写死公网 IP 与 `game.lingluotoki.dpdns.org`）。
- 服务端：`server/http/routes.js` 增加 `GET /api/admin/players|kick|kickall|rooms`（token 走 query，sha256+timingSafeEqual 常量时间比较；**未配置 `SP_ADMIN_TOKEN` 一律 403**）；`/healthz` 与别名 `/api/healthz` 加 CORS（`*`）；`server/net.js` 增加 `CLOSE.KICKED=4003`、`banned`、`ban(pid,600s)`、`isBanned()`（握手拒绝被封者）。
- 验证：HTTP——healthz/api-healthz 200 + CORS `*`；无 token/错 token=403；正确 token players/rooms=200；踢不存在玩家=404 ✅；**对真实在线玩家踢人留你实测**。
- 用法：运维以 `file://` 直接打开 monitor.html（靠 CORS 跨域拉接口），无需服务端托管该页面。

## 10. 本机开服 / PC+安卓局域网联机 / 打包
- 新分支位置：新 `scripts/launcher.mjs`（菜单：本机开服/连接服务器/设置/状态，**无公网 proxy**）、`scripts/zipdir.mjs`（通用 UTF-8 zip）；`scripts/launch.mjs` 默认 host 改 `0.0.0.0`（局域网可连）；`scripts/make-windows-bundle.mjs` 在官服版上增补 launcher bat/zipdir/stripWebfonts/`--zip`；根 `启动游戏.bat`/`本机当服务器.bat`/`连接服务器.bat`（`chcp 65001`、切脚本目录、无写死 IP/token）；`package.json` 增 `launcher`/`bundle`/`bundle:zip`。
- 局域网联机：`本机当服务器.bat` 以 `HOST=0.0.0.0` 开服，控制台打印局域网地址，朋友浏览器访问 `http://<本机IP>:3000`；`连接服务器.bat` 输入对方地址。
- 验证：全部 node --check；vendor 离线构建通过 ✅；**launcher 交互菜单、Windows 便携包实压、安卓 APK 留你实测**。
- 明确未纳入（见剥离清单）：`server/http/proxy.js` 公网反代/扇出、android 壳与 APK 签名、dist 产物、莱茵打包脚本。

---

## 需要你拍板的疑点
1. **「最多四人位」口径**：代码里战场可同时上场的部署位是 `deployCap`，官服与 live 均为 **8**，六人改动也未触碰它；房间玩家席位才是 6。你说的"最多四人位"若指"六人房也不放大部署位"，现状已满足（保持 8 不缩放）；若你确实要把部署位改成 4，请明确，我再调（这会偏离官服数值）。
2. **基础 BAN 数值**：live 曾把基础 BAN 改成 FUNNY1/其余4；纯净版已**对齐官服**（FUNNY0/其余3），仅叠加"五人少1六人少2"。若你想保留 live 的基础值 4，告诉我。
3. **SP_VERIFY=all 与跳过**：默认 `SP_VERIFY=off` 跳过正常；若你计划开启 `all` 严格反作弊复算，提前跳过的场次可能被自然结局覆盖。建议该服保持 off/sample；需要的话我可让服务端对 `reason='timeout'` 的提前结束免复算。
4. **公网联机 proxy / 安卓 APK**：本次按"本机开服 + 局域网直连"交付，未移植公网反代扇出与安卓打包。若需要公网联机或出 APK，再单独安排。
