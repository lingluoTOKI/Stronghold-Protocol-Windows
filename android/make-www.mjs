// android/make-www.mjs — 把浏览器端要用到的四棵树合成一个 www.zip，供安卓包内置。
//
// 结构与线上 Node 服务器（server/index.js createStaticHandler 的 mounts）一一对应：
//   /            → public/            → zip 根
//   /data/       → data/              → zip 的 data/
//   /shared/     → shared/            → zip 的 shared/
//   /sim/        → server/sim/        → zip 的 sim/
//
// 之所以先打成一个 zip、再由 App 首次启动时解压到内部存储，而不是直接塞进 AGP 的 assets/：
// AGP 的 assets.srcDirs 是把多个目录的**内容**并到同一层，这四棵树里 shared/constants.js 与
// server/sim/constants.js 同名，合并必然互相覆盖。zip 里可以带路径前缀，绕开这件事。
//
// 只实现 ZIP（store / deflate + 中央目录 + EOCD），超过 4 GB 或 65535 条目直接报错。
// 复用 scripts/zipdir.mjs 的 crc32 / dosDateTime（含 UTF-8 名字标志位 bit 11）。
//
// 用法：node android/make-www.mjs [--out <zip 路径>]

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { crc32, dosDateTime } from '../scripts/zipdir.mjs';
// 只为取 /data.js 那个迷你替身。server/index.js 末尾是 `if (isMain()) main()`，import 不会有副作用。
import { DATA_SHIM_JS } from '../server/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const LIMIT_ENTRIES = 0xffff;
const LIMIT_32 = 0xffffffff;

/** 四棵树 → zip 里的前缀。空串表示直接放在 zip 根。 */
export const TREES = Object.freeze([
  { src: 'public', prefix: '' },
  { src: 'data', prefix: 'data' },
  { src: 'shared', prefix: 'shared' },
  { src: path.join('server', 'sim'), prefix: 'sim' },
]);

/**
 * 递归列出一棵树，产出 zip 条目（名字用 `/`，目录以 `/` 结尾）。
 * @param {string} absDir
 * @param {string} prefix zip 里的顶层前缀（'' = 不要前缀）
 * @param {{name:string, abs:string, dir:boolean, mtime:Date, size:number}[]} out
 */
async function walk(absDir, prefix, out) {
  const items = await fsp.readdir(absDir, { withFileTypes: true });
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const it of items) {
    const childAbs = path.join(absDir, it.name);
    const rel = prefix ? `${prefix}/${it.name}` : it.name;
    if (it.isDirectory()) {
      const st = await fsp.stat(childAbs);
      out.push({ name: `${rel}/`, abs: childAbs, dir: true, mtime: st.mtime, size: 0 });
      await walk(childAbs, rel, out);
    } else if (it.isFile()) {
      const st = await fsp.stat(childAbs);
      out.push({ name: rel, abs: childAbs, dir: false, mtime: st.mtime, size: st.size });
    }
  }
}

/** 收集四条树的全部条目，按名字排序（产物稳定，便于比对）。 */
export async function collectEntries(root = ROOT) {
  const out = [];
  for (const t of TREES) {
    const abs = path.join(root, t.src);
    if (!fs.existsSync(abs)) throw new Error(`缺少源目录：${t.src}（先在仓库根跑一次 npm run setup）`);
    await walk(abs, t.prefix, out);
  }
  // /data.js 线上由 Node 现生成（server/index.js 的 DATA_SHIM_JS，浏览器里是 server/data.js 的替身），
  // /sim/content/** 会 `../../../data.js` 引它。app 里没有 Node，所以直接把这个常量写进 zip 根。
  const shim = Buffer.from(DATA_SHIM_JS, 'utf8');
  out.push({ name: 'data.js', abs: '', dir: false, mtime: new Date(), size: shim.length, data: shim });

  // 许可证与声明跟着包走。Windows 便携包把它们放在包根，安卓包没有"包根"这个概念，
  // 于是并进 about/。这一条是硬要求：素材版权归原权利人、不适用 GPL、不得单独再分发、
  // 严禁盈利、权利人要求即删除 —— 发出去的整包必须自带这几份，不能只有网页上有。
  for (const f of ['LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md']) {
    const abs = path.join(root, f);
    if (!fs.existsSync(abs)) throw new Error(`缺少声明文件 ${f}：整包发出去必须自带它`);
    const buf = fs.readFileSync(abs);
    out.push({ name: `about/${f}`, abs, dir: false, mtime: new Date(), size: buf.length, data: buf });
  }

  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * 写 zip。
 * @param {{name:string,abs:string,dir:boolean,mtime:Date,size:number}[]} items
 * @param {string} zipPath
 * @param {{level?:number, onProgress?:Function}} [o]
 */
export async function writeZip(items, zipPath, { level = 1, onProgress } = {}) {
  if (items.length > LIMIT_ENTRIES) throw new Error(`条目数 ${items.length} 超过 65535，需要 ZIP64（本实现不支持）`);
  const tmp = `${zipPath}.part`;
  await fsp.rm(tmp, { force: true });
  await fsp.mkdir(path.dirname(zipPath), { recursive: true });
  const out = fs.createWriteStream(tmp);

  let offset = 0;
  let files = 0;
  let dirs = 0;
  let rawBytes = 0;
  let storedBytes = 0;
  const central = [];

  const push = async (buf) => {
    offset += buf.length;
    if (!out.write(buf)) await once(out, 'drain');
  };

  const localHeader = (nameBytes, method, time, date, crc, csize, usize) => {
    const h = Buffer.alloc(30 + nameBytes.length);
    h.writeUInt32LE(SIG_LOCAL, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(FLAG_UTF8, 6);
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(csize, 18);
    h.writeUInt32LE(usize, 22);
    h.writeUInt16LE(nameBytes.length, 26);
    h.writeUInt16LE(0, 28);
    nameBytes.copy(h, 30);
    return h;
  };

  try {
    let done = 0;
    for (const it of items) {
      const nameBytes = Buffer.from(it.name, 'utf8');
      const { time, date } = dosDateTime(it.mtime);
      const start = offset;
      if (it.dir) {
        dirs++;
        await push(localHeader(nameBytes, METHOD_STORE, time, date, 0, 0, 0));
        central.push({ nameBytes, method: METHOD_STORE, time, date, crc: 0, csize: 0, usize: 0, start, attrs: ((0o040755 << 16) | 0x10) >>> 0 });
      } else {
        const data = it.data ? it.data : await fsp.readFile(it.abs);
        rawBytes += data.length;
        const crc = crc32(data);
        let method = level > 0 ? METHOD_DEFLATE : METHOD_STORE;
        let body = method === METHOD_DEFLATE ? zlib.deflateRawSync(data, { level }) : data;
        // 压不动就存原文（mp3 / png / skel 基本都压不动），别让包白变大、白花解压时间
        if (method === METHOD_DEFLATE && body.length >= data.length) { method = METHOD_STORE; body = data; }
        storedBytes += body.length;
        await push(localHeader(nameBytes, method, time, date, crc, body.length, data.length));
        await push(body);
        files++;
        central.push({ nameBytes, method, time, date, crc, csize: body.length, usize: data.length, start, attrs: (0o100644 << 16) >>> 0 });
      }
      onProgress?.(++done, items.length, it.name);
    }

    const cdStart = offset;
    for (const e of central) {
      const h = Buffer.alloc(46 + e.nameBytes.length);
      h.writeUInt32LE(SIG_CENTRAL, 0);
      h.writeUInt16LE(0x031e, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(FLAG_UTF8, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.csize, 20);
      h.writeUInt32LE(e.usize, 24);
      h.writeUInt16LE(e.nameBytes.length, 28);
      h.writeUInt16LE(0, 30);
      h.writeUInt16LE(0, 32);
      h.writeUInt16LE(0, 34);
      h.writeUInt16LE(0, 36);
      h.writeUInt32LE(e.attrs, 38);
      h.writeUInt32LE(e.start, 42);
      e.nameBytes.copy(h, 46);
      await push(h);
    }
    const cdSize = offset - cdStart;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    await push(eocd);

    if (offset > LIMIT_32) throw new Error('产物超过 4 GB，需要 ZIP64（本实现不支持）');

    await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
    await fsp.rm(zipPath, { force: true });
    await fsp.rename(tmp, zipPath);
    return { files, dirs, bytes: offset, rawBytes, storedBytes, entries: central.length };
  } catch (err) {
    out.destroy();
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

async function main(argv) {
  const outIdx = argv.indexOf('--out');
  const zipPath = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'www.zip');
  const t0 = Date.now();
  const items = await collectEntries();
  const raw = items.reduce((n, it) => n + it.size, 0);
  console.log(`条目 ${items.length}（${items.filter((i) => i.dir).length} 目录 / ${items.filter((i) => !i.dir).length} 文件）`);
  console.log(`原始大小 ${(raw / 1048576).toFixed(1)} MB`);
  let last = 0;
  const r = await writeZip(items, zipPath, {
    level: 1,
    onProgress: (done, total) => {
      const pct = Math.floor((done / total) * 100);
      if (pct >= last + 10) { last = pct - (pct % 10); process.stdout.write(`  ${last}%\n`); }
    },
  });
  console.log(`写出 ${zipPath}`);
  console.log(`  ${(r.bytes / 1048576).toFixed(1)} MB / ${r.entries} 条目 / 压缩后 ${(r.storedBytes / 1048576).toFixed(1)} MB（原始 ${(r.rawBytes / 1048576).toFixed(1)} MB）`);
  console.log(`  用时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }).catch((e) => { console.error(`✖ ${e?.message || e}`); process.exitCode = 1; });
}
