import fs from 'node:fs';
import path from 'node:path';
const ROOT = 'F:/github/Stronghold-Protocol-Windows-v0.1.0/app';
const PUB = path.join(ROOT, 'public');
const cur = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/local-assets.json'), 'utf8'));
const bak = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/local-assets.json.emoticon-only.bak'), 'utf8'));

// 1) 所有 path 物理文件必须存在
let missing = 0, checked = 0;
const missList = [];
for (const [g, items] of Object.entries(cur.groups)) {
  for (const [name, e] of Object.entries(items)) {
    checked++;
    const abs = path.join(PUB, e.path);
    if (!fs.existsSync(abs)) { missing++; if (missList.length < 10) missList.push(g + '/' + name + ' -> ' + e.path); }
  }
}
console.log('paths checked:', checked, '| missing files:', missing);
if (missList.length) console.log(missList.join('\n'));

// 2) 备份中的 36 个表情 path 必须原样保留
let drift = 0;
for (const [g, items] of Object.entries(bak.groups)) {
  for (const [name, old] of Object.entries(items)) {
    const now = cur.groups[g]?.[name];
    if (!now || now.path !== old.path) { drift++; console.log('EMOTICON DRIFT:', g, name, old.path, '=>', now?.path); }
  }
}
console.log('emoticon entries in backup:', bak.count, '| path drift:', drift);

// 3) 抽查关键条目
for (const [g, n] of [['guide', 'autochess_home_1'], ['guide', 'autochess_handbook_4'], ['ui/battle', 'emoji_btn'], ['ui/battle', 'emoji_bubble_bkg'], ['ui/outer', 'operator_preset'], ['emoticon/basic', 'pic_happy_battle']]) {
  console.log('KEY', g + '/' + n, '=>', cur.groups[g]?.[n]?.path || 'MISSING');
}
console.log(missing === 0 && drift === 0 ? 'ALL_OK' : 'HAS_PROBLEM');
