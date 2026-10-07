#!/usr/bin/env node
// scripts/publish-static-to-oss.mjs — 把「由 nginx 302 到 OSS」的那些静态目录同步到 OSS。
//
//   node scripts/publish-static-to-oss.mjs [--ossutil <path>] [--bucket <name>] [--dry-run] [--check]
//
// 背景（docs/DEPLOY.md「把静态资源分流到 OSS」）：线上 nginx 把 /data、/vendor、/js、/css 四个前缀
// 302 到阿里云 OSS，客户端因此不再从服务器的窄出口带宽取这些东西。代价是**每次发版都必须重跑本脚本**：
//
//   * /js 与 /css 每次发版都变。OSS 上那份一旦落后，玩家会**静默地一直跑旧代码** —— 不是刷新循环
//     （新页面首次 /healthz 检查就会把当前 build 标记认作「我这一版」，不会反复刷新），而是谁都
//     不会发现：build 标记来自服务器的磁盘，代码却来自 OSS，两者对不上时没有任何一方会报错。
//   * /data 与 /vendor 变得少，但改过就需要同步。
//
// 为什么逐个文件显式指定目标 key，而不是 `ossutil cp -r <dir> oss://bucket/`：后者的行为是把源目录的
// **内容**倒进目标前缀，不是把目录本身放进去 —— 少写一级前缀就会把文件撒到 bucket 根目录（踩过）。
//
// Ossutil 只负责搬运，凭据留在它自己的配置里（`ossutil config`），本脚本不接触、也不打印密钥。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 需要同步的目录：本地路径 → OSS 键前缀、缓存策略。
 *
 * Cache-Control 的取舍：/vendor 是第三方库，内容稳定，长缓存；/data、/js、/css 都会随发版改变，
 * 必须 `no-cache`（浏览器仍会带 If-None-Match 回源校验，内容没变就是一次 304），否则改完之后
 * 玩家要等缓存过期才拿得到新版本。
 */
const TREES = Object.freeze([
  { dir: 'data', prefix: 'data', cache: 'no-cache' },
  { dir: 'public/vendor', prefix: 'vendor', cache: 'max-age=31536000' },
  { dir: 'public/js', prefix: 'js', cache: 'no-cache' },
  { dir: 'public/css', prefix: 'css', cache: 'no-cache' },
]);

const HELP = `node scripts/publish-static-to-oss.mjs — 把 /data /vendor /js /css 同步到 OSS

  --ossutil <path>   ossutil 可执行文件（默认在 PATH 里找 ossutil / ossutil64，以及仓库内的
                     ossutil-v1.7.19-windows-amd64/ossutil64.exe）
  --bucket <name>    目标 bucket（默认 ${process.env.SP_OSS_BUCKET || 'weishuxieyi-game-res'}）
  --check            只比对 OSS 上已有对象与本地是否一致，不上传（发版前自查用）
  --dry-run          只打印将要执行的上传，不真的传
  -h, --help         显示这段说明

发版流程里**必须**包含这一步，否则玩家跑的还是 OSS 上的旧前端代码。见 docs/DEPLOY.md。
`;

function parseArgs(argv) {
  const o = { ossutil: '', bucket: process.env.SP_OSS_BUCKET || 'weishuxieyi-game-res', check: false, dry: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ossutil') o.ossutil = argv[++i] || '';
    else if (a === '--bucket') o.bucket = argv[++i] || o.bucket;
    else if (a === '--check') o.check = true;
    else if (a === '--dry-run') o.dry = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`未知参数：${a}（--help 看用法）`);
  }
  return o;
}

/** 找一个能用的 ossutil：显式指定 > PATH > 仓库自带的 Windows 版。 */
export function findOssutil(explicit = '') {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  candidates.push('ossutil', 'ossutil64');
  candidates.push(path.join(ROOT, 'ossutil-v1.7.19-windows-amd64', process.platform === 'win32' ? 'ossutil64.exe' : 'ossutil64'));
  candidates.push(path.join(ROOT, 'ossutil-v1.7.19-windows-amd64', 'ossutil.exe'));
  for (const c of candidates) {
    if (!c) continue;
    if (c.includes(path.sep) || /[\\/]/.test(c)) {
      if (fs.existsSync(c)) return path.resolve(c);
      continue;
    }
    const r = spawnSync(c, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}

/** 列出要同步的 [本地绝对路径, OSS 键, 缓存策略]，按 OSS 键排序（输出稳定、便于比对）。 */
export function listObjects(root = ROOT) {
  const out = [];
  for (const t of TREES) {
    const base = path.join(root, t.dir);
    if (!fs.existsSync(base)) continue;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;         // 编辑器 / 系统的杂物不进 bucket
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!e.isFile()) continue;
        const rel = path.relative(base, full).split(path.sep).join('/');
        out.push([full, `${t.prefix}/${rel}`, t.cache]);
      }
    };
    walk(base);
  }
  return out.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}

function ossutil(oss, args) {
  const r = spawnSync(oss, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.error) throw r.error;
  return { ok: r.status === 0, text };
}

export function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (o.help) { process.stdout.write(HELP); return 0; }

  const oss = findOssutil(o.ossutil);
  if (!oss) {
    console.error('✖ 找不到 ossutil。装一个（见 docs/DEPLOY.md），或用 --ossutil 指定路径。');
    return 1;
  }
  const objects = listObjects();
  if (!objects.length) {
    console.error('✖ 没有可同步的目录。先跑 node tools/setup.mjs 准备素材 / 前端库。');
    return 1;
  }
  const bytes = objects.reduce((n, [f]) => n + fs.statSync(f).size, 0);
  console.log(`ossutil : ${oss}`);
  console.log(`bucket  : oss://${o.bucket}`);
  console.log(`对象    : ${objects.length} 个 / ${(bytes / 1048576).toFixed(1)} MB`);
  if (o.check) console.log('模式    : --check（只比对，不上传）');
  if (o.dry) console.log('模式    : --dry-run');

  let ok = 0; const failed = []; const mismatched = [];
  for (const [full, key, cache] of objects) {
    const target = `oss://${o.bucket}/${key}`;
    if (o.check) {
      // 用 ETag（单段上传即内容 md5）与本地 md5 比对：不发第二次请求，也不下载整份文件。
      // 注意 ossutil 打印的是 `Etag                  : <32 位十六进制>`（大小写与冒号前的空格都不固定）。
      const st = ossutil(oss, ['stat', target]);
      const m = /e-?tag\s*:\s*"?([0-9a-fA-F]{32})/i.exec(st.text);
      if (!st.ok || !m) { mismatched.push(key); continue; }
      const r = spawnSync(process.execPath, ['-e', `
        const c=require('node:crypto'),f=require('node:fs');
        process.stdout.write(c.createHash('md5').update(f.readFileSync(process.argv[1])).digest('hex'));`,
        full], { encoding: 'utf8' });
      if (r.stdout.trim().toLowerCase() !== m[1].toLowerCase()) mismatched.push(key);
      continue;
    }
    if (o.dry) { console.log(`  would cp ${key}  (Cache-Control:${cache})`); ok++; continue; }
    const r = ossutil(oss, ['cp', '-f', full, target, '--meta', `Cache-Control:${cache}`]);
    if (r.ok && /Succeed/i.test(r.text)) ok++;
    else failed.push([key, r.text.trim().split('\n').slice(-1)[0]]);
  }

  if (o.check) {
    if (mismatched.length) {
      console.error(`\n✖ OSS 上有 ${mismatched.length} 个对象与本地不一致（或缺失）：`);
      for (const k of mismatched.slice(0, 20)) console.error(`    ${k}`);
      console.error('  发版前请先跑一次不带 --check 的同步。');
      return 1;
    }
    console.log(`\n✔ OSS 上 ${objects.length} 个对象与本地全部一致。`);
    return 0;
  }

  console.log(`\n${failed.length ? '✖' : '✔'} 上传完成：成功 ${ok} / 失败 ${failed.length}`);
  for (const [k, why] of failed.slice(0, 20)) console.error(`    ${k}: ${why}`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`✖ ${e?.message || e}`);
    process.exitCode = 1;
  }
}
