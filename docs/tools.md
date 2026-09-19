# Tooling scripts

Reference for the Node scripts under `tools/` that drive the
build pipeline, the sample-data tooling, the PocketBase setup, and a
few utilities. The `package.json` `scripts` table is the canonical
entry point — every script that has an `npm run …` wrapper should be
invoked that way. Each tool also runs standalone with `node` (useful
for debugging or when the npm wrapper doesn't take the right flags).

All scripts use ESM (`.mjs`) and `process.exit(1)` on fatal errors
(see `Conventions` at the bottom). They have no shared test harness;
treat them as CLI utilities.

## Layout

```
tools/
├── prepare-web-assets.mjs           # build: copy CMake artifacts → Vite publicDir
├── verify-build-output.mjs          # build: assert required dist files exist
├── generate-sample-index.mjs        # sample-data: scan sample-files/ → index.json + games.json
├── fetch-missing-cover-art.mjs      # sample-data: Wikipedia → cover images → games.json
├── upload-index.mjs                 # sample-data: index.json + games.json → PocketBase
├── download-khinsider-album.mjs     # sample-data: scrape a khinsider album → MP3s
├── inspect-genh.mjs                 # utility: dump GENH header from a local .genh file
├── download-pocketbase.mjs          # pocketbase: fetch latest PocketBase release → bin/
├── serve-pocketbase.mjs             # pocketbase: spawn bin/pocketbase serve
└── lib/                             # shared helpers (see below)
    ├── backend-loader.mjs           # lazy-load /wasm/backend_*.js for indexing
    ├── constants.mjs                # sample rate, timeouts, cover-art extensions
    ├── games-index.mjs              # group tracks → games.json shape
    ├── identifiers.mjs              # id/path normalisation helpers
    ├── indexer-context.mjs          # ties together VFS, backends, helpers for the indexer
    ├── logger.mjs                   # createLogger({ debug }) — TRACKIFY_INDEX_DEBUG plumbing
    ├── metadata-readers.mjs         # per-platform track-info reader (uses loaded WASM backends)
    ├── mp3-metadata-reader.mjs      # music-metadata wrapper for MP3s
    ├── paths.mjs                    # resolvePaths() — sample dir / output paths from argv + env
    ├── platforms.mjs                # EXT_PLATFORM map + getExtension/getPlatform
    ├── player-shims.mjs             # installPlayerShims(ctx) — non-browser stubs for backend modules
    ├── track-entries.mjs            # extractTrackMetadata() + game-name resolution
    └── wasm-vfs.mjs                 # VFS helpers for the WASM backends during indexing
```

The `tools/lib/` modules are internal helpers, not user-facing. The
ones used outside the `tools/` tree are documented inline in their
respective script section.

## Quick reference

| npm script              | Tool file                                | Purpose                                                  |
| ----------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `npm run assets:prepare`| `tools/prepare-web-assets.mjs`           | Copy CMake artifacts + pure-JS backends → Vite publicDir |
| `npm run verify:dist`   | `tools/verify-build-output.mjs`          | Assert the required dist files exist (CI sanity check)   |
| `npm run samples:index` | `tools/generate-sample-index.mjs`        | Scan `sample-files/` → `index.json` + `games.json`       |
| `npm run samples:coverart` | `tools/fetch-missing-cover-art.mjs`   | Wikipedia → cover images for games missing `coverArt`    |
| `npm run samples:upload-index` | `tools/upload-index.mjs`          | `index.json` + `games.json` + sample files → PocketBase  |
| `npm run khinsider:download` | `tools/download-khinsider-album.mjs` | Scrape a khinsider album → MP3s in a folder              |
| `npm run pocketbase:download` | `tools/download-pocketbase.mjs`   | Download latest PocketBase release → `bin/pocketbase`    |
| `npm run pocketbase:serve` | `tools/serve-pocketbase.mjs`          | Spawn `bin/pocketbase serve` with the repo's paths       |
| _(no wrapper)_          | `tools/inspect-genh.mjs`                 | Dump a GENH header to stdout (debugging aid)             |

Build orchestration scripts that **don't** live under `tools/` (they're
shell pipelines in `package.json`):

| npm script                | Composed of                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run wasm`            | `wasm:configure` then `wasm:build` (`emcmake cmake` + `cmake --build`)                           |
| `npm run dev`             | `wasm` + `assets:prepare` + `vite` on `127.0.0.1:8137`                                           |
| `npm run dev-js`          | `assets:prepare` + `vite` (skip WASM rebuild)                                                    |
| `npm run build`           | `wasm` + `assets:prepare` + `vite build`                                                         |
| `npm run build:watch`     | `wasm` + `assets:prepare` + `vite build --watch`                                                  |
| `npm run build:watch-js`  | `assets:prepare` + `vite build --watch` (skip WASM rebuild)                                      |
| `npm run preview`         | `vite preview` on `127.0.0.1:8137`                                                               |
| `npm run clean` / `rebuild` | `rm -rf build` / clean + build                                                                 |

## Build pipeline

### `tools/prepare-web-assets.mjs`

`npm run assets:prepare`

Required by every Vite build — copies the CMake-emitted runtimes
into `build/web-public/wasm/` so Vite serves them from `/wasm/`.

- **Inputs (must exist first)**: `build/wasm/scriptprocessor_player.js`,
  `build/wasm/backend_{psx,snes,nez,n64,vgm}.js`, `build/wasm/{psx,snes,nez,n64,vgm}.wasm`
  — all produced by `npm run wasm`.
- **Inputs (copied as-is)**: `web/backend_{xa,genh,mp3}.js` — pure-JS
  backends that are not built by CMake.
- **Output**: `build/web-public/wasm/` (recreated on every run).
- **Failure mode**: exits non-zero if any required runtime file is
  missing — never run this before `npm run wasm`.

Direct invocation: `node tools/prepare-web-assets.mjs`

### `tools/verify-build-output.mjs`

`npm run verify:dist`

CI-side sanity check that asserts the expected files exist under
`build/dist/` after a Vite build. It does not check hashes or
contents — only paths.

- **Required files** (hardcoded in the script): `index.html` plus the
  full `wasm/` runtime set: `scriptprocessor_player.js`,
  `backend_{psx,snes,nez,n64,vgm}.js`, `backend_{xa,genh,mp3}.js`,
  `{psx,snes,nez,n64,vgm}.wasm`.
- **Failure mode**: prints the missing paths and exits non-zero.

Direct invocation: `node tools/verify-build-output.mjs`

> When adding a new backend, the **required file lists in both
> `prepare-web-assets.mjs` and `verify-build-output.mjs` must be
> updated** — they are independent and not derived from a shared
> constant.

## Sample-data tooling

The `sample-files/` directory is **local reference data and is not
tracked in this repository** (gitignored). These four scripts operate
on a local copy if you create one — e.g. by downloading albums with
`npm run khinsider:download` — enrich it, and push it to PocketBase.
`sample-files/` is never copied into `build/web-public/`; the
production app reads catalog data from PocketBase at runtime via the
JS SDK.

### `tools/generate-sample-index.mjs`

`npm run samples:index`

Walks `sample-files/`, classifies files by extension, lazy-loads the
relevant WASM backends to extract track metadata (title, length,
artist, raw tag dump), and writes two manifests:

- `sample-files/index.json` — flat array of track entries, one per
  playable file. The script renames the on-disk `file` field to
  `filename` (basename) for the JSON output.
- `sample-files/games.json` — deduped by `platform::title`, with
  derived `coverArt` candidates from `*.{png,jpg,gif,webp}` siblings.

**Required for metadata extraction**: `build/wasm/` must exist
(`npm run wasm`) — the script mounts samples into a virtual FS and
calls into each backend's `emu_*` ABI to read track length / title.

**Environment variables**:

| Variable                  | Effect                                          |
| ------------------------- | ----------------------------------------------- |
| `TRACKIFY_INDEX_DEBUG=1`  | Verbose per-file logging                        |

**Outputs**: `sample-files/index.json`, `sample-files/games.json`.

Direct invocation: `node tools/generate-sample-index.mjs`

### `tools/fetch-missing-cover-art.mjs`

`npm run samples:coverart`

For every entry in `games.json` that has no `coverArt`, looks up a
candidate image via Wikipedia. The pipeline is:

1. If the game's track directory already has a cover-art file, link
   it (no network call).
2. Build search candidates from `title`, `platform`, `year`, and a
   small set of heuristic aliases (e.g. "Biohazard" → "Resident Evil").
3. Wikipedia search → title-similarity score → only proceed if score
   ≥ 0.45.
4. Fetch the lead image, falling back through:
   `summary` → `pageimages` API → infobox `<img>` scrape.
5. Verify the image is hosted on `upload.wikimedia.org` (unless
   non-Commons hosts are allowed) and within the size cap.
6. Write the image next to the game's tracks as
   `auto_cover_<slug>.<ext>`, then update `games.json`.

**Environment variables**:

| Variable                                       | Default          | Effect                                                            |
| ---------------------------------------------- | ---------------- | ----------------------------------------------------------------- |
| `TRACKIFY_FETCH_COVER_ART_DRY_RUN=1`           | `0`              | Print matches without writing files                               |
| `TRACKIFY_FETCH_COVER_ART_MAX_PER_RUN`         | `25`             | Cap on games matched per run                                      |
| `TRACKIFY_FETCH_COVER_ART_TIMEOUT_MS`          | `8000`           | Per-request timeout                                               |
| `TRACKIFY_FETCH_COVER_ART_REQUEST_DELAY_MS`    | `250`            | Delay between MediaWiki requests                                  |
| `TRACKIFY_FETCH_COVER_ART_RETRY_MAX_ATTEMPTS`  | `4`              | Retries for 429/503 responses                                     |
| `TRACKIFY_FETCH_COVER_ART_RETRY_BASE_DELAY_MS` | `1000`           | Exponential backoff base (1x, 2x, 4x, … when no `Retry-After`)    |
| `TRACKIFY_FETCH_COVER_ART_MAX_BYTES`           | `5242880` (5 MB) | Cap on downloaded image size                                      |
| `TRACKIFY_FETCH_COVER_ART_ALLOW_NON_COMMONS=0` | `1` (allowed)    | Restrict to Wikimedia Commons-hosted assets                       |
| `TRACKIFY_FETCH_COVER_ART_INSECURE_TLS=0`      | `0` (verified)   | Skip TLS certificate verification (sets `NODE_TLS_REJECT_UNAUTHORIZED=0`) |

**Outputs**: new files under `sample-files/<game-dir>/auto_cover_*.{jpg,png,…}`
plus an in-place rewrite of `sample-files/games.json`.

Direct invocation: `node tools/fetch-missing-cover-art.mjs`

### `tools/upload-index.mjs`

`npm run samples:upload-index`

Pushes `index.json` and `games.json` (and the files they reference)
to a running PocketBase. Two-phase:

1. **Games**: keyed by `platform::title` (lowercased). Creates new
   games with the source-id from `id`, patches existing ones when
   fields change, uploads `coverArt` when missing, and reconciles the
   `files[]` field against the directory contents (uploading new files,
   deleting stale ones).
2. **Tracks**: keyed by `filename` (lowercased). Creates new tracks
   with the source-id, patches existing ones.

The script expects the auth rules on the `games` / `tracks`
collections to permit its `TRACKIFY_PB_TOKEN` to write; see
[`docs/database.md`](database.md).

**Arguments**: optional first positional arg overrides the sample
directory (default `sample-files`).

**Environment variables**:

| Variable                       | Default                  | Effect                                                  |
| ------------------------------ | ------------------------ | ------------------------------------------------------- |
| `TRACKIFY_PB_URL`              | `http://127.0.0.1:8090`  | PocketBase base URL                                    |
| `TRACKIFY_PB_TOKEN`            | _(empty)_                | Auth token saved into `pb.authStore` before writes      |
| `TRACKIFY_PB_UPLOAD_DRY_RUN=1` | `0`                      | Print planned changes without writing to PocketBase     |

Direct invocation:

```bash
node tools/upload-index.mjs                 # uses sample-files/
node tools/upload-index.mjs other-folder   # custom sample dir
```

### `tools/download-khinsider-album.mjs`

`npm run khinsider:download`

Scrape a `downloads.khinsider.com` album page and download every MP3
into a local folder. The script:

1. Fetches the album HTML and collects song-page links via
   `#songlist tbody tr td:nth-child(3) a[href]`.
2. For each song page, finds the "Click here to download as MP3"
   link.
3. Downloads the MP3 with the album page as `Referer` to bypass the
   site's link gate, skipping files that already exist on disk.
4. Sleeps 400 ms between requests to stay polite.

**Arguments**:

```
node tools/download-khinsider-album.mjs <album-url> [folder]
```

- `album-url` — full URL to the khinsider album page.
- `folder` — output directory (default: last URL path segment,
  sanitised and lowercased under `cwd`; pass an absolute path to
  override).

**Exit code**: `0` if every track downloaded, `1` if any failed.

> This script scrapes a third-party site and depends on its HTML
> shape. Selector changes upstream will silently break it; treat
> failures as upstream signal, not as something to paper over.

## PocketBase setup

### `tools/download-pocketbase.mjs`

`npm run pocketbase:download`

Resolves the latest PocketBase release that matches the current
platform/arch (or explicit overrides), downloads the ZIP, extracts
the `pocketbase` / `pocketbase.exe` binary in pure Node (no extra
deps), and writes it to `bin/`. `bin/` is gitignored.

**Arguments**:

```
node tools/download-pocketbase.mjs [--platform windows|linux|darwin] [--arch amd64|arm64]
```

Defaults come from `process.platform` / `process.arch`. Sets the
executable bit (`0o755`) on non-Windows.

> Pulls release metadata from the GitHub API, so an unauthenticated
> request is rate-limited to 60/hour/IP. Fine for normal use; CI should
> cache `bin/` between runs.

### `tools/serve-pocketbase.mjs`

`npm run pocketbase:serve`

Spawns `bin/pocketbase serve` (or `bin/pocketbase.exe` on Windows)
with:

```
--publicDir ./build/dist
--dir       ./pb_data
--hooksDir  ./pb_hooks
```

`stdio: 'inherit'`, so the PocketBase console output flows through
the terminal. The process exits with the PocketBase child's exit
code. Run `npm run build` first so `./build/dist` exists, otherwise
PocketBase warns about the missing public dir.

Direct invocation: equivalent to `node tools/serve-pocketbase.mjs`
— there is nothing else to pass.

## Utilities

### `tools/inspect-genh.mjs`

_(no npm wrapper — invoke directly)_

Parses a `.genh` file's header and prints the fields the
`web/backend_genh.js` decoder relies on. Handy when adding a new
GENH-format game to the corpus and you want to know which codec /
interleave / sample rate it uses.

**Usage**:

```
node tools/inspect-genh.mjs <file.genh>
```

Prints the magic, codec + name, channels, sample rate, loop info,
start offset / header size / data size, interleave settings, codec
mode, skip-samples configuration, and DSP coefficient table layout.
Exits non-zero on bad magic or truncated header.

## Conventions

- **ESM only** — all scripts use `.mjs` and top-level `import`.
- **Working directory** — every script uses `process.cwd()` as the
  repo root. Run from the repo root, not from inside `tools/`.
- **Exit codes** — `process.exit(1)` (or `process.exitCode = 1`) on
  any fatal error. CI scripts (`verify-build-output`,
  `prepare-web-assets`) fail the build on the first missing file.
- **Logging** — `process.stdout` for status, `process.stderr` for
  errors. The indexer script uses a `createLogger({ debug })` helper
  from `tools/lib/logger.mjs` (toggled by `TRACKIFY_INDEX_DEBUG=1`).
- **No network in build scripts** — only the cover-art fetcher,
  khinsider downloader, and PocketBase downloader touch the network.
  Everything else is local filesystem work.
- **No shared test harness** — the scripts are CLI utilities. Smoke
  tests live in CI (`npm run verify:dist`) and in the manual
  `npm run pocketbase:serve` dev loop.

## Adding a new tool

1. Drop the script in `tools/` as `<verb>-<noun>.mjs`. Use ESM, read
   paths from `process.cwd()`, write logs to stdout/stderr.
2. If it has helpers shared with another script, put them in
   `tools/lib/` and import them. Keep the lib modules free of side
   effects so they're easy to test in isolation.
3. Add an `npm run …` wrapper to `package.json` if it should be
   discoverable from the README's "Useful scripts reference".
4. Document it in this file under the right section (build pipeline
   / sample-data / pocketbase / utilities), including any env vars
   and exit codes.
5. If it produces files that the web build consumes, list the
   required outputs in both `prepare-web-assets.mjs` and
   `verify-build-output.mjs` so CI catches a stale artifact early.