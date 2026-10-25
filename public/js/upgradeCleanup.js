// Legacy app-cache cleanup; preserve imported art across upgrades.
  (function () {
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (rs) {
          rs.forEach(function (r) { r.unregister(); });
        }).catch(function () {});
      }
      if (window.caches && caches.keys) {
        caches.keys().then(function (ks) {
          ks.forEach(function (k) {
            // sp-imported-assets-* is the player's imported art (public/sw.js / assetCache.js): hours of local
            // unzipping live here. Wiping it on every load made every import useless across sessions — the
            // stale-JS cleanup must only touch the app's own caches, which the SW activation also re-scopes.
            if (k.indexOf('sp-imported-assets-') !== 0) caches.delete(k);
          });
        }).catch(function () {});
      }
    } catch (e) {}
  })();
