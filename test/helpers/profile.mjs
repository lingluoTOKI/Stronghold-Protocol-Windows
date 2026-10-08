// test/helpers/profile.mjs — test-only data-profile switch (preload with --import).
//
// The repo ships two auditable data profiles (server/data.js getDataProfile):
//   • rhine  (data/ root)        = upstream v0.2.0 + the Rhine overlay (the live legacy behaviour)
//   • vanilla (data/vanilla/)    = pristine upstream v0.2.0, no Rhine content
//
// Upstream tests read top-level data/*.json both directly (readFileSync, every import style) and through the sim's
// getDefaultSource. To run the *upstream* suite against the pristine profile WITHOUT editing test files (keeping
// future upstream merges clean), set SP_TEST_PROFILE=vanilla:
//
//   SP_TEST_PROFILE=vanilla node --import ./test/helpers/profile.mjs --test test/content/op_doroth.test.js
//
// Two layers make the redirect exhaustive:
//   1. a module load hook (profile-hooks.mjs) wraps node:fs so even *named* readFileSync imports redirect;
//   2. a main-thread fs patch as a fallback for default/namespace imports.
// Only TOP-LEVEL data/<file>.json redirects to data/vanilla/<file>.json; data/vanilla/… and data/i18n/… never do.
// Default (unset) leaves everything untouched → the Rhine profile.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

const PROFILE = process.env.SP_TEST_PROFILE || 'rhine';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const VANILLA_DIR = path.join(DATA_DIR, 'vanilla');

if (PROFILE === 'vanilla') {
  // The load hook runs in the loader thread and reads these for its path math.
  process.env.SP_DATA_DIR = DATA_DIR;
  process.env.SP_VANILLA_DIR = VANILLA_DIR;
  register(new URL('./profile-hooks.mjs', import.meta.url), import.meta.url);

  /** Fallback for fs reached via a default/namespace import in the main thread. */
  function redirect(p) {
    if (p == null) return p;
    let s = p;
    if (p instanceof URL) s = fileURLToPath(p);
    else if (typeof p === 'object' && p && p.href) s = fileURLToPath(p.href);
    if (typeof s !== 'string') return p;
    const abs = path.resolve(s);
    const rel = path.relative(DATA_DIR, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep) && rel.endsWith('.json')) {
      return path.join(VANILLA_DIR, rel);
    }
    return p;
  }
  const origReadFileSync = fs.readFileSync;
  fs.readFileSync = (p, ...rest) => origReadFileSync(redirect(p), ...rest);
  const origReadFile = fs.promises.readFile;
  fs.promises.readFile = (p, ...rest) => origReadFile(redirect(p), ...rest);
}

export const PROFILE_NAME = PROFILE;
