# 安卓包（内置素材 · 一键启动）

点开即玩的安卓版：**素材全部在 APK 里，只有 `/ws` 与 `/api/*` 出网**。
它是 Windows 便携包 `SP_PROXY_TO`（`scripts/launcher.mjs --mode proxy`）在安卓上的等价物，
客户端代码一行都没改——页面以为自己在跟一台普通服务器说话。

## 它怎么工作

```
WebView  http://127.0.0.1:<随机端口>/
   │
   ├─ /  /js  /css  /data  /shared  /sim  /assets  /vendor  /fonts   ← 手机本地（解包后的 www/）
   ├─ /data.js   /media/…   /healthz                                 ← 本机应答
   ├─ /api/*     → 反代 https://<upstream>                           ← 只有这两条出网
   └─ /ws        → WebSocket 反代 wss://<upstream>
```

- `WwwInstaller.kt` 首次启动把 `assets/www.zip` 解到 `filesDir/www/`，用 `BuildConfig.VERSION_CODE`
  做标记，升级后自动重解。
- `LocalServer.kt` 就是那台"本机服务器"（Ktor CIO）。**它不依赖 `android.*`**，所以能原样跑在
  JVM 单元测试里，见 `app/src/test/.../LocalServerTest.kt`（11 例，含真实连线上服务器拿 `welcome`）。

### 为什么素材打成一个 zip 而不是直接当 AGP assets

AGP 的 `assets.srcDirs` 是把多个目录的**内容**并到同一层，而这四棵树里
`shared/constants.js` 与 `server/sim/constants.js` 同名，并到一层必然互相覆盖。zip 能带路径前缀。

## 构建

前置：**JDK 21**、**Android SDK（platform-tools / platforms;android-34 / build-tools;34.0.0）**、
**Gradle 8.7**。`android/local.properties` 里写 `sdk.dir=<SDK 路径>`。

```bash
# 1) 生成内置素材包（读仓库根的 public/ data/ shared/ server/sim/ + 三份声明 → about/）
node android/make-www.mjs

# 2) 构建（会一并跑 JVM 单元测试）
JAVA_HOME=<jdk21> ANDROID_HOME=<sdk> gradle -p android :app:testDebugUnitTest :app:assembleRelease
```

产物：`android/app/build/outputs/apk/release/app-release.apk`。

**顺序不能反**：`make-www.mjs` 必须在 `assembleRelease` 之前，否则打进包里的还是上一次的素材。
`android/.gitignore` 已排除 `www.zip` 与 `build/`。

### 换服务器

改 `android/gradle.properties` 里的 `SP_UPSTREAM`，重跑上面两条命令。

### 签名

密钥库在仓库外：`F:/android-keystore/stronghold.jks`（口令见 `gradle.properties`）。
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

- APK 约 310 MB，只能侧载（Google Play 单包上限 200 MB）。首次解包后占用约 400 MB，
  加上安装包共约 700 MB。
- 首次启动需要解包 8500+ 个文件，约 10–60 秒。
- 启动界面左下角有一行**诊断信息**（正常 10 秒后自动收起，出错留 30 秒，点一下可立即收起，
  点右下角构建标识可叫回来）。联机出问题时它会把异常链直接写在屏幕上——这一条是爬了四轮坑换来的：
  先有可观测性，再谈修 bug。
- 3D 棋盘依赖 `public/assets/local/`（本机客户端提取物），仓库里已有，重装环境需重新提取。
