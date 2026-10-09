# 更新说明 · 0.2.1-rhine.4 — 「盟约 / 干员开局不见了」随机禁盟约机制说明与排查结论

> 日期：2026-10-08
> 性质：**机制澄清 + 证据留存，无战斗 / 卡池逻辑改动**（本版不改动任何盟约、干员、ban 算法代码；仅新增游戏内公告与本说明文档）。
> 背景：群友反馈「开局选人时看到叙拉古、阿戈尔亮着，选了 pith、嘉维尔（嘉伟）进游戏后却像被 ban 了 / 盟约凑不起来」，并质疑改版未严格对齐原版。为此对「每局禁用盟约」全链路做了代码 + 真实对局核查，结论如下。

---

## 1. 结论先行

1. **原版（vanilla）的「每局随机禁用盟约」机制经真实对局逐局验证，与上游官方完全一致，不存在改版引入的错误。**
2. 群友看到的「叙拉古 / 阿戈尔不见了」，绝大多数是**官方每局随机禁盟约规则**：险境及以上每局随机禁用一批盟约，叙拉古、阿戈尔这类核心盟约每局约有 **1/3 多**概率被随机禁到，重开一局即换。
3. 群友反馈的「阿戈尔九回合 0 层、鱼不吃鱼、拉特兰杀人不叠层、靠技能叠不上」**不是被 ban**，而是浏览器战斗数据注入遗漏导致盟约战斗效果整体失效——**已在 rhine.3 修复**，需硬刷新后复测。
4. 莱茵档案每局禁 **4** 个核心盟约（原版为 **3**）是莱茵扩展的**有意设计并被发布校验测试锁定**，不是手误，本版不改。

---

## 2. 官方「每局禁用盟约」机制（数据来源：`data[/vanilla]/config.json` 的 `modes.*.inactiveBondIds` 与 `bans`）

| 模式 | 固定禁用盟约（`inactiveBondIds`） | 每局随机禁用 D（核心 / 附加） |
| --- | --- | --- |
| 入门协议 | 无 | 0 / 0 |
| 标准模拟（单人 / 联防） | **固定 10 个**：拉特兰、阿戈尔、卡西米尔、灵巧、奥术、奇迹、投资人、突袭、独行、绝技 | 原版 0/1；莱茵 1/1 |
| 险境模拟 | 无 | **原版 3/4；莱茵 4/4** |
| 绝境模拟 | 无 | **原版 3/4；莱茵 4/4** |
| 终极模拟 | 无 | **原版 3/4；莱茵 4/4** |

ban 判定（`server/match/pool.js` `drawDisabledBonds`，两档案一致）：

- 从该模式激活、权重 `weight>0` 的盟约中，按难度随机抽 `nCore` 个**核心**盟约 + `nAddon` 个**附加盟约**组成本局随机禁用集 **D**；
- 最终禁用集合 `off = D ∪ 模式固定禁用`；
- **一个可见、非 DIY 棋子被移出商店卡池，当且仅当它的「每一个」盟约都在 `off` 中**（`bonds.every(b => off.has(b))`）。只属单个盟约的干员，该盟约一被禁就整名移除；同时挂在另一个未禁用盟约下的干员仍会保留。

### 蒙特卡洛概率（3000 局 / 档，复刻官方算法）

- 原版险境（8 个核心禁 3）：叙拉古、阿戈尔**各约 35%~38%** 概率被随机禁；一局里两者至少一个被禁约 **60%**——「三把两把遇到」与该概率吻合。
- 莱茵险境（9 个核心禁 4，多了莱茵生命）：两者各约 **44%**。
- 只属单一盟约的棋子：只属叙拉古 3 个、只属阿戈尔 5 个，盟约一旦进入 D 即全部移出卡池（其余成员多为双盟约，可能靠另一盟约保留）。

---

## 3. 服务端真实对局验证（不是复刻、不是推断）

用**服务端真实 `Match` 类 + 真实 `data/vanilla` 数据**连跑 12 局险境（seed 1000 起，步长 37），读取每局实际生成并下发给前端的 `disabledBonds / bannedChess`：

- 每局稳定禁用 **7** 个盟约（3 核心 + 4 附加），数量与官方配置一致；
- 12 局中**叙拉古被禁 3 次、阿戈尔被禁 4 次**；
- 叙拉古被禁时移除 5~6 名干员（普罗旺斯、德克萨斯、拉普兰德、伺夜、阿罗玛、缄默德克萨斯、安洁莉娜、荒芜拉普兰德等中只属该盟约者）；
- 阿戈尔被禁时移除 6~7 名（深巡、幽灵鲨、斯卡蒂、海霓、水月、歌蕾蒂娅、乌尔比安、归溟幽灵鲨、浊心斯卡蒂等中只属该盟约者）。

数据链路核查：

- `server/lobby.js` `dataForProfile(rhineEnabled)`：原版房（`rhineEnabled=false`）严格经 `getDataProfile(false)` 加载 `data/vanilla/`（`server/data.js` `VANILLA_DATA_DIR`），**不会被莱茵配置污染**；
- `server/match/Match.js`：`this.dataProfile` / `this.rhineEnabled` 在构造时按房间固化（rhine.2 修复），`this.gd = new GameData(this.data, this.modeId)`，`drawDisabledBonds(this.gd, this.rngSetup)` 在**构造函数内、进入 INFO_CHECK 之前**就完成抽取；
- `server/match/match/views.js` 每帧下发 `disabledBonds / drawnDisabledBonds / bannedChess`，故「确认本局信息」打开时本局禁用集已确定、已下发。

---

## 4. 前端置灰显示链路（完整，无缺失）

- `public/js/ui/matchInfo.js` `matchInfoModel`：纯函数，由 `pub.drawnDisabledBonds`（随机集 D）与 `mode.inactiveBondIds`（固定禁用）算出每个盟约 `stateOf = 'off' | 'drawn' | null`，并由 `pub.bannedChess` 统计每盟约被 ban 干员数；该纯函数有单测 `test/ui/match-info.test.js` 覆盖；
- `MatchBondRow`：被禁盟约外层加 `is-off / is-incomplete`，并向 `BondDisc` 传 `active=false disabled=true tier=0`；
- `public/js/ui/components.js` `BondDisc`：禁用时加 `.is-disabled`、绘制 ✕、盟约环清空；
- `public/css/components.css:365`：`.bond.is-disabled .bond__core { filter: grayscale(1) brightness(.55); }`，名称变暗——**置灰样式存在且生效**。
- 即：被禁盟约在「确认本局信息」右栏会**灰度变暗 + ✕ + 红色被 ban 干员数**，下方「本局禁用干员」给出灰色头像列表。

> 说明：`briefing.css` 中没有 `.brief-bond.is-off/.is-incomplete` 规则，纯上游 0.2.1 同样没有——置灰本就由 `BondDisc` 的 `disabled` 状态负责，不属于样式丢失。

---

## 5. 莱茵档案为何禁 4 个核心（有意设计，勿当 bug 改）

- 上游构建脚本 `tools/build-data.mjs:3692` 的默认值为 `FUNNY 0/1，NORMAL/HARD/ABYSS 3/4`；
- 莱茵档案因新增「莱茵生命」成为第 9 个核心盟约，数值为 `FUNNY 1/1，其余 4/4`；
- `tools/verify-rhine-release.mjs:58-59` **显式断言并锁定**该结果（`FUNNY deepEqual {core:1,addon:1}`、`NORMAL/HARD/ABYSS deepEqual {core:4,addon:4}`）。
- 因此莱茵的 4 是发布校验固化的扩展设定。若日后要改回 3，需同步改莱茵数据构建 / overlay 与该发布测试，属平衡性决策，**不在本次热修范围**。

---

## 6. 「阿戈尔 / 拉特兰像被 ban」实为 rhine.3 已修的战斗 bug

群友所述「九回合阿戈尔 0 层」「鱼不吃鱼了」「圣葬人杀了人拉特兰一直 0 层」「靠技能叠不上层」，根因是双档案重构后浏览器战斗遗漏了 `simdata.setSimData(raw)` 与 `support.setGameData(null)` 初始化，导致战斗全局 `gameData()` 为空、`bondBb()` 全 undefined，阿戈尔吞噬（installEgir）、拉特兰击杀（installLaterano）等安装逻辑抛错被 try/catch 吞掉、叠层失效。

- 该问题已在 **0.2.1-rhine.3** 修复（战斗 runner 每战重设档案数据、内容层 `withGameData` 包裹、全模式开启 `layerGainsEnabled`）；
- 玩家若仍复现，**先 Ctrl+F5 硬刷新 / 手机清缓存**确认加载 rhine.3，再反馈并注明版本号。

---

## 7. 两个易混界面的官方行为

- **干员调配 / 自选编队（loadout / diy）是局外持久设置**：配置自带干员、装备技能模组、4 个自选槽，`public/js/screens/loadout.js` 明确「自选编队是局外设置：本局按开局时的设置进行，修改下一局生效」。它**不随单局随机禁用变化**，所以该界面盟约图标常亮是正常的，不代表本局商店必刷。
- **「确认本局信息」（INFO_CHECK）才展示本局随机禁用**：被禁盟约灰度 + ✕ + 被 ban 干员头像，开局前应在此确认本局可凑阵容。

---

## 8. 关于 pith、嘉维尔（嘉伟）的盟约归属（数据核查）

- **pith = `char_616_pithst`「盟约·辅助干员」**：`bonds = [maniShip, emptyShip]`，tier1、`visible=false`、PRESET 预设，**不属于叙拉古 / 阿戈尔**；
- **嘉维尔（百炼嘉维尔 `char_1026_gvial2`）**：`bonds = [sargonShip]`（萨尔贡），**也不属于叙拉古 / 阿戈尔**。
- 因此「选了 pith、嘉伟 → 叙拉古 / 阿戈尔被 ban」在盟约关系上不构成因果。若仍有具体异常，需提供「确认本局信息」右栏截图与所选模式、是自选槽还是商店招募，才能精确定位；在拿到截图前不对卡池 / 盟约代码做猜测性改动。

---

## 9. 本次改动清单与部署

- 新增游戏内公告 `announcements.json` 条目 `0.2.1-rhine.4`（随机禁盟约机制说明 + rhine.3 硬刷新复测引导）；
- 新增本说明文档；
- **无服务端 / 战斗 / 卡池 / 前端逻辑代码改动**，无需重启对局服务；公告文件走 `/api/announcements` 热更新（部署 `announcements.json` 后下次请求生效）。

### 给玩家的一句话

> 险境以上每局开局会随机禁掉几个盟约（叙拉古、阿戈尔这些每局有三分之一多概率被禁），开局「确认本局信息」里灰色打 ✕ 的就是本局不能凑的，换人或重开一局即可；阿戈尔 / 拉特兰叠不上层的问题已修复，请 Ctrl+F5 硬刷新后再试。

---

*本作为玩家自制的非官方同人作品，与鹰角 / Yostar 无关；代码 GPL-3.0，美术 / 音乐 / 文本 / 数据版权归 Hypergryph / Yostar。免费游玩，严禁任何形式盈利。*
