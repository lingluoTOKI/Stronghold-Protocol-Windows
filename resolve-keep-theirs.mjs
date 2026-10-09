import { readFileSync, writeFileSync } from 'node:fs';
const files = process.argv.slice(2);
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const out = [];
  let mode = 'normal';
  for (const ln of lines) {
    if (ln.startsWith('<<<<<<< ')) { mode = 'ours'; continue; }
    if (ln.startsWith('=======') && mode === 'ours') { mode = 'theirs'; continue; }
    if (ln.startsWith('>>>>>>> ')) { mode = 'normal'; continue; }
    if (mode === 'ours') continue;
    out.push(ln);
  }
  writeFileSync(f, out.join('\n'), 'utf8');
  console.log('resolved(keep theirs):', f);
}
