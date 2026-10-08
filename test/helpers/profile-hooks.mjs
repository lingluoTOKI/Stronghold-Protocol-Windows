// test/helpers/profile-hooks.mjs — module customization hooks (worker/loader thread) for the test data-profile switch.
//
// Why a load hook instead of monkey-patching fs in the main thread: upstream tests use the *named* import
// `import { readFileSync } from 'node:fs'`. Built-in module named exports are static bindings, so reassigning
// fs.readFileSync in a preload does NOT change what those tests call. A load hook hands every importer of node:fs /
// node:fs/promises a thin wrapper ESM module, so the redirect works for named / namespace / default imports without
// touching a single upstream test file (keeps future upstream merges clean).
//
// How the wrapper reaches the GENUINE built-in (important): a load/resolve hook that wraps a built-in cannot simply
// `export * from 'node:fs/promises?marker'` — Node's built-in *resolver/translator* rejects a query suffix on a
// subpath built-in such as `node:fs/promises?marker` (ERR_UNKNOWN_BUILTIN_MODULE) before load runs, and stripping
// the marker makes load wrap the "original" again (recursion). Instead each wrapper obtains the real built-in via
// CommonJS `createRequire(...).require('node:fs…')`, which bypasses the ESM loader hooks entirely (no re-wrap), and
// we statically re-export every real binding by name (enumerated here in the loader thread). Only readFileSync /
// fs.promises.readFile are replaced with redirecting wrappers.

import { createRequire } from 'node:module';

const PROFILE = process.env.SP_TEST_PROFILE || 'rhine';

// Genuine built-ins in the loader thread (CJS require bypasses these very ESM hooks), used to enumerate exports.
const __cr = createRequire(process.cwd() + '/package.json');
const REAL_FS = __cr('node:fs');
const REAL_FSP = __cr('node:fs/promises');

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Source of the path-redirect helper (shared by both wrappers). Maps a top-level data/*.json read to data/vanilla. */
function redirectSource(dataDir, vanillaDir, fnName) {
  return `
    import path from 'node:path';
    import { fileURLToPath } from 'node:url';
    const DATA_DIR = ${JSON.stringify(dataDir)};
    const VANILLA_DIR = ${JSON.stringify(vanillaDir)};
    function ${fnName}(p) {
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
  `;
}

/**
 * A wrapper ESM module for a built-in: re-export every genuine binding by name, then override `wrappedName` with a
 * redirecting version. Kept for parity with the earlier helper name.
 */
export function getRedirectSource(dataDir, vanillaDir) {
  return `
    import { readFileSync as __rfs } from 'node:fs';
    ${redirectSource(dataDir, vanillaDir, '__redirect')}
    globalThis.__spRedirect = __redirect;
    export function readFileSync(p, ...rest) { return __rfs(__redirect(p), ...rest); }
  `;
}

/** Build the wrapper source for `builtinId` ('node:fs' / 'node:fs/promises'), overriding one function name. */
function wrapperSource(builtinId, realModule, wrappedName, dataDir, vanillaDir) {
  const reExport = Object.keys(realModule)
    .filter((k) => IDENT.test(k) && k !== wrappedName)
    .map((k) => `export const ${k} = __real.${k};`)
    .join('\n');
  return `
    import { createRequire as __createRequire } from 'node:module';
    const __r = __createRequire(process.cwd() + '/package.json');
    const __real = __r(${JSON.stringify(builtinId)});
    export default __real;
    ${reExport}
    ${redirectSource(dataDir, vanillaDir, '__redirect')}
    export function ${wrappedName}(p, ...rest) { return __real.${wrappedName}(__redirect(p), ...rest); }
  `;
}

export async function load(url, context, nextLoad) {
  if (PROFILE === 'vanilla' && (url === 'node:fs' || url === 'node:fs/promises')) {
    const dataDir = process.env.SP_DATA_DIR;
    const vanillaDir = process.env.SP_VANILLA_DIR;
    if (url === 'node:fs') {
      return { format: 'module', shortCircuit: true, source: wrapperSource('node:fs', REAL_FS, 'readFileSync', dataDir, vanillaDir) };
    }
    // node:fs/promises: wrap readFile; every other binding (and the default) is the genuine built-in.
    return { format: 'module', shortCircuit: true, source: wrapperSource('node:fs/promises', REAL_FSP, 'readFile', dataDir, vanillaDir) };
  }
  return nextLoad(url, context);
}
