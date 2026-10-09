import { readFileSync, writeFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const out = []; let m = 'normal', ours = [], theirs = [];
  for (const ln of lines) {
    if (ln.startsWith('<<<<<<< ')) { m = 'ours'; ours = []; theirs = []; continue; }
    if (ln.startsWith('=======') && m === 'ours') { m = 'theirs'; continue; }
    if (ln.startsWith('>>>>>>> ')) { out.push(...ours, ...theirs); m = 'normal'; continue; }
    if (m === 'ours') ours.push(ln);
    else if (m === 'theirs') theirs.push(ln);
    else out.push(ln);
  }
  writeFileSync(f, out.join('\n'), 'utf8');
  console.log('union:', f);
}
