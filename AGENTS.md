# Trackify

VGM (Video Game Music) web player. Hybrid build: CMake + Emscripten for WASM
backend cores, Node + Vite for the UI, PocketBase for catalog metadata.
Sources of truth for full context: `README.md` (architecture, ABI, build flow)
and `ui.md` (iframe broker contract).

## One-time setup

- Submodules (cores, generic player, emsdk — all under `submodules/`):
  `git submodule update --init --recursive`
- Activate the bundled emsdk in every build shell (no system install needed):
  - macOS/Linux: `source ./submodules/emsdk/emsdk_env.sh`
  - Windows: `. .\submodules\emsdk\emsdk_env.ps1`
  - verify with `emcc --version`. CI uses `mymindstorm/setup-emsdk@v14` with `version: latest`.
- `npm install` (Vite only — `pocketbase` is the only runtime dep).

## Build / dev commands

All npm scripts live in `package.json`. The interesting chains:

- `npm run build` = `npm run wasm` + `npm run assets:prepare` + `vite build`.
  - `npm run wasm` = `emcmake cmake -B build -G Ninja -DTRACKIFY_JS_TOOLING=ON` then
    `cmake --build build --target player backend_psx backend_snes backend_nez backend_n64 backend_vgm`.
  - `npm run assets:prepare` (=`node tools/prepare-web-assets.mjs`) copies the
    CMake artifacts from `build/wasm/` into `build/web-public/wasm/`. It
    **fails hard** if the CMake runtime files are missing — never run it
    before `npm run wasm`.
- `npm run dev` runs the same chain then `vite` on `127.0.0.1:8137`
  (`strictPort: true` in `vite.config.mjs`, do not change).
- `npm run dev-js` / `npm run build:watch` / `npm run build:watch-js` skip the
  WASM rebuild — use these after the first build when iterating on web code.
- `npm run verify:dist` asserts the required runtime files exist under
  `build/dist` (CI runs it after `npm run build`).
- `npm run clean` → `rm -rf build` (use before a full rebuild if CMake cache
  looks stale; `npm run rebuild` does both).

Output layout:

- `build/wasm/` — CMake-emitted `backend_*.js` + `*.wasm` + concatenated
  `scriptprocessor_player.js`.
- `build/web-public/` — Vite `publicDir`; `prepare-web-assets.mjs` writes the
  `wasm/` tree here and is cleaned on every run.
- `build/dist/` — Vite `outDir` (HTML + assets + `wasm/`).

## Backend integration (where to edit)

Per-format runtime comes from `submodules/<core>/emscripten/` (untouched).
Glue lives in the repo:

- Build flags / sources: `backends/<core>/CMakeLists.txt`. Template is
  `backends/snes/CMakeLists.txt`; copy the `add_custom_command` block for the
  `shell-pre + emitted.js + shell-post + <core>_adapter.js` concat assembly
  done by `cmake/concat.cmake`.
- Per-core patches: `patches/<core>/emscripten/` is used in place of the
  upstream `emscripten/` files for the VGM and N64 adapters (see
  `backends/{vgm,n64}/CMakeLists.txt`).
- UI wiring:
  - `web/player.js`: `EXT_<CORE>` array, `BACKEND_SCRIPT_BY_TYPE` map, and
    `typeOf()` switch.
  - `web/app.js` (shell): adapter selection mirror.
  - `web/backend_xa.js` and `web/backend_genh.js` are pure-JS backends
    (copied into `build/web-public/wasm/` as-is, not built by CMake).

### Emscripten gotchas (verified working set)

- Drop `--closure 1`, `--llvm-lto`, `--memory-init-file`, `BINARYEN_*`,
  `SINGLE_FILE`, `EXTRA_EXPORTED_RUNTIME_METHODS` from the original
  `makeEmscripten.bat` flags.
- Define `EMSCRIPTEN` explicitly: modern emcc only sets `__EMSCRIPTEN__`, and
  some cores gate code paths on the bare `EMSCRIPTEN` macro.
- `EXPORTED_RUNTIME_METHODS` must include `HEAP16,HEAPU8,HEAP32,
  FS_createDataFile,FS_createPath,FS_unlink` in addition to `ccall,
  UTF8ToString` — the adapter code touches them.
- Do **not** export `Pointer_stringify` (removed). Keep a JS-side shim
  `Module.Pointer_stringify = Module.UTF8ToString` for adapters that still
  call it (SNES, N64, VGM do).
- webnez: needs `-Wno-incompatible-function-pointer-types`,
  `-Wno-incompatible-pointer-types`, `CXX_STANDARD 14`,
  `-Wl,--allow-multiple-definition`.
- webn64: `-fno-rtti`, `-sDISABLE_EXCEPTION_CATCHING=1`, 128 MB
  `INITIAL_MEMORY`. CPU-intensive — the N64 adapter uses a 0x4000-sample
  `ScriptProcessor` buffer to compensate for missing dynarec.
- vgmplay: must keep `--js-library ${VGM_EMS}/callback.js`,
  `ENABLE_ALL_CORES`/`FM_EMU`/`ADDITIONAL_FORMATS` defines,
  `-Wl,--allow-multiple-definition`, `-sERROR_ON_UNDEFINED_SYMBOLS=0`.
- The `emu_*` ABI is the contract — keep `EXPORTED_FUNCTIONS` in sync with
  the per-backend `EXPORTS` list and the `emu_*` symbols in each
  `<core>/emscripten/Adapter.cpp`.

## UI architecture (non-obvious)

Multi-page app under `web/` (Vite `root`):

- `index.html` is the **shell**: hosts two iframes (`#playlistFrame` for
  content like `collections.html`, `#playerFrame` for the player). All inter-frame
  communication goes through `web/broker.js` (`createShellBroker` /
  `createFrameBroker`) using `postMessage` with a versioned envelope — no
  direct frame-to-frame messaging. See `ui.md` for the message contract.
- `web/app.js` is the shell controller. Imports `pocketbase` JS SDK and
  fetches catalog from a running PocketBase instance.
- `web/player.js` owns the audio pipeline: lazy-loads the right
  `backend_*.js` from `/wasm/` by extension, instantiates a
  `ScriptNodePlayer`, and drives playback.
- `web/catalog_service.js`, `web/main.js`, per-page `*.html`/`*.js`/`*.css`
  are the rest of the UI surface.

## PocketBase

- Binary: `bin/pocketbase` (gitignored). Get it with
  `npm run pocketbase:download` (auto-resolves latest release for the current
  platform/arch; supports `--platform`/`--arch` overrides).
- Local dev: `npm run pocketbase:serve` runs `pocketbase serve
  --publicDir ./build/dist --dir ./pb_data --hooksDir ./pb_hooks`.
- Schema: `pb_migrations/` (PocketBase JS migrations, timestamped filenames).
- Hooks: `pb_hooks/` (currently `keep_names.pb.js` rewrites uploaded
  `originalName` → `name` on `games` create/update).
- The `TRACKIFY_PB_TOKEN` in `.env` is a PocketBase auth JWT used by the web
  app's PocketBase SDK client (loaded by Vite, not by Node tooling).

## Docker / deploy

- `Dockerfile` extends `adrianmusante/pocketbase`, copies `build/dist/` →
  `/pocketbase/public/`, `pb_migrations/` → `/pocketbase/migrations/`,
  `pb_hooks/` → `/pocketbase/hooks/`. Build the static site first with
  `npm run build` before building the image.
- `publish.sh <version>` is the release entry point: builds the image via
  `docker buildx` for `linux/amd64` and pushes to
  `harbor.alexklingenbeck.de/my/trackify:<version>`. Requires `set -e` and
  the version arg.

## Conventions worth knowing

- No test framework, linter, or formatter is configured — do not introduce
  one without being asked. The `tools/*.mjs` scripts are CLI utilities, not
  tests; they `process.exit(1)` on failure.
- `tools/prepare-web-assets.mjs` and `tools/verify-build-output.mjs` each
  hardcode the list of required runtime files. Update **both** when adding a
  new backend.
- `sample-files/` is reference data, not a staged web asset. It is scanned
  by `tools/generate-sample-index.mjs` to produce `sample-files/index.json`
  and `sample-files/games.json`; the latter is consumed by
  `tools/fetch-missing-cover-art.mjs` (Wikipedia summary → MediaWiki
  page-image → infobox scrape; tunables documented in `README.md`).
- `patches/` is intentionally for non-upstream files that override the
  matched submodule paths at build time. Do not modify submodule contents.
- `vite.config.mjs` sets `emptyOutDir: !isWatchBuild` so `vite build
  --watch` does not wipe prior outputs between iterations.
