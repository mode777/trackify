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
├── sample-files/                 # reference track corpus (gitignored, local only)
├── playlists/                    # hand-curated track lists (.txt)
├── Dockerfile                    # pocketbase + build/dist
├── publish.sh                    # buildx + push entry point
└── docs/
    ├── audio-backends.md         # detailed backend integration reference
    ├── database.md              # PocketBase schema, fields, API rules, auth lifecycle
    ├── deploy.md                # Docker image + publish.sh + runtime
    ├── frontend.md              # Vite config + iframe topology + shell responsibilities
    ├── tools.md                  # tools/*.mjs reference + env vars
    └── ui.md                     # iframe broker contract + topics
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
entry points (`index.html`, `collections.html`, `playlist.html`,
`player.html`) that load the shell + two iframe slots: a content
slot (`#playlistFrame`, swapped between the games and playlist
services) and a player slot (`#playerFrame`, loaded once for the
session). All inter-frame communication goes through a single
shared `web/broker.js`; the message contract lives in
[`docs/ui.md`](docs/ui.md).

Full reference (Vite config flags, iframe topology, per-frame
module breakdown, shell responsibilities, dev workflows, "add a
new page" walkthrough) lives in
[`docs/frontend.md`](docs/frontend.md).

## PocketBase backend

The web build is purely static; catalog data is fetched at runtime
from a running PocketBase instance via the `pocketbase` JS SDK. The
static build works without a running PocketBase, but the UI simply
has no catalog to show.

Get a local instance with:

```bash
npm run pocketbase:download   # writes bin/pocketbase (or .exe on Windows)
npm run pocketbase:serve      # serves ./build/dist + runs ./pb_migrations + ./pb_hooks
```

Schema (collections, fields, API rules, view collections, hooks,
JavaScript API, the `TRACKIFY_PB_TOKEN` / `authWithOAuth2` client
auth lifecycle) is documented in
[`docs/database.md`](docs/database.md).

## Sample data tooling

The `sample-files/` directory is **local reference data and is not
tracked in this repository** (gitignored). The `tools/*.mjs` scripts
operate on it if you create it locally — e.g. by downloading albums
with `npm run khinsider:download` — and scan it, fetch missing cover
art via Wikipedia, and push the resulting `index.json` + `games.json`
to PocketBase.

Per-tool reference (purpose, env vars, exit codes, direct
invocation) lives in [`docs/tools.md`](docs/tools.md).

## Docker / deploy

`Dockerfile` extends `adrianmusante/pocketbase` and copies:

```
build/dist/   →  /pocketbase/public/
pb_migrations/  →  /pocketbase/migrations/
pb_hooks/       →  /pocketbase/hooks/
```

so the resulting image serves the static web build and runs the
PocketBase migrations / hooks from a single container. Detailed
reference (build context, base-image assumptions, runtime data
persistence, release checklist) in [`docs/deploy.md`](docs/deploy.md).

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

All scripts live in `package.json`. Per-script reference (purpose,
env vars, exit semantics, direct invocation) lives in
[`docs/tools.md`](docs/tools.md#quick-reference).

Two scripts hardcode the list of required runtime files:

- `tools/prepare-web-assets.mjs`
- `tools/verify-build-output.mjs`

Update **both** when adding a new backend.

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
