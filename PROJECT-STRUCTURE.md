# PROJECT-STRUCTURE.md — 项目导览（给 AI / 新接手者快速上手）

> 本文档一句话说明每个目录/文件是干什么的，以及**打包后如何验证联机可用**。
> 最后更新对应版本：`0.1.4-rhine.7`（主分支 `rollback/live-7fc0606`）。

---

## 0. 这是什么游戏

《卫戍协议：盟约 / Stronghold Protocol》——明日方舟同人**自走棋**网页游戏，
**网页联机**为主，也打包成 PC 便携包 / 安卓 APK。非官方同人，美术音乐版权归原权利人，
代码 GPL-3.0，**严禁盈利**。

核心玩法：选阵营盟约 → 买干员编队 → 回合制自动战斗（棋盘上塔防式自动对决）。
支持 1~6 人合作 / 联机房间。

---

## 1. 目录速览

```
Stronghold-Protocol-Windows-v0.1.0/
├── server/          Node 后端：HTTP + WebSocket 房间/对局逻辑
│   ├── index.js       入口：起服务、静态文件、反代(proxyTo)、healthz
│   ├── lobby.js       房间大厅：建房/进房/名单/匹配
│   ├── net.js         WebSocket 连接封装
│   ├── match/         一局对局：Match.js 主循环、choices.js 盟约候选、
│   │                  match/phases.js（回合阶段/六人房信标道具）、
│   │                  match/spDraft.js、builtinMeta.js（物品 handler）
│   ├── sim/           战斗确定性模拟（前后端共用逻辑，也打进 APK 的 /sim）
│   └── http/          HTTP 路由（公告、在线人数、admin 踢人）
├── public/          前端（浏览器）：index.html + js/ + css/ + assets/(素材/图集/spine)
│   ├── js/           main.js、data.js、ui/（bonds.js/bondStrip.js/dataProfile.js/title.js…）
│   └── assets/       游戏美术素材（300+MB，仓库内已有，不进 git 的部分见 ASSET 规则）
├── shared/         前后端共享常量/工具（注意：与 server/sim/constants.js 同名，APK 用 zip 前缀隔开）
├── data/           游戏数据（莱茵档案 rhine）：
│   ├── *.json        chess/bonds/items/waves/stages/effects/tuning…
│   ├── vanilla/      ★ 纯原版（上游 v0.2.x 冻结）数据，与莱茵完全隔离
│   └── local-assets.json  本机美术索引（缺它→"准备就绪"点不动）
├── tools/          构建/数据工具脚本（.mjs）：
│   ├── build-data.mjs     从官方 GAMEDATA 抓数据生成 data/*.json
│   ├── rhine-data.mjs     莱茵档案数据适配层（★ 改数值/平衡看这里）
│   ├── vanilla-data.mjs   原版数据层
│   ├── package.mjs        npm run package 发布 zip
│   ├── vendor.mjs / fetch-assets.mjs / fetch-rhine-assets.mjs  素材下载
│   └── golden.mjs / doctor.mjs / verify-rhine-release.mjs  校验
├── scripts/        启动器与打包辅助：
│   ├── launcher.mjs       ★ 三模式：local(本机开服) / proxy(本机素材+远程对局) / connect(浏览器开远程)
│   ├── launch.mjs         实际拉起 server/index.js
│   ├── make-windows-bundle.mjs  打 PC 便携包（--server <host> 烤进联机地址）
│   └── zipdir.mjs         写 zip（规避 Windows GBK 文件名问题）
├── android/        安卓壳（原生 WebView）：
│   ├── app/src/main/java/.../MainActivity.kt   解包素材→起 LocalServer→WebView
│   ├── .../LocalServer.kt      本机静态服务 + 反代 UPSTREAM（/ws /api 转发线上）
│   ├── .../WwwInstaller.kt    assets/www.zip 首次解包
│   ├── make-www.mjs      把 public+data+shared+server/sim 打成内置 www.zip
│   ├── build.gradle.kts  ★ versionCode/versionName/UPSTREAM 在这
│   └── gradle.properties  SP_UPSTREAM=线上服务器地址
├── test/           测试套件（双档案：test:rhine / test:vanilla）
├── docs/           设计文档（DESIGN/SIM/MULTIPLAYER/BALANCE/RHINE…）
├── release-notes/  更新说明（各版本公告 md）
├── dist/           ★ 对外交付包（PC zip + APK）
├── announcements.json   游戏内公告（热更新，scp 到服务器即可）
└── monitor.html        监控大屏：看两台服务器在线人数、按房间分组、踢人
```

---

## 2. 关键命令（package.json scripts）

| 命令 | 作用 |
|---|---|
| `npm start` | 起本地服务器（`node server/index.js`），默认 3000 |
| `npm run build-data` | 重新抓官方数据生成 `data/*.json` |
| `npm run test:rhine` | 跑莱茵档案测试 |
| `npm run test:vanilla` | 跑原版测试 |
| `npm run typecheck` | `tsc --noEmit` 类型检查 |
| `npm run package` | tools/package.mjs 打完整发布 zip（含素材） |
| `npm run package:lite` | 不含素材的精简包 |

> Windows PowerShell 下 `SP_TEST_PROFILE=vanilla node ...` 这种写法会报错（不是内部命令），
> 需要用 `cmd /c "set SP_TEST_PROFILE=vanilla&& node ..."` 或 cross-env。

---

## 3. 双档案（原版 / 莱茵）隔离机制

- **data/** = 莱茵档案（改编内容，盟约/干员/装置）。
- **data/vanilla/** = 纯原版（对齐上游 sganggs/Stronghold-Protocol v0.2.x）。
- 服务端 `getDataProfile()` 按房间选择加载哪套；`Match` 构造时固化 `this.dataProfile/rhineEnabled`。
- 对局广播 `m.public` 必须下发 `rhineEnabled/dataProfile`，前端据此渲染——**串档 bug 的根因就在这**：
  若广播缺这两个字段、前端默认回退成莱茵，原版房就会冒出莱茵盟约。
- 原则：**原版房 = 纯原版内容，莱茵房才出莱茵内容**，两套互不串。

---

## 4. 联机架构（三种"连主服"的方式）

主服务器：`http://game.lingluotoki.dpdns.org`（ECS，公网 IP 101.132.104.41，systemd 服务名 `stronghold`，目录 `/root/stronghold`）
纯原版备用服：`http://116.62.39.28:3000`

```
方式 A：纯网页         浏览器直接打开主服网址（页面+素材+对局全走服务器）
方式 B：PC 便携包      本机素材快，只把 /ws + /api 反代到主服（= launcher --mode proxy）
方式 C：安卓 APK      内置素材解到手机本地，LocalServer 起 127.0.0.1，/ws /api 反代 UPSTREAM
```

后两种 = "本机素材 + 远程对局"，进游戏快、几乎不耗玩家带宽。

---

## 5. ★ 如何测试打包出来的东西能不能联机

### 5.0 先确认主服本身活着（任何打包前必做）
浏览器开或 curl：
```
http://game.lingluotoki.dpdns.org/healthz
```
应返回 `{"ok":true,"sockets":<在线连接数>,"matches":<战斗中房间数>,...}`。
连不上 = 服务器问题，跟你的包无关。

### 5.1 测 PC 便携包（dist/sp-pc-bundle.zip）
1. 解压 zip 到一个目录（**路径不要含特殊字符**）。
2. 双击 **`联机.bat`**（等价 `launcher --mode proxy --server game.lingluotoki.dpdns.org --yes`）。
3. 看黑窗口输出：
   - 应先探测主服 `https://game.lingluotoki.dpdns.org/...` 有响应；
   - 然后本机起在 `127.0.0.1:3000` 并自动开浏览器。
4. 浏览器里：**素材秒开**（说明走本机素材）→ 进大厅 → 点建房 → 拿到房间码。
5. **联机真连通验证**：另开一个浏览器标签（或另一台设备开 `http://game.lingluotoki.dpdns.org`），
   用房间码加入同一个房，双方都能看到对方、能同时点"准备"。
   → 两个端能在同一房间实时看到彼此 = /ws 反代成功，联机 OK。
6. 本机代理自检：浏览器开 `http://127.0.0.1:3000/healthz` 应 `ok:true`。

### 5.2 测安卓 APK（dist/卫戍协议-安卓联机-*.apk）
1. 允许「未知来源」后安装（versionCode 已递增，可覆盖旧版）。
2. 首次启动解包素材约 10–60 秒（屏幕显示进度）。
3. **重点看屏幕左下角黄字诊断行**：
   - 成功：出现 `WS 上游已连上` / 上游探测 OK，10 秒后自动收起。
   - 失败：会写明证书/反代/网络问题（这行是特意留的，截它就能定位）。
4. 进大厅建房，再用另一台设备（或另一手机）加入同房间，确认实时同步。
5. 右下角常驻构建标识显示版本名（`0.1.4-rhine.7-r11`），点一下可叫回诊断行。

### 5.3 联机不通时的排查顺序
1. `/healthz` 通不通？→ 不通是服务器挂了，重启 `systemctl restart stronghold`。
2. PC 包：黑窗口报"连不上这台服务器"？→ 地址烤错（`联机.bat` 里 `--server` 后的值）。
3. APK：诊断行报什么？→ http/https 协议、证书、UPSTREAM 配错。
4. 页面能开但进房对方看不到？→ /ws WebSocket 反代问题（不是素材问题）。

---

## 6. 打包命令速查（本机构建）

环境：JDK21（`C:\Program Files\Java\jdk-21`）、Android SDK（`F:\android-sdk`）、Gradle 8.7（`F:\gradle-8.7`）。

```powershell
# 安卓 APK：① 先合成内置素材，② 再构建
node android/make-www.mjs
$env:JAVA_HOME="C:\Program Files\Java\jdk-21"; $env:ANDROID_HOME="F:\android-sdk"
& "F:\gradle-8.7\bin\gradle.bat" -p android :app:assembleRelease --console=plain
# 产物：android/app/build/outputs/apk/release/app-release.apk
# ★ 发新版前务必把 android/app/build.gradle.kts 的 versionCode +1（否则覆盖安装失败）

# PC 便携包（--server 烤进联机地址）
node scripts/make-windows-bundle.mjs --server game.lingluotoki.dpdns.org --zip --out <输出目录>
```

改线上服务器地址：安卓改 `android/gradle.properties` 的 `SP_UPSTREAM`；PC 包改 `--server` 参数。

---

## 7. 部署铁律（对线上主服操作时）

- **绝不动**服务器上的 `public/assets`（素材）和 `node_modules`。
- 改 `server/*.js` → 上传后 `systemctl restart stronghold`。
- 改 `public/*` → 玩家需 **Ctrl+F5** 硬刷新。
- 游戏内公告只需 scp `announcements.json`，不用重启。
- SSH：root@101.132.104.41（用 plink/pscp，密码在用户处，不要写进仓库）。

---

## 8. 常见"我以为是 bug"实为预期

- 多开浏览器标签 = 在线人数 +N（WebSocket 每连接算一个，正常）。
- 联合作战/多人房设计上禁止战斗中叠层（`layerGainsEnabled:false`）。
- APK 约 427MB、首启解包 10–60 秒、占约 700MB，是已知限制。
- 游戏切后台再回偶尔有重复 BGM / 简化视图降级，多为 WebView/WebGL 环境问题。
