# 卫戍协议：盟约 · Stronghold Protocol: Alliance

《明日方舟》季节性自走棋塔防玩法「卫戍协议：盟约」的**非官方同人复刻**：浏览器即开即玩，单人或最多 6 人联机合作。

![version](https://img.shields.io/badge/version-0.3.1-2ea44f)
![license](https://img.shields.io/badge/code%20license-GPL--3.0--or--later-blue)
![node](https://img.shields.io/badge/node-22%20%7C%2024-339933)

## 2026-10-20 客户端展示与横屏修复

永久成就与每日挑战各增加独立奖章展板，入口与单人／多人按钮同行。永久 31 枚采用双核展翼构图，每日 21 枚采用 7×3 蜂巢；全屏按可用宽高等比例缩放，默认一屏完整展示。只显示章面，真实获得才点亮，点击查看条件、进度和获得时间，不改变玩家数据，也不读取排行榜。小屏顶栏约 49px，返回保留 44px 点击区域，支持减少动态效果。

修复手机统计页容器裁切展板的问题；房间页小屏顶栏将标题与操作按钮分行，避免按钮遮挡模拟模式。上述为前端热更新，不重启服务。

[离线美术审核与客户端演示](output/imagegen/review-v2/index.html)提供点亮／未点亮对照、永久／每日客户端布局演示；演示进度不是玩家成绩。[全点亮背景板](output/imagegen/review-v2/all-lit-board.html)及 [PNG](output/imagegen/review-v2/all-lit-board.png)仅供美术审核。

## 休整期存档与重启恢复

新增可选 SQLite 恢复：在休整期入口保存，重启后原玩家确认再继续。存储工作线程独立，保留上一份快照，结算防重复奖励。只保证同代码／同内容版本恢复；快照之后的操作需重做，首次部署前的旧对局无法恢复。玩法插件房暂不支持，存档异常保留并报告。详见 [恢复规则与运维](docs/MATCH-RECOVERY.md)。

## 2026-10-20 更新：挑战轮换与完整蚀刻章收藏

**用户已批准验证后部署并重启主服。本轮一起启用扩展成就与休整期恢复；启用当天保留旧每日目标与成绩，次日开始七天轮换。联盟服不在本轮重启范围。** 21 个每日目标分成七天，每天三项、周内不重复，第八天重复第一天；每榜每天最多 3 分，同分并列。终极模拟、官方 1 倍、全程无 AI 队友／托管、本人存活，单人／多人分开。

每日收藏 21 枚，永久收藏 31 枚，覆盖全部 23 种盟约。采用已确认的薄几何章框、深色珐琅底、清晰主题符号；每枚独立图案，按需加载。房间可查看目标，排行榜点击才读取，收藏可按分类／获得状态筛选；横屏按钮统一。

旧章、日期、进度、积分和恢复码保留。旧 6 人炎章继续有效，9 人档新增独立章。新通关累计仅承接可核实的历史下限，不把重叠条件相加。实际启用当天保留旧目标与成绩，次日启用轮换；新对局跨日按开局日期计分。

记录在 runtime/daily-challenges.json，主备原子保存、迁移前副本和有限日快照；部署前另存异地／本地运维备份。身份恢复码只需一份，不能代替服务器备份或浏览器本地战绩导出。本轮不改写本机对战记录。

保留之前日期的公告，只把今天多条更新合并成一栏置顶，今天的原文另存于 [公告归档](docs/announcements/20261020-before-consolidation.json)。完整规则见 [每日轮换](docs/DAILY-CHALLENGES.md)、[永久成就与兼容](docs/PERMANENT-ACHIEVEMENTS.md)、[审核清单](docs/REVIEW-CHALLENGES-20261020.md)。

## 2026-10-20 更新：同步上游安装与跨平台修复

本轮从已合入的上游 `d905c146` 同步至 `c9d804f470b8d7422ae04eb66faf671cef21ad52`，补齐 master 的 8 个提交。提交标题中的“0.3.2”是上游开发标签；上游本次未修改版本字段，本项目继续显示 **0.3.1**。

- **素材完整性检查**：安装与诊断流程只认可非空的普通文件。素材路径被同名目录占用或文件为空时，不再误判为已安装；新增回归测试覆盖这些情况。不会在此次部署中自动启动整包素材下载。
- **Windows 导出测试**：本地干员导出夹具按平台路径格式匹配，修复 Windows 下分隔符造成的误报。
- **插件宿主测试**：浏览器模拟目录排除 Node 专用的 `nodeData.js`；对局模块通过文件 URL 加载，避免 Windows 盘符被当成模块协议。
- **皮肤守卫测试**：比较仓库路径前统一为 `/`，兼容 Windows。
- **Python 特效导出**：保留本地已有的日志预计算写法，避免旧版 Python 无法解析嵌套 f-string；与上游 Python 3.8–3.11 兼容修复目的相同。此处为唯一合并冲突，不改变特效导出内容。
- **改编功能保留**：本次没有修改六人房、个人部署位、开局 BAN、信标奖励、倍速、跳过、聊天、匹配、素材导入和监控大屏；没有修改 `server/sim/`、`data/` 或游戏渲染。

线上采用主服文件增量更新，保留已有公告并追加本轮说明；不覆盖素材、提取清单、依赖、插件、运行配置或联盟服独立玩法。此次变更不涉及游戏进程已加载的模块，无需为工具和测试更新重启对局服务。安卓安装包未重新构建。

验证结果与部署记录见 [本轮同步记录](docs/SYNC-20261020.md)。上游提交可在 [master 提交记录](https://github.com/sganggs/Stronghold-Protocol/commits/master/) 核对。

## 2026-10-17 更新：上游修复与安卓本地素材

本轮已由维护者确认测试通过。上游基线从 `c24e17ee` 后续同步至 `6ab2468279e926d107788f63d7fe219b85f67b4a`；相对同步前分支新增 **16 个提交、24 个文件改动**，无合并冲突。上游提交标题中的 0.3.1 属于开发中的兼容修复，本版不冒称正式 0.3.1 发布。

### 上游 16 个提交的更新内容

- 插件作者测试：预加载模块使用 `file://` URL，避免 Windows 盘符被误认为模块协议；显式使用 Node spec 报告，终端、重定向和不同 Node 版本输出一致。
- 测试入口：`npm test` 与 CI 仅运行明确列出的测试文件，不再把 `test/` 下的辅助模块、子进程入口及 Forge 夹具作为独立测试执行；同步维护文档和测试列表一致性断言。
- 跨平台兼容：Forge 语言别名测试覆盖区分大小写的文件系统；浏览器加载测试在 Windows 也正确排除 `nodeData.js`；Docker 上下文检查兼容 CRLF / LF。
- 子进程与工作台：SIGKILL 上限探测先确认子进程进入准备阶段；看门狗断言检查子进程确实退出；忽略 SIGTERM 的探测用例给予 12 秒准备时间。
- 异步等待：战斗运行器内容加载测试使用与模拟刷新一致的 `setImmediate`；插件房间启动、首个对局状态、插件设置与内容就绪等待上限改为 20 秒；大厅限流测试单次往返上限改为 10 秒，并区分正常丢弃请求与超额洪泛。
- CI 配置：测试任务超时从 25 分钟调整为 40 分钟；修正文档注释及脚本排版。
- 本轮未修改 `server/sim/`、`data/` 或官方渲染。六人房、悬赏与信标、BAN 补偿、倍速和平滑倒计时、跳过、聊天、公告、在线人数、匹配、监控、PC / 安卓联机均保留。

### 安卓修复包 0.3.0-android.2（versionCode 302）

- 修复 `/assets/~哈希/…`、`/fonts/~哈希/…`、`/media/~哈希/…` 本地路径解析。带哈希的请求核对本地文件 SHA-256 前 16 位，一致才使用；缺失或不匹配时从服务器获取。
- 美术、字体、语音、音乐、3D 场景及官方战斗特效优先使用内置文件；本地场景与特效清单对应包内素材，包含 12,534 个特效文件、137 个场景文件及 7 个字体文件，两个清单引用均无缺失。
- 页面、JS、CSS、规则数据、战斗模拟、插件、健康状态、公告及联机来自所选服务器，避免旧 APK 游戏逻辑与新服务器混用。WebView 不复用旧响应缓存，服务器更新后重新打开页面即可获取代码更新；服务器不可达时不回退过期游戏代码。
- 主服 `http://101.132.104.41:3000`，保留切服功能。新增或变更的素材可能仍需联网；本包不是离线单机版。
- 沿用上一包的正式签名及应用 ID，版本码由 301 提升至 302，可覆盖安装；APK 约 806 MiB，首次解压后额外占用约 1.1 GiB。
- 本地安装包：`dist/StrongholdProtocol-0.3.0-20261017-android-local-art.apk`（不入 Git）；SHA-256：`11996a68e3f623a582d9c2b8e4251385f46c18fb69669664c623397e518109c5`。构建和签名校验通过，真机与游戏验收由维护者完成。

本轮公告保留历史条目。部署保留服务器 `node_modules`、`public/assets`、字体、提取清单、插件及运行配置，不上传 APK / 美术文件；完成后核对服务健康与公告接口。

## 声明

> [!IMPORTANT]
> - 本项目是玩家自制的**非官方同人作品**，与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方**没有任何关系**，未获其授权或认可。
> - 《明日方舟》及「卫戍协议」相关的名称、角色、美术、音乐、音效、文本与数据等素材，版权归原权利人所有。这些素材**不适用**本项目的 GPL-3.0 许可证；GPL 只覆盖本项目自己编写的代码。
> - 仅供学习交流与个人非商业使用。**严禁任何形式的盈利**，包括但不限于：售卖本项目或整合包、付费下载或付费分发、收费服务器或收费代开、广告 / 打赏 / 会员等变现方式，以及其他任何商业用途。
> - 仓库源码不包含游戏的美术与音频素材（只有由官方数据表生成的数据和几张游戏截图，同样不适用 GPL）；[Releases](../../releases/latest) 中的完整包为了方便玩家附带了素材（精简包不带，首次启动时从公开镜像下载），下载即视为同意本声明。请勿将素材用于本项目以外的用途或单独再分发。完整条款见 [NOTICE.md](NOTICE.md)。
> - 权利人如认为本项目侵犯其权益，请通过 Issue 联系，我们会**立即删除**相关内容。
> - 本项目按「现状」提供，**不提供任何担保**，使用风险自负。

English summary: [below](#english).

## 联机增强版说明（Alliance Edition）

本仓库在**官服 0.3.0 纯净基线**之上，额外保留了自托管联机增强功能：**6 人合作**（9 张悬赏、合作信标、共享首领血池、按人数补偿 BAN）、**1×/2×/4× 倍速**、**跳过本场**、**可拖拽聊天 / 表情**、**服务器公告栏**、**在线人数**、**公共快速匹配**、**监控大屏（踢人 / 公告）**、**PC 与安卓联机脚本**。本版**不含莱茵生命资料片**（它将作为相互隔离的独立插件，稳定后再回归），原版房即纯官服内容。

- 本次完整更新记录：[docs/CHANGELOG-ALLIANCE.md](docs/CHANGELOG-ALLIANCE.md)
- 以后同步上游、又不丢失独有功能的提示词与流程：[docs/1UPSTREAM-SYNC-PROMPT.md](docs/1UPSTREAM-SYNC-PROMPT.md)
- 独有功能落点清单：[docs/FEATURES-ALLIANCE.md](docs/FEATURES-ALLIANCE.md) ；莱茵剥离说明：[docs/RHINE-REMOVAL.md](docs/RHINE-REMOVAL.md)
- 在线游玩：主服 <http://game.lingluotoki.dpdns.org> ；备用纯原版 <http://116.62.39.28:3000>

### 本版详细更新（0.3.0-alliance）

**基线与结构**
- 以官服 `sganggs/Stronghold-Protocol` **0.3.0（commit `c24e17ee`）** 为基线同步，本轮上游新增 390 个 commit、807 个文件改动，**上游内容零遗漏、零删除**。上一轮基线为 0.2.6（`488db49f`）。
- **继续剥离莱茵生命资料片**：科研装置、盟约、双档案分流保持下线；原版房即纯官服内容。
- 保留全部自托管联机增强（见下），并把它们重新接到上游 0.3.0 的新代码上（本版服务端接线、内容指纹、插件系统改动较大，已逐项核对）。

**官服同步新增（0.3.0）**

*插件系统（本版主线）*
- **正式引入「插件」体系**：装饰插件（外观 / 个人 / 房间）、数据插件（补丁、紧凑记录、干员 kitRef / SkillSpec、模式、i18n）、每房独立内容集、DSL-lite、沙箱脚本 API、界面插件、插件 Studio 创作工具全部就位。
- **内容指纹 `cs`**：每个对局都会计算 `sha256` 内容指纹（代码 + 数据 + 插件 + 设置），客户端校验收到的字节与服务端一致；插件房默认标记为「非官方」、不计入战绩总览，官方本体永远是默认，插件不覆盖官方文件。
- **插件只装在服务器、由房主选择**：不跑任何未经服主与玩家明确同意的第三方代码；P0 阶段插件房对玩家体验零影响（golden 结果字节不变）。

*美术 / 资源*
- **标题界面新增「资源下载 / 导入」按钮**：首次进游戏可按需下载美术包，离线 / 精简包也能从素材包 zip 或本机 `public/assets` 导入；这部分美术不再从开服电脑逐一下载。
- **新增 VFX 战斗特效体系**：官方战斗特效（用本机客户端提取的 `.skel` / 贴图）作为可选「官方特效」开启。
- **官方场景按客户端着色器重新打光**并补上水面；伊利昂的木驮兽和「越长尘」会载客；冻结后手动刷新会取消冻结。

*界面 / 规则*
- **新增局内「作战统计」面板**（仅本机可见、不上传）：实时伤害 / 治疗统计，大厅加了 metrics 开关按钮。
- 机器人的布阵、采购和演习改进；其余干员 / 盟约 / 数值修复严格按官服结算。

**保留的独有联机 / UI 功能**
- 六人合作：座位扩到 6；悬赏轮刷 9 张、R10/R12/R14 合作信标、六人首领共享血池、开局 BAN 按人数补偿（五人少 1、六人少 2，最低 0）。
- 战斗 1×/2×/4× 倍速（本地确定性模拟），倒计时在倍速下平滑流动。
- 跳过本场：敌人全部出场后可跳过，残存敌人冲家扣血并直接进入下一轮买卖（联合作战 / Boss 关不可用）。
- 可拖拽聊天与表情、服务器公告栏（强制 / 常驻）、大厅在线人数、公共快速匹配（凑满即开，超时补 AI）。
- 监控大屏 monitor.html：按房间查看玩家、踢人、关房、发布 / 撤回强制公告（主服直连 `/monitor.html`）。
- PC 与安卓均可联机，附 Windows 一键「本机开服 / 联机」脚本；联机（本机客户端）模式只反代 `/ws` 与 `/api/*` 给中心服务器，页面与素材走本机磁盘。

**本轮同步的兼容性说明**
- 上游 0.3.0 引入了内容指纹 `cs` 与 `/cs/<cs>/` 每房内容集路由；合并时把这些新逻辑与改编版的 `proxy.js` 反代、公告栏接口、六人房 BAN / 信标、倍速 / 跳过钩子**全部重新接回**，`node --check` / `check:imports` / golden / `node --test` 全绿。
- 本机本地提取工具 `tools/local-extract/fx.py` 做了 Python 3.11 兼容（嵌套 f-string 预计算），便于在没有 Python 3.12 的环境下从本机《明日方舟》PC 客户端提取官方特效 / 3D 棋盘 / 召唤物 Spine。

### 上一版详细更新（0.2.6-alliance）

**基线与结构**
- 以官服 `sganggs/Stronghold-Protocol` **0.2.6（commit `488db49f`）** 为基线同步，本轮上游新增 58 个 commit、93 个文件改动，**上游内容零遗漏、零删除**。上一轮基线为 0.2.5（`cf7a9400`）。
- **继续剥离莱茵生命资料片**：科研装置、盟约、双档案分流保持下线；原版房即纯官服内容。
- 保留全部自托管联机增强（见下），并把它们重新接到上游 0.2.6 的新代码上（本轮服务端接线改动较大，已逐项核对）。

**官服同步新增（0.2.6）**

*开服流量（本轮主线，对玩家是纯收益）*
- **静音不再下载背景音乐**：静音或把「背景音乐」音量调到 0 时不再下载 BGM，重新打开声音后才下载当前该放的曲子（关音乐的玩家每局少下约 7–14 MB）。
- **WebSocket 消息压缩**：1 KB 以上的消息用 permessage-deflate 压缩，一局单人对局的服务器消息实测从 173 KB 降到 60 KB。
- **素材内容哈希长期缓存**：图片 / 模型 / 音频地址带内容哈希（`/assets/~<hash>/…`），浏览器可缓存一年；服务器更新、重新解压或 Docker 重建后只重新下载**内容变了**的文件。哈希存在 `.cache/asset-hashes.json`（后台构建、不阻塞启动），`SP_ASSET_INDEX=0` 可关闭。
- **brotli 压缩**：浏览器只在 HTTPS 页面和 localhost 上使用；`.skel` 与数据文件比 gzip 再小约四分之一。
- **教程图转 WebP**：本地提取的「玩法说明」图另存 WebP（质量 90，25.6 MB → 4.2 MB），看说明时只预载下一页。
- **流量统计**：`/healthz?traffic=1` 显示服务器发出的各类流量（**只对本机 / 局域网访问显示**，维护者 2026-10-12 决定）；「问题反馈」诊断信息增加本页下载量。
- 部署指南补充：固定访问地址、反代开 HTTP/2、Cloudflare 缓存规则。

*规则（按官方）*
- **维什戴尔的魂灵之影**只召唤到场上的部署格（含队友半场）：首领战中不再落到整备区，单人首领战也不落到空着的另一半场；范围内没有空位时不召唤（#557、PR #558）。

*界面*
- **官方战场场景光照改回官方值**：直射光与烘焙光不再被压暗，场景不再明显偏暗（#549、PR #554）。
- **官方场景上装置板重新画出**：射击台、特制水上平台、封印的地面此前只画在被场景替换掉的棋盘层里，导致战场#03 蓝门旁高台是平的、战场#05(上半) 水上平台看起来像空水面（干员却站在抬高位置）——现已修复（#569）。
- **每回合开始重播入场动画**：自己棋盘上的干员按部署顺序一个接一个重播 Start 动画并播放落地音效（维护者按官方实机确认）；买到干员、上场或换格时也播放一次，同一次落地只响一声，音量跟随「音效」（PR #416）。
- **新增「弹药数量」设置**（可选、**默认关闭**，官方界面本无此数字）：打开后弹药类技能的弹药条下方显示剩余 / 总数（如 13/14）。
- **修模型裁切与残影**：场上单位多时（画质「高」下通常第 7 回合后）改用缓存画面绘制，此前野鬃待机的旗帜、浊心斯卡蒂三技能飞起的头部会被裁掉，超出部分还会画进相邻单位留下错位残影（如隐现枪口）。现在每个模型按其全部动作预留缓存、每单位只画在自己区域内；少数特别大的动作（多为部署时从天而降）播放期间直接绘制（#542）。
- **策略轮选跳过按钮**：最后一个还没选策略的玩家不再看到可点的「跳过」；已选完的玩家仍显示在顺序里，但不算可以让过去的人（PR #546）。

*工具与开发*
- Windows 下场景素材测试的仓库路径不再重复盘符（PR #547）。

**保留的独有联机 / UI 功能**
- 六人合作：座位扩到 6；悬赏轮刷 9 张、R10/R12/R14 合作信标、六人首领共享血池、开局 BAN 按人数补偿（五人少 1、六人少 2，最低 0）。
- 战斗 1×/2×/4× 倍速（本地确定性模拟、切换更丝滑），倒计时在倍速下平滑流动。
- 跳过本场：敌人全部出场后可跳过，残存敌人冲家扣血并直接进入下一轮买卖（联合作战 / Boss 关不可用）。
- 可拖拽聊天与表情、服务器公告栏（强制 / 常驻）、大厅在线人数、公共快速匹配（凑满即开，超时补 AI）。
- 监控大屏 monitor.html：按房间查看玩家、踢人、关房、发布 / 撤回强制公告（主服直连 `/monitor.html`）。
- PC 与安卓均可联机，附 Windows 一键「本机开服 / 联机」脚本；联机（本机客户端）模式只反代 `/ws` 与 `/api/*` 给中心服务器，页面与素材走本机磁盘。

**本轮同步的兼容性说明**
- 上游 0.2.6 重写了服务端请求接线（新增流量计数 `traffic.js`、素材哈希索引 `assetIndex.js`、清单视图 `assetViews.js`），并给 WebSocket 开了 permessage-deflate 压缩。合并时把这些新逻辑与改编版的 `proxy.js` 反代、公告栏接口**同时保留**：`/healthz` 既支持上游的 `?traffic=1`，也保留监控大屏用的 `/api/healthz` 别名与 CORS 头。
- 上游 0.2.6 自己修掉了 `test/scene-assets.test.js` 在 Windows 下重复盘符的路径 bug（PR #547），与改编版此前的修法一致。



| 同盟房间 | 策略轮选 | 休整期（商店 / 盟约） |
|---|---|---|
| ![房间](docs/img/room.jpg) | ![策略](docs/img/band-draft.jpg) | ![休整期](docs/img/prep.jpg) |
| **部署方向轮盘** | **作战** | **最终攻势** |
| ![方向](docs/img/facing-wheel.jpg) | ![作战](docs/img/combat.jpg) | ![最终攻势](docs/img/final-assault.jpg) |

## 目录

- [声明](#声明) · [简介](#简介) · [功能一览](#功能一览)
- [快速开始](#快速开始)：[整合包](#方式一整合包推荐) · [从源码运行](#方式二从源码运行) · [系统要求](#系统要求) · [端口与配置](#端口与配置) · [局域网联机](#和朋友一起玩局域网)
- [插件](#插件) · [联机方式](#联机方式) · [操作](#操作) · [文档](#文档) · [开发与测试](#开发与测试) · [项目结构](#项目结构)
- [许可证](#许可证) · [致谢与数据来源](#致谢与数据来源) · [贡献](#贡献)

## 简介

「卫戍协议：盟约」是自走棋 + 塔防：休整期在调度中心招募干员、摆阵、配装备，作战期干员自动部署，迎击从红门涌来的敌人，漏过去的敌人扣目标生命值。本项目在浏览器里复刻了这一玩法，规则和数值尽量对照官方数据表与 PRTS 核对。

- **独立模拟**（单人）与**同盟模拟**（1–4 人**合作**，没有 PvP；空位可以加 AI 队友）。
- 服务器是一个 Node.js 程序，**战斗在各玩家的浏览器里模拟**（和官方一样），服务器只管经济与回合，一台低功耗小主机就能开服。
- 当前版本 0.3.1：Forge 工坊包导入大幅补齐（主题变量、公告、行为开关、新的盟约 / 装备 / 召唤物 / 驻守与池外官方干员、面板兼容层、特效、皮肤），插件工作台为这些新功能加了图形化模板；设置新增「素材存储」（申请持久保存、清理旧版本素材）；修复余、野鬃、缪尔赛思、瑕光等干员的官方特效和动作，琳琅诗怀雅三技能改为官方的不自动关闭，详见 [CHANGELOG.md](CHANGELOG.md)。仍有少数规则按推断实现，与官方不一致的地方欢迎在 Issue 里反馈。

## 功能一览

- **完整的一局**：确认本局信息 → 策略轮选（40 名策略）→ 14 回合 → 结算称号；险境及以上满足条件时进入第 15 回合「隐秘核心」。
- **4 种难度**：标准 / 险境 / 绝境 / 终极，独立与同盟各一套参数，均取自官方数据。
- **休整期**：招募、刷新、冻结、升级调度中心；整备区与临时整备区；从整备区拖到棋盘部署，用**方向轮盘**选择朝向。同盟模拟的卡池共用。
- **晋升精锐**：3 名同名干员自动合成精锐，并获得一次高一阶的免费招募。
- **干员与调配**：112 名可招募干员（+ 精锐）及其技能、天赋和特质；开局前可以为每名干员选择携带的技能（283 个技能全部手工实现）和精锐的模组。
- **盟约与层数**：23 个盟约（8 个势力核心盟约 + 附加盟约），层数整局保留，每个盟约最多 999 层。
- **装备与机变**：装备与法术，同名装备合成、特定组合赋予盟约效果；已配发的装备锁定在干员身上。部分回合开始前有机变选卡（装备、资金、干员、层数、悬赏等）。
- **自动作战**：技能按官方「技能策略」自动释放；按接触半径阻挡，阻挡者倒下时由接触的干员接替；元素损伤与元素爆发；召唤物由玩家手动摆放；推开 / 拉拽按力度与重量计算；被击倒的干员留在原地显示再部署倒计时。
- **地形与敌人**：阻隔工事、射击台、源石流吹风机、沼泽、排气格栅、涨潮等地形装置；空中与近地悬浮敌人、悬赏敌人。
- **联防**：有人漏怪、又有人完美作战时，完美作战的队友带着阵容帮忙拦截漏掉的敌人。
- **最终攻势与隐秘核心**：两人共享一个战场，全队共同削减同一条领袖血条；10 个敌方领袖，巨型领袖约 5×3 格的受击范围，以及官方的限伤规则。
- **结算**：官方样式的个人战报和同盟结算页，卫戍认证等级（官方 60 级、每日防卫目标，按本机记录计算）；卫戍之星、不朽盟约、坚若磐石等 6 个结算称号。
- **断线重连**：同盟模拟断线后 10 分钟内重新打开页面即可回到原座位，掉线期间按原阵容自动作战，也可以「暂离」交给 AI 托管；独立模拟 24 小时内可以回来继续（同一个浏览器）。
- **交互细节**：漏怪时顶栏用红字 + 「−N」标记待扣的目标生命值（结算时才扣除）；点选、拖放和配发装备都按地上的方格；购买、升级和机变选卡都需要点两次确认；只有一名玩家时除作战外不计时。
- **画面与声音**：真实 Spine 小人、官方 BGM 与音效、表情（6 套 × 6 个）、作战特效；可选的官方 3D 棋盘（需要从本机客户端提取贴图）。
- **手机与电脑**：触摸拖拽、长按查看详情，推荐横屏；设置里可以调低画质；界面被挖孔、刘海或曲面边缘挡住时可以用「异形屏适配」调整四边。

## 快速开始

### 方式一：整合包（推荐）

[Releases](../../releases/latest) 里有两种整合包，代码和运行依赖完全相同，二选一；已经装好 0.2.x 的，升级时只下载更新包即可：

- **完整包** `Stronghold-Protocol-v<版本>.zip`（约 800 MB，解压后约 1.16 GB）：附带全部美术 / 音频（含中文、日文、英文、韩文和本土语言的干员语音、官方 3D 棋盘贴图、各战场的官方场景和官方战斗特效），解压就能玩，不需要再下载任何东西。**推荐。**
- **精简包** `Stronghold-Protocol-v<版本>-lite.zip`（约 25 MB）：不带素材，第一次启动时自动从公开镜像下载美术、Spine 模型、音频、字体、表情和「玩法说明」教程图（约 720 MB，可中断，再次启动会续传）；官方 3D 棋盘等本地客户端素材不在其中（见下面的「本地客户端素材」；各战场的官方场景可以用 `node tools/setup.mjs --scenes` 在本机下载并提取）。适合下载大文件不方便的情况。
- **更新包** `Stronghold-Protocol-v<版本>-update.zip`（0.2.1 起提供，大小看改动多少，通常只有几 MB）：只含比之前的 0.2.x 版本改动过的文件，用来把已经装好的 0.2.x（完整包或精简包装的都行）升级到新版本，不用重新下载整个包。用法：先停止服务器（关掉窗口；装了开机自启的运行 `scripts\install-service-windows.ps1 -Stop`），把 zip 里 `Stronghold-Protocol` 文件夹的全部内容合并到安装文件夹、覆盖同名文件（Windows 资源管理器里复制粘贴即可；macOS 不要用访达拖放，它会整个替换文件夹，请用 `unzip -o`，见 [docs/DEPLOY.md](docs/DEPLOY.md) 第 1.5 节），再照常启动。启动时会先核对全部程序文件、删除新版本不再用的旧文件，然后正常运行；如果这个文件夹不是更新包对应的版本（例如 0.1.x，或者程序文件被改过），会提示下载完整包，服务器不启动。全新安装请用完整包或精简包。

两种包都包含运行和部署文件，以及插件作者需要的工具、模板、Schemas、插件文档和战斗测试助手。完整开发测试与设计文档仍在源码仓库里。

1. **安装 Node.js 22 或 24（LTS）**
   - Windows：在 PowerShell 里运行 `winget install OpenJS.NodeJS.LTS`，或到 <https://nodejs.org/zh-cn/download> 下载安装包。
   - macOS：`brew install node@22`，或到官网下载安装包。
   - Linux：发行版的包管理器、nvm 或 fnm。
2. **下载**：在 [Releases](../../releases/latest) 页面下载最新版本的完整包（或精简包），解压到一个路径较短的文件夹（Windows 上建议不要放在 OneDrive 同步的目录里）。
3. **启动**
   - Windows：双击 **`scripts\start-windows.bat`**。如果弹出「安全警告」，点「运行」；Windows 防火墙弹窗请勾选「专用网络」并允许。
   - macOS / Linux：在解压出的文件夹里运行 `./scripts/start.sh`（或 `bash scripts/start.sh`）。
4. 浏览器会自动打开 `http://localhost:3000`。窗口里列出的局域网地址可以直接发给同一网络的朋友。关闭窗口（或按 `Ctrl+C`）即停止服务器。

### 方式二：从源码运行

```bash
git clone https://github.com/sganggs/Stronghold-Protocol.git
cd Stronghold-Protocol
npm install        # 安装依赖（postinstall 会把 pixi / preact / three 复制到 public/vendor）
npm run setup      # 检查环境，并从公开镜像下载约 720 MB 美术 / 音频（可中断，再次运行会续传）
npm start          # 启动服务器：http://localhost:3000
```

也可以直接运行启动脚本（Windows `scripts\start-windows.bat`，macOS / Linux `scripts/start.sh`）：首次会自动安装依赖、下载素材，然后启动服务器并打开浏览器。

- **本地客户端素材（可选）**：官方 3D 棋盘、官方战斗特效（0.3.0「官方特效」）、部分官方界面图标（交流按钮与表情面板的边框、模组类型图标等）、灼热 / 炽焰源石虫和 39 个召唤物（多数自选召唤物）的官方模型需要从本机的《明日方舟》PC 客户端提取（Windows 原生客户端、macOS 的 CrossOver 或 PlayCover）。`npm run setup` 检测到客户端时会询问是否提取（需要 Python 3.8+，依赖装在项目内的 `.venv-extract`，不影响系统）；之后可以用 `node tools/setup.mjs --local` 重新提取，或用 `--game "<…/StreamingAssets/AB/Windows>"` 指定路径。没有客户端时游戏照常运行，这几样换成替代样式：2D 棋盘、样式相近的图标、染色的普通源石虫、召唤物头像。表情和「玩法说明」的教程图随上面的素材一起从公开镜像下载，不需要客户端。没有客户端的服务器（例如 Linux VPS）也可以从**同一版本**的整合包（完整包；精简包没有）里复制 `public/assets/local/` 和 `data/local-assets.json`，见 [docs/DEPLOY.md](docs/DEPLOY.md) 的「本地客户端素材」。
- 素材下载优先使用 GitHub，失败时自动改用 jsDelivr 镜像。
- `npm run doctor`（即 `node tools/doctor.mjs`）可以随时诊断：Node 版本、素材是否完整、端口占用、局域网地址和防火墙。

### 系统要求

| 项目 | 要求 |
|---|---|
| 开服的电脑 | Windows / macOS / Linux，Node.js 22 或 24（LTS）；磁盘约 1.2–1.4 GB（素材、依赖与本地提取的贴图、场景和特效：完整包解压后约 1.16 GB）；内存空闲约 100 MB，每局再加几 MB |
| 玩家 | 支持 WebGL 的现代浏览器（Chrome / Edge / Firefox / Safari 最新版），电脑、手机或平板（横屏） |
| 网络 | 首次进入游戏时，每位玩家要从开服的电脑下载几十 MB 素材（之后走浏览器缓存）；对局中流量很小。已有素材的玩家可以在标题画面点「导入素材包」（「下载完整素材」旁边），从素材包 zip、完整包 zip 或自己的 `public/assets` 文件夹导入，这部分美术不再从开服的电脑下载；需要 HTTPS 或 localhost（[docs/DEPLOY.md](docs/DEPLOY.md) 2.5 节）。0.3.0 的素材包 `Stronghold-Protocol-v0.3.0-assets.zip` 由维护者另行提供下载，不在 Releases 附件里 |

显卡较弱时可以在「设置」里调低画质，或在网址后加 `?board=2d`（强制 2D 棋盘）/ `?render=fallback`（不用 WebGL 的简化画面）。

### 端口与配置

默认监听 **TCP 3000**。换端口：启动脚本加 `--port 3001`，或设置环境变量 `PORT`。

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `::` | 监听地址。默认 `::` 是双栈：同一个端口同时接受 IPv6 和 IPv4；`0.0.0.0` = 只 IPv4；`127.0.0.1` = 只允许本机，放在反向代理后面时使用 |
| `SP_COMBAT` | `client` | `client`：各玩家浏览器模拟自己的战斗（服务器负载极低）；`server`：由服务器模拟并推流 |
| `SP_VERIFY` | `off` | 服务器复算客户端上报的战斗结果：`off` / `sample`（约 1/8 抽查）/ `all`（全部复算，更耗 CPU） |
| `SP_BOT_REHEARSAL` | 不设（服务器试算） | 仅 `host` 让房主浏览器帮 AI 队友试算布阵（同源 Worker，只回候选序号）；不设或 `server` 仍由服务器试算。房主无法完成时服务器用同一批候选接手。玩法插件房间始终由服务器试算。真人「AI 托管」和正式战斗不受影响 |
| `TRUST_PROXY` | `auto` | 是否信任 `X-Forwarded-For` 等转发头：`auto` 只信任来自本机 / 内网的代理；`1` 总是；`0` 从不 |
| `DEBUG` | 空 | 设为任意值输出详细日志 |
| `SP_NO_BROWSER` | 空 | 设为 `1` 时启动脚本不自动打开浏览器 |
| `SP_BOT_EMOTES` | 空 | AI 队友的对局表情回应（战斗、整备、合成、联防、收礼时即刻的 `m.emote` 广播）；设为 `0` 时整体关闭 |
| `SP_ASSET_INDEX` | 空 | 素材地址带内容哈希、浏览器长期缓存（0.2.6 起默认开启，哈希存在 `.cache/asset-hashes.json`）；设为 `0` 时关闭，素材清单原样下发 |

设置方式：macOS / Linux `PORT=8080 npm start`；PowerShell `$env:PORT=8080; npm start`；cmd `set "PORT=8080" && npm start`。健康检查：`GET /healthz`。

### 和朋友一起玩（局域网）

1. 打开页面 → 输入昵称 → **同盟模拟** → 创建房间。房主选择难度，可以添加 / 移除 AI 队友；开始前也可以把其他博士移出房间（对方可凭密钥重新加入）。
2. 把 4 位字母的**同盟密钥**，或「复制链接」得到的 `http://<地址>:3000/?room=密钥` 发给朋友。
3. 所有人点「准备就绪」后房主开始。
4. 同一 Wi-Fi / 路由器下的朋友打开启动窗口里列出的地址（形如 `http://192.168.x.x:3000`）即可。打不开时多半是防火墙：Windows 首次启动时在弹窗中允许「专用网络」，或运行 `npm run doctor` 查看具体命令；访客 Wi-Fi 常开启「AP 隔离」，也会导致连不上。

刷新页面或断线后，同盟模拟 10 分钟内、独立模拟 24 小时内重新打开即可回到原座位。服务器把房间和对局都保存在内存里，**重启服务器会结束所有对局**。

## 插件

0.3.0 起支持插件；不开插件时按原版游玩。

- **服主安装**：将插件文件夹放进服务器的 `plugins/`，或用 `node tools/plugin.mjs install <zip路径或HTTPS地址>` 安装；远程地址需带 `--sha256`。工作台也支持从社区目录安装和导入 Forge 工坊包。服主可在 `plugins/config.json` 限定可用插件。
- **房主开启**：在房间顶部的「原版 / 插件 ×N」面板里选外观或玩法插件、修改插件设置、选择插件模式。玩法插件的内容会由所有玩家下载并校验，房间标为「非官方」，统计总览默认不计入。
- **玩家个人设置**：「设置 → 外观插件 / 界面插件」只影响自己的浏览器；个人不能另装玩法插件改变房间规则。外观插件只换画面与声音，界面插件只读允许的对局信息。
- **自己制作**：打开启动窗口 `Studio:` 行的地址，使用 `/studio/` 插件工作台选模板、按官方名称选目标、拖放素材、实时预览、试一场并回放，最后打包分享。工作台限本机和局域网，修改需要钥匙。

脚本执行默认关闭。服主可以用 `SP_PLUGIN_SCRIPTS=sandbox` 开启沙箱脚本（或启动时加 `--scripts sandbox`；Windows 双击 `scripts\start-windows-sandbox.bat`）；原生受信任模式还需审查、固定锁文件哈希和玩家同意，公网部署需 `trusted-force`。开服设置见 [部署指南](docs/DEPLOY.md)，作者从[插件新手指南](docs/PLUGIN-GUIDE.md)开始，格式与限制见[插件参考](docs/PLUGINS.md)，接口列表见[插件 API 表](docs/PLUGIN-API.md)。

## 联机方式

朋友不在同一个局域网时，下面是几类常见做法，按自己的情况选一种即可。这里只做简单介绍，提到的工具和服务只是举例，本项目与它们没有任何关系，也不做推荐；具体的安装、费用和使用规则请以各自的官方说明为准。部署细节（防火墙、开机自启、反向代理与 HTTPS、Docker）见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

| 方式 | 怎么做 | 适合 |
|---|---|---|
| **同一局域网直连** | 把启动窗口里的局域网地址发给朋友 | 同一个家、宿舍或网吧 |
| **组网工具（虚拟局域网）** | 例如 Tailscale、ZeroTier、EasyTier、蒲公英：开服的人和朋友都安装同一个工具并加入同一个网络，朋友用开服电脑的虚拟 IP 访问 `http://<虚拟 IP>:3000` | 固定的几个熟人；不暴露到公网。朋友也要装客户端，部分工具需要注册账号；跨地区时可能走中继而变慢 |
| **内网穿透 / 隧道** | 只有开服的人运行客户端，朋友直接打开网址。例如自建的 frp（需要一台有公网 IP 的服务器）、Cloudflare 的 `cloudflared tunnel --url http://localhost:3000`（临时地址，每次启动都会变；国内访问延迟可能较高）、国内的樱花 frp 一类公共穿透服务（通常需要实名，大陆节点承载网页可能有备案要求） | 不想改路由器、没有公网 IP；免费线路带宽小时，首次加载素材会慢一些 |
| **云服务器 / VPS 直接部署** | 在 VPS 上运行整合包，或用仓库自带的 `Dockerfile`；用 Caddy / Nginx 加上 HTTPS。选离玩家近、线路好的地区（面向大陆玩家时，境外机房要关注回程线路，否则晚高峰延迟可能很高；大陆服务器绑定域名需要 ICP 备案） | 想长期开服、玩家分布在不同地区 |

通用注意事项：

- 游戏是**单个常驻 Node.js 进程 + WebSocket**（路径 `/ws`），只能跑一个实例，必须部署在域名根路径；Vercel 之类的 Serverless 平台和 GitHub Pages 之类的静态托管都不适用。反向代理要转发 WebSocket 升级。
- 游戏没有账号系统，**知道地址的人都能进来**。请只把地址发给朋友，不要公开发布，也不要搭建公开大厅；这同时能降低素材版权方面的风险。
- 有公网 IPv4 时也可以在路由器上做端口转发，但这会把家里的电脑直接暴露在公网上，优先考虑上面的方式。

## 操作

| 操作 | 方法 |
|---|---|
| 购买 / 升级调度中心 / 机变选卡 | 点一次选中，再点一次确认（`D` 升级） |
| 部署 / 移动干员 | 从整备区拖到棋盘格 → 出现方向轮盘 → 往上 / 右 / 下 / 左滑动选择朝向后松手；松在中心或点「✕ 点击取消」取消。拖动时指针 / 手指所在的格子就是落点，能放下时模型直接站在这一格上（不能放下时跟在指针下） |
| 调整朝向 | 把干员拖回它自己的格子，再选方向 |
| 出售 / 撤退 / 销毁装备 | 点击单位所在的格子 → 底部按钮「出售 +1」「撤退」；也可以把棋盘上的干员拖回整备区撤退。整备区里的装备与法术只能「销毁」，已配发的装备锁定在干员身上（干员出售或合成精锐时退回整备区） |
| 装备 | 把装备拖到干员所在的格子上（每人 2 件；满了会弹出替换窗口，被替换的一件会被销毁）；法术拖到地块上并选方向 |
| 查看详情 | 右键或长按单位 / 卡牌（属性为实时数值，高于基础值为绿色、低于为红色） |
| 快捷键 | `W` 购买鼠标指向的商品（无需点击） · `R` 刷新 · `F` 冻结 · `D` 升级 · `Q` 撤退 / `X` 出售鼠标指向的干员（无需点击） · `Space` 准备就绪 · `Esc` 取消 / 关闭；除 `Esc` 外都可以在「设置 → 快捷键」里改成别的键（[玩法指南 §11](docs/PLAYING.md#11-快捷键)） |
| 方向轮盘键盘操作 | 方向键预览 · `Enter` 确认 · `Esc` 取消 |
| 暂停（独立模拟） | 作战中（含最终攻势 / 隐秘核心）点顶栏的「暂停」或按 `Space`，再点「继续作战」（或 `Space`）继续；同盟模拟的作战不能暂停 |
| 表情 | 左下角「交流」，左右滑动（或方向键）换主题，冷却 1 秒 |
| 观战 | 自己的作战结束后（或休整期）点左侧队友头像 →「前往查看」；不参战的朋友可以在大厅输入同盟密钥点「观战」（每个同盟最多 2 名观战者，本作新增） |
| 统计（本机） | 标题画面右上角、大厅、等待室的「统计」：胜率、策略通过率、称号、战斗累计和对局记录（点一行回看结算页）；只存在本机浏览器里，可以导出 / 导入，没清完第一个回合就退出的对局不计入统计（[玩法指南 §12](docs/PLAYING.md#13-统计本机)） |

完整的规则、数值和小技巧见 **[docs/PLAYING.md](docs/PLAYING.md)**（游戏内左下角也有「玩法说明」）。

## 文档

| 文档 | 内容 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | 更新记录：每个版本修复了什么、哪些反馈经核实不是问题 |
| [docs/PLAYING.md](docs/PLAYING.md) | 玩法指南：流程、经济、招募与晋升、摆阵、联防、盟约、最终攻势、结算称号 |
| [docs/PLUGINS.md](docs/PLUGINS.md) · [docs/PLUGIN-GUIDE.md](docs/PLUGIN-GUIDE.md) | 插件格式、安装与服主策略；中文工作台入门、DSL 和对战试验 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 部署指南：Windows 开服与开机自启、防火墙、组网 / 隧道、反向代理与 HTTPS、Docker、systemd、排错 |
| [docs/WINDOWS.md](docs/WINDOWS.md) | Windows 便携包：怎么打一份「零安装」包（`scripts/make-windows-bundle.mjs`）、包里放了什么、授权注意事项 |
| [docs/DESIGN.md](docs/DESIGN.md) | 架构与契约（英文）：索引，按章节号找到文件；现行规则在 `docs/design/`（范围与目录分工、坐标与时间、战斗引擎、对局、网络协议、渲染与 UI），各次试玩和各版本的规则修订与依据在 `docs/history/` |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 代码地图（英文）：服务器、联机协议和前后端共用的战斗模拟，0.2.0 重构后的目录，数据流，黄金结果与导入边界，常见改动从哪里入手 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 参与贡献：准备环境、运行测试、忠实原则、提交与 PR 约定、怎样添加自选干员（中文，末尾附英文摘要） |
| [docs/SIM.md](docs/SIM.md) | 战斗模拟引擎参考（英文）：钩子、技能描述格式、职业默认行为 |
| [docs/META.md](docs/META.md) | 对局与经济引擎（英文）：回合流程、商店、联防、最终攻势的实现细节 |
| [docs/DATA.md](docs/DATA.md) | 由官方数据表生成的游戏数据（英文） |
| [docs/ASSETS.md](docs/ASSETS.md) | 素材来源、目录结构与清单（英文） |
| [docs/I18N.md](docs/I18N.md) | 界面语言（英文）：界面文字、游戏文本与服务器消息怎样翻译，覆盖范围；**添加一种语言只需在 `public/i18n/` 放一个语言文件**（社区翻译步骤见「Adding a language」，内容包格式见 [docs/PACKS.md](docs/PACKS.md)） |
| [docs/BALANCE.md](docs/BALANCE.md) | 难度模型与测量（英文） |
| [docs/research/](docs/research/00-INDEX.md) | 官方规则、数据与界面的调研记录 |

## 开发与测试

```bash
npm run dev                 # node --watch：改动服务器代码后自动重启
npm test                    # 单元 + 集成测试（约 3170 项；缺少素材 / 浏览器的用例会自动跳过；不带文件的 node --test 会把 test/ 下的辅助模块和夹具也当测试跑）
SP_E2E=1 node --test test/ui/mock.e2e.test.js        # 浏览器端到端测试，需要本机 Chrome（CHROME_PATH 可指定路径）
SP_REAL_E2E=1 node --test test/ui/real.e2e.test.js   # 需要 Chrome + 已下载的素材
RENDER_E2E=1 node --test 'test/render/*.browser.test.js'   # 渲染测试，部分需要本地提取的棋盘贴图
GOLDEN_FULL=1 node --test test/golden.test.js           # 黄金结果：固定种子的整套战斗与人机对局摘要（默认只跑快速子集）
node tools/perfbench.mjs --cpu 1,4,6 --profile             # 真实战斗的帧耗时基准（Chrome 降速 CPU 近似中低端手机），需要 Chrome + 已下载的素材
```

- 游戏数据由 `npm run build-data`（`tools/build-data.mjs`）从官方数据表生成，不要手工修改 `data/*.json`。
- 性能测试：`/dev/battle-perf.html` 在浏览器里跑一场真实战斗（对局用的战斗运行器、模拟和渲染），实时显示帧率与逐帧耗时；在手机上打开后点击「开始测量（10 秒）」，生成的报告可以复制后附在反馈中。用到的战斗来自 `node tools/capture-specs.mjs` 从固定种子的机器人对局里截取的数据（`public/dev/perf/`）。
- 只重构、不改玩法的提交不能改变 `test/golden/*.json`；有意改变玩法时运行 `npm run golden:update`，检查差异后随改动一起提交（见 [test/golden/README.md](test/golden/README.md)）。
- GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）在 Ubuntu 与 Windows、Node 22 / 24 上运行 `npm ci`、`npm test` 和服务器冒烟测试。
- 代码怎么分层、改某个规则该从哪个文件入手，见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目结构

| 路径 | 内容 |
|---|---|
| `server/` | 入口 `index.js`；Node HTTP 静态服务 + WebSocket（`/ws`，代码在 `http/`）、大厅、对局引擎（`match/`）、战斗模拟（`sim/`，浏览器与服务器共用） |
| `shared/` | 前后端共用的常量与网络协议 |
| `public/` | 浏览器客户端（原生 ES 模块，PixiJS + pixi-spine、three.js 3D 棋盘、Preact + htm UI） |
| `data/` | 由官方数据表生成的游戏数据与素材清单 `assets.json` |
| `tools/` | `setup.mjs` / `doctor.mjs`、素材下载 `fetch-assets.mjs`、数据构建、本地提取 `local-extract/` |
| `scripts/` | 启动脚本（Windows / macOS / Linux）、Windows 开机自启 |
| `docs/` | 文档与调研 |
| `test/` | `node:test` 测试 |

## 许可证

- **代码**：本项目自己编写的代码以 **GPL-3.0-or-later** 发布，全文见 [LICENSE](LICENSE)；另附一条 GPL 第 7 条的附加许可，允许与 pixi-spine 中的 Spine Runtimes 组合分发（见 [NOTICE.md](NOTICE.md)）。
- **游戏素材不在许可范围内**：《明日方舟》相关的美术、音乐、音效、文本与数据等版权归原权利人所有，不适用 GPL，使用限制见上方的[声明](#声明)和 [NOTICE.md](NOTICE.md)。
- **第三方组件**各自遵循其许可证：通过 npm 安装的库（整合包的 `node_modules` 中附带各自的许可证文件）、`tools/local-extract/aklz4.py` 的算法（BSD-3-Clause），以及字体等，清单与许可证全文见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 致谢与数据来源

- 游戏数据：[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)。
- 素材来源：[yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)、[fexli/ArknightsResource](https://github.com/fexli/ArknightsResource)、[isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models)、[ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2)；字体来自 [TimWangZi/The-font-of-Arknights](https://github.com/TimWangZi/The-font-of-Arknights) 与 Google Fonts（Noto Sans SC）。详见 [docs/ASSETS.md](docs/ASSETS.md)。
- 规则核对参考：[PRTS 明日方舟中文 Wiki](https://prts.wiki/)。
- LZ4AK 解包：`tools/local-extract/aklz4.py` 的算法来自 [isHarryh/Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker)（BSD-3-Clause，经 MooncellWiki/UnityPy）；解析 Unity 资源使用 [UnityPy](https://github.com/K0lb3/UnityPy)（MIT）。
- 库：[PixiJS](https://pixijs.com/)（MIT）、[pixi-spine](https://github.com/pixijs/spine)（MIT；其中包含的 Spine Runtime 另受 [Spine Runtimes License](https://esotericsoftware.com/spine-runtimes-license) 约束）、[three.js](https://threejs.org/)（MIT）、[Preact](https://preactjs.com/) + [htm](https://github.com/developit/htm)（MIT）、[ws](https://github.com/websockets/ws)（MIT）。

感谢以上项目的作者与维护者，以及鹰角网络带来的这款游戏。

## 贡献

欢迎提 Issue 反馈 bug、与官方规则不一致的地方或改进建议，也欢迎提交 Pull Request：

- 准备环境、运行测试、忠实原则和提交约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 提交前请运行 `npm test`，并同步更新相关文档；文档使用简体中文，代码与注释使用英文。
- 提交的代码将以 GPL-3.0-or-later 发布。
- 请不要提交任何游戏素材文件（`public/assets/` 等目录已被 `.gitignore` 排除）。
- 本项目坚持非商业：请不要提交广告、付费、打赏等任何形式的变现功能。

---

## English

An **unofficial, non-commercial fan remake** of Arknights' seasonal auto-chess tower-defense mode *Stronghold Protocol: Alliance*, played in the browser: solo, or 1–4 player co-op (AI teammates can fill seats). Combat is simulated in each player's browser, so a low-power PC can host.

- **Run:** download the full bundle `Stronghold-Protocol-v<version>.zip` (~800 MB, all the art inside, the Chinese, Japanese, English, Korean and own-language operator voices, the official battlefield scenes and the official battle effects included) from [Releases](../../releases/latest) — or the lite one, `…-lite.zip` (~25 MB), which downloads the art (~720 MB) on its first start; from 0.2.1 on, `…-update.zip` holds only the files changed since the earlier 0.2.x releases: stop the server, extract it over an existing 0.2.x folder and start again (the first start deletes the files the new version dropped and verifies the install) — install Node.js 22 or 24, then double-click `scripts\start-windows.bat` (Windows) or run `./scripts/start.sh` (macOS / Linux) and open <http://localhost:3000>. From source: `npm install && npm run setup && npm start` (setup downloads ~720 MB of art from public mirrors, the emotes and the how-to-play pages included; the official 3D board, some official HUD icons, two enemy models and 39 summon models are extracted from a local Arknights client — without one the game uses the 2D board and look-alike stand-ins (the summons show their avatars), and a server can copy `public/assets/local/` and `data/local-assets.json` from the full bundle of the same version).
- **Languages:** Chinese (the default), English, 日本語, 한국어 and 繁體中文 — switch on the title screen or in Settings. Game texts come from the official clients; the Japanese, Korean and Traditional Chinese interface strings are machine translations (corrections welcome: [docs/I18N.md](docs/I18N.md)).
- **Play with friends:** create a co-op room and share the 4-letter key or the `?room=KEY` link. On a LAN, use the address printed at start; otherwise use a virtual-LAN tool, a tunnel or a VPS — see [docs/DEPLOY.md](docs/DEPLOY.md).
- **Disclaimer:** not affiliated with or endorsed by Hypergryph or Yostar. All Arknights names, art, audio, text and data are © their respective owners and are **not** covered by this project's GPL licence. For study and personal non-commercial use only — no selling, paid distribution, paid servers or monetisation of any kind. Content will be removed on request of the rights holders. Provided "as is", without warranty.
- **License:** code GPL-3.0-or-later ([LICENSE](LICENSE)); game assets excluded.
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) (an English summary at its end); the code map is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
