#!/usr/bin/env node
// scripts/make-windows-bundle.mjs — 打一份「开箱即用」的 Windows 便携包（docs/WINDOWS.md）。
//
//   node scripts/make-windows-bundle.mjs [--out <dir>] [--zip] [--no-node] [--with-tests] [--force]
//
// 产物目录（默认 <仓库的上一级>\Stronghold-Protocol-Windows）：
//   node\node.exe            官方 Windows x64 便携版 Node（版本与 sha256 钉在下面的 NODE_PIN）
//   node\LICENSE-node.txt    Node 自己的许可证（和 node.exe 一起从官方 zip 里取出来）
//   app\                     游戏本体：**只收 git 跟踪的文件** + 生产依赖 + 素材，离线可玩
//   app\scripts\launcher.mjs 开始界面（本机当服务器 / 联机 / 连接服务器 / 设置 / 状态）
//   启动游戏.bat             菜单（开始界面）
//   本机当服务器.bat         ← 直接当服务器
//   联机.bat                 ← 本机素材 + 远程服务器
//   连接服务器.bat           ← 直接打开别人的网页
//
// 给 --server <host> 时，生成的 .bat 会把该地址烤进去，「联机.bat」连确认也跳过（--yes）：
// 玩家解压后双击即进线上，不用选菜单、不用输地址。
//   README-开箱即用.md       给玩家看的说明（含非官方 / 严禁盈利声明）
//   LICENSE / NOTICE.md / THIRD-PARTY-NOTICES.md
//
// 目标机器什么都不用装：解压 → 双击 启动游戏.bat。素材约 330 MB 是硬成本，包因此较大。
//
// 两条硬规则（都是踩过的坑）：
//   1. app\ 的文件清单来自 `git ls-files`，不是手写的跳过表 —— `.env` / `.venv` / `.claude` /
//      `data/local-assets.json` 这些本机文件被 .gitignore 挡在版本库外，因此天然进不了发行包。
//      旧实现用一张窄表整树复制，漏一项就是把密钥打进别人下载的压缩包。
//   2. node_modules 用 `npm ci --omit=dev` 重新装一遍，不带 devDependency（puppeteer-core 之类）。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
// --zip 用自己写的 zip 写入器：系统 tar / Compress-Archive 在中文 Windows 上会按 GBK 写文件名
import { zipDir } from './zipdir.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const MB = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

/**
 * 便携版 Node：版本与 sha256 **钉死在仓库里**，运行时只认这个常量。
 *
 * 不用 `latest-v22.x`：那样今天打的包和上个月打的包内容不同，出了问题也无从复现；而且校验哈希是运行时
 * 现去 nodejs.org 抓的，等于把「发出去的二进制是什么」交给当时的网络应答决定。换版本请改这里
 * （并在 `--node-version` 的同时用 `--sha256` 显式覆盖）。
 */
const NODE_PIN = Object.freeze({
  version: 'v22.23.3',
  file: 'node-v22.23.3-win-x64.zip',
  sha256: '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71',
});

/** 这几份不进版本库（npm / tools/setup.mjs 生成），但必须进包，否则游戏缺素材或缺前端库。 */
const ASSET_DIRS = ['public/assets', 'public/fonts', 'public/vendor'];

/** 版本库里有、但便携包默认不要的（--with-tests 可加回）。 */
const SKIP_TRACKED = ['test/'];

/**
 * 仓库根的**原地**启动器：它们假设 `%HERE%` 就是游戏根（`%HERE%scripts\launcher.mjs`）。
 * 便携包里游戏被放进 `app\`，包根另有一份由 bat() 生成的对应脚本，所以这三个不再拷进 `app\`——
 * 否则 `app\启动游戏.bat` 会因为找不到 `app\node\node.exe` 而退回 PATH 上的 node，双击即报错。
 */
const SKIP_ROOT_FILES = ['启动游戏.bat', '本机当服务器.bat', '联机.bat', '连接服务器.bat'];

/** 包根要带的许可证 / 声明。 */
const LEGAL_FILES = ['LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md'];

function parseArgs(argv) {
  const o = { out: '', zip: false, node: true, tests: false, force: false, nodeSpec: '', sha256: '', webfonts: false, server: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, v] = a.split('=');
    const val = () => (v !== undefined ? v : argv[++i]);
    if (k === '--out') o.out = String(val() || '');
    else if (k === '--node-version') o.nodeSpec = String(val() || '');
    else if (k === '--sha256') o.sha256 = String(val() || '').toLowerCase();
    else if (k === '--server') o.server = String(val() || '').trim();
    else if (a === '--zip') o.zip = true;
    else if (a === '--no-node') o.node = false;
    else if (a === '--with-tests') o.tests = true;
    else if (a === '--keep-webfonts') o.webfonts = true;
    else if (a === '--force') o.force = true;
    else if (a === '-h' || a === '--help') o.help = true;
  }
  return o;
}

const HELP = `node scripts/make-windows-bundle.mjs — 生成 Windows 开箱即用便携包

  --out <dir>        产物目录（默认 <仓库上一级>/Stronghold-Protocol-Windows）
  --zip              额外压成 <out>.zip（内置 zip 写入器，文件名 UTF-8，中文不乱码）
  --no-node          不下载便携版 Node（目标机器需自备 Node 22+）
  --with-tests       连 test/ 一起打包（默认不打，省体积）
  --keep-webfonts    保留 index.html 里的 Google Fonts 外链（默认去掉，见下）
  --force            目录已存在时先删掉（只肯删空目录，或上一次打的便携包；其余情况拒绝）
  --node-version X   换一个 Node 版本（默认 ${NODE_PIN.version}）；换版本必须同时给 --sha256
  --sha256 <hash>    该版本 win-x64.zip 的 sha256（取自官方 SHASUMS256.txt）
  --server <host>    把联机服务器地址烤进包里的 .bat（如 game.lingluotoki.dpdns.org）：
                     玩家解压后**双击「联机.bat」直接进线上** —— 不弹地址提示、也不再问确认。
                     玩法是本机素材 + 反向代理，只有 /ws 与 /api/* 出网。

  app\\ 里只放 git 跟踪的文件 + 生产依赖（npm ci --omit=dev）+ public/{assets,fonts,vendor}；
  因此 .env / .venv / .claude / data/local-assets.json 这些本机文件不会被打进去。

  默认去掉 https://fonts.googleapis.com 的外链：便携包里已自带 /fonts（Bender / Novecento Wide），
  而 Google Fonts 在国内通常不可达 —— 留着只是白等十几个请求。标题/正文字体会退回系统黑体（本来就是
  多数国内玩家的实际效果）。想保留外链（能上 Google 时更好看）加 --keep-webfonts。
`;

/**
 * 便携包默认去掉 index.html 里的 Google Fonts 外链（preconnect + css2 stylesheet）。
 * 只删这两条 <link>，其余原样；找不到就原样返回。
 * @param {string} html
 * @returns {{ html: string, removed: number }}
 */
export function stripWebfonts(html) {
  let removed = 0;
  const out = html.replace(/^[ \t]*<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\r?\n?/gm, () => { removed++; return ''; });
  return { html: out, removed };
}

/**
 * 真实路径（解析符号链接 / Windows 8.3 短名）；路径本身还不存在时，退到最长的存在祖先再拼回去。
 * @param {string} p
 */
function canonical(p) {
  let head = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      head = fs.realpathSync.native(head);
      break;
    } catch {
      const parent = path.dirname(head);
      if (parent === head) break;                 // 到根都还不存在：只能按字面量比
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
  const joined = tail.length ? path.join(head, ...tail) : head;
  // 只有 Linux 的默认文件系统区分大小写；darwin / win32 上按不区分处理是偏保守的一侧（宁可拒绝也不误删）。
  return process.platform === 'linux' ? joined : joined.toLowerCase();
}

/**
 * `--out` 指到仓库本身或它的**上级**目录时，`--force` 会先 `rm -rf` 那个目录 —— 也就是把仓库整个删掉。
 * 这种路径直接拒绝（指向仓库内部是允许的，只是产物会出现在 git status 里）。
 *
 * 注意这只是第一道防线：真正的保险是下面 `forceDeleteVerdict()` 那条「不确定就不删」的规则，
 * 因为再小心的路径比较也挡不住 8.3 短名之类的花样。
 * @param {string} out
 * @param {string} [root]
 */
export function outDirIsUnsafe(out, root = ROOT) {
  const r = canonical(root);
  const o = canonical(out);
  if (o === r) return true;
  const rel = path.relative(o, r);          // 从 out 看 root 的相对位置
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 上一次打的便携包长这样：包根有这份说明，还有一个 app\ 目录。 */
const BUNDLE_MARKERS = Object.freeze(['README-开箱即用.md', 'app']);

/**
 * `--force` 允不允许删掉这个目录？
 *
 * 只认三种情况：目录还不存在；目录是空的；目录**看起来就是上次打的便携包**。
 * 其余一律拒绝 —— 路径比较挡不住大小写、符号链接、8.3 短名的花招，所以规则反过来写：
 * 只有能确认「这就是上次的产物」才动手删，认不出来就什么都不删。
 * @param {string} dir
 * @returns {'missing' | 'empty' | 'bundle' | 'refuse'}
 */
export function forceDeleteVerdict(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return e?.code === 'ENOENT' ? 'missing' : 'refuse';   // 读不出来（权限 / 不是目录）就别删
  }
  if (entries.length === 0) return 'empty';
  const app = entries.find((e) => e.name === 'app');
  const looksLikeBundle = BUNDLE_MARKERS.every((n) => entries.some((e) => e.name === n))
    && !!app && (app.isDirectory() || app.isSymbolicLink());
  return looksLikeBundle ? 'bundle' : 'refuse';
}

/** PowerShell 单引号字符串：内部的 ' 写成 ''（否则 Expand-Archive 那条命令会被截断）。 */
export function psSingleQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * 版本库里跟踪的文件（仓库相对路径，posix 分隔符）。
 *
 * 这是 app\ 文件清单的唯一来源。用 NUL 分隔读，避免中文 / 空格文件名被 git 转义或截断。
 * @returns {string[]}
 */
function trackedFiles() {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new Error('git ls-files 失败：打包只收版本库里跟踪的文件，请在完整的 git 仓库里运行');
  }
  return r.stdout.toString('utf8').split('\0').filter(Boolean);
}

/** 按相对路径清单逐个复制（自动建目录）；源文件不存在就跳过（例如素材还没下载）。 */
export async function copyFiles(relPaths, dst, root = ROOT) {
  let files = 0; let bytes = 0;
  for (const rel of relPaths) {
    const from = path.join(root, rel);
    const to = path.join(dst, rel);
    let st;
    try {
      // eslint-disable-next-line no-await-in-loop
      st = await fsp.stat(from);
    } catch { continue; }
    if (!st.isFile()) continue;
    // eslint-disable-next-line no-await-in-loop
    await fsp.mkdir(path.dirname(to), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await fsp.copyFile(from, to);
    files++; bytes += st.size;
  }
  return { files, bytes };
}

/** 整目录复制（素材 / 依赖），跳过符号链接与点开头的条目（打包机器自己的 .DS_Store 之类）。 */
export async function copyDir(src, dst) {
  let files = 0; let bytes = 0;
  const walk = async (d, out) => {
    await fsp.mkdir(out, { recursive: true });
    const entries = await fsp.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      // 点开头的目录整棵跳过：macOS 的 .DS_Store、编辑器临时目录都不该进包
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const from = path.join(d, e.name);
      const to = path.join(out, e.name);
      if (e.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(from, to);
        continue;
      }
      if (!e.isFile()) continue;
      // eslint-disable-next-line no-await-in-loop
      await fsp.copyFile(from, to);
      files++;
      try {
        // eslint-disable-next-line no-await-in-loop
        bytes += (await fsp.stat(to)).size;
      } catch { /* ignore */ }
    }
  };
  await walk(src, dst);
  return { files, bytes };
}

async function dirSize(dir) {
  let bytes = 0; let files = 0;
  const walk = async (d) => {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) { files++; try { bytes += (await fsp.stat(p)).size; } catch { /* ignore */ } }
    }
  };
  await walk(dir);
  return { bytes, files };
}

/**
 * 只装生产依赖，装到 app\node_modules。
 *
 * 在临时目录里 `npm ci --omit=dev` 再搬过来：既拿到干净的生产依赖（不带 puppeteer-core 这类
 * devDependency），又不会动本仓库自己的 node_modules。
 */
async function installProductionDeps(appDir) {
  const stage = path.join(appDir, '.deps-stage');
  await fsp.rm(stage, { recursive: true, force: true });
  await fsp.mkdir(stage, { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) throw new Error(`缺少 ${f}：无法安装生产依赖`);
    await fsp.copyFile(src, path.join(stage, f));
  }
  console.log('  · 安装生产依赖 npm ci --omit=dev（稍等）…');
  // --ignore-scripts：本仓库的 postinstall 是 `node tools/vendor.mjs`（把 npm 里的前端库拷进
  // public/vendor）。这个暂存目录里只有一份 package.json，脚本根本不存在，npm ci 会在 postinstall
  // 阶段 MODULE_NOT_FOUND；而 public/vendor 本来就是整目录进包（见 ASSET_DIRS），不需要再跑一次。
  // 依赖里也没有需要编译的原生模块（htm / pixi / preact / three / ws 都是纯 JS）。
  const args = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
  // Windows 上 npm 是 npm.cmd（批处理），不能直接 spawn；显式走 cmd.exe，避免 shell:true 的参数转义告警。
  const r = IS_WIN
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd: stage, stdio: 'inherit' })
    : spawnSync('npm', args, { cwd: stage, stdio: 'inherit' });
  if (r.error || r.status !== 0) throw new Error('npm ci --omit=dev 失败（便携包需要生产依赖，请先联网）');
  await fsp.rm(path.join(appDir, 'node_modules'), { recursive: true, force: true });
  await fsp.rename(path.join(stage, 'node_modules'), path.join(appDir, 'node_modules'));
  await fsp.rm(stage, { recursive: true, force: true });
}

/**
 * 便携版 Node：取官方 zip 里的 node.exe 与 LICENSE，按仓库里钉死的 sha256 校验。
 *
 * 那个 zip 永远是 **win-x64** 的，解压出来的布局也就永远是 `<zip 名>/node.exe` —— 与打包机器是什么
 * 系统无关，所以 macOS / Linux 上也能打这个 Windows 包。旧实现按宿主平台去找 `bin/node`，在 macOS 上
 * 必然 ENOENT。
 * @param {string} bundleNodeDir
 * @param {string} version 形如 v22.23.3
 * @param {string} wantHash win-x64.zip 的 sha256（小写十六进制）
 */
async function downloadPortableNode(bundleNodeDir, version, wantHash) {
  const zipName = `node-${version}-win-x64.zip`;
  const base = `https://nodejs.org/dist/${version}/`;
  const cacheDir = path.join(os.tmpdir(), 'sp-node-cache');
  await fsp.mkdir(cacheDir, { recursive: true });
  const zipPath = path.join(cacheDir, zipName);

  let have = false;
  if (fs.existsSync(zipPath)) {
    const h = crypto.createHash('sha256').update(await fsp.readFile(zipPath)).digest('hex');
    have = h === wantHash;
    if (!have) console.log(`  · 缓存校验失败，重新下载 ${zipName}`);
  }
  if (!have) {
    console.log(`  · 下载 ${base}${zipName}（约 30 MB）`);
    const res = await fetch(`${base}${zipName}`);
    if (!res.ok) throw new Error(`下载失败 ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    if (got !== wantHash) throw new Error(`${zipName} sha256 不匹配：\n    期望 ${wantHash}\n    实际 ${got}`);
    await fsp.writeFile(zipPath, buf);
  }

  const rootName = zipName.replace(/\.zip$/, '');
  const unpack = path.join(cacheDir, rootName);
  const nodeExe = path.join(unpack, rootName, 'node.exe');   // win-x64 zip 的固定布局
  const license = path.join(unpack, rootName, 'LICENSE');
  if (!fs.existsSync(nodeExe)) {
    await fsp.rm(unpack, { recursive: true, force: true });
    await fsp.mkdir(unpack, { recursive: true });
    // Windows 10+ 自带 bsdtar，macOS / Linux 也有 tar，都能解 zip；没有才退回 Expand-Archive。
    let r = spawnSync('tar', ['-xf', zipPath, '-C', unpack], { stdio: 'inherit' });
    if ((r.error || r.status !== 0) && IS_WIN) {
      r = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${psSingleQuote(zipPath)} -DestinationPath ${psSingleQuote(unpack)} -Force`], { stdio: 'inherit' });
    }
    if (r.error || r.status !== 0) throw new Error('解压 Node 失败（需要可用的 tar）');
  }
  if (!fs.existsSync(nodeExe)) throw new Error(`解压后没找到 node.exe：${nodeExe}`);

  await fsp.mkdir(bundleNodeDir, { recursive: true });
  await fsp.copyFile(nodeExe, path.join(bundleNodeDir, 'node.exe'));
  // 发出去的二进制必须带它自己的许可证 —— 官方 zip 里就有，取出来放旁边。
  if (!fs.existsSync(license)) throw new Error(`官方 zip 里没有 LICENSE：${license}（不能就这样打包发出去）`);
  await fsp.copyFile(license, path.join(bundleNodeDir, 'LICENSE-node.txt'));
  return {
    version,
    bytes: (await fsp.stat(path.join(bundleNodeDir, 'node.exe'))).size,
    licenseBytes: (await fsp.stat(path.join(bundleNodeDir, 'LICENSE-node.txt'))).size,
  };
}

/** 开始界面用的 .bat（内容保持纯 ASCII，中文只出现在文件名与 Node 菜单里）。 */
function bat(body) {
  return `@echo off\r\nchcp 65001 >nul\r\nsetlocal\r\nset "HERE=%~dp0"\r\nset "NODE="\r\nif exist "%HERE%node\\node.exe" set "NODE=%HERE%node\\node.exe"\r\nif not defined NODE set "NODE=node"\r\n${body}\r\nset "CODE=%ERRORLEVEL%"\r\nif not "%CODE%"=="0" pause\r\nexit /b %CODE%\r\n`;
}

/**
 * 包内说明（README-开箱即用.md）。
 *
 * 措辞有两条硬要求，别改回去：不能声称这个包「不访问外网」（页面里仍有 Google Fonts 外链），
 * 也不能说「本包按 GPL 分发」（素材的版权在原权利人手里，GPL 覆盖不到）。
 * @param {{ version: string, withNode?: boolean }} o
 */
export function bundleReadme({ version, withNode = true, server = '' }) {
  return `# 卫戍协议：盟约 · Windows 开箱即用包

解压后**双击 \`启动游戏.bat\`** 即可${withNode ? '，目标机器不需要安装 Node' : '（本包没有带便携版 Node，请自行安装 Node 22 或 24）'}。${server ? `

**本包已内置联机服务器 \`${server}\`：直接双击 \`联机.bat\` 就能进线上** —— 不用先选菜单，也不用输地址。
这一种玩法把页面、代码与全部素材都从**本机磁盘**读，只有联机对战（\`/ws\`）与公告、在线人数（\`/api/*\`）
走网络，所以进对局最快、也几乎不耗流量。` : ''}

**联网时**页面会去 Google Fonts 取中文字体（Noto Sans SC）；**断网**时自动退回系统自带的黑体，
和没有代理时上 Google 的效果一致，所以**不联网也能玩**。玩家头像、立绘、Spine 小人、技能图标、
音效与 BGM 全部由本机服务器自带提供，不需要访问任何外部服务。

## 关于本项目（务必先读）

本项目是玩家自制的**非官方同人作品**，与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方
**没有任何关系**，未获其授权或认可。

游戏素材（立绘、头像、Spine、图标、音效、字体等）的**版权归原权利人所有**，本项目仅按非商业同人
用途引用，**不适用**本项目的 **GPL** 授权条款，也**不得单独再分发**；权利人若提出要求，会**立即删除**。
本包**不提供任何担保**。

**仅供学习交流与个人非商业使用。严禁任何形式的盈利**，包括但不限于：售卖本项目或整合包、
付费下载或付费分发、收费服务器或收费代开、广告 / 打赏 / 会员等变现方式，以及其他任何商业用途。

> 代码部分按 GPL-3.0-or-later 分发，完整条款见包内 [LICENSE](LICENSE)、[NOTICE.md](NOTICE.md)；
> 第三方组件的许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)${withNode ? '，以及内置 Node.js（MIT）的 `node\\LICENSE-node.txt`' : ''}。

## 开始界面（启动器菜单）

\`\`\`
[1] 本机当服务器      在这台电脑开服，浏览器自动打开；把打印出来的局域网地址发给朋友即可加入
[2] 联机（本机客户端）本机素材 + 远程服务器：只把 /ws 与 /api/* 转发过去，素材一次网络都不走
[3] 连接服务器        用浏览器直接打开别人的服务器：页面、素材、对局数据都从对方来，本机不用装任何东西
[4] 设置              端口 / 局域网共享
[5] 查看状态          本机服务器与上次连接的服务器是否在跑
\`\`\`

也可以直接双击 \`本机当服务器.bat\`、\`联机.bat\` 或 \`连接服务器.bat\`，等于菜单里的 [1] / [2] / [3]。

选 [3] 只是用你的默认浏览器打开对方的网页（地址会记在 \`app\\scripts\\launcher.config.json\`）；
不想自动打开浏览器就加 \`--no-open\`。

选 [2] 是便携包最划算的联机方式：页面、\`/js\`、\`/css\`、\`/data\`、\`/vendor\` 与全部素材都从**本机磁盘**读，
只把 \`/ws\`（联机对战）与 \`/api/*\`（公告、在线人数）转发给对方的服务器，而且服务只监听 \`127.0.0.1\`。
素材一次网络都不走，所以进对局最快、也几乎不耗流量。两点要知道：昵称与设置和**网页版不共享**（浏览器按源隔离存储）；
服务器会校验协议版本，提示不一致时说明便携包该换新版了。

## 好友怎么加入（本机当服务器）

1. 菜单选 [1]，等浏览器打开、控制台打印出「发给朋友」的地址（形如 \`http://192.168.1.23:3000\`）。
2. 第一次可能需要在 Windows 防火墙弹窗里勾选**允许专用网络**（否则朋友连不上）。
3. 建房后把 4 位「同盟密钥」或「复制链接」（\`…/?room=密钥\`）发给朋友。

## 目录结构

\`\`\`
${withNode ? `node\\node.exe            便携版 Node ${version}（官方 x64，已经 sha256 校验）
node\\LICENSE-node.txt    Node 自己的许可证（MIT）
` : ''}app\\                    游戏本体：server / shared / public（素材）/ data / scripts / tools
app\\scripts\\launcher.mjs 启动器（开始界面）
启动游戏.bat             双击开始（菜单）
本机当服务器.bat         直接开服
联机.bat                 本机素材 + 对方服务器（进对局最快）${server ? `｜已内置 ${server}` : ''}
连接服务器.bat           直接打开别人的网页
README-开箱即用.md       本文件
LICENSE / NOTICE.md / THIRD-PARTY-NOTICES.md
\`\`\`

卸载＝直接删掉整个文件夹（不写注册表、不放系统目录）。存档/昵称在该电脑的浏览器 localStorage 里。
`;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return 0; }
  const out = path.resolve(o.out || path.join(path.dirname(ROOT), 'Stronghold-Protocol-Windows'));
  const appDir = path.join(out, 'app');
  const nodeDir = path.join(out, 'node');

  // 版本与哈希：默认用仓库里钉死的那一份；换版本必须同时给 --sha256，否则拒绝。
  let nodeVersion = NODE_PIN.version;
  let nodeHash = NODE_PIN.sha256;
  if (o.nodeSpec) {
    if (/^latest/i.test(o.nodeSpec)) {
      console.error(`✖ 便携包必须钉死一个具体版本，不能是 ${o.nodeSpec}。请写 --node-version v22.23.3 这类具体版本。`);
      return 1;
    }
    nodeVersion = o.nodeSpec.startsWith('v') ? o.nodeSpec : `v${o.nodeSpec}`;
    if (nodeVersion !== NODE_PIN.version) {
      if (!/^[0-9a-f]{64}$/.test(o.sha256)) {
        console.error(`✖ --node-version ${nodeVersion} 与仓库里钉死的 ${NODE_PIN.version} 不同，必须同时给 --sha256 <64 位十六进制>（取自官方 SHASUMS256.txt）。`);
        return 1;
      }
      nodeHash = o.sha256;
    }
  }

  console.log(`\n卫戍协议 · Windows 开箱即用包\n  源仓库：${ROOT}\n  产物：  ${out}\n`);

  // --out 指到仓库本身 / 上级目录时直接拒绝；--force 另外只肯删「空目录」或「上一次打的包」。
  if (outDirIsUnsafe(out)) {
    console.error(`✖ --out 指向仓库本身或它的上级目录：${out}\n  加 --force 会把仓库删掉，请换一个仓库之外的目录（例如 D:\\Game\\Stronghold-Protocol-Windows）。`);
    return 1;
  }
  const verdict = forceDeleteVerdict(out);
  if (verdict !== 'missing') {
    if (!o.force) {
      console.error(`✖ ${out} 已存在。要覆盖请加 --force —— 它只会删掉空目录，或上一次打的便携包，其余情况一律拒绝。`);
      return 1;
    }
    if (verdict === 'refuse') {
      console.error(`✖ ${out} 已存在，但它既不是空目录，也不像上一次打的便携包（包根要有 README-开箱即用.md 和 app\\）。`
        + '\n  为免误删，这里不会动它：请自己确认后删掉，或换一个 --out（例如 D:\\Game\\Stronghold-Protocol-Windows）。');
      return 1;
    }
    await fsp.rm(out, { recursive: true, force: true });
    console.log(`  · 清掉 ${out}（${verdict === 'empty' ? '空目录' : '上一次的便携包'}）`);
  }
  await fsp.mkdir(out, { recursive: true });

  // 1) 游戏代码：只收 git 跟踪的文件
  const all = trackedFiles();
  const wanted = (o.tests ? all : all.filter((rel) => !SKIP_TRACKED.some((p) => rel === p || rel.startsWith(p))))
    .filter((rel) => !SKIP_ROOT_FILES.includes(rel));
  console.log(`  · 复制游戏本体（git 跟踪的 ${wanted.length} 个文件${o.tests ? '，含 test/' : `，略过 ${all.length - wanted.length} 个 test/ 文件`}）…`);
  const copied = await copyFiles(wanted, appDir);
  console.log(`    完成：${copied.files} 个文件 / ${MB(copied.bytes)}`);

  // 2) 素材与前端库（不进版本库，必须存在）
  for (const d of ASSET_DIRS) {
    if (!fs.existsSync(path.join(ROOT, d))) {
      throw new Error(`缺少 ${d} —— 先运行 node tools/setup.mjs 把素材 / 前端库准备好`);
    }
  }
  console.log(`  · 复制素材与前端库（${ASSET_DIRS.join('、')}）…`);
  let assetFiles = 0; let assetBytes = 0;
  for (const d of ASSET_DIRS) {
    // eslint-disable-next-line no-await-in-loop
    const s = await copyDir(path.join(ROOT, d), path.join(appDir, d));
    assetFiles += s.files; assetBytes += s.bytes;
  }
  console.log(`    完成：${assetFiles} 个文件 / ${MB(assetBytes)}`);

  // 3) 生产依赖
  await installProductionDeps(appDir);
  const deps = await dirSize(path.join(appDir, 'node_modules'));
  console.log(`    完成：${deps.files} 个文件 / ${MB(deps.bytes)}（只含生产依赖）`);

  if (!o.webfonts) {
    const page = path.join(appDir, 'public', 'index.html');
    const { html, removed } = stripWebfonts(await fsp.readFile(page, 'utf8'));
    if (removed) {
      await fsp.writeFile(page, html);
      console.log(`    去掉 ${removed} 条 Google Fonts 外链（包内自带 /fonts；--keep-webfonts 可保留）`);
    } else {
      console.log('    提示：index.html 里没有 Google Fonts 外链，无需处理');
    }
  }

  // 4) 便携版 Node（含它自己的 LICENSE）
  let nodeInfo = { version: '（未打包，目标机器需自备 Node 22+）', bytes: 0 };
  if (o.node) {
    console.log(`  · 准备便携版 Node ${nodeVersion}…`);
    nodeInfo = await downloadPortableNode(nodeDir, nodeVersion, nodeHash);
    console.log(`    完成：Node ${nodeInfo.version} / ${MB(nodeInfo.bytes)} + LICENSE`);
  }

  // 5) 包根的法律文件（本项目的 LICENSE / NOTICE / 第三方声明）
  for (const f of LEGAL_FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) {
      console.log(`    ! 版本库里没有 ${f}，包根将缺少这份声明`);
      continue;
    }
    await fsp.copyFile(src, path.join(out, f));
  }

  await fsp.writeFile(path.join(out, '启动游戏.bat'), bat('"%NODE%" "%HERE%app\\scripts\\launcher.mjs" %*'), 'latin1');
  await fsp.writeFile(path.join(out, '本机当服务器.bat'), bat('"%NODE%" "%HERE%app\\scripts\\launcher.mjs" --mode local %*'), 'latin1');
  // 给了 --server 就把它烤进 .bat：联机那个连确认也跳过（--yes），双击即进线上
  const srv = o.server ? ` --server ${o.server}` : '';
  const srvOneClick = o.server ? `${srv} --yes` : '';
  await fsp.writeFile(path.join(out, '联机.bat'), bat(`"%NODE%" "%HERE%app\\scripts\\launcher.mjs" --mode proxy${srvOneClick} %*`), 'latin1');
  await fsp.writeFile(path.join(out, '连接服务器.bat'), bat(`"%NODE%" "%HERE%app\\scripts\\launcher.mjs" --mode connect${srv} %*`), 'latin1');
  await fsp.writeFile(path.join(out, 'README-开箱即用.md'), bundleReadme({ version: nodeInfo.version, withNode: !!o.node, server: o.server }), 'utf8');

  const total = await dirSize(out);
  console.log(`\n✔ 便携包已生成：${out}\n  ${total.files} 个文件 / ${MB(total.bytes)}`);
  console.log('  双击「启动游戏.bat」即可（开始界面：本机当服务器 / 联机 / 连接服务器）。');
  if (o.server) console.log(`  已内置联机服务器 ${o.server}：玩家双击「联机.bat」直接进线上。`);

  if (o.zip) {
    const zipPath = `${out}.zip`;
    await fsp.rm(zipPath, { force: true });
    console.log(`\n  · 压缩 ${zipPath}（大包，几分钟）…`);
    // 自己写 zip：系统 tar / Compress-Archive 在中文 Windows 上按 GBK 写文件名且不置 UTF-8 标志，
    // 别人下载后（GitHub 预览、macOS、7-Zip）会看到乱码文件名。
    let last = 0;
    const t0 = Date.now();
    const r = await zipDir(out, zipPath, {
      onProgress: (done, totalEntries) => {
        const now = Date.now();
        if (now - last < 4000) return;
        last = now;
        const pct = Math.floor((done / totalEntries) * 100);
        console.log(`    ${String(pct).padStart(3)}%  ${done}/${totalEntries} 个条目（${Math.round((now - t0) / 1000)}s）`);
      },
    });
    const zb = (await fsp.stat(zipPath)).size;
    console.log(`  ✔ ${zipPath}（${MB(zb)}，${r.files} 个文件 / ${r.dirs} 个目录，压缩率 ${(100 - (zb / r.rawBytes) * 100).toFixed(1)}%）`);
  }
  return 0;
}

// 作为脚本运行时才打包（被 import 时只导出 stripWebfonts 等纯函数，方便测试）。
const IS_MAIN = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();
if (IS_MAIN) main().then((code) => { process.exitCode = code ?? 0; }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });
