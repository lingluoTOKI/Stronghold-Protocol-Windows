# 更新说明 · 0.2.1-rhine.5（六人房逻辑恢复）

日期：2026-10-09

## 本次修了什么

群友（FIFI）反馈：5~6 人联合作战开局机变 / 悬赏决策轮，可选卡片从以前的 **9 个变成了 6 个**，人一多最后有人被迫选到高赏金（"三块"）的卡。

### 根因
合并上游 0.2.1 时，`server/match/Match.js` 构造对局这一行被上游版本覆盖：

```js
// 稳定版 v0.1.4-client（Match.js:267）
this.gd = new GameData(this.data, this.modeId, this.startingPlayerCount);
// 合并后丢失第三参，startingPlayerCount 恒等于默认值 1
this.gd = new GameData(this.data, this.modeId);
```

`startingPlayerCount`（开局占用席位数，含 bot）恒为 1，导致所有"按人数分支"的多人逻辑全部退化到单人分支：

1. **大房悬赏轮 +3**（`choices.js` `largeRoomBountyCards`，条件 `startingPlayerCount >= 5`）从不触发 → 悬赏轮永远只有 6 张；
2. **6 人共享血池 ×2**（`gamedata.js` `startingPlayerCount === 6`）不生效；
3. **开局随机禁盟约数量**（`gamedata.bans()` → `openingBanCounts(difficulty, playerCount, bans)`）按单人算。

### 修复（对照 v0.1.4-client 稳定版原样恢复）
- `server/match/Match.js`：构造时去重统计 `opts.seats` 的真实席位数，存为 `this.startingPlayerCount` 并传入 `GameData`。
- `server/match/choices.js` / `match/spDraft.js`：恢复用 `gd.startingPlayerCount` 判断大房悬赏轮（撤销排查期临时加的独立参数）。
- `server/match/match/phases.js`（`startRound`）：恢复六人信标——满 6 人房在第 **10 / 12 / 14 回合**，每个存活玩家通过 `acquireItem` 获得信标道具 `chess_item_5_04_e_a`；用 `ps.counters['sixPlayerBeacon:<round>']` 持久标记，断线重连 / 重复进回合不会重复发。常量 `SIX_PLAYER_BEACON_ROUNDS = new Set([10,12,14])`、`ROUND_BEACON_ITEM` 加在 phases.js 顶部。

## 修复后行为对照

| 场景 | 修复前（0.2.1 合并后） | 修复后（= 0.1.4 稳定版） |
|---|---|---|
| 5~6 人房 悬赏轮选项 | 恒 6 张 | 6 官方 + 1/2/2 赏金 3 张 = **9 张** |
| 2~4 人房 悬赏轮 | 6 张 | 6 张（不变） |
| 满 6 人房 第 10/12/14 回合 | 不发信标 | 每人发 1 个信标道具 |
| 6 人共享血池 | 按单人（×1） | ×2（稳定版数值） |
| 开局禁盟约数 | 按单人 | 按真实人数（稳定版数值） |

## 验证（由服主本地实测）
- 满 6 人房（真人 + bot 凑满）悬赏轮 → 9 个选项；
- 第 10 / 12 / 14 回合每人背包多一个信标道具；
- 2~3 人房仍为 6 张、不发信标。

## 未改动
- 未引入新的上游代码；纯恢复本扩展在 0.1.4 时代已有的六人逻辑。
- 素材目录 `public/assets`、`node_modules` 不动。
