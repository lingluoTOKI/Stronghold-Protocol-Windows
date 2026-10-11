#!/usr/bin/env node
// tools/dist.mjs — build the player-facing artifacts in one command.
//
//   npm run dist                     Windows portable zip + Android APK into dist/, plus dist/SHA256SUMS.txt
//   npm run dist -- --apk            APK only
//   npm run dist -- --win            Windows zip only
//   npm run dist -- --upstream URL   the centre server baked into the APK (default: android/gradle.properties)
//   npm run dist -- --out <dir>      artifact directory (default: dist/)
//   npm run dist -- --skip-build     reuse the www.zip already in android/app/src/main/assets/
//   npm run dist -- --dry-run        print the plan, run nothing
//
// Why this exists: the Android shell used to live outside this repository, in two divergent copies — one of them
// under a non-ASCII path, where AGP refuses to configure the project at all — and its version name was hand-written
// in app/build.gradle.kts, so an APK could disagree with package.json forever. Now android/ is part of the tree,
// the version comes from package.json, and the signing secrets come from SP_KEYSTORE_PASSWORD / SP_KEY_ALIAS /
// SP_KEY_PASSWORD in the environment, never from a committed file (gradle.properties used to hold them in clear).
//
// The APK embeds android/app/src/main/assets/www.zip (the whole web client + game art, ~500 MB): that is what makes
// it playable offline. Since the client serves the code from the centre server and only the art locally
// (android/app/src/main/java/com/lingluotoki/stronghold/LocalServer.kt dispatch), a code-only release does NOT need
// a new APK — see docs/DEPLOY.md.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT, IS_WIN, c, mark } from './setup.mjs';

const ANDROID_DIR = path.join(ROOT, 'android');
const WWW_ZIP = path.join(ANDROID_DIR, 'app', 'src', 'main', 'assets', 'www.zip');
const APK_OUT = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

// ---------------------------------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { apk: false, win: false, upstream: '', out: path.join(ROOT, 'dist'), skipBuild: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apk') o.apk = true;
    else if (a === '--win') o.win = true;
    else if (a === '--skip-build') o.skipBuild = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--upstream') o.upstream = argv[++i] || '';
    else if (a.startsWith('--upstream=')) o.upstream = a.slice('--upstream='.length);
    else if (a === '--out') o.out = path.resolve(argv[++i] || o.out);
    else if (a.startsWith('--out=')) o.out = path.resolve(a.slice('--out='.length));
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`不认识的参数：${a}（--help 看用法）`);
  }
  if (!o.apk && !o.win) { o.apk = true; o.win = true; }
  return o;
}

const USAGE = `用法：node tools/dist.mjs [--apk] [--win] [--out <dir>] [--upstream <url>] [--skip-build] [--dry-run]

  不带 --apk/--win 时两个都出。APK 需要 JDK（JAVA_HOME 或 C:\\Program Files\\Java\\jdk-*）与 Gradle
  （SP_GRADLE 环境变量、PATH 里的 gradle，或 F:\\gradle-8.7），以及 F:\\android-sdk（local.properties 的 sdk.dir）。
  签名口令走环境变量：SP_KEYSTORE_PASSWORD / SP_KEY_ALIAS / SP_KEY_PASSWORD（缺了就退 debug 签名）。`;

// ---------------------------------------------------------------------------------------------------
// preflight: find the toolchain
// ---------------------------------------------------------------------------------------------------

function which(cmd) {
  const r = spawnSync(IS_WIN ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0].trim();
  return null;
}

/** A usable JDK. JAVA_HOME on the build machines has been stale (pointing at a directory that no longer exists),
 *  and Gradle fails with a confusing message, so verify it before use and fall back to a scan. */
function findJavaHome() {
  const looksLikeJdk = (dir) => !!dir && fs.existsSync(path.join(dir, 'bin', IS_WIN ? 'javac.exe' : 'javac'));
  if (looksLikeJdk(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const roots = IS_WIN ? ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'D:\\java', 'F:\\java'] : ['/usr/lib/jvm'];
  const found = [];
  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries) if (looksLikeJdk(path.join(root, e))) found.push(path.join(root, e));
  }
  // Highest version first: jdk-21 beats jdk-17.
  found.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return found[0] || null;
}

function findGradle() {
  if (process.env.SP_GRADLE && fs.existsSync(process.env.SP_GRADLE)) return process.env.SP_GRADLE;
  const onPath = which(IS_WIN ? 'gradle.bat' : 'gradle');
  if (onPath) return onPath;
  const roots = IS_WIN ? ['F:\\', 'C:\\', 'D:\\'] : [];
  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries.filter((n) => /^gradle-\d/.test(n)).sort().reverse()) {
      const bat = path.join(root, e, 'bin', IS_WIN ? 'gradle.bat' : 'gradle');
      if (fs.existsSync(bat)) return bat;
    }
  }
  return null;
}

/** The Android SDK: ANDROID_HOME / ANDROID_SDK_ROOT, else android/local.properties (sdk.dir=…). */
function findAndroidSdk() {
  for (const v of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) if (process.env[v] && fs.existsSync(process.env[v])) return process.env[v];
  const props = path.join(ANDROID_DIR, 'local.properties');
  try {
    const m = /^sdk\.dir=(.+)$/m.exec(fs.readFileSync(props, 'utf8'));
    if (m) {
      // local.properties is a Java properties file: ':' and '\' come escaped as '\:' and '\\'.
      let dir = m[1].trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\');
      if (IS_WIN) dir = dir.replace(/\//g, '\\');
      if (fs.existsSync(dir)) return dir;
    }
  } catch { /* no local.properties: the env vars may still do */ }
  return null;
}

/** One value out of android/gradle.properties (no secret lives there any more). */
function gradleProperty(name) {
  try {
    const m = new RegExp(`^${name}=(.+)$`, 'm').exec(fs.readFileSync(path.join(ANDROID_DIR, 'gradle.properties'), 'utf8'));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

/** android/keystore.properties (gitignored) — the local convenience when the env vars are not exported. */
function readKeystoreProperties() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ANDROID_DIR, 'keystore.properties'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch { /* none: the environment is then the only source */ }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------------

function run(file, args, opts = {}) {
  const label = `${path.basename(file)} ${args.join(' ')}`;
  if (opts.dryRun) { console.log(`  ${c.dim('dry-run ▸')} ${label}`); return { status: 0 }; }
  const r = spawnSync(file, args, {
    cwd: opts.cwd || ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.error) throw new Error(`${label} 起不来：${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${label} 退出码 ${r.status}`);
  return r;
}

/** Gradle ships as a .bat on Windows, which Node refuses to spawn directly (CVE-2024-27980): go through cmd. */
function runGradle(gradle, args, opts) {
  if (IS_WIN) return run('cmd.exe', ['/c', gradle, ...args], opts);
  return run(gradle, args, opts);
}

function human(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function sha256(file) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

async function record(outDir, file, lines) {
  const h = await sha256(file);
  lines.push(`${h}  ${path.basename(file)}`);
  console.log(`  ${mark.ok} ${path.basename(file)}  ${human(fs.statSync(file).size)}  ${c.dim(h.slice(0, 16) + '…')}`);
}

/**
 * Move a finished artifact into the artifact directory.
 *
 * `fs.rename` cannot cross volumes on Windows (EXDEV): the package stage is a temp dir, usually on C:, while the
 * repository lives wherever it lives. Fall back to copy + unlink there.
 */
function moveInto(src, dst) {
  // Rebuilding on the same day produces the same name, and Windows rename will not overwrite an existing file.
  fs.rmSync(dst, { force: true });
  try {
    fs.renameSync(src, dst);
  } catch (e) {
    if (e?.code !== 'EXDEV') throw e;
    fs.copyFileSync(src, dst);
    fs.rmSync(src, { force: true });
  }
  return dst;
}

// ---------------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------------

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help) { console.log(USAGE); return 0; }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  // versionCode must grow monotonically or the phone refuses the upgrade: 0.2.4 → 204.
  const [maj = 0, min = 0, pat = 0] = String(version).split('.').map((p) => parseInt(p, 10) || 0);
  const versionCode = maj * 10000 + min * 100 + pat;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = (kind) => `StrongholdProtocol-${version}-${stamp}-${kind}`;

  const gradle = findGradle();
  const javaHome = findJavaHome();
  const sdk = findAndroidSdk();
  const secrets = (() => {
    const fromFile = readKeystoreProperties();
    return {
      SP_KEYSTORE_PASSWORD: process.env.SP_KEYSTORE_PASSWORD || fromFile.SP_KEYSTORE_PASSWORD || '',
      SP_KEY_ALIAS: process.env.SP_KEY_ALIAS || fromFile.SP_KEY_ALIAS || '',
      SP_KEY_PASSWORD: process.env.SP_KEY_PASSWORD || fromFile.SP_KEY_PASSWORD || '',
    };
  })();
  const canSign = !!(secrets.SP_KEYSTORE_PASSWORD && secrets.SP_KEY_PASSWORD);

  console.log(`\n${c.bold('卫戍协议：盟约 · 打包')}  版本 ${version} (code ${versionCode})  产物 → ${o.out}`);
  if (o.dryRun) console.log(c.warn('  --dry-run：只打印计划，不执行\n'));
  if (o.apk) {
    console.log(`  APK     Gradle ${gradle || c.err('(找不到)')} · JDK ${javaHome || c.err('(找不到)')} · SDK ${sdk || c.err('(找不到)')}`);
    console.log(`          签名 ${canSign ? c.ok('release（已提供口令）') : c.warn('debug（没有口令；只能侧载）')}`
      + (o.upstream ? ` · 上游 ${o.upstream}` : ''));
  }
  if (!o.apk && o.win) console.log('  Windows 便携包（tools/package.mjs）');

  if (!o.dryRun) {
    if (o.apk && !sdk) throw new Error('找不到 Android SDK：设 ANDROID_HOME，或在 android/local.properties 写 sdk.dir=');
    if (o.apk && !javaHome) throw new Error('找不到可用的 JDK：设 JAVA_HOME 指向一个含 bin/javac 的目录');
    if (o.apk && !gradle) throw new Error('找不到 Gradle：设 SP_GRADLE，或把 gradle 放进 PATH');
    // Debug-signed APKs cannot upgrade an installed release build (different signature ⇒ uninstall first),
    // so refuse to hand one out silently when the release keystore is right there.
    if (o.apk && !canSign) {
      const keystore = gradleProperty('SP_KEYSTORE');
      if (keystore && fs.existsSync(keystore)) {
        throw new Error(
          '密钥库在，但签名口令没给 —— 这样打出来的是 debug 签名的包，'
          + '玩家装不上已装的正式版（签名不同，只能先卸载）。\n'
          + '  设环境变量 SP_KEYSTORE_PASSWORD / SP_KEY_ALIAS / SP_KEY_PASSWORD，'
          + '或写 android/keystore.properties（已在 .gitignore 里）。',
        );
      }
    }
    if (o.win && !fs.existsSync(path.join(ROOT, 'tools', 'package.mjs'))) throw new Error('缺 tools/package.mjs');
    fs.mkdirSync(o.out, { recursive: true });
  }

  const lines = [];
  const androidOpts = { dryRun: o.dryRun, env: { JAVA_HOME: javaHome || '' } };
  const props = [`-PSP_VERSION_NAME=${version}`, `-PSP_VERSION_CODE=${versionCode}`];
  if (o.upstream) props.push(`-PSP_UPSTREAM=${o.upstream}`);
  // Secrets go in as -P properties, not only as env vars: a reused Gradle daemon keeps the environment it was
  // started with, so System.getenv() in the build script can read a stale value.
  for (const [k, v] of Object.entries(secrets)) if (v) props.push(`-P${k}=${v}`);

  if (o.apk) {
    console.log(`\n${c.bold('1/3 打 www.zip')}（web 客户端 + 素材）`);
    if (o.skipBuild && fs.existsSync(WWW_ZIP)) {
      console.log(`  ${mark.ok} 复用现成的 ${path.relative(ROOT, WWW_ZIP)}  ${human(fs.statSync(WWW_ZIP).size)}`);
    } else {
      fs.mkdirSync(path.dirname(WWW_ZIP), { recursive: true });
      run(process.execPath, [path.join(ANDROID_DIR, 'make-www.mjs'), '--out', WWW_ZIP], { dryRun: o.dryRun });
    }

    console.log(`\n${c.bold('2/3 编译自检')}（先花 10 秒挡住 Kotlin 写错，再花几分钟打真包）`);
    runGradle(gradle, ['-p', ANDROID_DIR, ':app:compileReleaseKotlin', '--console=plain'], androidOpts);

    console.log(`\n${c.bold('3/3 打 APK')}`);
    runGradle(gradle, ['-p', ANDROID_DIR, ':app:assembleRelease', '--console=plain', ...props], androidOpts);
    if (!o.dryRun && !fs.existsSync(APK_OUT)) throw new Error(`Gradle 说成功了，但没有 ${path.relative(ROOT, APK_OUT)}`);
  }

  if (o.win) {
    console.log(`\n${c.bold('Windows 便携包')}（tools/package.mjs）`);
    // package.mjs refuses an --out inside the repository (it would package its own output), so stage it in a
    // temp dir and move the zip in afterwards.
    const stage = o.dryRun ? path.join(os.tmpdir(), 'sp-dist') : fs.mkdtempSync(path.join(os.tmpdir(), 'sp-dist-'));
    // --allow-dirty: this fork almost always carries local edits when packaging; package.mjs still refuses
    // anything outside its allowlist (`git ls-files`), so stray files cannot slip in.
    run(process.execPath, [path.join(ROOT, 'tools', 'package.mjs'), '--out', stage, '--allow-dirty'], { dryRun: o.dryRun });
    if (!o.dryRun) {
      const zip = fs.readdirSync(stage).find((f) => f.endsWith('.zip'));
      if (!zip) throw new Error(`package.mjs 没产出 zip（${stage}）`);
      const dst = path.join(o.out, name('windows') + '.zip');
      moveInto(path.join(stage, zip), dst);
      await record(o.out, dst, lines);
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }

  if (o.dryRun) { console.log('\n--dry-run 结束。\n'); return 0; }

  console.log(`\n${c.bold('产物')}`);
  if (o.apk) {
    const dst = path.join(o.out, name('android') + '.apk');
    moveInto(APK_OUT, dst);
    await record(o.out, dst, lines);
  }
  // Merge with what is already there: a --apk run must not drop the Windows line of an earlier --win run.
  const sumsFile = path.join(o.out, 'SHA256SUMS.txt');
  const fresh = new Map(lines.map((l) => [l.slice(66), l]));
  if (fs.existsSync(sumsFile)) {
    for (const l of fs.readFileSync(sumsFile, 'utf8').split(/\r?\n/)) {
      if (/^\w{64} {2}\S/.test(l) && !fresh.has(l.slice(66))) fresh.set(l.slice(66), l);
    }
  }
  fs.writeFileSync(sumsFile, [...fresh.values()].join('\n') + '\n', 'utf8');
  console.log(`  ${mark.ok} SHA256SUMS.txt`);
  console.log(`\n完成：${o.out}\n`);
  return 0;
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((e) => { console.error(`\n${mark.err} ${e?.message || e}\n`); process.exitCode = 1; });
