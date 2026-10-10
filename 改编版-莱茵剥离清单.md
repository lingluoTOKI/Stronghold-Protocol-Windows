# 改编版「莱茵插件 / 双档案分流」剥离清单

- 分支：`clean/vanilla-0.2.3-plus`，基点 = 官服上游 `1db8e510`（0.2.3）。
- 做法（策略 A）：**从官服 0.2.3 纯净基线重建**。纯净基线天然不含任何莱茵/双档案代码，因此本清单记录的是「live 旧树中存在、但确认不带入新版本」的全部内容，并给出零残留核对方法。
- 结论：新分支 `grep` 不到任何莱茵插件与 vanilla/rhine 双档案分流（仅官服数据档案一份）；官服 0.2.3 既有功能（含被 live 误删的 `room.setAiPicksLast`、`clientCombat.verifyJob`、runner 的 pending/prepare/endBattle、表情轮盘、双击观战等）全部保留。

## 一、莱茵生命插件内容（全部不移植）
### 专属代码/模块
- `shared/rhineResearch.js`、`shared/rhineRange.js`
- `server/sim/content/rhine.js`、`server/sim/content/rhineMeta.js`
- `server/sim/content/kits/rhine.js`、`rhineAssault.js`、`rhineNew.js`、`rhineSupport.js`
- `public/js/render/rhineDevices.js`、`public/js/ui/rhineDock.js`、`public/css/screens/rhine.css`
- 莱茵 6 名新干员、卡兹戴尔阵营、装置（生态维持仪/能量谐振仪/激光钻机/生态调控器）、众魂、战斗巨炮、屏障等内容与对应测试
### 数据/工具/脚本/文档/美术
- `tools/rhine-data.mjs`、`tools/rhine-data-source.json`、`tools/rhine-data-fetch.mjs`、`tools/build-rhine-bundle.mjs`、`tools/fetch-rhine-assets.mjs`、`tools/verify-rhine-release.mjs`、`tools/assets/rhine-plan.mjs`
- `scripts/rhine-bundle-launch.ps1`、根 `deploy-rhine-369.ps1`
- `test/rhine_smoke.mjs`
- `public/art/rhine/**`
- `docs/RHINE*.md`、`docs/rhine-*.json`、`docs/公告-0.2.2-rhine.*.txt`、`release-notes/*-rhine.*.md`

## 二、双档案（vanilla/rhine profile）分流架构（全部不移植）
- 前端分流模块 `public/js/ui/dataProfile.js`；服务端数据范围 `server/sim/content/support/dataScope.js`；构建脚本 `tools/vanilla-data.mjs`
- 双份数据目录 `data/vanilla/**`（纯净版只保留单一官服 `data/`，不做 overlay）
- 房间/大厅的 `rhineEnabled` 开关、`room.setRhine` 消息、`room.create` 的 `rhineEnabled` 字段、`target.area==='research'`
- 容量分流 `maxSeatsFor(rhineEnabled)` / `VANILLA_MAX_SEATS`（六人房容量改为直接由官服常量 `MAX_SEATS=6` 表达，**不再挂任何标志**）
- 胶水符号：`dataProfile`、`getDataProfile`、`profileFromState`、`prepareDataProfile`、`PROFILE_CHANGE`
- 数据重建 overlay `applyOpeningBans`（运行时不改写构建数据；纯净版只保留纯函数 `openingBanCounts`）

## 三、公网扇出 / 反代 / 多服监控（本机+局域网范围外，不移植）
- `server/http/proxy.js`（`SP_PROXY_TO` 反代、启动菜单"公网联机"、三台公服扇出）
- `monitor.html` 旧版的多服切换/三服扇出、公告编辑器、写死公网 IP 与 `game.lingluotoki.dpdns.org`（新 monitor 已改造为单本机服，全部删除）

## 四、临时杂物 / fork 重组 / 产物（不移植）
- 临时脚本与杂项：`.commit_msg.txt`、`cd`、`se.txt`、`merge-i18n.mjs`、`resolve-conflict.mjs`、`union-conflict.mjs`、`test/local_deploy.mjs`、`test/local_deploy2.mjs`、`QQ群公告.txt`、`PROJECT-STRUCTURE.md`
- fork 的干员打包重组 `server/sim/content/kits/tier1.js … tier6.js`：官服 0.2.3 以 `kits/ops/*.js` 组织且已含全部官服干员，不采用该重组
- `android/`（未入库的 Gradle WebView 壳）、`dist/`（PC zip/APK 产物）、仓库外安卓签名密钥：不破坏、不新建
- 莱茵数据/渲染相关的 live 修改（`public/js/render/**` 的 spine/WebGL 补救、`server/sim/content/kits/ops/*` 莱茵钩子等）：官服 0.2.3 渲染与战斗自洽，一律不跟随

## 五、被 live 改动、但新版本"恢复官服"的点
- 恢复官服 `room.setAiPicksLast`（live 用 `room.setRhine` 顶替，已还原）
- 保留官服 `server/match/match/clientCombat.js` 的 `verifyJob` 反作弊校验（live 曾删除，未跟随）
- 保留官服 `public/js/battle/runner.js` 的 pending Map / `prepare()` / `endBattle()` 架构（live 曾整套删除重写，未跟随；只嫁接倍速/跳过/倒计时原语）
- 保留官服对局表情轮盘 `g.emote`（live 曾被聊天框顶替，新版本二者并存）
- 开局基础 BAN 数值对齐官服（FUNNY core0 / NORMAL·HARD·ABYSS core3），只叠加五人-1/六人-2 的人数减免
- 战场部署位 `deployCap` 保持官服 8，不随六人房放大

## 六、零残留核对（已执行）
在新分支对 `server/`、`shared/`、`public/`、`scripts/`、根 `*.html/*.json/*.bat/*.mjs` 检索以下符号/词，**均 0 命中**：
`dataProfile`、`getDataProfile`、`profileFromState`、`prepareDataProfile`、`PROFILE_CHANGE`、`rhineEnabled`、`maxSeatsFor`、`VANILLA_MAX_SEATS`、`setRhine`、`rhineResearch`、`rhineRange`、`rhineDevices`、`rhineDock`、`rhineMeta`、`rhineCapacity`、`卡兹戴尔`、`生态维持仪`、`能量谐振仪`、`激光钻机`、`生态调控器`、`众魂`、`战斗巨炮`、`dpdns`、`lingluotoki`、`SP_PROXY_TO`、`build-rhine`、`fetch-rhine`。
（官服干员档案中"莱茵生命"作为阵营名、设计文档注释里的 "research" 代号属官服正常内容，不在剥离范围。）

> 复核命令示例（在分支根目录）：
> `git grep -n -E "dataProfile|rhineEnabled|maxSeatsFor|setRhine|rhineResearch|rhineRange|rhineDevices|rhineDock|卡兹戴尔|dpdns|SP_PROXY_TO" -- server shared public scripts '*.html' '*.bat'`
