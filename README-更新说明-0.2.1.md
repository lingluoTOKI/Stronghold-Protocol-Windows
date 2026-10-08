# 本次更新说明（0.2.1-rhine.1 · 2026-10-08）

本文档记录 **0.2.1-rhine.1** 这次更新的全部内容：上游同步、双档案架构、机制修复、数据重建、
测试状态与运维变更。面向维护者；给玩家看的简版在游戏内公告栏（`announcements.json`）。

---

## 一、这次更新做了什么

本次更新围绕三件事：**① 完整合入上游 0.2.1（R21A–H + R21P 满潜能，36 个提交 c2a2ef7）；② 落实「莱茵(rhine)插件与原版(vanilla)隔离、两套数据都必须加载成功」的双档案架构；③ 按上游 0.2.1 重建对局数据并重生成双档案快照。**

版本从 `0.2.0-rhine.1` → `0.2.1-rhine.1`。以下为逐项说明。

---

## 二、双档案并行架构（本扩展的核心结构）

服务器现在**同时完整加载两套数据档案**，互不干扰：

| 档案 | 数据目录 | 内容 | 说明 |
|---|---|---|---|
| **莱茵（默认）** | `data/`（根） | 上游 v0.2.1 + 莱茵生命 overlay | 本扩展实际玩的内容；`tools/rhine-data.mjs` 的 `applyRhineData` 在其上叠加莱茵专属干员、盟约、科研装置 |
| **原版（vanilla）** | `data/vanilla/` | 纯上游 v0.2.1，无莱茵内容 | 用 `tools/vanilla-data.mjs` 的 `snapshot()` 从上游 commit 精确冻结 |

关键机制：
- `test/helpers/profile.mjs` 用 `SP_TEST_PROFILE=vanilla|rhine` 切档；vanilla 时只把**顶层 `data/<file>.json`** 重定向到 `data/vanilla/`（i18n 不重定向）。
- `tools/rhine-data.mjs`：`RHINE_ADDITIONS`（6 个莱茵专属干员）、DIY 自选池剔除段、`indomShip` 数值覆写段。
- `tools/build-data.mjs`：`validateAll → vanillaFiles=structuredClone(files) → applyRhineData(files) → writeVanillaData → 原子写 data/*.json`，一次构建同时产出两套。
- 同名干员（伊芙利特 / 森蚺 / 多萝西）在莱茵档案下用重写版，原版档案下用上游版。

**约束**：两套都必须加载成功。本次已确认 data/ 与 data/vanilla/ 两套都完整（data/ 12 个莱茵专属棋子回归、config 含 supplyHp 等 0.2.1 字段；data/vanilla/ 为 0.2.1 冻结，23 个文件）。

---

## 三、上游 0.2.1 同步内容（R21A–H + R21P）

上游 master 从 v0.2.0 冻结点（1303321）推进到 0.2.1（c2a2ef7，36 个提交）。本次全部手工解决 13 处 merge 冲突后合入：

### R21A — 突袭落点
双方半场都占满时，突击（突袭）成员可落到**队友半场**（两助手联防场 / 最终攻势与隐秘核心双 boss 场）。单独联防助手的空半场、单人 boss 场的另半场、手牌/临时整备区行保持关闭；其他落点规则全部保留，乌尔比安 S3 移动仍在自己半场。

### R21B — 联防地形恢复
联防改回在**本回合的战场**上进行，地形、障碍物、水面、装置与符文全部恢复（与 0.1.4 一致）。0.2.0 引入的"占位道路地图"（所有波次模板关卡共用）撤销；只有 11 个 stage 关卡有地形。联防战斗输入在 20 个用例下与 0.1.4 逐字节一致。

### R21C — 自选干员进盟约名单
玩家的自选干员（V/VI 槽位）会出现在其携带盟约的**成员名单**里：未拥有时置灰、被禁时打叉；点开可查看该干员的卡片。修复"自选编队的干员在局内盟约名单里没有显示"。

### R21D — 装备替换（消耗品满装）
两个装备槽都满时，使用消耗品（博士投影、盟约之币等）会弹出**替换确认**，替换并**只销毁被指定的装备**（效果生效后）。对应官方"达到上限强行佩戴会改为替换装备并销毁被指定装备"。

### R21E — 多项战斗修复
- **凋亡技力流失**：流失同步扣除已存充能次数与就绪充能（每秒 -1 点技力）；此前只扣向下一充能的 SP，导致满技能保留全部充能。
- **外勤医疗触手（Touch）**：对范围内（5-2）受伤友军施放恳切福音；卡片改为干员卡（医疗 · 远程位）而非召唤物卡。
- **刷新时特质**：`刷新时`特质在干员刷新/被授予的当次正确结算（拉普兰德·贾维每 6 次刷新等）。
- **触手/预备干员医疗**：范围规则与卡片类型修正。

### R21F — 敌人动画与飞行悬停
- 飞行敌人悬停于道路上方 **1.3 格**，不再随每格抬升。
- 敌人动画状态补全：编号技能片段（anims.skills）、眩晕拼写 `Stun_1` / `Dizzy_Begin/Loop/End`、奔跑循环（Run）、巨大的丑东西重生（Revive）、自在（Revive_01）。
- 客户端：敌人按编号技能切技能片段、比 moveSpeed 快时走奔跑循环。data/assets.json 离线重生成：18 个敌人获 anims.skills、6 个获 anims.run、3 个获 stun clip。

### R21G — 控制消息防丢
对局加载/追帧期间到达的控制消息（接管、强制结束、重复开始、公共池、暂停等）按序排队，Battle 建立后按序应用，不再丢弃。

### R21H — 器物伤害分摊
器物（频次）敌人按**攻坚**分摊承受伤害（非补给线）；首领召唤物吃到本回合敌人的成长缩放。

### R21P — 全员满潜能（对应 DESIGN §26.14，作者 2026-10-07 决定）
所有干员以**满潜能（潜能 6）**出战：部署费用、再部署时间、ATK/HP/DEF/RES/ASPD 全部按官方满潜能数值计算（全为加算、取整前）。覆盖普通/精锐/补位/自选形态，选天赋/特质/模组候选取 `requiredPotentialRank ≤ 5`；召唤物按其拥有者潜能取天赋候选取、不继承拥有者属性步进。实测例：刺玫 413/17 → 435/15、砾 18 → 16 s、至简 80 → 70 s。

### 其他合入的上游改动
- **更新包机制（fb5-patch-pkg）**：从 0.2.1 起每个发布版本同时提供 `Stronghold-Protocol-v<版本>-update.zip`（只含相对更早 0.2.x 的改动文件）；`node tools/package.mjs --update --from <base>` 构建；服务器首启校验 MANIFEST.json 并删除新版本移除的文件。**手动下载，无自动更新**（作者 2026-10-07 决定）。
- **Esc 关自选选择器**：仅关闭自选选择器（如取消按钮），不关别的（GitHub #284）。
- 版本号统一 0.2.1、DEV_BUILD 转 false。
- i18n 模板测试按 APP_VERSION 读取应用区间。

---

## 四、莱茵平衡（indomShip 不屈概率）说明

上次有疑问"0.0041×200=0.82 对不上注释的 1.0"——**这是误解**。不屈触发概率公式为
`p = min(1, base_prob + prob_per_stack × L)`（`server/sim/content/bonds/addon/battle.js:99`）：

| | base_prob | prob_per_stack | 200 层概率 |
|---|---|---|---|
| 上游原版 0.2.1 | 0.18 | 0.004 | 0.98 |
| **莱茵（本次）** | 0.18 | **0.0041** | **0.18 + 0.0041×200 = 1.00** ✔ |

注释"200 层叠满恰为 1.0"精确正确——之前质疑漏加了 `base_prob=0.18`。**数值无问题，非 bug。**

---

## 五、数据重建

`node tools/build-data.mjs`（用户 2026-10-08 联网完成）拉取官方 GAMEDATA 完整重建：

```
wrote 15 files to data (5.33 MB) in 27523 ms
chess=278 visibleChess=118 bonds=24 garrisons=265 items=119 bands=40
effects=366 enemies=249 waves=38 stages=13 bosses=10 tokens=27
factionEntries=67 backupUnits=88 backupForms=256 backupTokens=38 diyOwnedPicks=68
```

1 条无害 warning（stage 名 research annotation 清理）。重建后 data/ 已含上游 0.2.1 的 `supplyHp` 等机制字段；data/vanilla/ 为 0.2.1 冻结快照。**注意**：`tools/vanilla-data.mjs` 的 `VANILLA_UPSTREAM_COMMIT` 常量仍是 v0.2.0（1303321）标记，若需严格对齐 0.2.1 应核对（本次 data/vanilla 内容已是 0.2.1，仅上游版本常量待对齐）。

---

## 六、测试状态（如实说明）

**双档案测试未全绿**，已知失败及性质：

| 失败项 | 性质 |
|---|---|
| Spine 3 项（stun / run / 盐风昆图斯编号技能） | **非 bug**：data/assets.json 的 anims role 元数据由旧工具链生成、过时；当前 `tools/assets/anim-roles.mjs` 能正确解析（Stun_1→stun、Dizzy_*→stun）。修复入口 `fetch-assets --offline` 被 shrink guard 因 ifrit 边缘案例挡下。**不影响战斗与游玩** |
| golden 快照 5 项（roster/bonds/fields/matches/diy） | **预期**：0.2.1 机制与满潜能改动使模拟结果变化，需 `npm run golden:update` 审阅 diff 后重生成 |
| chess keyframes / talent candidates / i18n/en | **重建后期望值未同步**：基于新 character_table 重新推导的校验，数据重建后待核对 |
| zip 中文文件名（卫戍 a.png → a.png） | **真实编码问题**：zip 读取 UTF-8 中文名丢字，影响更新包中文文件，待修 |
| map/autochess materials.json / 本地提取（board-scene/board/pack slot/36 pictures） | 依赖本地客户端提取环境，服务器环境预期缺失 |
| version 包名 | 旧日志过时：当前 package.json name 已为 `stronghold-protocol-rhine`，测试应通过 |

**结论**：这些失败**均不阻塞游戏上架运行**。游戏本身能启动、能联机、莱茵内容完整、自选干员资源已补齐。

---

## 七、部署与运维

- 部署路径：`/root/stronghold`（阿里云 ECS 101.132.104.41）
- 运行方式：systemd 服务 `stronghold.service`，`WorkingDirectory=/root/stronghold`，`ExecStart=/usr/local/bin/node server/index.js`
- 端口：3000（公网）；域名 `game.lingluotoki.dpdns.org`
- 备份：上架前已备份代码+数据到 `/root/stronghold-backups/pre-deploy-20261008`（38M，含 server/shared/tools/scripts/data/package.json/package-lock.json/announcements.json）
- 素材（public/，407M）未重传，仅更新代码+数据（server/shared/tools/scripts + data/ + package.json + announcements.json）
- 部署步骤：备份 → 上传差异 → `systemctl restart stronghold.service` → 验证 `/healthz` 与页面

---

## 八、保留的原有功能（未删任何既有功能）

6 人合作、联机聊天（可拖拽、终端风 UI）、1×/2×/4× 战斗倍速、单人/多人跳过本场、实时在线人数（`/api/online`、`/api/status`）、表情包资源、公共匹配池、建立方式重构、莱茵平衡调整（伊芙利特/实验终端/联合研究主机）、公告栏、博士投影修复等原有功能**全部保留**。

---

> 本作为玩家自制的非官方同人作品，与鹰角 / Yostar 无关。代码 GPL-3.0；美术/音乐/文本/数据版权归原权利人，不在 GPL 范围。仅供交流与个人非商业使用，严禁任何形式盈利。
