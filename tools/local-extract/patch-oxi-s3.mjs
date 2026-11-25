// tools/local-extract/patch-oxi-s3.mjs — 塔露拉 S3 (skchr_oxi_3) 的弹道补丁（本地补丁，可回退）
//
// 背景：客户端把 S3 日冕重烈的火墙弹道 `projectile_chr_oxi_s_3_heatwave` 写在 buff 模板 oxi_s_3_wave 里，
// fx.py 的 crawl 只读技能 / charpack / 能力引用，抓不到这层；于是 fx/index.json 的
// skills.skchr_oxi_3.projectiles 为空、projectiles 段没有该条目 —— 前端（skills.js skillProjectile →
// plan.projectiles，flight.js projectileParts.main）因此不播 oxi_skill_03_trail_01 / _hit_01，对局里看到
// 的就是「技能一开只有起手那一下」。
//
// 本脚本把导出好的条目（同目录 oxi-s3-projectile.json，由 tools/local-extract 的 projectile 走查导出）写入
// index.json，并让 skchr_oxi_3 指向它。幂等：条目已存在且内容一致时什么都不做，可反复运行。
// 重跑 --only fx 后 index 会被重写，需要再运行本脚本一次（tools/verify-local-patches.mjs 会盯住）。
//
// 用法：node tools/local-extract/patch-oxi-s3.mjs [--check]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const INDEX = path.join(ROOT, 'public', 'assets', 'local', 'fx', 'index.json');
const DATA = path.join(HERE, 'oxi-s3-projectile.json');

const KEY = 'projectile_chr_oxi_s_3_heatwave';
const SKILL = 'skchr_oxi_3';

const check = process.argv.includes('--check');
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const entry = data[KEY];
if (!entry || typeof entry !== 'object') {
  console.error(`patch-oxi-s3: ${DATA} 里没有 ${KEY}`);
  process.exit(1);
}

const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
if (!idx.projectiles || typeof idx.projectiles !== 'object') idx.projectiles = {};
if (!idx.skills || typeof idx.skills !== 'object') idx.skills = {};

// skillPlan/planUses 先用 units[char].skills[id]（units 段才是对局读的那份），再退回 skills[id]：
// 两处都要指向弹道，只改 skills 段不生效。
const holders = [];
const own = idx.skills[SKILL];
if (own) holders.push(own);
for (const u of Object.values(idx.units || {})) {
  const s = u && typeof u === 'object' && u.skills ? u.skills[SKILL] : null;
  if (s && s !== own) holders.push(s);
}
if (!holders.length) {
  console.error(`patch-oxi-s3: index 里没有技能 ${SKILL}`);
  process.exit(1);
}

const before = {
  projectile: JSON.stringify(idx.projectiles[KEY] ?? null),
  skills: JSON.stringify(holders.map((s) => s.projectiles ?? null)),
};

idx.projectiles[KEY] = entry;

for (const s of holders) {
  const list = Array.isArray(s.projectiles) ? s.projectiles.filter((k) => k !== KEY) : [];
  s.projectiles = [KEY, ...list];
}

const after = {
  projectile: JSON.stringify(idx.projectiles[KEY]),
  skills: JSON.stringify(holders.map((s) => s.projectiles)),
};
const changed = before.projectile !== after.projectile || before.skills !== after.skills;

if (check) {
  console.log(changed ? 'patch-oxi-s3: 需要补丁（未写入）' : 'patch-oxi-s3: 已是最新');
  process.exit(changed ? 1 : 0);
}

if (!changed) {
  console.log('patch-oxi-s3: 已是最新，未改动');
  process.exit(0);
}

fs.writeFileSync(INDEX, JSON.stringify(idx), 'utf8');
console.log(`patch-oxi-s3: 已写入 ${KEY}（main ${entry.main}，lifeTime ${entry.lifeTime}）→ ${SKILL}.projectiles ${JSON.stringify(holders[0].projectiles)}`);
