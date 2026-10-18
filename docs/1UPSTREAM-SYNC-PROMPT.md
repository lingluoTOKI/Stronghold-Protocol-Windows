# 上游同步提示词（每次上游更新时，把本文件全文发给 AI）

> 用途：官服上游 `sganggs/Stronghold-Protocol` 发布新版本后，让 AI 把上游更新**完整同步**进本改编版，同时**一个不丢地保留**下列独有功能。直接复制下方分隔线之间的内容发送即可。
>
> **本文件四个部分**：
> 1. `✂` 分隔线之间 —— **发给 AI 的提示词本体**（同步要求 + 执行流程）
> 2. **附：当前基线快照** —— 上次同步到哪个 commit、冲突怎么解的、上游新增了什么机制
> 3. **附二/三** —— 部署踩过的坑、部署流程（每次同步后都要回来看）
> 4. **附四：服务器架构速记** —— `/opt` 运维层、重连窗口、**插件 vs 房间设置**、**带宽与 gzip**、素材包守卫
>
> 最后更新：2026-10-18（同步上游 0.3.1 之后，另加当天的带宽治理与素材守卫）。服务器运维的完整交接见仓库外的 `交接文档-卫戍协议服务器.md`。
>
> **如果只想知道「最近改了什么」，直接跳到「附四」** —— 那里有今天的全部结论：gzip 省 90%、
> BGM 默认关、公告轮询 60 秒、没导入素材不让建房、改动型插件为何不能用。

---

## ✂ ───── 复制以下提示词 ─────

我在维护《卫戍协议：盟约》（明日方舟同人网页联机自走棋，Node 原生 http/WebSocket + Preact + PixiJS/Spine/three.js）的**个人改编版**。现在官服上游发布了新版本，请你帮我把上游更新同步进来，要求如下。

**仓库与路径**
- 改编版工作目录（就在这里改）：`F:\github\Stronghold-Protocol\sp-clean-Stronghold-Protocol`，日常分支 `clean/vanilla-0.2.3-plus`（**不要直接在它上面动**，见执行流程第 2 步）
- 官服上游：`https://github.com/sganggs/Stronghold-Protocol`（master 分支）
- 我的远程 origin：`https://github.com/lingluoTOKI/Stronghold-Protocol-Windows.git`
- 本机 GitHub 直连不通，必须走镜像：`git -c http.sslVerify=false fetch https://ghfast.top/https://github.com/sganggs/Stronghold-Protocol.git master`（ghfast.top 不通就换 gh-proxy.com）；用 curl 下载加 `--ssl-no-revoke`。
- Node ≥ 22（本机实测 v24.x），包管理 npm，ESM（`"type":"module"`）。
- **别把 `data/config.json` 整份 print 出来**：上游把它压成单行 JSON，`Select-String`/`cat` 会吐出几万字符淹没上下文。要核对锁定值请用正则直接抽字段（见文末「常用命令」的 deployCap/BAN 一行式）。

**最高原则（冲突时的取舍顺序）**
1. **上游内容必须全量同步、零遗漏**：上游 master 的每一个 commit、每一处机制/数据/渲染/修复都要合进来。战斗模拟（`server/sim/**`）、数据构建（`tools/build-data.mjs`、`data/**`）、官方渲染（`public/js/render/**`）一律**以上游为准**，不得用我的旧实现覆盖上游新逻辑。
2. **我的独有功能一个都不能丢、不能被改坏**（清单见下，共 10 项）。这些是以外挂/补丁方式叠在上游上的，合并冲突时要把它们的"钩子调用点"重新接回上游新代码，而不是直接删掉。
3. **零莱茵生命资料片**：本版是纯净官服 + 独有联机功能，**不要**带回任何莱茵生命盟约/干员/装置、`data/vanilla` 双档案分流、`dataProfile/rhineEnabled` 之类的东西（历史上已彻底剥离）。
4. **锁定的平衡数值不要动**：每人部署位 `data/config.json -> economy.deployCap = 8`（六人房只扩玩家座位到 6，不砍个人部署位）；开局 BAN 用官服基础值（FUNNY 0/1，NORMAL/HARD/ABYSS 3/4，TRAINING 0/0），仅五人核心少 1、六人核心少 2（见 `shared/openingBans.js`，训练不减、最低 0）。
5. **只改代码，别擅自提交**：做完 `node --check`、`npm run check:imports`、本地起服冒烟和浏览器 DOM/网络巡检后，**可以**再跑 `npm run ci` 和 `npm run golden` 作为自检（这两个我会看结果，很有参考价值）；但**不要**擅自 `git commit`（同步分支上的合并提交除外）、`push` 或部署，改完告诉我，我验收后再统一提交部署。
   - **跑 `npm run ci` 时务必区分「真失败」和「机器满载抖动」**：性能/时序类断言（`test/sim/perf.test.js`、`test/sim/robustness.test.js`、`test/match/realtime.test.js`）在并行满载时会踩线报错，**单独重跑就过**。报告前请对每个失败项单独重跑一次，别把抖动当成改编版改坏了。
   - **上游自带的 Windows 路径 bug 已于 2026-10-13 修掉**：`test/scene-assets.test.js` 与 `test/lobby.test.js` 曾用 `new URL(import.meta.url).pathname` 拼 `ROOT`，在 Windows 上得到 `F:\F:\...` 而 ENOENT（全仓 165 个测试用正确的 `fileURLToPath`，只有这 2 个是异类）。现已改为 `fileURLToPath`。**若上游后续版本又把这 2 个文件覆盖回旧写法，请照此再修一次**（合并时注意别把上游的旧写法带回来）。
6. 部署铁律（供你判断，本轮先不执行）：绝不动服务器 `node_modules` 和 `public/assets`；改了 server/shared 需 `systemctl restart stronghold`。

**我必须保留的 10 项独有功能及其代码落点（合并后逐项 grep 自检）**
1. **六人房全套**：`shared/constants.js` `MAX_SEATS=6`；`server/match/choices.js` `largeRoomBountyCards`（开局≥5人悬赏在基础 6 张上补 I/II/II 三档凑 **9 张**）；`shared/openingBans.js` + `server/match/gamedata.js`（五人少1/六人少2 BAN；六人 boss 共享血池 = 四人基准 ×200%，并与上游按存活人数缩放叠加）；`server/match/match/phases.js` `SIX_PLAYER_BEACON_ROUNDS={10,12,14}`（R10/R12/R14 每位存活玩家发信标道具，R14 那枚领完立即转干员并进商店）。
2. **1×/2×/4× 战斗倍速**：`public/js/battle/runner.js`（cycleSpeed，本地确定性模拟，改倍率即可）+ `public/js/ui/hud.js` SpeedButton（循环 1×→2×→4×，非默认 2× 时高亮）。要求切换丝滑。
3. **倒计时流动**：倍速下战斗倒计时按真实时钟平滑走（`public/js/screens/game.js` countdown 相关）。
4. **跳过本场**：`runner.js` `skipBattle`/`skipReady`（**敌人全部出场后**才能跳；单人+多人都可跳；联防/Boss 关不可用；单人长时间未结束按残存怪冲家扣血直接进下一轮买卖）。HUD 按钮与二次确认在 `hud.js`。
5. **可拖拽聊天 + 表情**：`public/js/ui/chat.js`（左下角单个绿色「交流」按钮，可拖拽）、协议 `g.chat`、`shared/constants.js` `CHAT_COOLDOWN_MS/EMOTE_COOLDOWN_MS/CHAT_MAX_LEN`、`server/match/match/intents.js`。
6. **公告栏（热加载）**：根 `announcements.json`（`{updatedAt,items[]}`，支持 force/forceId/startAt/expireAt）、`server/http/announcements.js`、`server/index.js` announceApi、`server/http/routes.js` 只读 `GET /api/announcements` + 管理接口、`public/js/screens/title.js` 公告弹窗与信封按钮（图标 `public/js/ui/components.js` 的 ICONS.mail）。
    - **每次同步顺手更新公告文案**：在 `items[0]` 用新版本号插一条（沿用 `【本次重点】/【官服同步（x.y.z）】/【进入游戏 & 说明】` 结构，内容照上游 `CHANGELOG.md` 对应章节提炼），旧条目保留在后面，并更新顶层 `updatedAt`。改完用 `GET /api/announcements` 确认能解析出多条。
7. **在线人数**：`server/http/routes.js` `GET /api/online`，前端 5s 轮询。
8. **公共/快速匹配**：`server/lobby.js` 匹配队列（`MATCH_TARGET=6`、`MATCH_TIMEOUT_MS=30000`，凑满即开；超时三选一：继续等待 / 用 AI 补满 / 按当前人数直接开），协议 `match.enqueue` 等。
9. **监控大屏 monitor.html**：按房间分组玩家、单人踢/一键踢全、三服务器切换、公告编辑器（发布/撤回强制公告）；对应服务端 `routes.js` 的 `/api/admin/*`（players/rooms/kick/kickall/**room/close**/announce/announce-clear，`SP_ADMIN_TOKEN` 鉴权）与 `/healthz` CORS。
    - **鉴权走 query 参数 `?token=`，不是 HTTP header**：用 header 测会得到 403，别误判成鉴权坏了。`/api/admin/room/close` 是 **GET** 且需 `code=<4位房间号>`（无 token 403 / code 非法 400 / 房间不存在 404 / 房内有人且无 `force=1` 则 409）。
    - **⚠️ 0.3.0 起 CSP 会拦内联脚本**：上游 0.3.0 加了严格 CSP（`script-src 'self' 'sha256-<importmap-hash>'`），monitor.html 的内联 `<script>` 会被浏览器直接拦截（页面打开但数字全 `--`）。**必须把 JS 抽到外部文件**（`public/js/monitor.js`），HTML 只留 `<script src="/js/monitor.js"></script>`。合并时若上游改动了 CSP 策略，注意别把这个外部化改回内联。
    - **⚠️ CSP 也拦 `onclick=` 内联属性**（2026-10-18 踩过）：不只是 `<script>` 标签，HTML 元素上的 `onclick="saveToken()"` 这类内联事件处理器同样被拒绝执行，报
      `Executing inline event handler violates the following Content Security Policy directive 'script-src …'`。
      表现极隐蔽：页面显示正常，但按钮点了毫无反应——「保存 token」因此存不进 localStorage，刷新就丢。
      **合并后必查**：`grep -c 'onclick=' public/monitor.html` 应为 0；事件统一在 `monitor.js` 的 `bindUi()` 里用 `addEventListener` 绑定。
    - **运行保护面板的数据不在本项目里**：大屏上那两块「运行保护」（可用内存 / 本服占用 / 对局上限 / 无人房间）
      来自服务器上的 `stronghold-control.service`（`/opt/stronghold-stability/control.py`，只监听 127.0.0.1:31998），
      经 nginx 的两个精确路径 `/api/admin/stability` 与 `/api/admin/stability/control` 转发。
      **不要在 `routes.js` 里重复实现**——nginx 的精确匹配会先命中 31998，写了也不会被调用（2026-10-18 白写过一次）。
    - **「重启服务」按钮是本改编版加的**（运维层 README 明确「没有重启功能」）：`routes.js` 的
      `GET /api/admin/restart`，需 `SP_ALLOW_RESTART=1`（在 `service.d/monitor-ops.conf`）才启用，否则 409；
      先刷响应再 `process.exit(0)`，由 systemd `Restart=always` 拉起。**升级上游时 `routes.js` 被整份覆盖会把这段冲掉**，
      2026-10-18 就丢过一次，合并后 grep 确认：`grep -c 'api/admin/restart' server/http/routes.js` 应为 1。
10. **本机/PC/安卓联机脚本**：根目录 `本机当服务器.bat`、`启动游戏.bat`、`连接服务器.bat`（共 3 个 bat；含便携 node 探测、局域网共享）、`scripts/launcher.mjs`、`scripts/launch.mjs`、`scripts/make-windows-bundle.mjs`、`scripts/zipdir.mjs`、`tools/dist.mjs`、`scripts/launcher.config.json`。**联机（本机客户端）模式**：`server/http/proxy.js`（`SP_PROXY_TO` / `opts.proxyTo`：`/ws` 与 `/api/*` 反代中心服务器，页面与素材走本机磁盘，`/healthz` 不转发）+ `server/index.js` 接线 + `routes.js` / `websocket.js` 两条转发 + `launcher.mjs --mode proxy` + 打包 `--upstream` 生成的 `连接主服务器.bat`。**上游地址只从包内 `scripts/launcher.config.json` 的 `upstream` 读，不吃命令行 / URL 参数**（会话凭证按 origin 存）。
    - **⚠️ 监听地址铁律（曾经手滑改坏过）**：`scripts/launch.mjs` 必须保持 `host: process.env.HOST || '::'`，服务端 `server/http/config.js` 的 `DEFAULT_BIND_HOST = '::'`。**`'::'` 是双栈**，改成 `'0.0.0.0'` 会只收 IPv4、**IPv6 玩家连不上本机开的服**。合并后务必用 `Select-String scripts\launch.mjs -Pattern "env\.HOST \|\|"` 确认仍是 `'::'`。

**执行流程（一步步来，每步给我看结果）**
1. `git fetch` 上游 master（走镜像），记录上游最新 commit；用 `git merge-base --is-ancestor <上游最新> HEAD` 和 `git log --oneline HEAD..<上游最新>` 确认**哪些是上游新 commit**（同步前先告诉我数量和标题）。
2. 从当前分支新建同步分支（如 `sync/upstream-<版本号>`），不要直接在主分支上动。
3. 合入上游（merge 或按 commit cherry-pick）。**先打备份标签**（`git tag -f pre-sync-<版本> HEAD`）再动手，方便随时回退。建议 `git merge --no-commit --no-ff <上游最新>` 后先看冲突面。逐文件解决冲突：
   - `server/sim/**`、`tools/**`、`public/js/render/**`、官方数据 → 采用上游版本，再把我独有功能的调用钩子重新接上；
   - 独有文件（chat.js、openingBans.js、monitor.html、announcements*、`server/http/proxy.js`、launcher/打包脚本、3 个 bat、`改编版-*.md`、`docs/RHINE-REMOVAL.md`）→ 保留我的；
   - 交叠文件（lobby.js、Match.js、choices.js、gamedata.js、phases.js、intents.js、runner.js、hud.js、game.js、title.js、routes.js、index.js、constants.js、protocol.js）→ 以上游新逻辑为底，把 10 项独有补丁重新合入，保证上游新改动不被覆盖。
   - 实操提示：冲突多半是**双方各自新增**（如 `.gitignore` 两边各加一条、`protocol.js` 两边各加消息名），这种**两边都保留**即可，不要二选一。
   - **解决完必须全局搜残留标记**：`git grep -n -E "^(<<<<<<<|>>>>>>>)"`（应为空）。注意：**只 `git add` 不等于解干净**，标记还在文件里就会进提交。
   - **自动合并 ≠ 没被吞**：两边改同一文件但不同区域时 Git 会静默合并，可能把钩子挤掉。合完要对每个交叠文件人工确认「上游新逻辑」和「我的钩子」都在（例如 `gamedata.js` 里我的 BAN 与上游新增方法应并存、`phases.js` 里我的信标与上游新 `bossPairs` 应并存）。
4. 若上游改了数据结构/字段（例如 config 新增字段），运行 `node tools/build-data.mjs` 重建 `data/**`，再确认独有数值（deployCap=8、BAN）仍在。**重建后若 `git status` 无 diff，说明上游数据结构没变，不必提交 data**；另注意 `data/**` 应与上游逐字节一致（`git diff --stat <上游最新> HEAD -- data/` 应为空）。
5. **美术资源不入库**：`public/assets/**`、`public/fonts/**`、`data/assets.json`、`data/local-assets.json`、`data/local-fx.json` 在 `.gitignore` 内，属于部署/本地资源，不要提交、不要删；3D 棋盘靠 `data/local-assets.json` + `public/assets/local/`；0.3.0 起官方战斗特效靠 `data/local-fx.json` + `public/assets/local/fx/`（缺失会静默回退 2D/原版特效、没有橙色栏杆）。
6. 自检：对改动的 js 跑 `node --check`、`npm run check:imports`；本地 `PORT=31xx SP_ADMIN_TOKEN=test` 起服，curl 冒烟 `/healthz`（版本号应为新版本）、`/api/online`、`/api/announcements`、admin 接口鉴权（无 token 403、`?token=` 正确 200）；浏览器清 Service Worker+caches 硬刷新，巡检标题页/建房页/战场无 404、无 console error。
   - `npm run check:imports` 有 3 条 `server/sim/nodeData.js: node:fs/path/url [sim-node]` 违规是**上游既有的、被上游 `test/check-imports.test.js` 白名单认可的**，退出码 0，不是合并引入的问题。
   - **强烈建议加跑 `npm run golden`**：黄金结果全绿是「上游战斗改动没被我的六人房补丁改坏」的最有力证据。若有场景变动，必须能说清是上游有意改动还是我误伤。
7. 合并后**重新逐项核对上面 10 项功能**（grep 关键符号都还在），并确认 `git diff --diff-filter=D <上游最新>` 没有删掉任何上游文件、也没有混入任何莱茵/双档案文件。
   - **莱茵搜索结果要会甄别**：搜 `rhine` 会大量命中**上游自己的官方干员 kit**（「莱茵生命」是官服 `character_table` 的 groupId，如 `chess_char_6_11-mlyss.js`、`op-slent2.js`、`op-ifrit.js`），这些**不是**要剥离的资料片。真正的判据是搜 `rhineEnabled` / `dataProfile` 这两个**代码符号**，应为零命中。
   - 另确认 `git merge-base --is-ancestor <上游最新> HEAD` 返回 0、`git rev-list --count HEAD..<上游最新>` 为 0（上游零遗漏）。
8. 给我一份"上游同步了什么 + 冲突怎么解的 + 10 项功能自检结果 + 待我实测清单"的报告，**先不要提交/部署**，等我跑对局验收。报告请顺带说明：本次跑过的自检命令与结果、`npm run ci` 的失败项判定（真失败还是抖动）、以及需要我拍板的事项。

**注意**：如果上游某个改动和我的独有功能在设计上直接冲突（无法同时满足），不要自己拍板，列清楚两种取舍给我决定。

## ✂ ───── 复制到此结束 ─────

---

## 附：当前基线快照（AI 核对用，会随版本过期，以实际 fetch 为准）

- **最近一次同步：2026-10-18；上游 master 最新 = `d905c146`（0.3.1，2026-10-18）**，已合入分支 `sync/upstream-0.3.1`（合并提交 `e9447bb0`，双父 `cd5636e5` + `d905c146`），**已确认是改编版 HEAD 的祖先、上游 commit 零遗漏、零删除文件**。备份标签 `pre-sync-0.3.1`。
- 更早的同步基点：`c24e17ee`（0.3.0）、`488db49f`（0.2.6）、`cf7a9400`（0.2.5）、`bc50cac0`（0.2.4）、`1db8e510`（0.2.3）。
- **0.3.1 带来 200 个新 commit / 520 个文件改动**（从 0.3.0 算起），本改编版同区间改了 114 个文件。
  41 个文件两边都动过，其中 **14 个是真冲突**：

  | 文件 | 冲突性质 | 解法 |
  |---|---|---|
  | `shared/protocol.js` | 双方各加消息 | 保留我方 `g.choice` idx≤8（六人房九张悬赏）+ 上游 `g.offer` / `g.offerRefresh` |
  | `public/js/main.js` | 两边各加 import | 合并：`UrgentNoticeHost`（公告栏）+ `joinKnown`（上游） |
  | `public/js/ui/hud.js` | 我方函数 + 上游 JSDoc 首行 | SpeedButton/SkipGlyph/SkipButton 整段移到 `TopBar` 注释之前，注释各自完整 |
  | `public/js/screens/lobby.js` | 导入 + `create()` | 导入合并；`create()` 同时含公共匹配分支与上游 `test` 参数 |
  | `server/lobby.js` | 两边各加 import | 合并 `MATCH_TARGET`/`MATCH_TIMEOUT_MS` + 上游 `checkSkinSelection`/`operatorCharIds` |
  | `public/js/ui/choiceOverlay.js` | 两边各加 DOM 块 | 我方「决策顺序」栏 + 上游 `spov__grid` 容器并存 |
  | `scripts/launch.mjs` | 上游加函数 + 我方注释 | 上游 `warnTestMode` 在前，我方 `printShare` 注释接后 |
  | `server/match/Match.js` | 两边各加构造参数 | 我方六人座 `startingSeatCount` + 上游 `kitted`/`rules` 并存 |
  | `public/css/screens/result.css` | 两边各加样式块 | 我方伤害看板 + 上游 `modmark` 并存 |
  | `test/match/fuzz.test.js` | 两边各加 case | `g.chat` + `g.offer` 并存 |
  | `public/i18n/{en,ja,ko,zh-TW}.json` ×4 | 两边各加键 | 合并为一段，注意前段补逗号 |

- **0.3.1 上游新增的重要机制（合并时必须保留、不要覆盖）**：
  - **官方结算页**：雷达开场、个人战报、同盟页，卫戍认证按官方 60 级表（`#698`）
  - **皮肤系统**：每座位可选干员皮肤，设置里「显示其他玩家的皮肤」默认开（`#686`/`#667`）
  - **异形屏适配**：四个滑块，把界面从挖孔/刘海往里收（`#699`）
  - **素材存储**：设置里可查看并申请浏览器持久保存（`#703`）
  - **悬赏决策改版**：机变按官方样式，决策顺序显示在队伍栏头像（`#695`）
  - **S.W.E.E.P. 报告** + 敌人图鉴按官方评级（`#696`）
  - **Forge 导入 U1–U6**：隐藏棋子、普通/精锐双形态 id、借用官方干员的头像立绘模型语音
  - **内容插件四规则**：`shopBias` / `prepLoadout` / `morphPairing` / `unequip`
  - **音效改用官方音库**：各音库独立同时播放上限、替换最旧、音高范围、延迟播放
  - 大量官方特效修正（余三技能火墙、缪尔赛思流形、瑕光、野鬃、诅咒娃娃、斯卡蒂海嗣、狼群、归溟幽灵鲨…）

- **已知待优化（不影响兼容，下次可处理）**：
  - **倍速切换不丝滑**：4× 切 1× 时渲染插值速率骤降，视觉顿挫。reanchor 数学上游戏时间连续不跳，但渲染层插值器没有平滑过渡。改这个需要动渲染层插值器，风险大，暂未处理。

- **改编版在 0.3.1 之上新加的东西（合并时要保住）**：
  - **首领血量挡位**：`shared/constants.js` `BOSS_HP_OPTIONS = [1, 3.25]`、`shared/protocol.js`
    `room.setBossHp`、`server/lobby.js` `setBossHp` + `Room.bossHp` + `room.state.bossHp`、
    `server/match/Match.js` 传 `opts.bossHp`、`server/match/gamedata.js` 构造函数第 4 参数
    `bossHpOverride`（在 `bossPoolShare()` 里乘上去）、`public/js/screens/room.js` `BossHpPicker`
    + `public/css/screens/room.css` `.bosshp`。**这是「房间设置」而不是插件**——理由见附四。
  - **素材包守卫**：`public/js/screens/lobby.js` `requireAssetPack()`，拦 `create` / `join` / `startMatch`。
  - **BGM 默认关**：`public/js/ui/gameLogic/settings.js` `DEFAULT_SETTINGS.bgm = 0`、
    `public/js/audio.js` `this.volumes.bgm = 0`。
  - **公告轮询 60 秒**：`public/js/screens/title.js` 的 `setInterval(load, 60000)`（原 10 秒）。
  - **监控大屏「重启服务」**：`server/http/routes.js` `GET /api/admin/restart`（需 `SP_ALLOW_RESTART=1`）
    + `public/monitor.html` 两个按钮 + `public/js/monitor.js` `restartService()`。
    **升级上游时 `routes.js` 被整份覆盖会冲掉它**，2026-10-18 就丢过一次。

- **本次验证结论**：446 个 js/mjs `node --check` 全过；4 个 i18n JSON `JSON.parse` 通过；
  `npm run check:imports` 退出 0；`npm run golden` 全绿（49/46/22/21/10/140 场景）；
  `rhineEnabled`/`dataProfile` 代码内零命中；无删除文件。

---

## 附二：部署时踩过的坑（每次同步都回来看一眼）

> 下面这些都是 2026-10-18 同步 0.3.1 时**真实发生过**的，不是假想。服务器运维的完整交接
> 见仓库外的 `交接文档-卫戍协议服务器.md`，这里只留与「同步 + 部署」直接相关的。

### 坑 A：部署包按目录手写清单 → 漏目录 → 服务起不来

第一次部署 0.3.1 时，部署包只包含了
`server/ shared/ public/js public/css public/i18n tools/ scripts/ test/ docs/`，
**漏掉了 `public/studio/`、`public/dev/`、`public/icons/`、`public/vendor/`，
以及 `public/index.html`、`public/sw.js`、`public/manifest.json`**。

后果：`server/studio/authoring.js` 找不到 `public/studio/js/presentation.js`：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/root/stronghold/public/studio/js/presentation.js'
  imported from /root/stronghold/server/studio/authoring.js
```

systemd `Restart=always` 把它拉进重启循环（40 秒内重启 4 次），**服务完全不可用**。
回滚到 0.3.0 才恢复，补全目录后第二次部署成功。

**正确做法**——按目录枚举，不凭记忆：

```bash
ls -d public/*/     # 看清楚有哪些目录
```

必须排除的只有：`public/assets/`（3 万+ 素材）、`public/fonts/`、`public/assets.zip`（打包产物）。

### 坑 B：`git add -A` 带上 781 MB 的 `public/assets.zip`

`public/assets.zip` 是 `tools/package.mjs` 的产物，**没在 `.gitignore` 里**。
`git add -A` 把它加进暂存区后 push 被 GitHub 拒绝：

```
remote: error: File public/assets.zip is 781.48 MB; this exceeds GitHub's file size limit of 100.00 MB
remote: error: GH001: Large files detected.
```

已补进 `.gitignore`。以后提交前先扫一遍大文件：

```bash
git diff --cached --name-only | while read f; do
  [ -f "$f" ] && [ "$(stat -c%s "$f" 2>/dev/null || echo 0)" -gt 52428800 ] && echo "大文件: $f"
done
```

### 坑 C：CSP 不只拦 `<script>`，也拦 HTML 里的 `onclick=`

0.3.0 起有了严格 CSP。已知要外部化 `<script>`，但**很多人会忽略内联事件处理器也会被拦**：

```
Executing inline event handler violates the following Content Security Policy
directive 'script-src 'self' 'sha256-…'
```

监控大屏原本 8 个按钮全用 `onclick="saveToken()"` 这种写法，**浏览器直接拒绝执行**。
表现很隐蔽：页面正常显示，但点「保存」token 毫无反应 → token 存不进 localStorage → 刷新就丢。

**合并后要检查 `public/monitor.html` 里是否还有 `onclick=`**：

```bash
grep -c 'onclick=' public/monitor.html   # 应为 0
```

所有事件统一在 `public/js/monitor.js` 的 `bindUi()` 里用 `addEventListener` 绑定。

### 坑 D：打包产物、日志、测试残留混进提交

`.playwright-cli/`、`output/`、`public/assets.zip` 等都在 `.gitignore` 里，
但如果新增了别的产物目录，记得同步补 `.gitignore`，别靠 `git status` 事后发现。

---

## 附三：部署流程（同步完成、验收通过后）

> 本文件顶部「最高原则」第 5 条说**不要擅自部署**——下面是在**维护者明确同意后**才执行的步骤。

1. **先确认有没有人在玩**

   ```bash
   curl -s "http://127.0.0.1:3000/api/admin/rooms?token=<SP_ADMIN_TOKEN>" | node -e '…'
   ```

   看 `connectedHumans > 0` 的房间。有人的话**先问**，别自作主张重启——重启会打断对局，
   玩家只会看到「掉线」。

2. **备份当前可运行状态**（可秒回滚）

   ```bash
   BK=/root/backups/deploy-$(date +%Y%m%d-%H%M%S) && mkdir -p $BK
   tar -czf $BK/code-before.tgz -C /root/stronghold \
     --exclude=public/assets --exclude=public/fonts --exclude=node_modules \
     --exclude=plugins --exclude=data/assets.json --exclude=data/local-assets.json \
     --exclude=data/local-fx.json server shared public tools scripts data package.json
   ```

3. **解包后立刻校验**

   ```bash
   node -e 'console.log(require("/root/stronghold/package.json").version)'   # 应是新版本
   node --check /root/stronghold/server/http/routes.js
   ls /root/stronghold/public/studio/js/presentation.js                      # 坑 A 的检查点
   ```

4. **确认受保护文件还在**：`public/assets`、`data/assets.json`、
   `data/local-assets.json`、`data/local-fx.json`、`announcements.json`、`plugins/`。

5. **重启并按端口冒烟**

   ```bash
   systemctl restart stronghold && sleep 12 && systemctl is-active stronghold
   curl -s localhost:3000/healthz          # app 应为新版本
   curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/online
   curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/announcements
   curl -s -o /dev/null -w '%{http_code}' "localhost:3000/api/admin/rooms?token=<TOKEN>"   # 200
   curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/admin/rooms                    # 403
   journalctl -u stronghold --since "2 min ago" | grep -icE "error|cannot|fail|ERR_"        # 应为 0
   ```

6. **回滚**（如果起不来）

   ```bash
   systemctl stop stronghold
   tar -xzf /root/backups/deploy-<时间>/code-before.tgz -C /root/stronghold
   systemctl start stronghold
   ```

### 一句话记住部署范围

| 类别 | 内容 | 要不要重启 |
|---|---|---|
| **代码** | `server/` `shared/` `public/js` `public/css` `public/i18n` `public/studio` `public/dev` `public/icons` `public/vendor` `public/*.html` `public/sw.js` | `server/` `shared/` 改了**要**；纯前端只刷新页面 |
| **数据** | `data/*.json`（**排除** `assets.json` / `local-assets.json` / `local-fx.json`） | 要 |
| **热加载** | `announcements.json`、`plugins/`、`public/monitor.html` `public/js/*.js` `*.css` | **不要**，改完即生效 |
| **绝不动** | `public/assets/` `public/fonts/` `node_modules/` `plugins/`（指目录内容）`data/assets.json` `data/local-*.json` | — |

---

## 附四：服务器架构速记（避免重复造轮子）

排查或实现任何「服务器上缺什么」之前，**先看这个再动手**。
2026-10-18 就因为只 `grep /root/stronghold/server/`、没查 `/opt/`，
误判「运行保护面板没有服务端实现」，把已经存在的 stability 接口又写了一遍，纯属白费功夫。

**本附四还收录了几件「看着该做、其实别做」的事**，都是那天实测踩出来的：

| 想做的事 | 别做的原因 |
|---|---|
| 给 `/assets/` 加长缓存 | 已经有 `immutable` 一年，先 `curl -D -` 看响应头 |
| 把首领血量做成插件 | 插件必进 `cs` → 强制子进程 → 小机器出「不出怪」 |
| 把重连窗口设小（只设 solo） | `windowOf()` 只取较大值，基础窗口会盖掉 |
| 在大厅加提示条引导导入素材 | 维护者要的是**拦截**，不是横幅 |
| 以为服务器被打了 | 24 次重启是部署失败的重启循环，不是流量 |

```
stronghold.service
  └─ ExecStart = /usr/local/bin/node /opt/stronghold-stability/start.mjs
       │          ↑ 启动入口不是 server/index.js！
       ├─ admission.mjs        开局保护（maxMatches / maxRooms / RSS / 事件循环延迟）
       │                       资源紧张时暂缓新开局，不影响已有对局与重连
       └─ stronghold-control.service   127.0.0.1:31998（Python control.py）
            └─ 只做「暂停开局」，README 明确「never restart/kick/close」

nginx  location = /api/admin/stability          → 127.0.0.1:31998   （Python 运维层）
       location = /api/admin/stability/control  → 127.0.0.1:31998   （Python 运维层）
       /api/admin/restart                       → 127.0.0.1:3000    （Node，改编版自己加的）
```

`start.mjs` 里还传了几个关键参数（换机器时**必须一并搬过去**）：

```javascript
const server = await startServer({
  maxRooms,
  reconnectWindowMs: 60000,        // 基础重连窗口 10 分钟 → 60 秒
  soloReconnectWindowMs: 60000,    // 单人局 24 小时 → 60 秒（两个都要改，见下）
});
```

**排查「服务器上某个功能」的检查顺序**：

```bash
ls /etc/systemd/system/stronghold.service.d/      # 有哪些 drop-in
systemctl show stronghold -p ExecStart            # 真正的启动入口
ls /opt/                                      # 运维层可能在这里
grep -rn <关键词> /root/stronghold/server/     # 最后才看项目目录
```

### 掉线重连窗口：只能延长，不能缩短（★★★ 极易踩）

`server/net.js` 的 `windowOf()`：

```javascript
const own = s.resumeWindowMs;
return typeof own === 'number' && own > this.reconnectWindowMs ? own : this.reconnectWindowMs;
```

- `reconnectWindowMs` 是**基础窗口**（`NET_DEFAULTS` 里 10 分钟，官方值）。
- `soloReconnectWindowMs` 是**单人局的官方 24 小时**（`config.constants.singleReconnectTime`）。
- 取**较大值**，所以把 solo 那个设成 60 秒**毫无效果**——被 10 分钟基础窗口吃掉。

2026-10-18 踩过：只改了 `soloReconnectWindowMs`，空房间还是留 10 分钟以上，白折腾半天。

**要缩短清理时间，两个都要改**（在 `/opt/stronghold-stability/start.mjs`）：

```javascript
const server = await startServer({ maxRooms, reconnectWindowMs: 60000, soloReconnectWindowMs: 60000 });
```

清理链路（改了窗口后自动跟着变快）：

```
sweep 每 min(15s, reconnectWindowMs/4) 跑一次
  → SessionRegistry.sweep() 找过期会话
  → lobby.onExpire() → removeMember()
  → 房间无人 → disposeRoom('empty')
```

实测 `reconnectWindowMs=60000`：无人房间从掉线到消失 **约 60–75 秒**。

> ⚠️ `SP_SOLO_RECONNECT_MS` 环境变量在 **0.3.1 之后已失效**——上游重写 `server/http/config.js` 时
> 去掉了读它的那段代码。现在只能走 `start.mjs` 传参。旧 systemd 环境变量已清理。

### 公告正文走 URL 参数，太长会 414

`socket` 层 `MAX_URL_LENGTH = 4096`，而 `monitor.js` 发布公告是把正文放进查询参数的：

```javascript
let path = `/api/admin/announce?title=${…}&content=${encodeURIComponent(content)}&force=${…}`;
```

中文经 `encodeURIComponent` 会膨胀约 3 倍，所以正文**控制在 400–500 字以内**。
超过就返回 `414`，大屏上表现为「发布失败」但**没有任何提示**（`Invoke-WebRequest` 甚至会把 404/414 的 HTML 当成成功）。

需要发长公告时直接改 `announcements.json`（热加载，不必走接口）。

### 插件：能做什么、不能做什么

```bash
node tools/plugin.mjs check <id>          # 校验
node tools/plugin.mjs pack <id> --zip     # 产物在 plugins/_dist/<id>-<version>.zip
```

`plugins/*` 在 `.gitignore` 里（服务器自己的插件不入库），只有 `_template/` 被跟踪。
**分发要走 zip，不要发源码文件夹**——`plugin.lock.json` 是完整性校验的一部分。

插件能做的事有边界：`permissions` 里 `data.patch` 可以改 `config` / `chess` / `bonds` 等表，
但房间规则开关只认 `shopBias` / `prepLoadout` / `morphPairing` / `unequip` 四个。

**★★★ 改数据的插件会让房间强制走服务器子进程。** `server/lobby.js:1626`：

```javascript
const match = modded && this.hosts
  ? this.hosts.create(room.content.cs, opts)   // 插件房：起 match host 子进程
  : new this.MatchClass(opts);                 // 普通房：本进程
```

而 `modded` 的判据是 `cs !== vanilla.cs`，`cs` 的哈希输入里有 `plugins: parts`
（`server/plugins/contentSet.js` 的 `contentHashOf`）——**只要加载任何插件就 `modded = true`**，
哪怕这插件只改外观、没动 data。

后果（2026-10-18 实测）：2 核 1.6 GB 的小机器上，每开一个插件房就起一个子进程重新加载
全部数据，表现为**「不出怪」**和客户端红字**「插件卡死，本场由服务器接管」**
（真实日志是 `rejected client result … its content is not named is not the room's <cs>`：
房主中途改了插件设置，其他玩家还在用旧哈希上报）。那个 `boss-hp-scale` 插件已下架。

**所以「改游戏数值」这类需求不要做成插件**，做成房间设置：
照 `room.setDifficulty` 的模式加一条协议消息，服务端 `GameData` 直接读，不进 `cs`、不起子进程。
`room.setBossHp`（首领血量 1× / 3.25×）就是这么做的，可作为范例。

### 带宽：小主机最容易被打爆的地方

按实测流量占比从大到小（2026-10-18，最近 2000 条请求）：

| 来源 | 占比 | 处置 |
|---|---|---|
| **紧急公告轮询**（10 秒一次 × 7.8 KB/次） | **23.6%** | 改 60 秒（`title.js`） |
| BGM 音频（两个 ~1.9 MB 的 loop） | 23.6% | 默认音量 0（`bgmSilent` 时**不下载**，不是静音播放） |
| 素材（干员立绘 / Spine / 特效） | 37% | 引导玩家导入素材包，没导入就拦住建房 |
| JS/CSS/JSON | 22% | **nginx gzip**（见下） |

#### nginx 的 gzip 默认几乎没生效（★★★ 极易忽略）

```nginx
gzip on;               # 看起来开了
# gzip_types ...;      # 但默认 gzip_types 只有 text/html！
```

**JS / CSS / JSON 全是裸传的。** 补上后实测（`/etc/nginx/nginx.conf`）：

| 文件 | 原始 | gzip 后 | 节省 |
|---|---|---|---|
| `data/chess.json` | 1,876,337 B | 165,317 B | **91%** |
| `data/config.json` | 113,113 B | 10,552 B | 91% |
| `css/screens/lobby.css` | 20,303 B | 4,799 B | 76% |
| `js/main.js` | 25,404 B | 9,752 B | 62% |

```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_min_length 1024;
gzip_types text/plain text/css text/javascript application/javascript
           application/json application/manifest+json image/svg+xml
           text/xml application/xml application/xml+rss;
```

**不要给 png / webp / ogg / mp3 / woff2 加 gzip**（已经压过了，再压只费 CPU）。
改完 `nginx -t` 然后 `systemctl reload nginx`——**不用重启游戏服务**。

⚠️ 这份配置**不在 git 仓库里**，换机器或重装 nginx 要重新配。

#### 缓存头其实已经有，别重复做

应用层已经会按文件名里的内容哈希返回 `Cache-Control: public, max-age=31536000, immutable`
（`server/http/static.js` 的 `IMMUTABLE_JSON`、`files.js`）；不带哈希的走 `max-age=86400`。
`/media/` 与 `/assets/` 都命中。**先 `curl -D -` 看一眼响应头再动手**，别以为没配。

#### 判断是不是被阿里云限速

- `tc qdisc show dev eth0` 只有 `fq_codel`、`iptables` 里没有 limit → **服务器自身没限速**
- 限制在阿里云虚拟化层：经济型 e 实例（`ecs.e-c1m1.large`）是**突发带宽**，
  配额用完后回落到基础带宽（常见 1 Mbps）
- 元数据查不到带宽值，得看控制台
- 判据看 `/proc/net/dev` 的累计发送量和 nginx 的每小时字节数，别凭感觉

### 素材包守卫（没导入不让进对局）

`public/js/screens/lobby.js` 的 `requireAssetPack()`，拦住 `create` / `join` / `startMatch` 三个入口，
没导入就弹窗提示导入方法。

- 用 `countImportedFiles()`（`public/js/assetCache.js`）判断，返回 0 = 没导入
- **不支持导入的环境要放行**（`importSupport().ok === false`：http 非安全上下文 / 缺 Cache API），
  否则那些浏览器就完全玩不了
- **读缓存出错也放行**：宁可放过，不误伤
- 只拦「进入对局」，大厅本身照常可看，玩家可以回标题页导入再回来

做过又删掉的：大厅顶部的黄色提示条（维护者只要拦截、不要横幅）。

- 常用命令：
  - 拉上游：`git -c http.sslVerify=false fetch https://ghfast.top/https://github.com/sganggs/Stronghold-Protocol.git master`
  - 查上游新增（数量 + 标题）：`git rev-list --count HEAD..FETCH_HEAD`；`git log --oneline --reverse HEAD..FETCH_HEAD`
  - 查是否已包含上游：`git merge-base --is-ancestor FETCH_HEAD HEAD`（0 = 已包含，零遗漏）
  - 查双方交叠文件（冲突候选）：对比 `git diff --name-only <基点> HEAD` 与 `git diff --name-only <基点> FETCH_HEAD` 的交集
  - 查未合并残留：`git diff --name-only --diff-filter=U`；查冲突标记残留：`git grep -n -E "^(<<<<<<<|>>>>>>>)"`
  - 查相对上游删了哪些文件（应为空）：`git diff --diff-filter=D --name-only FETCH_HEAD`
  - 查 data 是否与上游一致（应为空）：`git diff --stat FETCH_HEAD HEAD -- data/`
  - 核对锁定值（**别整份 print config.json**）：
    - `Select-String data\config.json -Pattern '"deployCap":(\d+)'`
    - `Select-String data\config.json -Pattern '"bans":\{"FUNNY"'`（或直接在 `shared/openingBans.js` 看基础值）
    - `Select-String scripts\launch.mjs -Pattern "env\.HOST \|\|"`（必须是 `'::'`）
  - 重建数据：`node tools/build-data.mjs`
  - 导入自检：`npm run check:imports`；黄金结果：`npm run golden`；全量 CI：`npm run ci`
