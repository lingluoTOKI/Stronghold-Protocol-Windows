// 重新生成完整的 data/local-assets.json：递归扫描 public/assets/local 下所有图片，
// group = 相对目录(POSIX)，name = 不含扩展名的文件名，path = /assets/local/<rel>。
// 覆盖 emoticon / guide / ui(battle,common,outer) / module / map/* / projectiles。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'F:/github/Stronghold-Protocol-Windows-v0.1.0/app';
const LOCAL = path.join(ROOT, 'public', 'assets', 'local');
const OUT = path.join(ROOT, 'data', 'local-assets.json');
const BAK = path.join(ROOT, 'data', 'local-assets.json.emoticon-only.bak');

fs.copyFileSync(OUT, BAK);
console.log('backed up ->', path.basename(BAK));

const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const PRIO = { '.png': 0, '.webp': 1, '.gif': 2, '.jpg': 3, '.jpeg': 4 };

function pngSize(buf) {
  if (buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  return null;
}

function walk(d) {
  let out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  }
  return out;
}

const groups = {};
let scanned = 0;
for (const abs of walk(LOCAL)) {
  const ext = path.extname(abs).toLowerCase();
  if (!IMG_EXT.includes(ext)) continue;
  scanned++;
  const rel = path.relative(LOCAL, abs).split(path.sep).join('/');
  const dir = path.posix.dirname(rel);
  const group = dir === '.' ? '' : dir;
  const name = path.basename(rel, ext);
  const entry = { path: '/assets/local/' + rel };
  if (ext === '.png') {
    try {
      const fd = fs.openSync(abs, 'r');
      const head = Buffer.alloc(24);
      fs.readSync(fd, head, 0, 24, 0);
      fs.closeSync(fd);
      const wh = pngSize(head);
      if (wh) { entry.w = wh.w; entry.h = wh.h; }
    } catch { /* 尺寸读不到就只保留 path */ }
  }
  if (!groups[group]) groups[group] = {};
  const existing = groups[group][name];
  if (!existing) {
    groups[group][name] = entry;
  } else {
    const curExt = path.extname(existing.path).toLowerCase();
    if (PRIO[ext] < PRIO[curExt]) groups[group][name] = entry; // 同名时 png 优先
  }
}

const sortedGroups = {};
let count = 0;
for (const g of Object.keys(groups).sort()) {
  sortedGroups[g] = {};
  for (const n of Object.keys(groups[g]).sort()) { sortedGroups[g][n] = groups[g][n]; count++; }
}

const manifest = {
  version: 1,
  source: 'regenerated: full scan of public/assets/local (emoticon+guide+ui+module+map+projectiles)',
  count,
  groups: sortedGroups,
};
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('scanned images:', scanned, '| manifest entries:', count);
for (const g of Object.keys(sortedGroups)) console.log('  group', JSON.stringify(g), Object.keys(sortedGroups[g]).length);
