// test/helpers/dataFile.mjs — single source of truth for the data directory a test reads.
//
// Tests must not hard-code '../../data/<file>.json': that path is the RHINE profile (data/ root), while the pristine
// upstream suite has to run against data/vanilla/. Import these helpers instead so the same test resolves the right
// profile from SP_TEST_PROFILE (rhine by default; vanilla with test/helpers/profile.mjs).
//
//   import { loadDataJson, dataFilePath } from '../helpers/dataFile.mjs';
//   const CHESS = loadDataJson('chess');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // test/helpers
const ROOT = path.resolve(HERE, '..', '..');

export const DATA_PROFILE = process.env.SP_TEST_PROFILE === 'vanilla' ? 'vanilla' : 'rhine';
export const DATA_DIR = DATA_PROFILE === 'vanilla' ? path.join(ROOT, 'data', 'vanilla') : path.join(ROOT, 'data');

/** Absolute path to `<profile>/<file>` (`.json` appended when missing). */
export function dataFilePath(file) {
  const name = file.endsWith('.json') ? file : `${file}.json`;
  return path.join(DATA_DIR, name);
}
/** file:// URL for `<profile>/<file>` (use in place of `new URL('../../data/…', import.meta.url)`). */
export function dataFileUrl(file) { return pathToFileURL(dataFilePath(file)); }
/** Parse and return `<profile>/<file>.json`. */
export function loadDataJson(file) { return JSON.parse(fs.readFileSync(dataFilePath(file), 'utf8'));
}
