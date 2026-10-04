import fs from 'node:fs';
import path from 'node:path';
const root = 'F:/github/Stronghold-Protocol-Windows-v0.1.0/app';
const local = path.join(root, 'public/assets/local');
function walk(d) {
  let out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  }
  return out;
}
console.log('=== assets/local 一级目录 ===');
for (const e of fs.readdirSync(local, { withFileTypes: true })) {
  if (e.isDirectory()) {
    const n = walk(path.join(local, e.name)).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).length;
    console.log('DIR ', e.name, n, 'imgs');
  } else {
    console.log('FILE', e.name);
  }
}
const all = walk(local);
console.log('=== 关键素材定位 ===');
for (const key of ['autochess_home_1', 'autochess_shop_1', 'autochess_handbook_1', 'emoji_btn', 'emoji_bkg', 'emoji_bubble_bkg', 'pic_happy_battle']) {
  const hit = all.filter((f) => path.basename(f).includes(key)).slice(0, 4).map((f) => path.relative(local, f).replace(/\\/g, '/'));
  console.log('FIND', key.padEnd(24), '=>', hit.join(' | ') || '(none)');
}
console.log('=== tools 中与 asset/data/local 相关脚本 ===');
const tools = path.join(root, 'tools');
if (fs.existsSync(tools)) for (const f of fs.readdirSync(tools)) if (/asset|data|local|manifest/i.test(f)) console.log('TOOL', f);
console.log('=== data 目录 ===');
for (const f of fs.readdirSync(path.join(root, 'data'))) console.log('DATA', f);
