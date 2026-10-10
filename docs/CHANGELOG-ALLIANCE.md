# Stronghold Protocol — Alliance Edition · Changelog

> A community multiplayer fork of **Stronghold Protocol (卫戍协议：盟约)**.
> This edition is rebuilt on the **clean official upstream 0.2.3** baseline and re-applies a
> small set of self-hosted multiplayer / UI features. The Rhine Life expansion has been
> removed from this build and will return later as a separately isolated plugin.
>
> - Upstream: <https://github.com/sganggs/Stronghold-Protocol> (baseline commit `1db8e510`, **0.2.3**)
> - This fork: <https://github.com/lingluoTOKI/Stronghold-Protocol-Windows>
> - Primary server: <http://game.lingluotoki.dpdns.org> · Backup vanilla server: <http://116.62.39.28:3000>
>
> Fan-made, unofficial, free to play. Art / music / text / data belong to Hypergryph / Yostar
> and are **not** covered by the GPL code license. No commercial use of any kind.

---

## [0.2.3-alliance] — 2026-10-10

### Rebuilt on a clean official baseline
- Reset the whole project onto official **sganggs/Stronghold-Protocol 0.2.3** (`1db8e510`).
  Verified: every upstream commit is present, **zero upstream files deleted**; the only added
  or modified files belong to the custom features listed below.
- **Removed the Rhine Life expansion** (the dual `vanilla` / `rhine` data profile). On the new
  engine it caused cross-profile contamination (Rhine bonds/operators leaking into vanilla
  rooms), missing research devices, and unstable mechanics. This build ships **official content
  only**. Rhine is planned to come back as an independently isolated plugin once stable.
- The custom multiplayer / UI features were re-applied onto the clean baseline as an explicit
  patch set instead of being carried inside the old mixed codebase.

### Upstream fixes now included (0.2.1 → 0.2.3 cumulative)
- Bond layer gains during battle are fixed; the Aegir "fish eats fish" devour and the
  Laterano / Sargon / Yan layer-gain cases now settle exactly by official rules.
- Fixed a bond showing as lit in the lobby while its operator was banned after entering a match
  (picker highlight disagreed with actual eligibility).
- Fixed ranged-enemy attacks causing a movement hitch / glide; operators that had fallen still
  attacking; blocked stealth enemies not losing concealment; some module / talent effects not
  applying.
- R21P — every operator fights at full potential; DIY / loadout related fixes; plus a large set
  of stage, balance, i18n and rendering fixes from upstream 0.2.1–0.2.3.

### Custom multiplayer / UI features (preserved)
1. **Six-player co-op** — player seats expanded to 6; large-room bounty rounds offer **9 cards**
   (the base 6 plus 3 across `[1,2,2]` tiers for rooms starting with ≥5 players); co-op beacons
   on rounds 10 / 12 / 14 (the round-14 beacon converts straight to a shop operator); six-player
   boss shared HP pool = 200% of the four-player baseline and scales with alive players; opening
   bans compensate by headcount (5 players −1, 6 players −2). Per-player deploy cap stays at the
   official **8** (only seats are expanded).
2. **Battle speed 1× / 2× / 4×** — local deterministic simulation, just changes the multiplier;
   smoother switching; non-default speed is highlighted.
3. **Smooth countdown** — the prep countdown flows smoothly at higher speed.
4. **Skip battle** — available only after every enemy has spawned; leftover enemies rush the base
   and deal their damage, then the game proceeds straight to the next shopping round.
   Unavailable in joint operations and boss stages; works in both solo and multiplayer.
5. **Draggable chat + emotes** — a single green "交流" button bottom-left; cooldown-gated
   (`CHAT_COOLDOWN_MS` / `EMOTE_COOLDOWN_MS`, max length 200).
6. **Server bulletin / announcements** — root `announcements.json`, hot-reloaded by file mtime
   (no restart needed); normal bulletins plus a one-time forced popup keyed by `forceId`.
7. **Online player count** — `GET /api/online`, polled by the lobby.
8. **Public / quick matchmaking** — target 6, difficulty FIFO buckets start as soon as full;
   on timeout the host may wait, top up with AI bots, or start immediately.
9. **Admin monitor (`monitor.html`)** — players grouped by room, kick / kick-all, publish and
   clear forced announcements; all admin routes require `SP_ADMIN_TOKEN`; `/healthz` has CORS.
10. **PC + Android online builds** — three Windows `.bat` launchers (host / local-client /
    connect) with portable-Node detection and LAN sharing, plus the packaging scripts.

### Fixes specific to this edition
- **Profile leak fixed:** after choosing vanilla in the lobby, the match briefing and operator
  loadout no longer show Rhine bonds or Rhine operators; spectators and reconnecting clients are
  fixed too. A vanilla room is now pure official content.
- Unowned DIY operators are now shown **dimmed** inside their bond's expanded roster (cards still
  open for inspection); the red disabled badge is retained.
- Restored the title-screen bulletin **envelope (mail) icon**.
- Restored the monitor's **"clear all forced announcements"** admin endpoints
  (`/api/admin/announce`, `/api/admin/announce-clear`).
- Restored the **3D battlefield (three.js)** by shipping the `data/local-assets.json` index:
  orange fence rails, 3D crates / gates / devices are back during prep. It auto-falls-back to the
  2D board when WebGL2 is unavailable, with no loss of playability.
- Smoother speed-button cycling and a smoothly flowing countdown at 2×/4×.

### Data & assets
- `data/local-assets.json` (the board3d art index, ~1481 entries) is shipped so the 3D board and
  fence rails load; URLs come only from this index (nothing is guessed).
- `data/assets.json` is rebuilt for 0.2.3.
- Deployment **keeps the server's `node_modules` and `public/assets`**. The ~123 previously
  missing summon Spine models under `public/assets/local/spine/{token,enemy}` are synced
  incrementally; any still-missing summon model falls back to static art and does not crash.

### Deployment notes
- systemd unit: `stronghold`; restart it after changing `server/` or `shared/`.
  `announcements.json` hot-reloads on mtime and does not require a restart.
- After pulling front-end changes, hard-refresh (Ctrl+F5) / clear the service worker and caches.
- A full byte-level backup of the previous live build (**app 0.2.2 / build `bcf47f9d`**,
  the Rhine edition) was archived before this upgrade, with SHA-256 and rollback steps recorded
  in `server-live-backup/`.

---

## How to re-sync a future upstream update without losing the custom features

See **[`UPSTREAM-SYNC-PROMPT.md`](./UPSTREAM-SYNC-PROMPT.md)** — it contains the reusable prompt
(the block between the two ✂ markers can be copied wholesale), the mirror commands, the exact
file locations of all ten custom features, the merge/rebuild workflow, the "art is not committed"
rule, and a self-check list. Never delete a custom feature; keep Rhine out of this build.
