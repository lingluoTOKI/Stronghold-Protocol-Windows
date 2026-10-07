// test/render/oss-fallback.test.js — public/js/assets.js: OSS static-asset hosting and its fallback.
//
// The bucket answers only to the origins its 防盗链 / CORS rules list, so an offline, LAN-addressed or
// un-whitelisted client sees every `/assets/…` request fail (403 or a transport error). These cases pin the
// promise made in the module header: one failure turns every later asset URL back to the server's own copy,
// and the game keeps playing instead of showing a page without art or sound.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  OSS_BASE, OSS_PROBE_PATH, rewriteAssetUrl, ossEnabled, disableOss, enableOss, probeOss, createAssets,
} from '../../public/js/assets.js';

/** A manifest big enough for one spine entry (`char_002_amiya`) and one plain image. */
const SP = (id) => ({ skel: `/assets/spine/${id}.skel`, atlas: `/assets/spine/${id}.atlas`, textures: [`/assets/spine/${id}.png`], pma: false, anims: { idle: 'Idle' }, animations: { Idle: 1 }, events: [], hits: {}, bounds: null });
const M = { chars: { char_002_amiya: { avatar: '/a/amiya.png', spine: { front: SP('amiya_f') } } } };

beforeEach(() => enableOss());
afterEach(() => enableOss());

describe('rewriteAssetUrl', () => {
  test('maps /assets/ to OSS while it is on, and back to the local copy once it is off', () => {
    assert.equal(rewriteAssetUrl('/assets/ui/x.png'), `${OSS_BASE}/assets/ui/x.png`);
    disableOss();
    assert.equal(rewriteAssetUrl('/assets/ui/x.png'), '/assets/ui/x.png');
    enableOss();
    assert.equal(rewriteAssetUrl('/assets/ui/x.png'), `${OSS_BASE}/assets/ui/x.png`);
  });

  test('leaves every non-asset URL alone (API, ws, page code, data)', () => {
    for (const u of ['/data/assets.json', '/js/main.js', 'https://example.com/a.png', '/media/bgm/act1', '', null, undefined, 42]) {
      assert.equal(rewriteAssetUrl(u), u, `${u} must be untouched`);
    }
  });

  test('disableOss is idempotent and enableOss restores the mapping', () => {
    disableOss();
    disableOss();
    assert.equal(ossEnabled(), false);
    enableOss();
    assert.equal(ossEnabled(), true);
  });
});

describe('image() falls back to the server copy', () => {
  test('an OSS failure retries the local URL and switches every later URL over', async () => {
    const loaded = [];
    const a = createAssets({
      manifest: M,
      loadImage: async (u) => { loaded.push(u); if (u.startsWith(OSS_BASE)) throw new Error('403'); return { src: u }; },
    });

    assert.deepEqual(await a.image('/assets/art/x.png'), { src: '/assets/art/x.png' });
    assert.deepEqual(loaded, [`${OSS_BASE}/assets/art/x.png`, '/assets/art/x.png'], 'one OSS try, then the local copy');
    assert.equal(ossEnabled(), false, 'the failure switches the whole client over');

    loaded.length = 0;
    assert.deepEqual(await a.image('/assets/art/y.png'), { src: '/assets/art/y.png' });
    assert.deepEqual(loaded, ['/assets/art/y.png'], 'later images never touch OSS');
  });

  test('a URL that is not under /assets/ is not retried (nothing to fall back to)', async () => {
    const loaded = [];
    const a = createAssets({
      manifest: M,
      loadImage: async (u) => { loaded.push(u); throw new Error('boom'); },
    });
    assert.equal(await a.image('/data/some.png'), null);
    assert.deepEqual(loaded, ['/data/some.png']);
    assert.equal(ossEnabled(), true, 'an unrelated failure must not switch OSS off');
  });

  test('a local retry that fails too still resolves null, and the flag stays off', async () => {
    const a = createAssets({ manifest: M, loadImage: async () => { throw new Error('offline'); } });
    assert.equal(await a.image('/assets/art/z.png'), null);
    assert.equal(ossEnabled(), false);
  });

  test('imageNow() finds the entry whichever key it was cached under', async () => {
    const a = createAssets({
      manifest: M,
      loadImage: async (u) => { if (u.startsWith(OSS_BASE)) throw new Error('403'); return { src: u }; },
    });
    await a.image('/assets/art/w.png');
    // cached under the OSS key, but the flag is now off, so imageNow computes the local key
    assert.deepEqual(a.imageNow('/assets/art/w.png'), { src: '/assets/art/w.png' });
  });
});

describe('spine falls back to the server copy', () => {
  test('an OSS skeleton that never arrives is retried from /assets/ and the flag flips', async () => {
    const tried = [];
    const a = createAssets({
      manifest: M,
      unloadSpine: () => {},
      loadSpine: async (e) => { tried.push(e.skel); if (e.skel.startsWith(OSS_BASE)) throw new Error('403'); return { animations: [], from: e.skel }; },
    });
    const e = a.spineEntry('char_002_amiya');
    const d = await a.spine.acquire(e);
    assert.equal(d.from, '/assets/spine/amiya_f.skel');
    assert.deepEqual(tried, [`${OSS_BASE}/assets/spine/amiya_f.skel`, '/assets/spine/amiya_f.skel']);
    assert.equal(ossEnabled(), false);
  });

  test('a retry that fails too stops there and leaves the flag off', async () => {
    const tried = [];
    const a = createAssets({
      manifest: M,
      unloadSpine: () => {},
      loadSpine: async (e) => { tried.push(e.skel); throw new Error('nope'); },
    });
    await assert.rejects(a.spine.acquire(a.spineEntry('char_002_amiya')));
    assert.deepEqual(tried, [`${OSS_BASE}/assets/spine/amiya_f.skel`, '/assets/spine/amiya_f.skel'], 'OSS, then the local copy, and no third try');
    assert.equal(ossEnabled(), false);
  });
});

describe('probeOss', () => {
  test('a transport failure turns OSS off', async () => {
    const ok = await probeOss({ fresh: true, fetch: async () => { throw new Error('ENOTFOUND'); } });
    assert.equal(ok, false);
    assert.equal(ossEnabled(), false);
    assert.equal(rewriteAssetUrl('/assets/a.png'), '/assets/a.png');
  });

  test('a 403 (hotlink / CORS refused) turns OSS off', async () => {
    const ok = await probeOss({ fresh: true, fetch: async () => ({ ok: false, status: 403 }) });
    assert.equal(ok, false);
    assert.equal(ossEnabled(), false);
  });

  test('a 404 keeps OSS on: the bucket answered, only the probe path is wrong', async () => {
    const ok = await probeOss({ fresh: true, fetch: async () => ({ ok: false, status: 404 }) });
    assert.equal(ok, true);
    assert.equal(ossEnabled(), true);
  });

  test('a 200 keeps OSS on, and it asks for the documented probe path', async () => {
    const seen = [];
    const ok = await probeOss({ fresh: true, fetch: async (u) => { seen.push(u); return { ok: true, status: 200 }; } });
    assert.equal(ok, true);
    assert.deepEqual(seen, [OSS_BASE + OSS_PROBE_PATH]);
  });

  test('never rejects, and a cached probe is not asked again', async () => {
    let calls = 0;
    const f = async () => { calls++; throw new Error('down'); };
    await probeOss({ fresh: true, fetch: f });
    await probeOss({ fetch: f });
    await probeOss({ fetch: f });
    assert.equal(calls, 1, 'the decision is made once');
  });
});
