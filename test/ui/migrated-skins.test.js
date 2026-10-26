import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { data } from '../../public/js/data.js';
import { availableSkins, setSkin, clearSkin, chosenSkin } from '../../public/js/ui/skins.js';
import { spineEntry, portraitUrl } from '../../public/js/assets.js';
const manifest = JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
test('migrated installation skins can be selected and cleared through the real picker', () => {
  data.setContent({ id: 'm'.repeat(64), values: { assets: manifest } });
  try {
    let count = 0;
    for (const [id, c] of Object.entries(manifest.chars)) {
      for (const [key, skin] of Object.entries(c.skins || {})) {
        if (!JSON.stringify(skin).includes('/assets/migrated-skins/') && !JSON.stringify(skin).includes('/assets/local/official-skins/')) continue;
        assert.ok(availableSkins(id).some(s => s.id === key && s.playable), key);
        setSkin(id, key);
        assert.equal(chosenSkin(id), key);
        if (skin.spine?.front) assert.equal(spineEntry(manifest, id, {skin:key}).skel, skin.spine.front.skel);
        if (skin.portrait) assert.equal(portraitUrl(manifest, id, {skin:key}), skin.portrait);
        clearSkin(id);
        assert.equal(chosenSkin(id), null);
        count++;
      }
    }
    assert.equal(count, 304);
  } finally { data.setContent(null); }
});
