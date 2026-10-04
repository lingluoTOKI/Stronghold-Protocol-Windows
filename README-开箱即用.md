# 卫戍协议：盟约 · Windows 开箱即用包

解压后**双击 `启动游戏.bat`** 即可，目标机器不需要安装 Node、不需要联网下载素材。
这个包**不访问外网**：字体用包内自带的 `app\public\fonts`（Bender / Novecento Wide），
原版页面里指向 `fonts.googleapis.com` 的外链已去掉（想保留：重新打包时加 `--keep-webfonts`）；
中文会退回系统自带的黑体，和没有代理时上 Google 的效果一致。

## 关于本项目（务必先读）

本项目是玩家自制的**非官方同人作品**，与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方
**没有任何关系**，未获其授权或认可。

**仅供学习交流与个人非商业使用。严禁任何形式的盈利**，包括但不限于：售卖本项目或整合包、
付费下载或付费分发、收费服务器或收费代开、广告 / 打赏 / 会员等变现方式，以及其他任何商业用途。

> 本包按 GPL-3.0-or-later 分发，完整条款见包内 [LICENSE](LICENSE)、[NOTICE.md](NOTICE.md)；
> 内置 Node.js（MIT）以及其它第三方组件的许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
> 与 `node\LICENSE-node.txt`。

## 开始界面（启动器菜单）

```
[1] 本机当服务器   在这台电脑开服，浏览器自动打开；把打印出来的局域网地址发给朋友即可加入
[2] 连接服务器     用浏览器直接打开别人的服务器：页面、素材、对局数据都从对方来，本机不用装任何东西
[3] 设置           端口 / 局域网共享
[4] 查看状态       本机服务器与上次连接的服务器是否在跑
```

也可以直接双击 `本机当服务器.bat` 或 `连接服务器.bat`，等于菜单里的 [1] / [2]。

选 [2] 只是用你的默认浏览器打开对方的网页（地址会记在 `app\scripts\launcher.config.json`）；
不想自动打开浏览器就加 `--no-open`。

## 好友怎么加入（本机当服务器）

1. 菜单选 [1]，等浏览器打开、控制台打印出「发给朋友」的地址（形如 `http://192.168.1.23:3000`）。
2. 第一次可能需要在 Windows 防火墙弹窗里勾选**允许专用网络**（否则朋友连不上）。
3. 建房后把 4 位「同盟密钥」或「复制链接」（`…/?room=密钥`）发给朋友。

## 目录结构

```
node\node.exe            便携版 Node v22.23.3（官方 x64，已经 sha256 校验）
node\LICENSE-node.txt    Node 自己的许可证（MIT）
app\                    游戏本体：server / shared / public（全部素材）/ data / scripts / tools
app\scripts\launcher.mjs 启动器（开始界面）
启动游戏.bat             双击开始（菜单）
README-开箱即用.md       本文件
LICENSE / NOTICE.md / THIRD-PARTY-NOTICES.md
```

卸载＝直接删掉整个文件夹（不写注册表、不放系统目录）。存档/昵称在该电脑的浏览器 localStorage 里。
