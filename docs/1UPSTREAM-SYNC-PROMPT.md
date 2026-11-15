# 上游同步提示词（每次上游更新时，把 `✂` 之间的内容整段发给 AI）

> **本文件只放「提示词本体」**。服务器运维、部署流程、坑、历史同步记录一律在仓库外的
> `F:\github\Stronghold-Protocol\交接文档-卫戍协议服务器.md`（唯一交接文档），不要在这里重复。
>
> 用法：复制下面 `✂` 分隔线之间的全部内容，发给接手的 AI；它缺上下文时再去读交接文档。
>
> 最后更新：**2026-11-15**（基线对齐上游 v0.4.0 + CI 修复，本地 HEAD `f40b4cca`，与 `upstream/dev` 零遗漏）

---

## ✂ ───── 复制以下提示词 ─────

我在维护《卫戍协议：盟约》（明日方舟同人网页联机自走棋，Node 原生 http/WebSocket + Preact + PixiJS/Spine/three.js）的**个人改编版**。现在官服上游发布了新版本，请把上游更新**完整同步**进来，同时**一个不丢地保留**我的独有功能。

**仓库与路径**

- 改编版工作目录（就在这里改）：`F:\github\Stronghold-Protocol\sp-clean-Stronghold-Protocol`
- 当前活跃分支 `sync/upstream-0.4.0`，HEAD `f40b4cca`，`package.json` = **0.4.0**
- 官服上游：`https://github.com/sganggs/Stronghold-Protocol`，**分支 `dev`**（不要拉 `master`）
- 我的远程 origin：`https://github.com/lingluoTOKI/Stronghold-Protocol-Windows.git`
- 两个 remote 都已配好，`git fetch upstream dev` 直连成功，**不需要镜像**；失败时才退回 `git -c http.sslVerify=false fetch https://ghfast.top/https://github.com/sganggs/Stronghold-Protocol.git dev`（ghfast.top 不通换 gh-proxy.com）
- Node ≥ 22，ESM（`"type":"module"`），npm
- **`git` / `ssh` / `scp` / `robocopy` 都不在 PATH**，必须全路径：`C:\Program Files\Git\cmd\git.exe`、`C:\Windows\System32\OpenSSH\ssh.exe`
- **别把 `data/config.json` 整份 print 出来**：上游压成单行 JSON，会吐出几万字符淹没上下文。核对字段用 `Select-String` 正则抽取
- **`sp-clean-Stronghold-Protocol` 是 git worktree**，其主仓是同级的 `Stronghold-Protocol-Windows-v0.1.0`。**不要移动/改名/删除那个目录**，否则 git 立刻失效

**动手前的前置条件（不满足别 merge）**

- **A. 先把未提交的改动落袋**：当前工作区还有 `M announcements.json`（0.4.0 更新公告，已实测生效）+ 若干未跟踪残留（`.playwright-cli/` 约 71 个、`output/` 约 40 个、`.tmp-server-assetImport.js`、`data/local-assets.backup.json`）。merge 前先确认 `git status --porcelain` 只剩这些可忽略项。
- **B. 账号绑定子系统走独立分支**：`local/account-binding`（`fcfdb83a`）。它包含 `server/accounts/{challenges,client,store,worker}.js`、`server/index.js` 的 `createAccounts` 接线、`docs/ACCOUNT-BINDING-PLAN.md`、`test/account-*.test.js` ×5。**不要在 sync 分支上继续加账号提交**，做完同步再合回去。
- **C. `.gitignore` 仍然缺两条**：`.playwright-cli/`、`/output/` 没有被忽略（实测残留 71 / 40 个）。`data/assets.json` 被 git 跟踪且是冲突候选，**不要 `git rm --cached` 脱管**（`server/http/static.js` 的 assetViews 要用它）。

**最高原则（冲突时的取舍顺序）**

1. **上游内容全量同步、零遗漏**：上游 `dev` 的每一个 commit、每一处机制/数据/渲染/修复都要合进来。`server/sim/**`、`tools/build-data.mjs`、`data/**`、`public/js/render/**` 一律**以上游为准**，不得用旧实现覆盖上游新逻辑。
2. **我的独有功能一个都不能丢、不能被改坏**（清单见下，共 **11 项**）。它们以外挂/补丁方式叠在上游上，冲突时要把「钩子调用点」重新接回上游新代码，而不是删掉。
3. **零莱茵生命资料片**：判据是搜代码符号 `rhineEnabled` / `dataProfile`，应为**零命中**。**不要**搜 `rhine` 关键词——上游官方干员 kit 里大量出现「莱茵生命」groupId（`op-slent2.js`、`op-ifrit.js`、`chess_char_6_11-mlyss.js` 等），那不是要剥离的东西。
4. **锁定数值不要动**：`data/config.json` 的 `economy.deployCap = 8`；开局 BAN 用官服基础值（FUNNY 0/1，NORMAL/HARD/ABYSS 3/4，TRAINING 0/0），五人核心少 1、六人核心少 2（`shared/openingBans.js`，训练不减、最低 0）。
5. **别擅自提交或部署**：做完 `node --check`、`npm run check:imports`、本地起服冒烟即可；`npm run ci` 与 `npm run golden` 可以跑（结果我会看），但**不要**擅自 `commit`、`push`，改完把报告给我，我验收后再统一提交部署。
6. **部署铁律**（供判断，本轮不执行）：绝不动服务器 `node_modules` 和 `public/assets`；改了 `server/` 或 `shared/` 需 `systemctl restart stronghold`。

**我必须保留的 11 项独有功能及代码落点（合并后逐项 grep 自检）**

1. **六人房全套**：`shared/constants.js` `MAX_SEATS=6`；`server/match/choices.js` `largeRoomBountyCards`（≥5 人悬赏在基础 6 张上补 I/II/II 三档凑 **9 张**）；`shared/openingBans.js` + `server/match/gamedata.js`（五人少 1 / 六人少 2 BAN；六人 Boss 共享血池 = 四人基准 ×200%，并与上游按存活人数缩放叠加）；`server/match/match/phases.js` `SIX_PLAYER_BEACON_ROUNDS={10,12,14}`（R10/R12/R14 每位存活玩家发信标，R14 领完立即转干员并进商店）。
2. **1×/2×/4× 战斗倍速**：`public/js/battle/runner.js`（`cycleSpeed`）+ `public/js/ui/hud.js` `SpeedButton`（非默认 2× 时高亮）。要求切换丝滑。
3. **倒计时流动**：倍速下战斗倒计时按真实时钟平滑走（`public/js/screens/game.js` countdown 相关）。
4. **跳过本场**：`runner.js` 的 `skipBattle`/`skipReady`（**敌人全部出场后**才能跳；单人+多人都可跳；联防/Boss 关不可用；单人长时间未结束按残存怪冲家扣血直接进下一轮）。按钮与二次确认在 `hud.js`。
5. **可拖拽聊天 + 表情**：`public/js/ui/chat.js`（左下角单个绿色「交流」按钮，可拖拽）、协议 `g.chat`、`shared/constants.js` 的 `CHAT_COOLDOWN_MS/EMOTE_COOLDOWN_MS/CHAT_MAX_LEN`、`server/match/match/intents.js`。
6. **公告栏（热加载）**：根 `announcements.json`（`{updatedAt,items[]}`，支持 `force`/`forceId`/`startAt`/`expireAt`）、`server/http/announcements.js`（mtime 懒热更新）、`server/index.js` announceApi、`server/http/routes.js` 的 `GET /api/announcements` + 管理接口、`public/js/screens/title.js` 公告弹窗与信封按钮（`public/js/ui/components.js` 的 `ICONS.mail`）。
   - **每次同步顺手更新公告**：在 `items[0]` 用新版本号插一条（沿用「【本次重点】/【官服同步（x.y.z）】/【进入游戏 & 说明】」结构，内容照上游 `CHANGELOG.md` 提炼），旧条目往后留，并更新顶层 `updatedAt`；末尾固定「本作非官方同人作品，与鹰角 / Yostar 无关，仅供学习交流，严禁商用。」。改完用 `GET /api/announcements` 确认能解析多条。
7. **在线人数**：`server/http/routes.js` `GET /api/online`，前端 5 秒轮询。
8. **公共/快速匹配**：`server/lobby.js` 匹配队列（`MATCH_TARGET=6`、`MATCH_TIMEOUT_MS=30000`，凑满即开；超时三选一：继续等待 / 用 AI 补满 / 按当前人数直接开），协议 `match.enqueue` 等。
9. **监控大屏**：`public/monitor.html` + `public/js/monitor.js`（**CSP 要求 JS 外部化**，且 `onclick=` 计数必须为 0，事件在 `bindUi()` 里 `addEventListener`）；服务端 `routes.js` 的 `/api/admin/*`（players/rooms/kick/kickall/room/close/announce/announce-clear，`SP_ADMIN_TOKEN` 鉴权，**走 query `?token=` 不是 header**）+ `/healthz` CORS + **`GET /api/admin/restart`**（需 `SP_ALLOW_RESTART=1`，合并后 grep 应为 1，历史上被整份覆盖丢过一次）。
   - **运行保护面板不在项目里**：数据来自服务器 `/opt/stronghold-stability/control.py`（127.0.0.1:31998），nginx 精确匹配转发。**不要在 `routes.js` 重复实现**。
10. **本机/PC/安卓联机**：3 个 bat（`本机当服务器.bat`、`启动游戏.bat`、`连接服务器.bat`，含便携 node 探测）、`scripts/launcher.mjs`、`launch.mjs`、`make-windows-bundle.mjs`、`zipdir.mjs`、`tools/dist.mjs`、`scripts/launcher.config.json`。**联机模式** = `server/http/proxy.js`（`SP_PROXY_TO`，反代 `/ws` 与 `/api/*`，页面与素材走本机磁盘，`/healthz` 不转发）+ `server/index.js` 接线 + `routes.js`/`websocket.js` 两条转发 + `launcher.mjs --mode proxy`。
    - **监听地址铁律**：`scripts/launch.mjs` 必须保持 `host: process.env.HOST || '::'`，`server/http/config.js` 的 `DEFAULT_BIND_HOST = '::'`。**`'::'` 是双栈**，改成 `'0.0.0.0'` 会只收 IPv4、IPv6 玩家连不上。
11. **Boss 关卡地形补齐（0.4.0 期间新增，上游没有）**：Boss 回合用的地形原本从未生成，导致 Boss 站在 m 系列地形的空中平台层上。
    - `tools/build-data.mjs` 的 `buildStages` 里增加了 h07/h08 模板遍历（从 `ctx.templateIds` 取，**不能取 `act.battleDataDict` 的键**、**不能塞进 `ctx.stageIds`**——后者会走 `composeRegulationStage` 三块拼接路线）。
    - `server/match/match/bossRounds.js` 的 `stageId` 改为 `(wave.templateId && this.gd.stage(wave.templateId)) ? wave.templateId : this.stageId`。
    - 结果：`data/versions/act3autochess-v3_1/stages.json` 从 12 键扩到 **44 键**（12 m + 20 h07 + 12 h08，全 19×21）。
    - **重建命令**：`node tools/build-data.mjs --version "act3autochess@V3_1"`（**必须带 `@`**，写成 `act3autochess-v3_1` 报 `unknown version`）。
    - 合并 `tools/build-data.mjs` 时若上游重写了 `buildStages`，**必须把 h07/h08 遍历接回去**，否则重新构建会退回 12 键、Boss 再次站到错误地形上。

**执行流程（一步步来，每步给我看结果）**

0. **先满足前置条件 A/B/C**，确认 `git status --porcelain` 只剩可忽略项。
1. `git fetch upstream dev`，记录上游最新 commit；用 `git merge-base --is-ancestor <上游最新> HEAD` 和 `git log --oneline HEAD..<上游最新>` 确认**哪些是上游新 commit**（同步前先告诉我数量和标题）。**不要拉 master。**
   - 2026-11-15 基线：`upstream/dev` = `55f528e9`，本地已**零遗漏**（`is-ancestor` 退出码 0，领先 112 / 落后 0）。下次同步从 0 个待合提交起步。
2. 从当前分支新建同步分支（如 `sync/upstream-<版本号>`），不要直接在 `sync/upstream-0.4.0` 上动。
3. 合入上游（merge 或按 commit cherry-pick）。**先打备份标签**（`git tag -f pre-sync-<版本> HEAD`），建议 `git merge --no-commit --no-ff <上游最新>` 先看冲突面。逐文件解决：
   - `server/sim/**`、`tools/**`、`public/js/render/**`、官方数据 → 采用上游，再把独有钩子接上；
   - 独有文件（`chat.js`、`openingBans.js`、`monitor.html`/`monitor.js`、`announcements*`、`server/http/proxy.js`、launcher/打包脚本、3 个 bat）→ 保留本地；
   - 交叠文件 → 以上游新逻辑为底，把 11 项补丁重新合入。
   - 实操提示：冲突多半是**双方各自新增**（`.gitignore` 各加一条、`protocol.js` 各加消息名），**两边都保留**，不要二选一。
   - 解决完必须全局搜残留：`git grep -n -E "^(<<<<<<<|>>>>>>>)"`（应为空）。**只 `git add` 不等于解干净。**
   - **自动合并 ≠ 没被吞**：两边改同一文件不同区域时 Git 会静默合并，可能把钩子挤掉。每个交叠文件都要人工确认「上游新逻辑」和「我的钩子」都在（`gamedata.js` 我的 BAN 与上游新方法并存、`phases.js` 我的信标与上游 `bossPairs` 并存）。
4. 上游若改了数据结构/字段，运行 `node tools/build-data.mjs --version "act3autochess@V3_1"` 重建 `data/**`，再确认独有数值（deployCap=8、BAN）与 **44 键 stages** 都还在。**重建后若 `git status` 无 diff，说明数据结构没变，不必提交 data**；另注意 `data/**` 应与上游逐字节一致（`git diff --stat upstream/dev HEAD -- data/` 应为空）。
5. **美术资源不入库**：`public/assets/**`、`public/fonts/**`、`public/vendor/**`、`data/local-assets.json`、`data/local-fx.json`、`runtime/` 在 `.gitignore` 内，属于部署/本地资源，**不要提交、不要删**。
   - 例外：`data/assets.json` **不在 `.gitignore` 且被跟踪**，merge 时按上游版本处理。
   - 3D 棋盘靠 `data/local-assets.json` + `public/assets/local/`；0.3.0 起官方战斗特效靠 `data/local-fx.json` + `public/assets/local/fx/`（缺失会静默回退 2D 原版特效、没有橙色栏杆）。
6. 自检：改动过的 js 跑 `node --check`、`npm run check:imports`；本地 `PORT=31xx SP_ADMIN_TOKEN=test` 起服，curl 冒烟 `/healthz`（版本号应为新版本）、`/api/online`、`/api/announcements`、admin 鉴权（无 token 403 / `?token=` 200）。浏览器侧由我本人验证。
   - `check:imports` 有 3 条 `server/sim/nodeData.js` 的 `[sim-node]` 违规是**上游既有、被上游白名单认可的**，退出码 0，不是合并引入的问题。
   - **强烈建议跑 `npm run golden`**：全绿是「上游战斗改动没被六人房补丁改坏」的最有力证据。有场景变动必须能说清是上游有意改动还是误伤。
7. 合并后**先跑独有资产校验器**：`node tools/verify-local-patches.mjs`（当前 **55 项**，退出码 0 才算全保住）。FAIL 项逐条修回、重跑直到全 PASS。
   - 它只是**符号级**检查，确认不了「钩子接对了」。还要人工确认 `git diff --diff-filter=D upstream/dev HEAD` 没删上游文件、没混入莱茵/双档案。
   - **新增独有功能时，同步往校验器里加一条检查**，否则下次同步没人替它把关。
   - 另确认 `git merge-base --is-ancestor <上游最新> HEAD` 返回 0、`git rev-list --count HEAD..<上游最新>` 为 0。
8. 给我一份「上游同步了什么 + 冲突怎么解的 + 11 项功能自检结果 + 待我实测清单」的报告，**先不要提交/部署**，等我跑对局验收。报告请说明：跑过的自检命令与结果、`npm run ci` 的失败项判定（真失败还是机器满载抖动——性能/时序类断言单跑就过）。

**注意**：如果上游某个改动和我的独有功能在设计上直接冲突（无法同时满足），不要自己拍板，列清两种取舍给我决定。

## ✂ ───── 复制到此结束 ─────
