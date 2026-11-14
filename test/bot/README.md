# QQ 无密码账号 —— 联调脚本

三条链路各自独立复跑，都不需要重启线上游戏服或机器人。

## 目录

| 文件 | 作用 |
| --- | --- |
| `account-bridge-check.py` | 机器人侧断言：直接调用线上真实插件 `game_account.py` 的 `verify_game_account()`，覆盖正常绑定 + 7 种拒绝路径 |
| `account-bridge-fixture.mjs` | 隔离的账号服务夹具：只起 `server/accounts/http.js`，不启动游戏服，不碰线上数据 |
| `run-bot-e2e.sh` | 在 astrbot 容器内闭环跑「生成绑定码 → 机器人验证」 |

夹具必须跑在**容器内**：插件只允许 `http://127.0.0.1` / `https://`，宿主机网关地址（`172.18.0.1`）会被判为「通道尚未配置完成」。

## 机器人侧（在服务器上跑）

```bash
# 1) 上传脚本
scp test/bot/account-bridge-check.py      root@<host>:/tmp/sp-fixture-check.py
scp test/bot/account-bridge-fixture.mjs    root@<host>:/tmp/sp-fixture-fixture.mjs
scp test/bot/run-bot-e2e.sh                root@<host>:/tmp/run-bot-e2e.sh

# 2) 执行（脚本内部会拷进容器、起夹具、生成绑定码、跑断言、清理）
ssh root@<host> 'bash /tmp/run-bot-e2e.sh'
```

期望输出结尾为 `ALL_BOT_ASSERTIONS_PASSED`。

## 后端 + 浏览器（本地跑）

```bash
# 后端：真实服务进程 + 真实 websocket 会话 + 真实 SQLite
node --test test/account-e2e-live.test.js

# 浏览器：真实 Chrome + 真实前端 + 真实后端（走 puppeteer-core + 系统 Chrome）
node --test test/account-browser-e2e.test.js
```

浏览器测试需要本机装 Chrome（`CHROME_PATH` 可覆盖路径）；没有 Chrome 时该用例自动 skip。

## 注意事项

- **origin 白名单必须与浏览器实际发送的 `Origin` 完全一致（含端口）**。`createAccounts` 在构造时就把 `origin` 固定下来，所以测试里必须先定好端口、再设 `SP_ACCOUNT_ORIGIN`、最后启动服务；改环境变量为时已晚。
- 桥接密钥只从服务器上的 `/var/lib/stronghold-accounts/3000.env` 读取，不要写进仓库或命令行历史。
- 夹具的 SQLite 落在 `/tmp/sp-fixture/`，是临时数据，与线上 `/var/lib/stronghold-accounts/accounts.sqlite` 无关。
