# 溢流服分流：主服满员才开放

**目标机**：杭州 `116.62.39.28:3000`（版本 0.2.1，`/root/stronghold`）
**建立时间**：2026-10-18

## 为什么

这台机器是**按量计费**，主服（3000）和契约服（3001）是包月。
主服还有空位的时候，不该让玩家跑到这台来烧流量。

所以它当**溢流服**：主服满 10 人才开放，否则拒绝新玩家。

## 逻辑

```
新玩家连入（hello 握手）
  ↓
溢流服当前开放吗？（每 15 秒后台刷新一次）
  ↓
主服 humans ≥ 10 ？
  ├─ 是 → ✅ 放行
  └─ 否 → 🚫 拒绝
        「这边流量按量计费，主服和契约服有空位时不开放」
```

**只拦新会话**：带 token 的重连走 `resumed` 分支，不受影响——已经在玩的人掉线还能回来。

## 为什么不再要求契约服也满

最初的条件是「主服和契约服都满 10 人才开放」。但契约服常年只有 1–2 人，
这个条件几乎永不成立 —— 这台按量计费的机器一直付钱、一直不开。

2026-10-18 晚上改成**只看主服**。契约服照旧可以用，只是不再作为开放的前置条件。

## 判断口径

用 `/api/online` 的 **`humans`**（房内真人），不是 `online`（连接数）：

- 不算机器人
- 不算已离开的
- 不算掉线中的座位
- 一个人开两个标签页算 1 个
- 挂着大厅没进房间的**不算**（否则一个挂机就让溢流服误判「满了」）

## 读不到怎么办

主服查不到人数（网络抖动、超时 2.5 秒）→ **当作「没满」**，即不开放。

理由：宁可让人去包月的主服，也不要因为一次网络抖动就把人放进按量计费的机器。

## 依赖

前两服的 `/api/online` 必须带 `humans` 字段：

```bash
curl https://game.lingluotoki.dpdns.org/api/online   # {"online":14,"humans":11}
curl https://alliance.lingluo-toki.top/api/online    # {"online":6,"humans":3}
```

**这个字段是 2026-10-18 才加到 3000/3001 的。** 如果主服回退到不带 `humans`
的版本，溢流服会一直「读不到 → 当作没满 → 不开放」，表现为杭州服进不去。

排查：`journalctl -u stronghold | grep overflow` 会打出
`[overflow] 开放（主服 10/10 · 契约服 2/10）` 这种明细，`?` 表示那台没读到。

## 部署

```bash
# 把本目录传到目标机
scp -r _hangzhou-overflow root@116.62.39.28:/root/overflow-patch
ssh root@116.62.39.28 'cd /root/overflow-patch && bash apply-overflow.sh /root/stronghold'
ssh root@116.62.39.28 'systemctl restart stronghold'
```

脚本是幂等的（已改过的跳过），改之前自动备份到 `/root/backups/overflow-<时间戳>/`。

⚠️ **重启前先看有没有人在玩**：

```bash
curl -s http://127.0.0.1:3000/healthz   # humans 是 0 再重启
```

这个项目里踩过好几次「部署失败导致重启循环打断对局」，重启前确认是硬规矩。

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `server/overflow.js` | **新建**（约 90 行）：查询前两服人数、15 秒缓存、后台 watcher、同步读取 |
| `shared/constants.js` | 加 `OVERFLOW_CLOSED` 错误码与中文文案 |
| `server/net.js` | `onHelloMsg` 的 `registry.create` 之前加分流检查（约 10 行） |
| `server/index.js` | `http.createServer` 之前 `startOverflowWatcher({ log })` |

## 调参

都在 `server/overflow.js` 顶部：

```javascript
export const OVERFLOW_THRESHOLD = 10;   // 主服达到几人算「满」
const CACHE_MS   = 15_000;              // 多久刷新一次（也是握手时结果的最大陈旧度）
const TIMEOUT_MS = 2_500;               // 单次查询超时
```

改完重启即可。**没有做成配置文件**——这里的取值很固定，不值得为它加一套热加载。

## 已验证

**2026-10-18 19:24（旧逻辑：两服都满）**：

```
[overflow] 关闭（主服 10/10 · 契约服 1/10）
[net] refuse new player 给: overflow closed (主服 7/10 · 契约服 1/10)
```

**2026-10-18 20:00（新逻辑：主服满就开）**：

```
[net] refuse new player 1: overflow closed (主服 9/10 · 契约服 2/10)   ← 主服 9 人，仍拦
[overflow] 开放（主服 10/10 · 契约服 2/10）                            ← 主服满了，开放
```

两次都按预期工作。
