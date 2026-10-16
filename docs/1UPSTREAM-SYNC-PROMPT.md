# 上游同步提示词（每次上游更新时，把本文件全文发给 AI）

> 用途：官服上游 `sganggs/Stronghold-Protocol` 发布新版本后，让 AI 把上游更新**完整同步**进本改编版，同时**一个不丢地保留**下列独有功能。直接复制下方分隔线之间的内容发送即可。

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

- **最近一次同步：2026-10-16；上游 master 最新 = `c24e17ee`（0.3.0，2026-10-16）**，已合入分支 `sync/upstream-0.3.0`（合并提交 `56888798`，后续公告 `282ff2bf`、README `9101714a`、monitor CSP 修复 `4fc7c170`、兼容文档 `7e951110`），**已确认是改编版 HEAD 的祖先、上游 commit 零遗漏、零删除文件**。
- 更早的同步基点：`488db49f`（0.2.6）、`cf7a9400`（0.2.5）、`bc50cac0`（0.2.4）、`1db8e510`（0.2.3）。
- 0.3.0 带来 **390 个新 commit / 807 个文件改动**（从 0.2.6 算起）；合并时 18 个冲突文件分三类解决：文档配置 9、服务端核心 5（index.js / routes.js / lobby.js / gamedata.js / Match.js）、前端核心 4（runner.js / game.js / title.js / hud.js）。
- **0.3.0 上游新增的重要机制（合并时必须保留、不要覆盖）**：
  - **插件系统**：`plugins/` 目录、`server/plugins/registry.js`、`shared/plugins/ui.js`、`/studio/` 工作台、Forge 导入器、脚本沙箱（`SP_PLUGIN_SCRIPTS`）。默认不开启，我们线上 plugins/ 只有 `_template`，零实际插件。
  - **严格 CSP**：`server/http/csp.js` 的 `siteCsp(publicDir)` 只白名单 importmap hash，所有 HTML 页面套 `script-src 'self' ...`。**monitor.html 已外部化 JS**（见 10 项功能第 9 条）。
  - **官方战斗特效**：`data/local-fx.json` 清单 + `public/assets/local/fx/`（12534 文件）。
  - **11 战场新场景**：`public/assets/local/scene/`（137 文件）。
  - **素材导入功能**：标题画面「导入素材包」、「下载完整素材」按哈希校验缓存。
  - **统计页改版**、**干员多语言语音**、**攻击判定按官方碰撞箱**等大量平衡/渲染改进。
- **已知待优化（不影响兼容，下次可处理）**：
  - **倍速切换不丝滑**：4× 切 1× 时渲染插值速率骤降，视觉顿挫。reanchor 数学上游戏时间连续不跳，但渲染层插值器没有平滑过渡。改这个需要动渲染层插值器，风险大，暂未处理。
- 改编版相对新基线 `c24e17ee` 的独有改动：全部属于上述 10 项独有功能。新增文件主要落在：`android/**`、`announcements.json`、`public/monitor.html` + `public/js/monitor.js`、`public/js/ui/chat.js`、`scripts/launcher.mjs`、`scripts/launcher.config.json`、`scripts/zipdir.mjs`、`tools/dist.mjs`、`server/http/announcements.js`、`server/http/proxy.js`、`shared/openingBans.js`、`test/admin-rooms.test.js`、`test/proxy.test.js`、3 个 bat、`docs/COMPAT-0.3.0.md` 及 docs/ 下改编版文档。
- 本次验证结论：`node --check` 全过；`npm run check:imports` 退出 0；`node tools/build-data.mjs` 重建零差异；`npm run golden` 全绿；服务器已部署（build `3aa174f7fc6e`，healthz 正常）。
- **美术资源不入库（0.3.0 更新）**：`public/assets/**`、`data/local-assets.json`、`data/local-fx.json` 在 `.gitignore` 内。3D 棋盘靠 `data/local-assets.json` + `public/assets/local/`；官方战斗特效靠 `data/local-fx.json` + `public/assets/local/fx/`。缺失会静默回退 2D/原版特效。**部署到新服务器时，必须从完整包复制这两个清单文件和 local/ 目录，否则游戏会提示素材不完整。**
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
