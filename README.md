# Trackify — VGM Web Audio Player

Trackify is a self-contained web player for **Video Game Music** (VGM)
file formats. Audio is decoded in WebAssembly by a set of lazy-loaded
emulator cores that plug into a generic `webaudio-player` engine, the
catalog metadata is served by a small **PocketBase** backend, and the
multi-page UI is built with **Vite** and rendered as cooperating
iframes that talk through a small `postMessage` broker.

The project is a hybrid build:

- **CMake + Emscripten** for the WASM/runtime artifacts
  (PSX, SNES, NEZ, N64, VGM cores).
- **Node + Vite** for the web app (shell, content, player pages, JS
  tooling).
- **PocketBase** for catalog metadata (games, tracks, favorites, cover
  art, Google OAuth users).

```
  ┌──────────────────────────────── Browser ────────────────────────────────┐
  │                                                                        │
  │   web/   ──▶   shell  (index.html, app.js)                             │
  │                    │                                                   │
  │                    ├─ content frame   (collections.js, playlist.js)     │
  │                    └─ player frame    (player.js + web/player/*)        │
  │                                       │                                │
  │                                       ▼                                │
  │                            ScriptNodePlayer (generic engine)           │
  │                            + emu_* ABI from each WASM core             │
  │                                       │                                │
  └───────────────────────────────────────┼────────────────────────────────┘
                                          │
                                          ▼
                                PocketBase  (catalog)
                                /api/files/...   (audio + cover art)
```

## Table of contents

- [Backends at a glance](#backends-at-a-glance)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Project layout](#project-layout)
- [WASM audio backends](#wasm-audio-backends)
- [Frontend (Vite + iframes)](#frontend-vite--iframes)
- [PocketBase backend](#pocketbase-backend)
- [Sample data tooling](#sample-data-tooling)
- [Docker / deploy](#docker--deploy)
- [Useful scripts reference](#useful-scripts-reference)
- [Conventions](#conventions)
- [License](#license)

## Backends at a glance

The player auto-selects a backend by file extension. Backend scripts
are lazy-loaded on first use, so only the format runtime the user
actually opens is fetched and initialized.

| Backend key | Source core                                  | Build        | Extensions                                                       | `INITIAL_MEMORY` |
| ----------- | -------------------------------------------- | ------------ | ---------------------------------------------------------------- | ---------------- |
| `psx`       | `submodules/webpsx` (HighlyExperimental)     | WASM / CMake | `.psf` `.minipsf` `.psf2` `.minipsf2` `.psflib`                  | 128 MB           |
| `snes`      | `submodules/websnes` (Game Music Emu)        | WASM / CMake | `.spc` `.rsn`                                                    | 64 MB            |
| `nez`       | `submodules/webnez` (NEZplug++)              | WASM / CMake | `.bgm` `.opx` `.nsf` `.sng` `.kss`                                | 64 MB            |
| `n64`       | `submodules/webn64` (LazyUSF2 / Mupen64plus) | WASM / CMake | `.usf` `.miniusf` `.usflib`                                       | 128 MB           |
| `vgm`       | `submodules/vgmplay-0.40.9` (VGMPlay)        | WASM / CMake | `.vgm` `.vgz` `.cmf` `.dro`                                      | 64 MB            |
| `xa`        | native JS decoder                            | copied as-is | `.xa`                                                            | n/a              |
| `genh`      | native JS decoder                            | copied as-is | `.genh`                                                          | n/a              |
| `mp3`       | native JS decoder                            | copied as-is | `.mp3`                                                           | n/a              |

Detailed ABI, build flags, per-core quirks, and the "add a new
backend" walkthrough live in
[`docs/audio-backends.md`](docs/audio-backends.md).

## Prerequisites

You need:

- **CMake** ≥ 3.21
- **Ninja**
- **Node.js** ≥ 20
- **npm**
- **Python 3** (for the bundled emsdk)
- **Git**
- A modern browser (Web Audio API + WebAssembly)

The Emscripten SDK ships in [`submodules/emsdk`](submodules/emsdk) —
no system-wide Emscripten install is required. CI uses
`mymindstorm/setup-emsdk@v14` with `version: latest`.

## Quick start

```bash
# 1. One-time: populate submodules (cores, generic player, emsdk)
git submodule update --init --recursive

# 2. Activate the bundled emsdk in this shell
source ./submodules/emsdk/emsdk_env.sh      # macOS / Linux
# . .\submodules\emsdk\emsdk_env.ps1         # Windows PowerShell
emcc --version                              # sanity check

# 3. JS tooling (Vite + pocketbase + music-metadata)
npm install

# 4. Full build (WASM + asset prep + Vite production build)
npm run build
#  → build/wasm/        CMake-emitted runtime
#  → build/web-public/  Vite publicDir
#  → build/dist/        Vite outDir (deployable static site)

# 5. Dev loop
npm run dev                                 # Vite on 127.0.0.1:8137 (strictPort)
npm run pocketbase:serve                    # PocketBase in another shell
```

## Project layout

```
trackify/
├── CMakeLists.txt                # root build: backends + generic player
├── backends/                     # per-core CMakeLists (psx, snes, nez, n64, vgm)
├── cmake/concat.cmake            # cross-platform JS concat helper
├── patches/                      # non-upstream overrides for VGM/N64/PSX emscripten
├── submodules/                   # upstream cores, generic player, emsdk
├── tools/                        # Node CLI scripts (build, sample data, PocketBase)
├── web/                          # Vite root — the entire UI
│   ├── index.html / app.js / app.css                  # shell
│   ├── collections.html / collections.js / collections.css
│   ├── playlist.html   / playlist.js   / playlist.css
│   ├── player.html     / player.js                    # transport shell
│   ├── player/         # player frame modules (transport, seek, media session, ...)
│   ├── backend_xa.js / backend_genh.js / backend_mp3.js   # pure-JS backends
│   ├── broker.js       # postMessage broker (shell + frame modes)
│   ├── catalog_service.js                            # PocketBase client
│   └── main.js
├── pb_hooks/                     # PocketBase JS hooks
├── pb_migrations/                # PocketBase JS schema migrations (timestamped)
├── sample-files/                 # reference track corpus (not a staged web asset)
├── playlists/                    # hand-curated track lists (.txt)
├── Dockerfile                    # pocketbase + build/dist
├── publish.sh                    # buildx + push entry point
└── docs/
    └── audio-backends.md         # detailed backend integration reference
```

## WASM audio backends

The five WASM cores (PSX, SNES, NEZ, N64, VGM) are built by CMake and
assembled into `build/wasm/`:

- `scriptprocessor_player.js` — the generic player runtime,
  concatenated from `submodules/webaudio-player/src/*.js` in the order
  defined by its upstream build script (no minify, no bundler).
- `backend_<core>.js` — the per-core runtime. Each is built by
  concatenating:
  ```
  shell-pre.js + <emscripten-emitted>.js + shell-post.js + <core>_adapter.js
  ```
  driven by `cmake/concat.cmake`.
- `<core>.wasm` — the actual emulator binary.

The player UI lazy-loads `backend_<core>.js` from `/wasm/` on first
use. A small in-frame cache keeps the request deduped across rapid
playlist changes.

The ABI is a fixed set of `emu_*` C symbols plus `malloc` / `free`
(extended per-core: `emu_set_bios` for PSX, `emu_set_boost` for
PSX/N64/VGM, `emu_set_resource_path` for VGM, etc.). The
`EmsHEAP16BackendAdapter` base class and the per-core `*_adapter.js`
translate `ScriptNodePlayer` calls into `Module.ccall(...)` against
those symbols.

For everything below the high level — flags, `EXPORTED_RUNTIME_METHODS`,
patches, Emscripten gotchas, per-core quirks, the "add a new backend"
walkthrough — see [`docs/audio-backends.md`](docs/audio-backends.md).

## Frontend (Vite + iframes)

The web app is a Vite project rooted at `web/`. Vite builds four HTML
entry points (see `vite.config.mjs`):

- `index.html` — the **shell**. Hosts the sidebar / nav / search
  chrome and **two iframes**:
  - `#playlistFrame` (`name="content-frame"`) — content services:
    `collections.html` (games grid) and `playlist.html` (per-game
    track list).
  - `#playerFrame` — the player service: `player.html` plus the
    `web/player/*.js` modules.
- `collections.html` / `playlist.html` — the content frame, swapped
  in via `target="content-frame"` links.
- `player.html` — the player frame, which is loaded once and reused
  for the whole session.

All inter-frame communication is via a single shared
`web/broker.js` using `window.postMessage` with a versioned envelope.
There is no direct frame-to-frame messaging; the shell validates,
routes, and fanouts every message. The full message contract, the
broker API, and the topics currently in use live in
[`ui.md`](ui.md).

The player frame is split into small modules under `web/player/`:

```
web/player/
├── dom.js                    # cached element lookups
├── player_host.js            # ScriptNodePlayer / runtime namespace
├── backend_loader.js         # lazy-load /wasm/backend_*.js
├── backend_catalog.js        # extension → backend-type → script-src map
├── transport.js              # playlist state + play/pause/next/seek/shuffle
├── seek_ui.js                # seek bar + 250 ms position polling
├── now_playing_ui.js         # footer track info + play button state
├── media_session_sync.js     # navigator.mediaSession binding
├── media_session_anchor.js   # silent audio shim to keep media controls alive
├── shuffle_ui.js             # shuffle toggle button binding
└── volume_ui.js              # volume slider binding
```

The shell (`web/app.js`) wires it all together: PocketBase SDK
construction, auth (Google OAuth), iframe history buttons, the
favorites playlist flow, and the shell-side `navigator.mediaSession`
binding that lets OS-level media keys control the player even when
the player iframe is in a different frame tree.

Vite config notes:

- The dev server binds to `127.0.0.1:8137` with `strictPort: true` —
  do not change.
- `npm run build` produces `build/dist/` with the four HTML pages
  hashed and the contents of `build/web-public/wasm/` copied in.
- `npm run dev-js` / `npm run build:watch` /
  `npm run build:watch-js` skip the WASM rebuild — use these after
  the first build when iterating on web code.

## PocketBase backend

The web build is purely static; catalog data is fetched at runtime
from a running PocketBase instance via the `pocketbase` JS SDK. The
static build works without a running PocketBase, but the UI simply
has no catalog to show.

### Download the binary

```bash
npm run pocketbase:download   # writes bin/pocketbase (or .exe on Windows)
```

The script auto-resolves the latest release matching your OS/arch;
override with `--platform` / `--arch` if needed. The binary is
gitignored (`bin/`).

### Run the dev server

```bash
npm run pocketbase:serve
# ≡  bin/pocketbase serve
#      --publicDir ./build/dist
#      --dir ./pb_data
#      --hooksDir ./pb_hooks
```

Layout:

- `bin/pocketbase` — the server binary.
- `pb_data/` — local database, created on first run (gitignored).
- `pb_hooks/` — JS server hooks. `keep_names.pb.js` rewrites
  uploaded `originalName` → `name` on the `games` collection's
  `files[]` and `coverArt` fields (create + update).
- `pb_migrations/` — JS schema migrations, applied in filename order
  on startup. The migration set defines base collections, several
  view collections, and the favorites / playlist flows.
- `--publicDir ./build/dist` — PocketBase serves the static build
  here, so run `npm run build` at least once before this is useful.

### Schema (high level)

- `users` — PocketBase auth users (Google OAuth via
  `pb.collection('users').authWithOAuth2({ provider: 'google' })`).
- `games` — game metadata: `title`, `company[]`, `year`, `platform`,
  `coverArt` (file), and a `files[]` field holding the bundled
  track files for that game.
- `tracks` — individual track records: `title`, `gameId`,
  `filename`, `platform`, `artist[]`, `metadata` (raw core-emitted
  tag dump), and the derived `coverArt`.
- `playlists` — user-owned playlists. `type="favorites"` is reserved
  for the auto-created favorites playlist (one per user, lazily
  provisioned).
- `playlist_tracks` — join rows linking a track to a playlist, with
  ordering.
- `favorites` / `playlist_tracks` — backing data for the favorites
  flow.

The migration set also defines several view collections the web app
reads from:

- `games_view` — flattened game metadata with resolved cover-art URLs.
- `tracks_view` — flattened tracks with resolved `coverArt` /
  `file` URLs and joined `game` display name. This is the collection
  `ShellCatalogService` queries.
- `favorites_view` — joined favorites tracks.
- `playlist_tracks_view` — joined playlist rows with track metadata.

### Client auth

The web client authenticates to PocketBase with the JWT in `.env` as
`TRACKIFY_PB_TOKEN`. Vite loads it into the web bundle at build time;
the Node tooling does **not** read it. The browser-side
`authWithOAuth2({ provider: 'google' })` flow populates
`pb.authStore`; the shell publishes `shell.user.login` /
`shell.user.logout` events to frames so the favorites UI updates
without a page reload.

### Typical dev loop

```bash
# shell A — frontend
source ./submodules/emsdk/emsdk_env.sh
npm run dev

# shell B — catalog
npm run pocketbase:serve
```

## Sample data tooling

The `sample-files/` directory is **reference data, not a staged web
asset**. It is the corpus that the `tools/*.mjs` scripts scan to
produce the manifests the web app originally used to ship without a
PocketBase backend.

```bash
npm run samples:index        # regenerate sample-files/{index,games}.json
npm run samples:coverart     # fetch missing cover art, update games.json
npm run samples:upload-index # upload regenerated index.json to PocketBase
```

`tools/fetch-missing-cover-art.mjs` looks up art via Wikipedia
summary metadata first, then falls back to MediaWiki page-image, then
scrapes the game page infobox image as a final fallback. The
following env vars tune the run:

- `TRACKIFY_FETCH_COVER_ART_DRY_RUN=1` — print matches without
  writing files.
- `TRACKIFY_FETCH_COVER_ART_MAX_PER_RUN` — cap downloads per run
  (default 25).
- `TRACKIFY_FETCH_COVER_ART_TIMEOUT_MS` — per-request timeout in ms
  (default 8000).
- `TRACKIFY_FETCH_COVER_ART_REQUEST_DELAY_MS` — delay between
  MediaWiki requests in ms (default 250).
- `TRACKIFY_FETCH_COVER_ART_RETRY_MAX_ATTEMPTS` — max retries for
  rate-limited lookups (default 4).
- `TRACKIFY_FETCH_COVER_ART_RETRY_BASE_DELAY_MS` — base backoff
  delay for HTTP 429 retries in ms (default 1000; exponential
  1x, 2x, 4x, … when `Retry-After` is not provided).
- `TRACKIFY_FETCH_COVER_ART_MAX_BYTES` — max downloaded image size
  in bytes (default 5242880).
- `TRACKIFY_FETCH_COVER_ART_ALLOW_NON_COMMONS=0` — restrict to
  Wikimedia Commons-hosted assets only (enabled by default).
- `TRACKIFY_FETCH_COVER_ART_INSECURE_TLS=0` — enforce TLS
  certificate verification (disabled by default).

`tools/inspect-genh.mjs` is a small CLI for dumping metadata from
local `.genh` files (handy when adding a new game to the corpus).

## Docker / deploy

`Dockerfile` extends `adrianmusante/pocketbase` and copies:

```
build/dist/   →  /pocketbase/public/
pb_migrations/  →  /pocketbase/migrations/
pb_hooks/       →  /pocketbase/hooks/
```

so the resulting image serves the static web build and runs the
PocketBase migrations / hooks from a single container.

```bash
# 1. Build the static site first
npm run build

# 2. Buildx + push the image (linux/amd64)
./publish.sh <version>
#  → harbor.alexklingenbeck.de/my/trackify:<version>
```

`publish.sh` is `set -e` and takes exactly one argument: the
version tag. The release entry point is intentionally minimal — the
build artefacts are picked up straight from `build/dist/` /
`pb_migrations/` / `pb_hooks/`.

## Useful scripts reference

All scripts live in `package.json`. The non-obvious ones:

```bash
npm run wasm              # emcmake + cmake build (player + 5 backends)
npm run wasm:configure    # emcmake cmake -B build -G Ninja -DTRACKIFY_JS_TOOLING=ON
npm run wasm:build        # cmake --build build --target player backend_*

npm run assets:prepare    # copy CMake artifacts → build/web-public/wasm/
                          # (fails hard if artifacts are missing — never
                          #  run this before `npm run wasm`)

npm run build             # wasm + assets:prepare + vite build
npm run build:watch       # wasm + assets:prepare + vite build --watch
npm run build:watch-js    # assets:prepare + vite build --watch  (skip WASM)
npm run dev               # wasm + assets:prepare + vite  (port 8137)
npm run dev-js            # assets:prepare + vite  (skip WASM)
npm run preview           # vite preview  (port 8137)
npm run verify:dist       # assert runtime files exist under build/dist
                          # (CI runs this after `npm run build`)

npm run clean             # rm -rf build
npm run rebuild           # clean + build

npm run samples:index     # rebuild sample-files/{index,games}.json
npm run samples:coverart  # fetch missing cover art, update games.json
npm run samples:upload-index
                          # upload regenerated index.json to PocketBase

npm run pocketbase:download
                          # fetch bin/pocketbase for current platform/arch
npm run pocketbase:serve  # serve with ./build/dist as publicDir
```

The `tools/*.mjs` scripts are CLI utilities, not tests; they
`process.exit(1)` on failure. `tools/prepare-web-assets.mjs` and
`tools/verify-build-output.mjs` each hardcode the list of required
runtime files — update **both** when adding a new backend.

## Conventions

- No test framework, linter, or formatter is configured. Do not
  introduce one without being asked.
- `vite.config.mjs` sets `emptyOutDir: !isWatchBuild` so
  `vite build --watch` does not wipe prior outputs between
  iterations.
- `patches/` is intentionally for non-upstream files that override
  matched submodule paths at build time (currently VGM, N64, and
  PSX have local `patches/<core>/emscripten/` overrides). Do not
  modify submodule contents.
- Pure-JS backends (`xa`, `genh`, `mp3`) are not built by CMake —
  they are copied as-is from `web/` to `build/web-public/wasm/` by
  `tools/prepare-web-assets.mjs`.

## License

The bundled cores and generic player retain their upstream licenses
(GPL/LGPL — see the respective submodule directories). All new
build, glue, and UI files in this repository are provided as
integration code.
