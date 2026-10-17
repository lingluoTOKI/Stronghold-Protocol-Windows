# 改编版与官方 0.3.0 兼容性报告

> 生成时间：2026-10-16（2026-10-17 更新部署状态）
> 上游基线：`sganggs/Stronghold-Protocol` master @ `c24e17ee`（v0.3.0）
> 改编版 HEAD：`4fc7c170`（sync/upstream-0.3.0 分支）
> 线上版本：3000 → build `ca3acf158f35`；3001 → build `7eef62337ba2`，均为 app `0.3.0`

---

## 一、代码层面兼容性

### 与完整包（Stronghold-Protocol-v0.3.0.zip）逐文件对比

| 类别 | 数量 | 说明 |
|---|---|---|
| 完整包代码文件 | 828 | 排除 node_modules/assets/.git/packs |
| 我们代码文件 | 2425 | 含 .cache 本地提取缓存、改编版独有文件 |
| **我们缺** | 3 | 见下表 |
| **我们多** | ~1600 | 绝大多数是 `.cache/` 本地提取缓存（不入 git） |
| **大小不同** | 50 | 全部是我们 10 项独有功能的改编点 |

### 缺失文件处理

| 文件 | 大小 | 状态 |
|---|---|---|
| `MANIFEST.json` | 1.0 MB | **不需要**——官方发布包的文件校验清单，git 拉取的源码没有这个，正常 |
| `data/local-fx.json` | 1.2 MB | **已补齐**——0.3.0 官方战斗特效清单，已复制到本地和服务器 |
| `public/assets.zip` | 814 MB | **不需要**——官方"导入素材包"功能用的打包文件，我们服务器直接 serving 单文件 |

### 大小不同的 50 个文件 = 10 项独有功能落点

以下文件均为改编版故意修改，与官方 0.3.0 兼容（上游新逻辑完整保留，我们的补丁叠加在上游之上）：

**服务端（8 个）：**
- `server/index.js`（+3.7 KB）：六人房、公告 API、proxy 接入、admin token 鉴权
- `server/lobby.js`（+10 KB）：六人房匹配（MATCH_TARGET=6）、快速匹配超时三选一
- `server/http/routes.js`（+9.8 KB）：/api/online、/api/announcements、/api/admin/*（monitor 大屏）、/healthz CORS
- `server/http/boot.js`、`server/http/websocket.js`、`server/http/csp.js`：CSP 放行 monitor 外部 JS
- `server/match/Match.js`、`server/match/builtinMeta.js`：六人房血量/经济适配

**前端（18 个）：**
- `public/js/battle/runner.js`（+8.3 KB）：倍速 1×/2×/4×、跳过本场
- `public/js/ui/hud.js`（+5.9 KB）：SpeedButton、跳过按钮、拖拽聊天
- `public/js/screens/title.js`（+7 KB）：公告弹窗、信封按钮
- `public/js/screens/lobby.js`（+8.6 KB）：快速匹配、公告栏
- `public/js/screens/game.js`（+2.7 KB）：倍速倒计时平滑
- `public/js/screens/room.js`、`public/js/main.js`、`public/js/store.js`：六人房 UI
- `public/css/screens/*.css`（5 个）：公告栏、聊天拖拽、六人房样式
- `public/i18n/en.json`、`public/index.html`：文案和入口

**文档/配置（6 个）：**
- `package.json`（+628 B）：我们的启动脚本
- `README.md`（+8.7 KB）：改编版说明
- `docs/DEPLOY.md`、`docs/PLAYING.md`、`docs/PLUGINS.md`：本地小修
- `scripts/launch.mjs`（+1.9 KB）：proxy 模式、HOST='::' 双栈监听

---

## 二、素材层面兼容性

### 已全部补齐

| 素材目录 | 官方完整包 | 我们 sp-clean | 服务器 |
|---|---|---|---|
| audio（中/日/英/韩/本土语音） | 360.9 MB / 12064 | ✅ 已有 | ✅ 已部署 |
| spine（干员 Spine 动画） | 226.9 MB / 2021 | ✅ 已有 | ✅ 已部署 |
| ui（UI 图标/边框） | 39.4 MB / 639 | ✅ 已有 | ✅ 已部署 |
| char/enemy/item/skill/prof/band/token | ~94 MB | ✅ 已有 | ✅ 已部署 |
| **local/fx（官方战斗特效）** | 184.8 MB / 12534 | ✅ **本次补齐** | ✅ **已部署** |
| **local/scene（11 战场新场景）** | 73.7 MB / 137 | ✅ **本次补齐** | ✅ **已部署** |
| local 其他（表情/图标等） | ~74 MB | ✅ 已有（1605 项） | ✅ 已有 |
| **assets 总计** | **1056 MB / 31014** | **1062 MB / 31155** | **已与完整包一致** |

### 清单文件

- `data/local-assets.json`：已从官方完整包复制（1690 项，旧版 1601 项已备份为 .bak）
- `data/local-fx.json`：已从官方完整包复制（1.2 MB，0.3.0 新增）

---

## 三、10 项独有功能自检

| # | 功能 | 状态 | 关键文件 |
|---|---|---|---|
| 1 | 六人房（MAX_SEATS=6） | ✅ | shared/constants.js, server/match/* |
| 2 | 1×/2×/4× 倍速 | ✅ | public/js/battle/runner.js, ui/hud.js |
| 3 | 倍速倒计时平滑 | ✅ | public/js/screens/game.js |
| 4 | 跳过本场 | ✅ | runner.js skipBattle, hud.js 按钮 |
| 5 | 可拖拽聊天+表情 | ✅ | public/js/ui/chat.js |
| 6 | 公告栏（热加载） | ✅ | announcements.json, server/http/announcements.js |
| 7 | /api/online 在线人数 | ✅ | server/http/routes.js |
| 8 | 公开/快速匹配 | ✅ | server/lobby.js MATCH_TARGET=6 |
| 9 | monitor.html 大屏 | ✅ **本次修复 CSP** | public/monitor.html + public/js/monitor.js |
| 10 | 3 个 bat + proxy/launcher | ✅ | scripts/launch.mjs, server/http/proxy.js |

---

## 四、本次同步关键修复

### 4.1 monitor.html CSP 拦截
- **问题**：0.3.0 上游加了严格 CSP（`script-src 'self' 'sha256-<importmap-hash>'`），monitor.html 的内联 JS 被浏览器拦截，大屏数字全空
- **修法**：把 monitor.html 第 330-733 行的内联 `<script>`（21102 字符）抽到外部 `public/js/monitor.js`，HTML 改为 `<script src="/js/monitor.js"></script>`，符合 `script-src 'self'`
- **提交**：`4fc7c170`

### 4.2 官方特效素材补齐
- **问题**：本地只有 1605 项 local 素材，缺 12671 个 fx/scene 文件（258 MB）
- **修法**：从完整包复制 `local/fx/` 和 `local/scene/`，连同 `data/local-fx.json` 一起上传服务器
- **结果**：服务器 assets 从 848 MB → 1106 MB，与完整包一致

---

## 五、锁定值确认（未动）

| 配置 | 值 | 位置 |
|---|---|---|
| deployCap | 8 | data/config.json economy |
| BAN FUNNY | 0/1 | shared/openingBans.js |
| BAN NORMAL/HARD/ABYSS | 3/4 | shared/openingBans.js |
| BAN TRAINING | 0/0 | shared/openingBans.js |
| host | `::`（双栈） | scripts/launch.mjs |
| MAX_SEATS | 6 | shared/constants.js |
| MATCH_TARGET | 6 | server/lobby.js |
| SP_ADMIN_TOKEN | `tYP6cVr7KO8eTlDLZbF2xwhI` | systemd 环境变量 |

---

## 六、服务器部署状态

同一台 ECS（101.132.104.41）上并存两套独立服务，共用一份素材与 node_modules。

| 项目 | 3000（本改编版） | 3001（`卫v0.5-0.3` 包） |
|---|---|---|
| 路径 | `/root/stronghold` | `/root/stronghold-3001` |
| systemd | `stronghold`（active，开机自启） | `stronghold-3001`（active，开机自启） |
| 端口 | 3000 | 3001 |
| 域名 | https://game.lingluotoki.dpdns.org | **https://alliance.lingluo-toki.top** |
| IP 直连 | http://101.132.104.41:3000 | http://101.132.104.41:3001 |
| build hash | `ca3acf158f35` | `aa7046189839` |
| content vanilla hash | `e044986e81191baeb…` | `e82a94f015efa3c70…` |
| 证书到期 | 2027-01-03 | 2027-01-15 |

共用项（两套服务相同）：

| 项目 | 值 |
|---|---|
| Node | v22.23.3 |
| 素材 | `public/assets` 均为软链 → `/root/stronghold/public/assets`（16,705 个文件 / 758,184,113 字节） |
| node_modules | `stronghold-3001/node_modules` 软链 → `/root/stronghold/node_modules` |
| 素材清单 | `local-assets.json` 1,690 项、`local-fx.json` 9,187 项，两份 md5 完全一致 |
| plugins/ | 空（只有 `_template`，零实际插件） |
| SP_PLUGIN_SCRIPTS | 未设置（脚本沙箱关闭） |

### 6.1 nginx 与域名

nginx 1.18.0 监听 80/443，按 `server_name` 分流；`sites-enabled/` 下四项：

| 配置文件 | 域名 | 去向 |
|---|---|---|
| `game.conf` | game.lingluotoki.dpdns.org | 根路径 → 3000；`/backup/` → 116.62.39.28:3000 |
| `alliance.conf` | alliance.lingluo-toki.top | 根路径 → 3001（含 WS 升级） |
| `zz-eye-diagnosis.conf` | lingluo-toki.top / www | 眼健康诊断系统 → 本地 8000 |
| `default` | 兜底 | `/var/www/html` |

证书均为 Let's Encrypt + certbot webroot，`--deploy-hook` 自动 `systemctl reload nginx`。

### 6.2 ⚠️ 该游戏必须部署在域名根路径

客户端的 `public/index.html` 用**根路径绝对地址**（`href="/js/webFonts.js"`、`href="/fonts/fonts.css"`），
WS 也固定拼 `ws(s)://<host>/ws`（`public/js/net.js`）。因此**不能用子路径反代**
（如 `location /alliance/ { proxy_pass http://127.0.0.1:3001/; }`）：页面在子路径下打开时，
资源请求会打到该域名根路径（即 3000），WS 也会连进 3000 的大厅——HTTP 表面返回 200，实际是串服。
2026-10-17 已删除 `game.lingluotoki.dpdns.org/alliance/` 这条错误的子路径反代（现返回 404），
备份在 `/etc/nginx/sites-available/game.conf.bak-rm-alliance-20261017-135128`。

新增端口时一律新开子域名并在**根路径**反代。

### 6.3 部署 3001 的步骤（2026-10-17 实际执行）

1. 上传包里排除 `public/assets`、`node_modules`、`.cache` 与 `plugins/.studio-key`（工作台密钥不入服务器），其余约 940 个文件 / 13 MB。
2. 解包到新目录，`public/assets` 与 `node_modules` 软链到 `/root/stronghold` 下的同版本副本（先用 md5 确认清单一致）。
3. **必须在备用端口试跑**（`PORT=30099 node server/index.js`）再切换：首次打包时 `robocopy /XD assets`
   误伤了 `tools/assets/`，服务启动即因 `ERR_MODULE_NOT_FOUND: tools/assets/atlas.mjs` 崩溃，靠试跑拦下。
4. 试跑通过后才 `systemctl stop` → 换目录 → `systemctl start`，避免打断在线对局。
5. 回滚：`systemctl stop stronghold-3001 && mv stronghold-3001 stronghold-3001-failed && mv stronghold-3001-old stronghold-3001 && systemctl start stronghold-3001`。

代码备份：`/root/backups/stronghold-3001-pre-upstream-20261017-133831.tgz`（旧 0.2.1 代码）；
旧目录完整保留在 `/root/stronghold-3001-old`。

### 6.4 3001 的移植与定制记录（2026-10-17）

3001 跑的是 `卫v0.5-0.3` 包（含莱茵档案、444 干员）+ `升级包v0.51-0.3-无尽beta`，
**不是**本仓库 `sp-clean` 的代码。为让它具备本改编版的联机能力，从 `sp-clean` 移植了 6 项功能，
另对上游代码做了 4 处修改。全部改动都在服务器的 `/root/stronghold-3001/` 下：

| 改动 | 文件 | 说明 |
|---|---|---|
| 公告栏 | `server/http/announcements.js`、`server/index.js`、`server/http/routes.js`、`public/js/screens/title.js`、`announcements.json` | 从 sp-clean 移植 |
| 在线人数 | `server/http/routes.js`（`GET /api/online`） | 从 sp-clean 移植 |
| 监控大屏 | `public/monitor.html`、`public/js/monitor.js`、`routes.js` 的 `/api/admin/*` | 从 sp-clean 移植 |
| 战斗倍速 1×/2×/4× | `public/js/battle/runner.js`、`public/js/ui/hud.js`、`public/js/screens/game.js` | 从 sp-clean 移植 |
| 跳过本场 | 同上 + `game.css` | 从 sp-clean 移植 |
| proxy 反代 | `server/http/proxy.js`、`server/http/websocket.js` | 从 sp-clean 移植（便携包用） |
| **放宽无尽模式限制** | `server/lobby.js` | 上游只允许本地端开；改为可用 `SP_ENDLESS_LOCAL_ONLY=1` 恢复 |
| **补 `room.list` 接口** | `shared/protocol.js`、`server/lobby.js`、`server/net.js` | 上游缺失，导致大厅在线数与房间列表永远为空 |
| **补梅尔水獭模型** | `data/assets.json`、`tools/assets/local-token-spines.json` | 上游提取工具漏项，素材在但清单没登记 |
| **修公告弹窗层级** | `public/js/screens/title.js`、`public/css/screens/title.css` | 弹窗被 `.title-main` 层叠上下文困住，z-index 再高也盖不住 |

**没有移植的**（如需再补）：六人房、聊天表情、快速匹配、本机/PC 联机脚本。

> ⚠️ 3001 的这棵代码树**不在任何 git 仓库里**。本地的 `_merge3001` 是线上代码的完整副本，
> 但没有版本控制。改动前务必先备份（见 6.3 的更新流程）。

---

## 七、下次上游同步注意事项

1. **CSP 会拦内联脚本**：0.3.0 起所有 HTML 页面都套站点 CSP，新增 HTML 页面必须把 JS 抽到外部文件
2. **fx/scene 素材不入 git**：在 .gitignore 里，本地提取或从完整包复制即可，不提交
3. **data/local-assets.json 和 local-fx.json**：也不入 git，服务器部署时单独复制
4. **10 项独有功能的补丁点**已在上文列出，下次合并冲突时按此清单逐一 grep 确认
5. **不要把 `.cache/` 目录提交**：这是本地客户端提取的缓存，体积巨大且不入版本控制
6. **3000 与 3001 已共用同一份素材目录**（软链）。更新 3000 的 `public/assets` 会同时影响 3001；
   若将来两套服务的素材版本需要分叉，必须改成独立副本，否则会出现「素材与代码版本不匹配」。
   反过来，两套服务代码版本不同也会让 `data/assets.json` 的清单哈希对不上（现为
   `e044986e…` vs `dfcbcee9…`），排查素材问题时要按各自端口分别看清单。
7. **打包排除规则要用精确路径**：`robocopy /XD assets` 这类命名匹配会误伤任意层级的同名目录
   （`tools/assets/` 就被误删过），排除项必须写完整路径。
8. **改 nginx 前先 `nginx -T | grep server_name` 查重复**：`sites-enabled/` 里残留的软链接
   （例如指向 `game.conf` 自身的 `game.conf.bak-*`）会让同一份配置被加载两遍，表现为
   `conflicting server name ... ignored` 警告，容易掩盖真实问题。2026-10-17 已清理一处。
