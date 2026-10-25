// Maintainer-only local migration; no network or gameplay data changes.
import { readFile, writeFile, mkdir, copyFile, stat, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { contentHash } from './manifest.mjs';

export async function importSkins(source, root) {
  source = resolve(source);
  const input = JSON.parse(await readFile(join(source, 'data/assets.json'), 'utf8'));
  const targetPath = join(root, 'data/assets.json');
  const target = JSON.parse(await readFile(targetPath, 'utf8'));
  const catalogue = JSON.parse(await readFile(join(source, 'data/skins.json'), 'utf8'));
  const chars = {}, files = new Map();
  const convert = value => {
    if (typeof value === 'string' && value.startsWith('/assets/')) {
      const rel = value.slice(8);
      if (rel.split('/').some(x => !x || x === '..' || x === '.') || rel.includes('\\')) throw new Error('Unsafe asset path');
      const dest = '/assets/migrated-skins/' + rel;
      files.set(value, dest);
      return dest;
    }
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,convert(v)]));
    return value;
  };
  for (const [id, c] of Object.entries(input.chars || {})) {
    if (target.chars[id] && Object.keys(c.skins || {}).length) chars[id] = { skins: convert(c.skins) };
  }
  for (const [id, c] of Object.entries(chars)) {
    for (const item of (catalogue.chars?.[id] || [])) {
      if (c.skins[item.id]) Object.assign(c.skins[item.id], { name: item.name, group: item.group });
    }
  }
  // Validate all references before touching the destination manifest.
  for (const path of files.keys()) if (!(await stat(join(source, 'public', path))).isFile()) throw new Error('Missing ' + path);
  for (const [src,dst] of files) {
    const output = join(root, 'public', dst);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(join(source, 'public', src), output);
  }
  for (const [id,c] of Object.entries(chars)) target.chars[id].skins = { ...target.chars[id].skins, ...c.skins };
  const { version, hash, generator, stats, ...body } = target;
  target.hash = contentHash(body);
  const urls = new Set();
  const collect = v => { if (typeof v === 'string' && v.startsWith('/assets/')) urls.add(v); else if (v && typeof v === 'object') Object.values(v).forEach(collect); };
  collect(body);
  let bytes = 0;
  for (const url of urls) { try { bytes += (await stat(join(root, 'public', url))).size; } catch { /* unrelated optional art may be absent */ } }
  target.stats = { ...stats, files: urls.size, bytes };
  await writeFile(join(root, 'tools/assets/migrated-skins.json'), JSON.stringify(chars, null, 2) + '\n');
  await writeFile(targetPath + '.tmp', JSON.stringify(target) + '\n');
  await rename(targetPath + '.tmp', targetPath);
  console.log(JSON.stringify({ operators: Object.keys(chars).length, skins: Object.values(chars).reduce((n,c) => n + Object.keys(c.skins).length,0), files: files.size }));
}
