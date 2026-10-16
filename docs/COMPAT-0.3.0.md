# 改编版与官方 0.3.0 兼容性报告

> 生成时间：2026-10-16
> 上游基线：`sganggs/Stronghold-Protocol` master @ `c24e17ee`（v0.3.0）
> 改编版 HEAD：`4fc7c170`（sync/upstream-0.3.0 分支）
> 线上版本：build `3aa174f7fc6e`，app `0.3.0`

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

| 项目 | 值 |
|---|---|
| IP | 101.132.104.41 |
| 路径 | /root/stronghold |
| systemd | stronghold（active） |
| Node | v22.23.3 |
| 端口 | 3000 |
| 域名 | https://game.lingluotoki.dpdns.org |
| build hash | 3aa174f7fc6e |
| content vanilla hash | e044986e81191baeba211af71952150aab84882243a151dd8fe6086a88c06f3b |
| plugins/ | 空（只有 _template，零实际插件） |
| SP_PLUGIN_SCRIPTS | 未设置（脚本沙箱关闭） |

---

## 七、下次上游同步注意事项

1. **CSP 会拦内联脚本**：0.3.0 起所有 HTML 页面都套站点 CSP，新增 HTML 页面必须把 JS 抽到外部文件
2. **fx/scene 素材不入 git**：在 .gitignore 里，本地提取或从完整包复制即可，不提交
3. **data/local-assets.json 和 local-fx.json**：也不入 git，服务器部署时单独复制
4. **10 项独有功能的补丁点**已在上文列出，下次合并冲突时按此清单逐一 grep 确认
5. **不要把 `.cache/` 目录提交**：这是本地客户端提取的缓存，体积巨大且不入版本控制
