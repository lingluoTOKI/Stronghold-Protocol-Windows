import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const files = process.argv.slice(2);
const show = (stage, f) => {
  try { return execSync(`git show :${stage}:${f}`, { maxBuffer: 1e8 }).toString('utf8'); }
  catch { return null; }
};
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
function merge(a, b) {
  if (isObj(a) && isObj(b)) {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = k in a ? merge(a[k], b[k]) : b[k];
    return out;
  }
  return b === undefined ? a : b;
}
for (const f of files) {
  const ours = JSON.parse(show(2, f));
  const theirs = JSON.parse(show(3, f));
  const merged = merge(ours, theirs);
  writeFileSync(f, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log('i18n merged:', f);
}
