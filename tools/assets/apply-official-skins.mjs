import { readFile, writeFile, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { contentHash } from './manifest.mjs';

export async function applyOfficialSkins(root) {
  const input = JSON.parse(await readFile(join(root, 'tools/assets/official-skins.json'), 'utf8'));
  const dest = join(root, 'data/assets.json');
  const manifest = JSON.parse(await readFile(dest, 'utf8'));
  const refs = new Set();
  const collect = v => {
    if (typeof v === 'string' && v.startsWith('/assets/')) refs.add(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(input);
  for (const url of refs) if (!(await stat(join(root, 'public', url))).isFile()) throw new Error('Missing ' + url);
  // Replace previous official exports atomically, including corrected case aliases.
  for (const c of Object.values(manifest.chars)) {
    for (const [sid, v] of Object.entries(c.skins || {})) {
      if (JSON.stringify(v).includes('/assets/local/official-skins/')) delete c.skins[sid];
    }
  }
  for (const [cid, entry] of Object.entries(input)) {
    if (!manifest.chars[cid]) continue;
    manifest.chars[cid].skins = { ...manifest.chars[cid].skins, ...entry.skins };
  }
  const { version, hash, generator, stats, ...body } = manifest;
  manifest.hash = contentHash(body);
  refs.clear(); collect(body);
  let bytes = 0;
  for (const url of refs) {
    try { bytes += (await stat(join(root, 'public', url))).size; }
    catch (err) { if (err.code !== 'ENOENT') throw err; } // Unrelated base art may be absent locally.
  }
  manifest.stats = { ...stats, files: refs.size, bytes };
  await writeFile(dest + '.tmp', JSON.stringify(manifest) + '\n');
  await rename(dest + '.tmp', dest);
  console.log(JSON.stringify({ operators: Object.keys(input).length, skins: Object.values(input).reduce((n, c) => n + Object.keys(c.skins).length, 0), files: refs.size }));
}
