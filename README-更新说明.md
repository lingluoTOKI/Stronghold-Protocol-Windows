# 本次更新说明（2026-10-07）

本文档记录 **0.1.4-rhine.6** 这次更新的全部内容、实测数据、运维变更与已知限制。
面向维护者；给玩家看的简版在游戏内公告栏（`announcements.json`）。

---

## 一、为什么做这次更新

线上服务器（阿里云轻量，nginx → node:3000）的**公网出口实测只有 17–105 KB/s**，抖动极大。
素材此前已经迁到阿里云 OSS，但**开局必须下载的东西还有一大半仍在挤这条管子**：

| 内容 | gzip 后 | 改动前实测 |
|---|---|---|
| `/data/assets.json` | 70 KB | **45 秒仍未下完** |
| `/data/chess.json` | 156 KB | **45 秒仍未下完** |
| `/data/vanilla/chess.json` | 149 KB | **45 秒仍未下完** |
| `/data/local-assets.json` | 190 KB | **30 秒以上仍未下完** |
| `/vendor/pixi.min.js` | 137 KB | **45 秒仍未下完** |
| `/vendor/three.core.js` | 288 KB | **39.9 秒** |

也就是说，玩家开局光等这些就要一两分钟，而 WebSocket 对战流量还要和它们抢同一条出口。

---

## 二、对局数据与前端库迁移 OSS

把这两个前缀也搬到阿里云 OSS（`weishuxieyi-game-res`，上海），由 nginx **302** 过去，
**客户端一行代码都没改**：

```nginx
location ~ ^/(data|vendor)/ {
    return 302 https://weishuxieyi-game-res.oss-cn-shanghai.aliyuncs.com$request_uri;
}
```

用 302 而不是 301：301 会被浏览器永久记住，将来想改回本地很麻烦。

### 实测效果

| 文件 | 改动前 | 改动后 |
|---|---|---|
| `/data/assets.json` | 45 秒超时 | **441 ms** |
| `/data/chess.json` | 45 秒超时 | **1.30 s** |
| `/data/vanilla/chess.json` | 45 秒超时 | **1.59 s** |
| `/data/local-assets.json` | 30 秒+ 超时 | **536 ms** |
| `/vendor/pixi.min.js` | 45 秒超时 | **864 ms** |
| `/vendor/three.core.js` | 39.9 s | **1.25 s** |

7 个文件合计从「5 个下不完」降到 **6.18 秒**。

### 内容一致性

上传前后逐字节校验过：`data/*.json` 与 `public/vendor/*` 在**本地仓库、线上服务器、OSS 三方 md5 完全一致**，
确认这次改动是纯粹的「换条路送同样的东西」，没有悄悄改变任何游戏数据。

---

## 三、素材加载容错（OSS 回退）

### 问题

OSS 的防盗链与 CORS 白名单**只放行 `http://localhost:3000`** 一条。实测：

| 请求 | 结果 |
|---|---|
| `Referer: http://localhost:3000/` | 200 |
| `Referer: http://192.168.1.23:3000/`（局域网） | **403** |
| `Referer: http://example.com/` | **403** |
| `Origin: http://127.0.0.1:3000` | **不返回 `Access-Control-Allow-Origin`** |

配合 `public/js/assets.js` 里 `img.crossOrigin = 'anonymous'`，**除「开服那台机器用 localhost 打开自己」
以外，所有玩家取素材都会被拒**：局域网玩家、走 Cloudflare 隧道的远程玩家全中招。

> 注意：**游戏域名的白名单是正常的**（`https://game.lingluotoki.dpdns.org` 实测 200 且 CORS 通过），
> 上面说的是局域网地址这一类。

### 做法

把 OSS 从「唯一来源」改回「优先来源」，失败即回退到服务器自带的 `/assets/` 副本：

* `public/js/assets.js`
  * 新增 `ossOn` 开关与 `disableOss()` / `enableOss()` / `ossEnabled()`，`rewriteAssetUrl()` 依据开关决定是否改写；
  * 新增 `probeOss()`，启动时问一次 OSS 是否可用。**只有传输层失败（DNS / 连接被拒 / 超时）或 403 才关掉 OSS**；
    404 说明 bucket 应答正常、只是探针路径不对，为此把所有玩家切回服务器反而更糟；
  * `image()`：单张图 OSS 失败即关闭开关并改用本地副本重试一次，之后所有 URL 直接走本地；
  * `spine.load`：骨架 OSS 失败后关掉开关并用本地 URL 重新加载一次（`rewriteAssetUrl` 改为每次尝试时求值，
    重试才能寻址到本地副本）；
  * `imageNow()`：同时接受 OSS 键与本地键，否则回退后已加载的图会查不到。
* `public/js/audio.js`：取音拆成 `grab(target)`，OSS 失败则关闭开关并用本地 URL 重试一次。
* `public/js/main.js`：启动时 `probeOss()`，不阻塞首屏（竞态由逐次回退兜底）。
* `test/render/oss-fallback.test.js`：**新增 14 个测试**，覆盖开关语义、图片/骨架回退、
  404 与 403 的区别对待、探针只问一次。

**这只是止血**：回退意味着素材改走服务器，而迁到 OSS 本来就是为了省这个带宽。
要根治，需要在阿里云控制台把**防盗链**和**跨域 CORS**（两个独立设置）都补上局域网地址段。

---

## 四、修好的问题：游戏脚本加载失败

### 现象

部分玩家页面报 **「游戏脚本加载失败」**。

### 原因

本次一度把 `/js` 与 `/css` 也 302 到 OSS，结果拆断了前端模块图。

ES 模块的相对说明符是**按「导入方模块自己的 URL」解析**的，而 `public/js/` 里的模块大量引用 `/js` 之外的东西：

```
audio.js / net.js / render/*.js / ui/*.js
    -> ../../shared/constants.js        ../../../shared/protocol.js
    -> ../../../shared/rhineRange.js    ../../../shared/media.js
    -> ../../../shared/loadoutRecord.js /sim/constants.js
```

`/js/` 一旦由 OSS 提供，`../../shared/constants.js` 就解析成
`https://weishuxieyi-game-res.oss-…/shared/constants.js` —— bucket 上没有这个对象，浏览器拿到 404，
模块图当场断裂。

### 处理

**已回滚**：`/js`、`/css` 回到服务器提供。`/data`、`/vendor` 仍在 OSS（那才是大头）。

完整的逃逸清单（以后若要迁 `/js`，这些必须一起迁）：
`/shared/{constants,highGround,loadoutRecord,media,openingBans,protocol,rhineRange,rhineResearch}.js`
与 `/sim/constants.js`。

**结论：`/js` 不迁。** 它的收益（gzip 后约 400 KB ≈ 十几秒）远小于「模块图被拆到两个源」的风险。
`/css` 技术上可以单独迁（`public/css` 里只有 `data:` 与 `url(#…)`，没有外部引用），收益小，暂不做。

---

## 五、发版工具与运维变更

### 新增 `scripts/publish-static-to-oss.mjs`

把由 nginx 302 到 OSS 的目录（`/data`、`/vendor`）同步到 OSS。

```bash
npm run publish:oss:check   # 只比对 OSS 上对象的 ETag 与本地 md5，列出不一致项
npm run publish:oss         # 同步（首次迁移、以及每次改过 data/ 之后）
```

* **逐个文件显式指定目标 key**，不用 `ossutil cp -r`：后者是把源目录的**内容**倒进目标前缀，
  少写一级前缀就会把文件撒到 bucket 根目录（迁移时踩过一次，删了 42 个错位的键）。
* 缓存策略：`/data` = `no-cache`（随发版改变，浏览器仍会带 `If-None-Match` 回源校验）；
  `/vendor` = 一年。
* 凭据只留在 ossutil 自己的配置里（`ossutil config`），脚本不接触、不打印。

### 改过 `/data` 就要重跑同步

否则玩家拿到的还是 OSS 上的旧数据，而且没有任何报错会提醒你。

### 线上 nginx

改动集中在 `/etc/nginx/sites-available/game.conf`，已备份两份：

* `game.conf.bak-20261007-144338` —— 加 `/data` `/vendor` 之前
* `game.conf.bak-20261007-145910` —— 加 `/js` `/css` 之前（**回滚用的就是这份**）

回滚方式：

```bash
cp /etc/nginx/sites-available/game.conf.bak-20261007-145910 /etc/nginx/sites-available/game.conf
nginx -t && systemctl reload nginx
```

### 服务器上的代码备份

`/root/stronghold/backups/pre-oss-fallback-20261007-144853/`

---

## 六、Windows 便携包

* 三个启动器（`启动游戏.bat` / `本机当服务器.bat` / `连接服务器.bat`）适配新根目录布局并**纳入版本库**。
* `scripts/make-windows-bundle.mjs` 补回上游的安全护栏：
  * 原来 `--force` 会**无条件 `rm -rf` 掉 `--out` 指定的任何目录**（`--out C:\Users\你 --force` 就是删用户目录）；
    现在拒绝指向仓库本身或其上级的 `--out`，且只肯删空目录或「上一次打的便携包」，认不出来就什么都不删。
  * `Expand-Archive` 的路径补上 PowerShell 单引号转义（含 `'` 的路径原先会被截断）。
  * `copyDir` 跳过点开头的条目（打包机自己的 `.DS_Store` 原先会被打进玩家的包）。
* 包内说明修正两处**错误陈述**：不能声称「这个包不访问外网」（页面里仍有 Google Fonts 外链），
  也不能说「本包按 GPL 分发」（素材版权在原权利人手里，GPL 覆盖不到）。补齐素材版权、不适用 GPL、
  不得单独再分发、可要求立即删除、不提供担保等声明。

---

## 七、测试

`npm test` 原先用 `node --test` 自动发现，会把仓库里留着的参考克隆副本
（`rhine_ref/` 343 个、`rhine_upstream/` 298 个 `*.test.js`）一并跑掉，凭空多出几百个失败。

改为 `node --test "test/**/*.test.js"`（真实测试全部位于 `test/` 之下）：

| | 之前 | 现在 |
|---|---|---|
| 测试数 | 10646 | 3695 |
| 耗时 | 7 分 22 秒 | **116 秒** |
| 失败 | 394 | 114（**均为仓库原有**，与本次改动无关） |

改动前后对同一文件的对照：`test/render/assets.test.js` 两次都是 29 个测试 / 25 通过 / 4 失败，完全一致。

---

## 八、当前的线上架构

```
浏览器
  ├─ /                     → nginx → node:3000   （HTML）
  ├─ /api/*, /healthz, /ws → nginx → node:3000   （公告、健康检查、WebSocket 对战）
  ├─ /js/, /css/           → nginx → node:3000   （客户端脚本；不可迁 OSS，见第四节）
  ├─ /shared/, /sim/       → nginx → node:3000   （被 /js 引用的共享模块）
  ├─ /assets/              → 客户端直连 OSS（assets.js 的 rewriteAssetUrl）
  ├─ /data/, /vendor/      → 302 → OSS
  └─ /fonts/, /manifest.json, /icon.svg → nginx → node:3000
```

OSS 上的对象：

| 前缀 | 对象数 | 说明 |
|---|---|---|
| `/assets/` | 6332 | 素材（上一版迁移） |
| `/data/` | 36 | 对局数据 |
| `/vendor/` | 7 | 前端库 |
| `/js/` `/css/` | 98 | **已无用**（迁移回滚后不再被访问），可删可留 |

---

## 九、已知限制与后续

1. **服务器出口带宽是硬瓶颈**（17–105 KB/s，轻量机产品限制）。本次迁移把大头绕开了，
   但 `/js`、`/css`、`/shared`、`/sim`、字体仍从它过（gzip 后约 500 KB），开局仍有十几秒等待。
2. **重启才会刷新 build 标记**：`server/index.js` 的 `buildCache` 缓存在内存里。
   重启会让在线对局中断，所以挑人少时做。
3. **`/data/local-assets.json` 是每台服务器自己的本地素材清单**（3D 棋盘靠它判断能否启用），
   也已同步到 OSS。重新提取本地素材后必须重跑 `npm run publish:oss`。
4. 轻量服务器高峰期宿主机资源争抢导致带宽被压缩，属于产品特性，无法彻底根除。

---

## 十、安全提醒

* 本次调试期间 **OSS AccessKey 与服务器 root 密码都出现在对话记录里**，建议尽快轮换：
  在阿里云控制台禁用旧 AccessKey 并新建；服务器上执行 `passwd`。
* 轮换 AccessKey 后需要重跑一次 `ossutil config`（本机配置在 `~/.ossutilconfig`），
  否则 `npm run publish:oss` 会失败。
* **不要**把 AccessKey 写进版本库或任何脚本。
