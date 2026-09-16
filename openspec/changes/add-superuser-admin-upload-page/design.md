# Design: add-superuser-admin-upload-page

## Context

The web app is a multi-page Vite project rooted at `web/` with an
iframe/broker shell (`docs/frontend.md`); the shell owns the single
`PocketBase` instance and its `LocalAuthStore` (`pb_auth` localStorage key,
cross-tab synced). All writes to `games` / `tracks` are superuser-only via
`null` API rules — no schema or rule change is needed or allowed here. The
CLI chain (`tools/generate-sample-index.mjs` → `tools/upload-index.mjs`)
already encodes the catalog pipeline: a `<platform>/<game>/` folder layout,
path-derived deterministic record ids, cover art = first image in the game
folder, and metadata probing through the WASM cores' `emu_*` ABI
(`emu_load_file` → `emu_get_track_info` / `emu_get_max_position`, with
`-1`/filename fallback). The five `backend_*.js` runtimes are already built
and shipped to `/wasm/` and verified by `npm run verify:dist`.

## Goals / Non-Goals

**Goals:**

- Full create/upload parity with the CLI: same layout convention, same
  deterministic ids, same create-or-skip idempotency, same probing fallbacks.
- Complete isolation between the superuser session (admin page) and the
  visitor session (shell app), including when both are open simultaneously.
- Reuse of shipped assets and logic: the five backends via
  `web/player/backend_loader.js`, the CLI's pure helper functions.
- Zero server-side changes (no migrations, no rules, no hooks).

**Non-Goals:**

- Editing or deleting existing catalog records (the CLI's field-patching
  sync is deliberately not carried over).
- Byte-level upload progress; drag-and-drop folder input; cover-art
  downloading; any mobile/admin-native app concerns.
- Integration with the shell broker (no new topics, no service id).

## Decisions

### D1 — Standalone `admin.html` entry, not a shell service

The admin page is a fifth Vite entry that never joins the shell/iframe
topology: no `allowedServices` entry, no broker, no router route.

*Why:* the shell has exactly one `PocketBase` instance bound to the shared
`pb_auth` store; a superuser login there would evict the visitor's OAuth
session (favorites/playlists break). A separate document with its own SDK
instance gives isolation by construction. A separate origin/app was rejected
as deployment overhead for no added security (all protection is
server-side rules).

### D2 — Superuser auth with an isolated auth store key

Login form → `pb.collection('_superusers').authWithPassword({ email,
password })` on a dedicated client: `new PocketBase(baseUrl, new
LocalAuthStore('pb_admin_auth'))`. The store key differs from the visitor
app's `pb_auth`, so the two stores cannot collide even though `LocalAuthStore`
syncs tabs by key. The build-time `TRACKIFY_PB_TOKEN` seeding pattern is
explicitly **not** used — that mechanism inlines a JWT into the public
bundle, which would be unacceptable for a superuser credential.

*Alternatives:* in-memory-only token (session lost on reload; rejected),
build-time token (secret shipped publicly; rejected).

### D3 — Deterministic ids via a shared, path-safe helper module

The CLI's identifier/grouping functions (`normalizeIdentifier`,
`getPathParts`, `buildGameId`, `buildTrackId`, `splitArtists`,
`normalizeFolderGameName`, extension→platform map) are pure string
functions; only their current home (`tools/lib/*.mjs`) imports `node:path`.
The path-free subset moves into a shared ESM module imported by **both**
`tools/lib` and `web/admin` so the two implementations cannot drift; the
`node:path`-dependent wrappers (`stripExtension`, folder-name casing) stay
behind thin per-environment shims. Vite happily bundles imports outside the
`web/` root, and the tools consume plain ESM already.

*Alternatives:* copy-paste port (rejected: drift risk — id divergence would
silently break CLI/admin parity, which the spec requires); random UUID ids
(rejected: breaks idempotent re-upload).

### D4 — Probing reuses the player's backend loading and a browser port of the CLI probe flow

- `web/player/backend_loader.js` is imported as-is to lazy-load
  `/wasm/backend_<core>.js` per platform (it has no player-specific coupling).
- The probe sequence ports `tools/lib/track-entries.mjs` +
  `tools/lib/metadata-readers.mjs` from Node `Buffer` to
  `File`/`ArrayBuffer`: stage the game folder's files into the core's
  virtual FS (`FS_createPath` / `FS_createDataFile` — already in the
  verified `EXPORTED_RUNTIME_METHODS` set), `emu_load_file`, optional
  `emu_set_subsong` (snes: `-1`, vgm: `0`), read info, `emu_teardown`.
- Backends are loaded per platform on demand and probed **serially** to bound
  memory; a per-file failure falls back to filename title + `-1` and never
  stops the pass — byte-for-byte the CLI's fallback contract.
- `VGMPlay.ini`: the CLI stages it from the checkout when present. The
  browser has no such resource, so vgm files that need it may fall back to
  `-1`; accepted as a probing-quality limitation, not a correctness one.
- `mp3` / `xa` / `genh`: no WASM probe (CLI parity) → `-1` + fallback title.

### D5 — Upload engine: SDK calls mirroring the CLI, driven by a serial item queue

Upload start fetches server truth once (`games.getFullList` with
`coverArt,files`; `tracks.getFullList` with `id,filename`) and computes skip
sets exactly like the CLI (game by id, fallback `platform::title` key; track
by id, fallback lowercased filename; file by basename in the game's
`files[]`). A serial queue then executes, in dependency order per game:
`games.create` (with coverArt file when present) → per file
`games.update(id, { 'files+': file })` → per track `tracks.create`. Every
item moves through `pending → active → completed | skipped | failed`, keeps
its own error, and is individually retryable; a 400 "already exists"-style
conflict on create is treated as `skipped` (benign race between the
pre-fetch and the write). Concurrency 1 (CLI parity) — a concurrency knob is
a trivial later addition, not a v1 goal.

*Progress granularity:* per-item states only. Byte-level bars would require
XHR instead of the SDK's fetch; rejected for v1.

### D6 — Page structure follows the existing per-page module pattern

`web/admin.html` + `web/admin.js` (entry: auth gate → staging UI → upload
run) + `web/admin.css` + `web/admin/` modules (`auth.js`, `stage.js`,
`probe.js`, `upload.js`, `ui.js`-style small single-purpose files, mirroring
how `web/player/` is organized). Plain DOM, no framework, consistent with
the rest of the project. The login form and the management UI are two
visibility states of the same document; no routing.

*Docs:* `docs/frontend.md` gains the entry in the input list and a note that
this page is intentionally outside the iframe topology; a new
`docs/admin.md` documents the page (auth model, layout convention, probing
limits, upload semantics). `docs/ui.md` and `docs/database.md` are untouched.

## Risks / Trade-offs

- [Superuser JWT sits in localStorage on a publicly served page] → The page
  grants nothing without the credential (writes stay `null`-rule protected);
  XSS surface is minimized by text-only DOM updates (no
  untrusted-HTML rendering); PocketBase's built-in auth rate limiting
  applies to the `_superusers` endpoint; `docs/admin.md` will note the
  option of not deploying `admin.html` for public instances that don't
  want the login form exposed at all.
- [`webkitdirectory` support varies (Safari weakest)] → The multi-file
  picker is always available as fallback; both paths feed the same staging
  model; limitation documented. Without a folder selection there is no
  `<platform>/<game>/` prefix, so files stage as *ungrouped* and the user
  assigns game/platform manually (spec: ungrouped must be surfaced, never
  dropped).
- [Two-step write (create game, then push files) is not atomic] → Covered
  by the idempotent re-upload contract and per-item retry; a crash between
  steps leaves a game with a partial bundle, and re-running the same folder
  completes it.
- [Probing large folders holds cores + file bytes in memory] → Serial
  probing, backend teardown after each game, `-1` fallback keeps the batch
  alive; upload does not begin until the probe pass completes (staged state
  only).
- [Helper drift between CLI and admin] → Mitigated by the shared module
  (D3); a same-input parity check (admin page vs `upload-index.mjs`
  dry-run ids) is part of the task list.
- [One request per file is slow for large OSTs] → Accepted for v1 (CLI
  parity, simple failure isolation); the 500-file/game schema cap bounds the
  worst case.

## Migration Plan

Pure static-site addition: build emits `admin.html`; existing
Docker/publish flow ships it (`build/dist` → image `public/`). No data
migration, no schema change. Rollback = redeploy a build without the entry;
a stale `admin.html` is harmless (login-gated, rule-protected writes).

## Open Questions

- Safari's folder-picker support level at implementation time (fallback
  path already designed; no spec impact).
- Whether a later change should port the CLI's field-patch sync for
  corrections; deferred by product decision ("editing not yet needed").
