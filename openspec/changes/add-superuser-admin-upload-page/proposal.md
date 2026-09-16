# Proposal: add-superuser-admin-upload-page

## Why

Creating catalog content (games + tracks) currently requires local CLI tooling
(`tools/upload-index.mjs` plus a pre-probed `sample-files/index.json`) or manual
work in the PocketBase dashboard. There is no first-party web surface for
uploading new tracks to a deployed instance, so the person running a Trackify
deployment must keep a local checkout, the sample-files layout, and the CLI
chain handy for every content update.

## What Changes

- Add a standalone `admin.html` Vite entry (fifth rollup input) that lives
  **outside** the shell/iframe topology — no broker topics, no service id, no
  shell registration.
- Gate the page behind **PocketBase superuser authentication**
  (`pb.collection('_superusers').authWithPassword(...)`, email + password form)
  using an isolated `LocalAuthStore` key so a superuser session never touches
  the visitor app's `pb_auth` session.
- Add a batch upload pipeline mirroring `tools/upload-index.mjs` +
  `tools/generate-sample-index.mjs` semantics:
  1. **Select** — pick a whole folder (`webkitdirectory`; the existing
     `<platform>/<game>/` layout convention) or a multi-file selection.
  2. **Stage** (offline) — group files into games via the CLI's path-derived
     rules; auto-discover cover art (first image in the game folder, sorted)
     with manual override; per-game fields (title, platform, year, company)
     and per-track fields (title, artist, length) editable before any upload.
  3. **Probe** (offline) — reuse the shipped WASM backends via the `emu_*` ABI
     (`emu_load_file` → `emu_get_track_info` / `emu_get_max_position`) to
     auto-fill title / artist / length; fall back to `-1` + filename title on
     failure, exactly like the CLI.
  4. **Upload** — create-or-skip semantics per game/file/track with
     deterministic, path-derived record ids identical to the CLI's
     (`buildGameId` / `buildTrackId`), per-item progress states
     (queued → uploading → done / skipped / failed) and per-item retry.
- No PocketBase schema, migration, or API rule changes — writes stay
  superuser-only through the existing `null` create/update rules on `games` /
  `tracks`.
- No broker envelope or topic changes.
- Documentation updates: new-page walkthrough entry in `docs/frontend.md`,
  new admin page reference doc.

Explicitly out of scope (per product decision): automatic cover-art download
(the `fetch-missing-cover-art.mjs` flow), editing or deleting existing tracks,
byte-level upload progress, drag-and-drop folder input.

## Capabilities

### New Capabilities

- `admin-auth`: Superuser authentication for the admin page — login gate,
  isolated auth-store key, session display, logout, and expired-session
  (401) handling.
- `admin-catalog-upload`: The batch catalog upload pipeline — folder staging
  and grouping, cover-art selection, WASM metadata probing, pre-upload
  review/editing, create-or-skip upload with CLI-parity deterministic ids,
  and per-item progress.

### Modified Capabilities

(none — no existing specs are affected)

## Impact

- **`web/`** — new `admin.html`, `web/admin.js`, `web/admin.css`, and a
  `web/admin/` module directory (auth, staging, probing, upload orchestration).
  Reuses `web/player/backend_loader.js` and the `emu_*` adapter ABI for
  probing.
- **`vite.config.mjs`** — new rollup input entry for `admin.html`.
- **Shared pure helpers** — the CLI's identifier/grouping helpers
  (`normalizeIdentifier`, `getPathParts`, `buildGameId`, `buildTrackId`,
  `splitArtists`, extension→platform map) currently live in
  `tools/lib/*.mjs` and import `node:path`; a browser-safe form is needed
  (see design).
- **Docs** — `docs/frontend.md` (entry + new-page walkthrough),
  new admin page doc; `docs/database.md` unchanged (no schema/rule edits);
  `docs/ui.md` unchanged (no broker topics).
- **Dependencies** — none new; `pocketbase ^0.27.0` SDK already supports
  `_superusers` auth.
- **Runtime files** — no new WASM backends; the probe reuses the five shipped
  `backend_*.js` runtimes already verified by `npm run verify:dist`.
