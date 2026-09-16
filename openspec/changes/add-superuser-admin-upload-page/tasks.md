## 1. Shared identifier helpers (CLI ↔ admin parity foundation)

- [x] 1.1 Extract the path-free pure helpers (`normalizeIdentifier`, `getPathParts`, `buildGameId`, `buildTrackId`, `splitArtists`, `isUnknownGameName`, extension→platform map) from `tools/lib/identifiers.mjs` / `tools/lib/platforms.mjs` into a shared ESM module (no `node:path` import); refactor `tools/lib` to re-export from it. Verify with `node -e "import('<shared module>').then(m => console.log(m.buildGameId('psx','Final Fantasy IX'), m.buildTrackId('psx/my-game/01 Title.psf')))"` and by re-running `TRACKIFY_PB_UPLOAD_DRY_RUN=1 node tools/upload-index.mjs` against a local `npm run pocketbase:serve` instance — output ids identical to pre-refactor.
- [x] 1.2 Add per-environment shims (`stripExtension`, `normalizeFolderGameName`) for the browser in `web/admin/lib/` that call the shared module; verify identical outputs for the same inputs via a quick browser-console check during 2.x.

## 2. Page scaffold and build wiring

- [x] 2.1 Create `web/admin.html`, `web/admin.js` (entry), `web/admin.css`; add the rollup input in `vite.config.mjs`. Verify `npm run dev-js` serves `/admin.html` and `npm run build` emits `build/dist/admin.html` (then `npm run verify:dist` still passes).
- [x] 2.2 Create `web/admin/` module directory with the auth/stage/probe/upload module skeletons wired into the entry; verify the page loads with no console errors in dev.

## 3. Superuser auth gate (specs: admin-auth)

- [x] 3.1 Implement `web/admin/auth.js`: dedicated PocketBase client with `new LocalAuthStore('pb_admin_auth')`, `_superusers.authWithPassword` login form, logout, and session display. Verify login against a local superuser (`bin/pocketbase superuser upsert ...` + `npm run pocketbase:serve`): valid credentials show the UI, wrong ones show an error without a session.
- [x] 3.2 Implement the gate: unauthenticated page renders only the login form and fetches nothing; implement 401 handling that clears the session and returns to the login form while preserving staged state. Verify: anonymous visit shows no catalog data in the network tab; a cleared/expired token mid-use drops to login with staged files still listed.
- [x] 3.3 Verify session isolation: with the visitor app signed in via Google/OAuth in a second tab, superuser login and logout on `/admin.html` must not alter the visitor tab's `pb_auth` localStorage entry or break favorites.

## 4. Staging: selection, grouping, cover art, editing (specs: admin-catalog-upload)

- [x] 4.1 Implement folder input (`webkitdirectory`) and multi-file input capturing `webkitRelativePath`; stage every accepted file with its relative path. Verify with a copy of `sample-files/`: all audio, image, and sidecar files appear staged.
- [x] 4.2 Implement grouping into games using the shared helpers (platform from first path segment, game from second, playable = known extension; sidecars attach to the bundle without track rows; images never become tracks; convention violations surface as ungrouped, never dropped). Verify: `psx/my-game/*` groups as one game; a `.psflib` produces no track row; multi-picked loose files appear as ungrouped with manual game/platform assignment.
- [x] 4.3 Implement cover-art proposal (first image in the game folder, sorted by name) with manual replace (file picker) and clear; games without cover art remain uploadable. Verify on a sample game folder, including the override path.
- [x] 4.4 Implement the editable staging grid (per-game title/platform/year/company/cover; per-track title/artist/length; derived ids shown and editable) with no network writes before upload starts. Verify: editing fields then inspecting the network tab shows zero PocketBase write requests until upload is started.

## 5. Metadata probing (specs: admin-catalog-upload)

- [x] 5.1 Port the CLI probe flow to the browser (`web/admin/probe.js`): reuse `web/player/backend_loader.js`, stage game-folder files into the core's virtual FS, run `emu_load_file` (+ `emu_set_subsong` for snes/vgm), read title/artist/length via `emu_get_track_info`/`emu_get_max_position`, then `emu_teardown`; serial per game. Verify on a known `sample-files` game: length/title/artist prefilled and matching `sample-files/index.json` for the same file.
- [x] 5.2 Implement fallbacks and isolation: probe failure or unsupported type (mp3/xa/genh) → filename-derived title, length `-1`; probing runs fully client-side before upload and prefills the editable fields. Verify: a corrupt file and an `.xa` file both stage with `-1` while the rest of the batch probes normally.

## 6. Upload engine (specs: admin-catalog-upload)

- [x] 6.1 Implement skip-set computation at upload start (`games.getFullList` with `coverArt,files`; `tracks.getFullList` with `id,filename`; game by id or `platform::title` key, track by id or lowercased filename, file by basename) mirroring the CLI. Verify against a catalog already populated via `TRACKIFY_PB_UPLOAD_DRY_RUN=0` CLI upload: re-staging the same folder marks everything as existing.
- [x] 6.2 Implement the serial item queue in dependency order (game create → `files+` uploads → track creates) with per-item state machine `pending → active → completed | skipped | failed`, treat create-conflict (400 already exists) as skipped, and expose per-item retry after the pass. Verify by uploading a folder to local PB, then re-uploading: second pass reports all items skipped and creates no duplicates (check record counts before/after).
- [x] 6.3 Verify partial-failure recovery: interrupt an upload mid-pass (dev-tools offline), then re-run the same folder — only missing files/tracks are created, completed items are not re-sent; and verify a track's `filename` equals the stored bundle basename (spot-check via `/api/files/games/<gameId>/<filename>`).
- [x] 6.4 Verify per-item progress UI: during an upload each item shows pending/active/completed/skipped/failed; a forced single-file failure (e.g. oversized file) marks only that item failed while the batch continues.

## 7. Parity, build, and docs

- [x] 7.1 CLI-parity check: stage the same folder via the admin page and run `TRACKIFY_PB_UPLOAD_DRY_RUN=1 node tools/upload-index.mjs` against the same local instance; assert identical game/track ids and no duplicate records after both run. 
- [x] 7.2 Full build gate: `npm run build && npm run verify:dist` passes with `admin.html` emitted and all five backends intact in `build/dist/wasm/`.
- [x] 7.3 Docs: add `admin.html` to `docs/frontend.md` (input list + a note that the page intentionally sits outside the iframe/broker topology) and write `docs/admin.md` (auth model and `pb_admin_auth` isolation, folder layout convention, probing limits incl. `VGMPlay.ini`/mp3/xa/genh, upload semantics, rollback note). Verify all referenced commands and file paths in the docs exist.
