# 上游同步提示词（每次上游更新时，把本文件全文发给 AI）

> 用途：官服上游 `sganggs/Stronghold-Protocol` 发布新版本后，让 AI 把上游更新**完整同步**进本改编版，同时**一个不丢地保留**下列独有功能。直接复制下方分隔线之间的内容发送即可。

---

## ✂ ───── 复制以下提示词 ─────

我在维护《卫戍协议：盟约》（明日方舟同人网页联机自走棋，Node 原生 http/WebSocket + Preact + PixiJS/Spine/three.js）的**个人改编版**。现在官服上游发布了新版本，请你帮我把上游更新同步进来，要求如下。

**仓库与路径**
- 改编版工作目录（就在这里改）：`F:\github\sp-clean-Stronghold-Protocol`，当前分支 `clean/vanilla-0.2.3-plus`
- 官服上游：`https://github.com/sganggs/Stronghold-Protocol`（master 分支）
- 我的远程 origin：`https://github.com/lingluoTOKI/Stronghold-Protocol-Windows.git`
- 本机 GitHub 直连不通，必须走镜像：`git -c http.sslVerify=false fetch https://ghfast.top/https://github.com/sganggs/Stronghold-Protocol.git master`（ghfast.top 不通就换 gh-proxy.com）；用 curl 下载加 `--ssl-no-revoke`。
- Node ≥ 22（本机 v22.x），包管理 npm，ESM（`"type":"module"`）。

**最高原则（冲突时的取舍顺序）**
1. **上游内容必须全量同步、零遗漏**：上游 master 的每一个 commit、每一处机制/数据/渲染/修复都要合进来。战斗模拟（`server/sim/**`）、数据构建（`tools/build-data.mjs`、`data/**`）、官方渲染（`public/js/render/**`）一律**以上游为准**，不得用我的旧实现覆盖上游新逻辑。
2. **我的独有功能一个都不能丢、不能被改坏**（清单见下，共 10 项）。这些是以外挂/补丁方式叠在上游上的，合并冲突时要把它们的"钩子调用点"重新接回上游新代码，而不是直接删掉。
3. **零莱茵生命资料片**：本版是纯净官服 + 独有联机功能，**不要**带回任何莱茵生命盟约/干员/装置、`data/vanilla` 双档案分流、`dataProfile/rhineEnabled` 之类的东西（历史上已彻底剥离）。
4. **锁定的平衡数值不要动**：每人部署位 `data/config.json -> economy.deployCap = 8`（六人房只扩玩家座位到 6，不砍个人部署位）；开局 BAN 用官服基础值（FUNNY 0/1，NORMAL/HARD/ABYSS 3/4，TRAINING 0/0），仅五人核心少 1、六人核心少 2（见 `shared/openingBans.js`，训练不减、最低 0）。
5. **只改代码，测试我来跑**：你只做 `node --check`、`npm run check:imports`、本地起服冒烟和浏览器 DOM/网络巡检；**不要**跑完整对局/测试套件，不要擅自 `git commit`、`push` 或部署，改完告诉我，我验收后再统一提交部署。
6. 部署铁律（供你判断，本轮先不执行）：绝不动服务器 `node_modules` 和 `public/assets`；改了 server/shared 需 `systemctl restart stronghold`。

**我必须保留的 10 项独有功能及其代码落点（合并后逐项 grep 自检）**
1. **六人房全套**：`shared/constants.js` `MAX_SEATS=6`；`server/match/choices.js` `largeRoomBountyCards`（开局≥5人悬赏在基础 6 张上补 I/II/II 三档凑 **9 张**）；`shared/openingBans.js` + `server/match/gamedata.js`（五人少1/六人少2 BAN；六人 boss 共享血池 = 四人基准 ×200%，并与上游按存活人数缩放叠加）；`server/match/match/phases.js` `SIX_PLAYER_BEACON_ROUNDS={10,12,14}`（R10/R12/R14 每位存活玩家发信标道具，R14 那枚领完立即转干员并进商店）。
2. **1×/2×/4× 战斗倍速**：`public/js/battle/runner.js`（cycleSpeed，本地确定性模拟，改倍率即可）+ `public/js/ui/hud.js` SpeedButton（循环 1×→2×→4×，非默认 2× 时高亮）。要求切换丝滑。
3. **倒计时流动**：倍速下战斗倒计时按真实时钟平滑走（`public/js/screens/game.js` countdown 相关）。
4. **跳过本场**：`runner.js` `skipBattle`/`skipReady`（**敌人全部出场后**才能跳；单人+多人都可跳；联防/Boss 关不可用；单人长时间未结束按残存怪冲家扣血直接进下一轮买卖）。HUD 按钮与二次确认在 `hud.js`。
5. **可拖拽聊天 + 表情**：`public/js/ui/chat.js`（左下角单个绿色「交流」按钮，可拖拽）、协议 `g.chat`、`shared/constants.js` `CHAT_COOLDOWN_MS/EMOTE_COOLDOWN_MS/CHAT_MAX_LEN`、`server/match/match/intents.js`。
6. **公告栏（热加载）**：根 `announcements.json`（`{updatedAt,items[]}`，支持 force/forceId/startAt/expireAt）、`server/http/announcements.js`、`server/index.js` announceApi、`server/http/routes.js` 只读 `GET /api/announcements` + 管理接口、`public/js/screens/title.js` 公告弹窗与信封按钮（图标 `public/js/ui/components.js` 的 ICONS.mail）。
7. **在线人数**：`server/http/routes.js` `GET /api/online`，前端 5s 轮询。
8. **公共/快速匹配**：`server/lobby.js` 匹配队列（`MATCH_TARGET=6`、`MATCH_TIMEOUT_MS=30000`，凑满即开；超时三选一：继续等待 / 用 AI 补满 / 按当前人数直接开），协议 `match.enqueue` 等。
9. **监控大屏 monitor.html**：按房间分组玩家、单人踢/一键踢全、三服务器切换、公告编辑器（发布/撤回强制公告）；对应服务端 `routes.js` 的 `/api/admin/*`（players/rooms/kick/kickall/announce/announce-clear，`SP_ADMIN_TOKEN` 鉴权）与 `/healthz` CORS。
10. **本机/PC/安卓联机脚本**：根目录 `本机当服务器.bat`、`启动游戏.bat`、`连接服务器.bat`（含便携 node 探测、局域网共享）、`scripts/launcher.mjs`、`scripts/make-windows-bundle.mjs`、`scripts/zipdir.mjs`。

**执行流程（一步步来，每步给我看结果）**
1. `git fetch` 上游 master（走镜像），记录上游最新 commit；用 `git merge-base --is-ancestor <上游最新> HEAD` 和 `git log --oneline HEAD..<上游最新>` 确认**哪些是上游新 commit**（同步前先告诉我数量和标题）。
2. 从当前分支新建同步分支（如 `sync/upstream-<版本号>`），不要直接在主分支上动。
3. 合入上游（merge 或按 commit cherry-pick）。逐文件解决冲突：
   - `server/sim/**`、`tools/**`、`public/js/render/**`、官方数据 → 采用上游版本，再把我独有功能的调用钩子重新接上；
   - 独有文件（chat.js、openingBans.js、monitor.html、announcements*、launcher/打包脚本、三个 bat、两个 `改编版-*.md`）→ 保留我的；
   - 交叠文件（lobby.js、Match.js、choices.js、gamedata.js、phases.js、intents.js、runner.js、hud.js、game.js、title.js、routes.js、index.js、constants.js、protocol.js）→ 以上游新逻辑为底，把 10 项独有补丁重新合入，保证上游新改动不被覆盖。
4. 若上游改了数据结构/字段（例如 config 新增字段），运行 `node tools/build-data.mjs` 重建 `data/**`，再确认独有数值（deployCap=8、BAN）仍在。
5. **美术资源不入库**：`public/assets/**`、`public/fonts/**`、`data/assets.json`、`data/local-assets.json` 在 `.gitignore` 内，属于部署/本地资源，不要提交、不要删；3D 棋盘靠 `data/local-assets.json` + `public/assets/local`（缺失会静默回退 2D、没有橙色栏杆）。
6. 自检：对改动的 js 跑 `node --check`、`npm run check:imports`；本地 `PORT=31xx SP_ADMIN_TOKEN=test` 起服，curl 冒烟 `/healthz`、`/api/online`、`/api/announcements`、admin 接口鉴权（无 token 403）；浏览器清 Service Worker+caches 硬刷新，巡检标题页/建房页/战场无 404、无 console error。
7. 合并后**重新逐项核对上面 10 项功能**（grep 关键符号都还在），并确认 `git diff --diff-filter=D <上游最新>` 没有删掉任何上游文件、也没有混入任何莱茵/双档案文件。
8. 给我一份"上游同步了什么 + 冲突怎么解的 + 10 项功能自检结果 + 待我实测清单"的报告，**先不要提交/部署**，等我跑对局验收。

**注意**：如果上游某个改动和我的独有功能在设计上直接冲突（无法同时满足），不要自己拍板，列清楚两种取舍给我决定。

## ✂ ───── 复制到此结束 ─────

---

## 附：当前基线快照（AI 核对用，会随版本过期，以实际 fetch 为准）

- 最近一次核对时间：2026-10-10；上游 master 最新 = `1db8e510`（0.2.3，2026-10-10 03:19 +0800），已确认是改编版 HEAD 的祖先，**上游 commit 零遗漏、零删除文件**。
- 改编版在该基线上的独有改动：新增 12 个文件（announcements.json、monitor.html、public/js/ui/chat.js、scripts/launcher.mjs、scripts/zipdir.mjs、server/http/announcements.js、shared/openingBans.js、三个 bat、两个 `改编版-*.md` 等），修改约 30 个文件，全部属于上述 10 项独有功能。
- 常用命令：
  - 拉上游：`git -c http.sslVerify=false fetch https://ghfast.top/https://github.com/sganggs/Stronghold-Protocol.git master`
  - 查上游新增：`git log --oneline HEAD..FETCH_HEAD`
  - 查是否已包含上游：`git merge-base --is-ancestor FETCH_HEAD HEAD`
  - 查相对上游删了哪些文件（应为空）：`git diff --diff-filter=D --name-only FETCH_HEAD`
  - 重建数据：`node tools/build-data.mjs`
  - 导入自检：`npm run check:imports`
