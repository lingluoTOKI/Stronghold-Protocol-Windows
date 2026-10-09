import { readFileSync, writeFileSync } from 'node:fs';
const files = process.argv.slice(2);
for (const f of files) {
  let t = readFileSync(f, 'utf8');
  const lines = t.split('\n');
  const out = [];
  let mode = 'normal'; // normal | ours | theirs
  for (const ln of lines) {
    if (ln.startsWith('<<<<<<< ')) { mode = 'ours'; continue; }
    if (ln.startsWith('=======') && mode === 'ours') { mode = 'theirs'; continue; }
    if (ln.startsWith('>>>>>>> ')) { mode = 'normal'; continue; }
    if (mode === 'theirs') continue;
    out.push(ln);
  }
  writeFileSync(f, out.join('\n'), 'utf8');
  console.log('resolved(keep ours):', f);
}
