# Trackify

VGM (Video Game Music) web player. Hybrid build: CMake + Emscripten for WASM
backend cores, Node + Vite for the UI, PocketBase for catalog metadata.
Sources of truth for full context: `README.md` (architecture, ABI, build flow),
`docs/ui.md` (iframe broker contract), `docs/database.md` (PocketBase schema,
fields, and API rules), `docs/audio-backends.md` (per-backend ABI + Emscripten
flags + "add a new backend" walkthrough), `docs/frontend.md` (Vite config +
iframe topology + shell responsibilities + "add a new page" walkthrough),
`docs/tools.md` (per-script reference for the `tools/*.mjs` tooling), and
`docs/deploy.md` (Docker image + `publish.sh` + runtime characteristics).

## Role-based task routing

For every request, evaluate the task first and assign it to exactly
one role before planning any work. If the user has explicitly assigned
a role, use that; otherwise pick the role whose files own the dominant
area of impact. If a change crosses roles, scope the work to the
assigned role's files and hand off the rest explicitly in the plan.

- **Data engineer** — PocketBase queries, schema / migrations / API
  rules / hooks / view collections / auth lifecycle, and the
  cross-frame broker plumbing (topic names, envelope shape,
  request/response wiring between shell and frames).
- **UI engineer** — Player chrome, playlist, collections, hero,
  navigation, popups, and their HTML / CSS counterparts.
- **Audio engineer** — The WebAudio player (transport,
  `ScriptProcessor` buffer, `AudioContext` lifecycle, MediaSession),
  the WASM backends, the pure-JS backends, the `emu_*` ABI, and the
  CMake / Emscripten build glue.

### Data engineer

Owns the catalog backend and the cross-frame message contract. Read
first, in order:

- [`docs/database.md`](docs/database.md) — schema, fields, API rules,
  view collections, hooks, JS API surface, `authWithOAuth2` /
  `TRACKIFY_PB_TOKEN` lifecycle.
- [`docs/ui.md`](docs/ui.md) — envelope shape and topic list
  (anything that travels between frames goes through here).
- `web/broker.js` — `createShellBroker` / `createFrameBroker`, the
  versioned envelope.
- `web/catalog_service.js` — PocketBase SDK calls used by the shell.
- `pb_migrations/` (schema) and `pb_hooks/` (server-side behaviour).
- `web/playlist/auth_state.js` — client-side auth wiring.

When changing a collection, field, or rule, update `docs/database.md`
in the same change. When changing a topic or envelope field, update
`docs/ui.md` and the broker version in lockstep.

### UI engineer

Owns what the user sees and clicks. Read first, in order:

- [`docs/frontend.md`](docs/frontend.md) — Vite config, iframe
  topology, shell responsibilities, per-frame module breakdown,
  "add a new page" walkthrough.
- `web/index.html`, `web/main.js`, `web/app.js`, `web/app.css` — the
  shell and its global styling.
- Per-page frames and their sub-modules:
  - `web/player.html` / `web/player.css` + `web/player/`
    (`dom.js`, `now_playing_ui.js`, `seek_ui.js`, `shuffle_ui.js`,
    `volume_ui.js`, `media_session_anchor.js`).
  - `web/playlist.html` / `web/playlist.css` + `web/playlist/`
    (`dom.js`, `playlist_state.js`, `track_list_ui.js`,
    `track_helpers.js`, `hero_ui.js`, `navigation.js`,
    `status_ui.js`, `title_edit_ui.js`, `add_to_playlist_popup.js`).
  - `web/collections.html` / `web/collections.css` / `web/collections.js`.

CSS lives next to the page it styles. New pages follow the
"add a new page" walkthrough in `docs/frontend.md`.

### Audio engineer

Owns playback and every backend that produces samples. Read first, in
order:

- [`docs/audio-backends.md`](docs/audio-backends.md) — per-backend
  ABI, Emscripten flags, "add a new backend" walkthrough.
- The "Backend integration" and "Emscripten gotchas" sections above
  — verified working flag set, exports contract, ABI notes.
- `web/player.js` — `EXT_<CORE>`, `BACKEND_SCRIPT_BY_TYPE`, `typeOf()`
  switch, the adapter selection mirror with the shell.
- `web/player/` — `transport.js`, `backend_loader.js`,
  `backend_catalog.js`, `now_playing_ui.js`, `media_session_*.js`,
  `shuffle_ui.js`.
- `backends/<core>/CMakeLists.txt` (template:
  `backends/snes/CMakeLists.txt`), `cmake/concat.cmake`,
  `submodules/<core>/emscripten/`, `patches/<core>/emscripten/`.
- Pure-JS backends copied as-is: `web/backend_xa.js`,
  `web/backend_genh.js`, `web/backend_mp3.js`.

The `emu_*` ABI is the contract — keep `EXPORTED_FUNCTIONS` in each
`backends/<core>/CMakeLists.txt` in sync with the per-backend
`EXPORTS` list and the `emu_*` symbols in
`submodules/<core>/emscripten/Adapter.cpp`.

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

The web app is a multi-page Vite project rooted at `web/`. The full
reference (Vite config, iframe topology, per-frame module breakdown,
shell responsibilities, dev workflows, "add a new page" walkthrough)
lives in [`docs/frontend.md`](docs/frontend.md).

One thing that is easy to miss: all inter-frame communication goes
through `web/broker.js` (`createShellBroker` / `createFrameBroker`)
with a versioned envelope — no direct frame-to-frame messaging.
The message contract and topic list are in
[`docs/ui.md`](docs/ui.md).

## PocketBase

PocketBase is the catalog backend. Schema, fields, API rules, view
collections, hooks, the JavaScript API surface, and the
`TRACKIFY_PB_TOKEN` / `authWithOAuth2` client auth lifecycle are in
[`docs/database.md`](docs/database.md).

Agent-relevant specifics not covered in the doc:

- Binary: `bin/pocketbase` (gitignored). Get it with
  `npm run pocketbase:download` (auto-resolves latest release for the
  current platform/arch; supports `--platform`/`--arch` overrides).
- Local dev: `npm run pocketbase:serve` runs `pocketbase serve
  --publicDir ./build/dist --dir ./pb_data --hooksDir ./pb_hooks`.
- The `TRACKIFY_PB_TOKEN` in `.env` is a PocketBase auth JWT used by
  the web app's PocketBase SDK client (loaded by Vite, not by Node
  tooling).

## Docker / deploy

`Dockerfile` extends `adrianmusante/pocketbase`, copies `build/dist/`
→ `/pocketbase/public/`, `pb_migrations/` → `/pocketbase/migrations/`,
`pb_hooks/` → `/pocketbase/hooks/`. Build the static site first with
`npm run build` before building the image. `publish.sh <version>` is
the release entry point: builds the image via `docker buildx` for
`linux/amd64` and pushes to
`harbor.alexklingenbeck.de/my/trackify:<version>`. Requires `set -e`
and the version arg.

Tagging behavior: pushing a `v*` git tag triggers
`.github/workflows/release.yml`, which builds the static site (same
steps as `ci.yml`), logs into Harbor with the `HARBOR_USERNAME` /
`HARBOR_PASSWORD` repo secrets, and runs
`./publish.sh "${GITHUB_REF_NAME#v}"` — the leading `v` is stripped,
so git tag `v0.5.3` publishes image tag `0.5.3`. Only `v*` tags
release; plain commits and other tags never push images.

Full reference (build context, base-image assumptions, runtime data
persistence, release checklist) lives in [`docs/deploy.md`](docs/deploy.md).

## Conventions worth knowing

- No test framework, linter, or formatter is configured — do not introduce
  one without being asked. The `tools/*.mjs` scripts are CLI utilities, not
  tests; they `process.exit(1)` on failure. Per-script reference (purpose,
  env vars, direct invocation) lives in `docs/tools.md`.
- PocketBase schema, fields, and API rules live in `docs/database.md`. Keep it
  in sync when adding / renaming collections, changing fields, or modifying
  rules in `pb_migrations/`.
- `tools/prepare-web-assets.mjs` and `tools/verify-build-output.mjs` each
  hardcode the list of required runtime files. Update **both** when adding a
  new backend. The "Adding a new backend" and "Adding a new tool" sections
  of the relevant doc spell out where to look.
- `sample-files/` is **gitignored local reference data, not tracked in
  the repo** (it held copyrighted game rips and was purged from
  history). The tools still operate on it if you create it locally:
  `tools/generate-sample-index.mjs` produces `sample-files/index.json`
  and `sample-files/games.json`; the latter is consumed by
  `tools/fetch-missing-cover-art.mjs` (Wikipedia summary → MediaWiki
  page-image → infobox scrape; tunables documented in `docs/tools.md`).
- `patches/` is intentionally for non-upstream files that override the
  matched submodule paths at build time. Do not modify submodule contents.
- `vite.config.mjs` sets `emptyOutDir: !isWatchBuild` so `vite build
  --watch` does not wipe prior outputs between iterations.

## OpenSpec (spec-driven development)

OpenSpec (`@fission-ai/openspec`, devDependency) manages spec-driven
change proposals under `openspec/`. Project context shown to agents
when authoring artifacts lives in `openspec/config.yaml`.

- Propose a change: `/opsx-propose "idea"` (OpenCode) or
  `npx openspec` workflows; specs live in `openspec/specs/`, active
  change proposals in `openspec/changes/`, completed ones are archived
  to `openspec/changes/archive/`.
- Validate before archiving: `npx openspec validate --all`.
- Shared skill definitions are in `.agents/skills/`; the OpenCode
  adapter lives in `.opencode/` (`opsx-*` commands).