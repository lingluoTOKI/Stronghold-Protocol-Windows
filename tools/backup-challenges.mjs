import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
// Run on a trusted machine with a second-volume or mounted off-host destination.
// This tool copies only; it never replaces a live store or restores old progress.
const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg) throw new Error('Usage: node tools/backup-challenges.mjs <runtime/daily-challenges.json> <backup-directory>');
const source = path.resolve(sourceArg), destination = path.resolve(destinationArg);
if (destination === path.dirname(source)) throw new Error('Choose a separate backup directory or volume');
const bytes = await fs.readFile(source), data = JSON.parse(bytes.toString('utf8'));
if (data.version !== 2 || !/^[a-f0-9]{64}$/.test(data.secret) || !data.days || !data.achievements) throw new Error('Invalid source; backup refused');
await fs.mkdir(destination, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = path.join(destination, `challenge-${stamp}.json`);
await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
const hash = value => createHash('sha256').update(value).digest('hex');
if (hash(await fs.readFile(file)) !== hash(bytes)) throw new Error('Backup verification failed');
console.log(JSON.stringify({ file, bytes: bytes.length, sha256: hash(bytes), verified: true }));
