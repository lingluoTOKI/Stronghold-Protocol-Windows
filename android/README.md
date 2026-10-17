# 安卓包：本地美术、服务器更新

2026-10-17 修复版保持同一应用 ID 和正式签名，构建版本码提升为 302，可覆盖安装上一包。

- 页面、JS、CSS、游戏数据、战斗模拟、插件与健康检查从选中的服务器加载；公告和联机同样走服务器。服务器更新后重新打开页面即可获取更新，不必为游戏代码重新安装 APK。
- APK 内置美术、字体、语音、音乐、3D 场景及官方特效；`/data/local-assets.json`、`/data/local-fx.json` 使用包内清单。
- 正确解析 `/assets/~哈希/…`、`/fonts/~哈希/…`、`/media/~哈希/…`。本地文件与请求哈希一致才使用；缺失或哈希不同则从服务器加载，避免返回错误版本的素材。
- 不再在联网失败时使用旧的包内游戏代码，避免新旧战斗协议混用。此包需要联网，不能离线进行对局。
- 主服为 http://101.132.104.41:3000，保留设置中的切服功能。
- WebView 关闭旧响应缓存，游戏代码更新跟随服务器；本地存储中的玩家设置和身份保留。

构建前运行 `node android/make-www.mjs`，随后用 JDK 21、Gradle 8.7 和 Android SDK 34 构建 `:app:assembleRelease`。签名从已忽略的 `android/keystore.properties` 读取，勿公开口令。版本码必须高于上一包。

首次启动会解压内置资源，需要额外存储空间。服务器以后新增或修改的素材可能需要联网下载；只有 APK 内已有且匹配的素材才能从本地直接加载。

包内保留 LICENSE、NOTICE.md 与 THIRD-PARTY-NOTICES.md。素材版权归原权利人，严禁盈利。

### 为什么素材打成一个 zip 而不是直接当 AGP assets

AGP 的 `assets.srcDirs` 是把多个目录的**内容**并到同一层，而这四棵树里
`shared/constants.js` 与 `server/sim/constants.js` 同名，并到一层必然互相覆盖。zip 能带路径前缀。

## 构建

前置：**JDK 21**、**Android SDK（platform-tools / platforms;android-34 / build-tools;34.0.0）**、
**Gradle 8.7**。`android/local.properties` 里写 `sdk.dir=<SDK 路径>`。

```bash
# 1) 生成内置素材包（读仓库根的 public/ data/ shared/ server/sim/ + 三份声明 → about/）
node android/make-www.mjs

# 2) 构建（单元测试按需另跑）
JAVA_HOME=<jdk21> ANDROID_HOME=<sdk> gradle -p android :app:assembleRelease -PSP_VERSION_CODE=302 -PSP_VERSION_NAME=0.3.0-android.2
```

产物：`android/app/build/outputs/apk/release/app-release.apk`。

**顺序不能反**：`make-www.mjs` 必须在 `assembleRelease` 之前，否则打进包里的还是上一次的素材。
`android/.gitignore` 已排除 `www.zip` 与 `build/`。

### 换服务器

改 `android/gradle.properties` 里的 `SP_UPSTREAM`，重跑上面两条命令。

### 签名

密钥库在仓库外：`F:/android-keystore/stronghold.jks`（口令只从环境变量或已忽略的 `keystore.properties` 读取）。
没这个文件时会退回 debug 签名，仍可侧载但不适合分发。

> ⚠️ **务必备份这个 jks**。丢了就再也无法给已安装的用户发更新，只能让他们卸载重装。

## 分发前检查

- [ ] `node android/make-www.mjs` 跑过，且 `www.zip` 里含 `about/LICENSE`、`about/NOTICE.md`、
      `about/THIRD-PARTY-NOTICES.md`（`make-www.mjs` 找不到会直接报错）
- [ ] 启动界面能看到：「非官方同人作品 · 与鹰角网络及其关联方无关 / 素材版权归原权利人 · 严禁盈利」
- [ ] `versionCode` 比上一版大（否则装不上去）
- [ ] 记下 `SHA-256` 一并发布，方便对方校验

发出去时请**连同 `群发说明.txt` 一起**：素材版权在原权利人手里，不适用 GPL，也不得单独再分发。

## 已知限制

- 本次 APK 约 804 MB，只能侧载（Google Play 单包上限 200 MB）。首次解包后占用约 1.1 GB，
  加上安装包需要约 2 GB 可用空间。
- 首次启动需要解包约 32000 个文件，约 10–60 秒。
- 启动界面左下角有一行**诊断信息**（正常 10 秒后自动收起，出错留 30 秒，点一下可立即收起，
  点右下角构建标识可叫回来）。联机出问题时它会把异常链直接写在屏幕上——这一条是爬了四轮坑换来的：
  先有可观测性，再谈修 bug。
- 3D 棋盘依赖 `public/assets/local/`（本机客户端提取物），仓库里已有，重装环境需重新提取。
