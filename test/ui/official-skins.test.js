import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chessAvatarUrl, chessPortraitUrl } from '../../public/js/ui/assetUrls.js';
import { parseSkel } from '../../tools/assets/skel.mjs';
const read = p => JSON.parse(fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8'));
const official = read('tools/assets/official-skins.json');
const manifest = read('data/assets.json');
test('official skins stay owned by the exact operator and resolve to real exported files', () => {
  let n = 0;
  for (const [cid, rec] of Object.entries(official)) for (const [sid, skin] of Object.entries(rec.skins)) {
    assert.ok(sid.startsWith(cid + '@'), sid);
    assert.deepEqual(manifest.chars[cid].skins[sid], skin);
    for (const p of [skin.avatar, skin.portrait]) {
      assert.ok(p && !p.includes('#'), sid);
      assert.ok(fs.existsSync(new URL('../../public' + p, import.meta.url)), p);
    }
    const chess = { charId: cid, assets: { avatar: cid, portrait: cid + '_1' } };
    if (skin.avatar) assert.equal(chessAvatarUrl(manifest, chess, {skin: sid}), skin.avatar);
    if (skin.portrait) assert.equal(chessPortraitUrl(manifest, chess, {skin: sid}), skin.portrait);
    for (const model of Object.values(skin.spine || {})) {
      const sk = parseSkel(fs.readFileSync(new URL('../../public' + model.skel, import.meta.url)));
      assert.ok(sk.animations.length, sid);
      for (const p of [model.atlas, ...model.textures]) assert.ok(fs.existsSync(new URL('../../public' + p, import.meta.url)), p);
    }
    n++;
  }
  assert.ok(n >= 276);
});
