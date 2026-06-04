# Plan: Web Audio Player for VGM sample files

Build a clean, single-page web audio player that plays the files in [sample-files](sample-files) by reusing the generic `webaudio-player` plus the `webpsx` (PSX/PSF) and `websnes` (SNES/SPC) cores. The two emscripten backends are compiled with **CMake via `emcmake`** (new `CMakeLists.txt` replicating the existing `makeEmscripten.bat` flags/exports), and a minimal hand-written UI auto-selects the backend by file extension.

## Phase 1 — Toolchain setup
1. Install + activate emsdk (one-time): `emsdk install latest` then `emsdk activate latest` in [submodules/emsdk](submodules/emsdk). Build commands run from the `emsdk_env` shell.

## Phase 2 — CMake backends (built via `emcmake`) *(parallel: psx & snes)*
2. Root `CMakeLists.txt` declaring the project and `add_subdirectory` for both backends; pick up the Emscripten toolchain from `emcmake`.
3. `backends/psx/CMakeLists.txt` — compile `webpsx` sources (`Core/*.c` incl. `psx,iop,bios,r3000*,vfs,spucore,spu,mkhebios`, `psflib/*.c`, `zlib/*.c`, `SPUDriver.cpp`, `heplug.c`, `MetaInfoHelper.cpp`, `Adapter.cpp`), include dirs `-I../Core -I../psflib -I../zlib`, defines `-DBUILTIN_HEBIOS -DEMU_COMPILE -DEMU_LITTLE_ENDIAN -DHAVE_STDINT_H -DNO_DEBUG_LOGS`, `--js-library callback.js`, the PSX `EXPORTED_FUNCTIONS` list, `EXPORTED_RUNTIME_METHODS=[ccall,UTF8ToString]`, `FORCE_FILESYSTEM=1`, `TOTAL_MEMORY=128MB`. BIOS is baked in (no external BIOS file needed).
4. `backends/snes/CMakeLists.txt` — compile `websnes` GME sources (`gme/*.cpp`), `zlib/*.c`, `MetaInfoHelper.cpp`, `Adapter.cpp`, `-std=c++11`, `TOTAL_MEMORY=64MB`, the SNES `EXPORTED_FUNCTIONS` list.
5. Post-link custom commands assemble `backend_psx.js`/`backend_snes.js` by concatenating `shell-pre.js` + emitted JS + `shell-post.js` + `*_adapter.js` (preserving the `backend_PSX.Module` / `backend_SNES.Module` IIFE wrapping the player expects).

## Phase 3 — Generic player + UI
6. Generate `scriptprocessor_player.js` by concatenating [webaudio-player/src](submodules/webaudio-player/src) files in the order from [webaudio-player/build.bat](submodules/webaudio-player/build.bat) (no terser/minify needed).
7. `web/index.html` + `web/app.js` + `web/app.css` — minimal UI (track list of the 2 sample files, play/pause/next, song-info display). `app.js` instantiates `PSXBackendAdapter` or `SNESBackendAdapter` based on extension and drives `ScriptNodePlayer.initialize(...)`. Includes a tiny compat shim `Module.Pointer_stringify = UTF8ToString` (modern emscripten removed it; `snes_adapter.js` still calls it).

## Phase 4 — Stage & run
8. CMake stages `dist/`: the two `backend_*.js` + `.wasm`, `scriptprocessor_player.js`, UI files, and `sample-files/*` (incl. `driver.psflib` next to the minipsf so the file mapper resolves the dependency).
9. Serve `dist/` over local HTTP (`emrun` or `python -m http.server`).

## Relevant files
- [submodules/webpsx/emscripten/makeEmscripten.bat](submodules/webpsx/emscripten/makeEmscripten.bat) — source of truth for PSX flags/exports/source list.
- [submodules/websnes/emscripten/makeEmscripten.bat](submodules/websnes/emscripten/makeEmscripten.bat) — same for SNES.
- `psx_adapter.js` / `snes_adapter.js`, `shell-pre.js` / `shell-post.js` in both `emscripten/` dirs — reused as-is for backend assembly.
- [webaudio-player/build.bat](submodules/webaudio-player/build.bat) — defines the player concat order.

## Verification
1. `cmake --build build` completes; `psx.wasm`/`psx.js` and `snes.wasm`/`snes.js` produced.
2. Serve `dist/`, open the page: `super james pond - codename robocod.spc` plays with correct title/artist (SNES path, exercises the `Pointer_stringify` shim).
3. `01 main menu.minipsf` plays — confirm `driver.psflib` is fetched as a dependency without 404.
4. Switching tracks tears down one backend and starts the other without errors in console.

## Decisions
- Modernize the 2023-era emcc flags in CMake (`EXPORTED_RUNTIME_METHODS`, `-flto`, drop `--closure 1`/`--llvm-lto`/`BINARYEN_*`) to build cleanly with latest emsdk; **submodule sources stay untouched** — all new files live in new project dirs.
- Excluded: the jQuery `mini_controls`/`mini_display` UI, spectrum visualizer, modland remote URLs, drag-and-drop (can add later).

## Further Considerations
1. emsdk version: latest (modernized flags) vs pinning a 2023-era emscripten to keep original flags verbatim. Recommend **latest + modernized flags**.
2. Closure compiler is dropped (needs Java) — fine for a clean dev build; re-add later for size optimization if desired.
3. Player JS: plain concatenation vs running the submodule's terser minify. Recommend **plain concat** to avoid the npm/terser dependency.
