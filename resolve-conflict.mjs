import { readFileSync, writeFileSync } from 'node:fs';
const mode = process.argv[2]; // 'ours' | 'theirs'
const files = process.argv.slice(3);
const keepOurs = mode === 'ours';
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const out = [];
  let m = 'normal';
  for (const ln of lines) {
    if (ln.startsWith('<<<<<<< ')) { m = 'ours'; continue; }
    if (ln.startsWith('=======') && m === 'ours') { m = 'theirs'; continue; }
    if (ln.startsWith('>>>>>>> ')) { m = 'normal'; continue; }
    if (m === 'ours' && !keepOurs) continue;
    if (m === 'theirs' && keepOurs) continue;
    out.push(ln);
  }
  writeFileSync(f, out.join('\n'), 'utf8');
  console.log('resolved keep', mode, ':', f);
}
