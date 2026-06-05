# Trackify — VGM Web Audio Player

A clean, single-page web player for Video Game Music (VGM) files. It reuses the
generic [`webaudio-player`](submodules/webaudio-player) engine together with three
Emscripten-compiled emulator cores:

| Backend | Source core | Formats | Memory |
| ------- | ----------- | ------- | ------ |
| **PSX** | [`webpsx`](submodules/webpsx) (HighlyExperimental) | `.psf` / `.minipsf` (+ `.psflib`) | 128 MB |
| **SNES** | [`websnes`](submodules/websnes) (Game Music Emu) | `.spc` | 64 MB |
| **NEZ** | [`webnez`](submodules/webnez) (NEZplug++) | `.bgm` / `.opx` / `.nsf` / `.sng` / `.kss` | 64 MB |
| **N64** | [`webn64`](submodules/webn64) (LazyUSF2/Mupen64plus) | `.usf` / `.miniusf` (+ `.usflib`) | 128 MB |

The UI auto-selects the backend by file extension, decodes audio in WebAssembly,
and streams it through a `ScriptProcessorNode` pipeline.

Track metadata is loaded at runtime from `sample-files/index.json` (array of
`{ title, file }` objects), and audio files are fetched from the same
`sample-files/` directory.

---

## Prerequisites

The project now uses a hybrid build:

- **CMake + Emscripten** for WASM/runtime artifacts
- **Node.js + Vite** for web app build/dev workflow

You need:

- **CMake** ≥ 3.21
- **Ninja**
- **Node.js** ≥ 20
- **npm**
- **Python 3** (for the bundled emsdk)
- **Git**
- A modern browser (Web Audio API + WebAssembly)

The Emscripten SDK lives in [`submodules/emsdk`](submodules/emsdk) and is
installed/activated as a one-time step below — no system-wide Emscripten install
is required.

---

## Building

### 0. Initialize submodules (one-time, after cloning)

This repository uses Git submodules for the emulator cores, the generic player,
and the Emscripten SDK. After cloning, populate them with:

```bash
git submodule update --init --recursive
```

To bring all submodules up to the pinned commit after a `git pull`:

```bash
git submodule update --recursive
```

---

### 1. Install & activate the Emscripten SDK (one-time)

```powershell
cd submodules/emsdk
./emsdk install latest
./emsdk activate latest
```

### 2. Load the Emscripten environment

Every build shell needs the emsdk environment on its `PATH`:

```powershell
# Windows (PowerShell)
. ./submodules/emsdk/emsdk_env.ps1
```

```bash
# Linux / macOS
source ./submodules/emsdk/emsdk_env.sh
```

Verify with `emcc --version`.

### 3. Install JavaScript tooling (one-time)

From the repository root:

```bash
npm install
```

### 4. Build (WASM + web app)

From the repository root:

```bash
npm run build
```

This runs:

1. CMake in JS-tooling mode (`TRACKIFY_JS_TOOLING=ON`) to produce runtime
   artifacts under `build/wasm/`
2. Asset preparation into `build/web-public/`
3. Vite production build into `build/dist/`

Expected output (simplified):

```
build/
├── wasm/
│   ├── scriptprocessor_player.js
│   ├── backend_psx.js
│   ├── backend_snes.js
│   ├── backend_nez.js
│   ├── backend_n64.js
│   ├── psx.wasm
│   ├── snes.wasm
│   ├── nez.wasm
│   └── n64.wasm
├── web-public/
│   ├── wasm/
│   └── sample-files/
└── dist/
    ├── index.html
    ├── assets/...
    ├── wasm/...
    └── sample-files/...
```

### 5. Dev server

Run the Vite dev server (includes wasm build + asset prep):

```bash
npm run dev
```

Then open `http://127.0.0.1:8137/`.

### Useful scripts

```bash
npm run wasm         # only configure/build CMake runtime artifacts
npm run preview      # preview the production build
npm run verify:dist  # assert required runtime files exist in build/dist
```

### Legacy CMake-only mode (optional)

If you want the old staging behavior (CMake copies `web/` + `sample-files/`
directly into `build/dist`), configure with:

```bash
emcmake cmake -B build -G Ninja -DTRACKIFY_JS_TOOLING=OFF
cmake --build build
```

### Previous direct CMake build command

From the repository root:

```powershell
emcmake cmake -B build -G Ninja -DTRACKIFY_JS_TOOLING=ON
cmake --build build --target player backend_psx backend_snes backend_nez backend_n64
```

---

## Architecture

```mermaid
flowchart TD
    subgraph UI["web/ (UI)"]
        APP["app.js<br/>track list • play/pause/next<br/>extension → backend select"]
    end

    subgraph PLAYER["scriptprocessor_player.js (generic engine)"]
        SNP["ScriptNodePlayer<br/>(public API + audio pipeline)"]
        ADP["EmsHEAP16BackendAdapter<br/>(base adapter)"]
        FM["SimpleFileMapper<br/>(virtual FS + URI mapping)"]
    end

    subgraph BACKENDS["backend_*.js (per-core)"]
        PSXA["PSXBackendAdapter"]
        SNESA["SNESBackendAdapter"]
      NEZA["NEZBackendAdapter"]
      N64A["N64BackendAdapter"]
        PSXM["backend_PSX.Module<br/>psx.wasm"]
        SNESM["backend_SNES.Module<br/>snes.wasm"]
      NEZM["backend_NEZ.Module<br/>nez.wasm"]
      N64M["backend_N64.Module<br/>n64.wasm"]
    end

    APP -->|initialize / loadMusicFromURL| SNP
    SNP --> ADP
    ADP --> FM
    PSXA -.->|extends| ADP
    SNESA -.->|extends| ADP
    NEZA -.->|extends| ADP
    N64A -.->|extends| ADP
    PSXA --> PSXM
    SNESA --> SNESM
    NEZA --> NEZM
    N64A --> N64M
```

### How the pieces fit together

1. **The generic player** ([`webaudio-player`](submodules/webaudio-player)) is
   format-agnostic. `ScriptNodePlayer` owns the Web Audio pipeline and exposes
   the public API (`initialize`, `loadMusicFromURL`, `play/pause`, `getSongInfo`,
   …). It talks to a *backend adapter*.

2. **A backend adapter** (`PSXBackendAdapter`, `SNESBackendAdapter`,
  `NEZBackendAdapter`, `N64BackendAdapter`) is a thin
   subclass of `EmsHEAP16BackendAdapter` that knows how to drive one specific
   emulator core through a small, fixed C ABI (the `emu_*` functions — load,
   teardown, compute samples, query track info, etc.).

3. **The emulator core** is the C/C++ source compiled to WebAssembly. Each core
  is wrapped in an IIFE (`backend_PSX` / `backend_SNES` / `backend_NEZ` / `backend_N64`) so multiple cores can
   coexist on the same page without symbol clashes.

### The `emu_*` ABI

All cores expose this shared base ABI:

```
emu_load_file, emu_teardown,
emu_compute_audio_samples, emu_get_audio_buffer, emu_get_audio_buffer_length,
emu_get_sample_rate,
emu_get_current_position, emu_seek_position, emu_get_max_position,
emu_set_subsong, emu_get_track_info,
malloc, free
# PSX only: emu_set_bios, emu_set_boost
# N64 only: emu_set_boost
# NEZ only: emu_set_loop, emu_number_trace_streams, emu_get_trace_streams,
#           emu_get_trace_titles, emu_force_mbm_device
```

### Build assembly (CMake)

Each `backend_*.js` is **assembled by concatenation** (no bundler):

```
shell-pre.js  +  <emscripten-emitted>.js  +  shell-post.js  +  <core>_adapter.js
```

- `shell-pre.js` / `shell-post.js` wrap the emitted module in the
  `backend_PSX` / `backend_SNES` / `backend_NEZ` / `backend_N64` IIFE and provide the async-ready
  hook.
- `<core>_adapter.js` is the per-core adapter subclass.

The concatenation is done by [`cmake/concat.cmake`](cmake/concat.cmake), invoked
as a post-link custom command from each backend's `CMakeLists.txt`. The generic
player is likewise assembled by concatenating the
[`webaudio-player/src`](submodules/webaudio-player/src) files in the order
defined by the upstream `build.bat` (plain concat, no minify).

> **Note:** All build logic lives in new top-level files
> ([`CMakeLists.txt`](CMakeLists.txt), [`backends/`](backends),
> [`cmake/`](cmake), [`web/`](web)). The submodule sources are never modified.

---

## Adding another backend

If a new core ships in the same shape as `webpsx` / `websnes` / `webnez` / `webn64` — i.e. an
`emscripten/` directory containing `shell-pre.js`, `shell-post.js`, a
`*_adapter.js`, glue sources, and the `emu_*` ABI — integration is mechanical.

### 1. Drop the core in

Add it under `submodules/<mycore>` with its `emscripten/` glue intact.

### 2. Create `backends/<mycore>/CMakeLists.txt`

Use [`backends/snes/CMakeLists.txt`](backends/snes/CMakeLists.txt) as the
template. The essentials:

```cmake
add_executable(mycore ${MYCORE_SOURCES})

set_target_properties(mycore PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
    OUTPUT_NAME "mycore"
    SUFFIX ".js")            # emit mycore.js (+ mycore.wasm)

target_include_directories(mycore PRIVATE ...)   # mirror makeEmscripten.bat -I flags
target_compile_definitions(mycore PRIVATE ...)   # mirror its -D defines
target_compile_options(mycore PRIVATE -O3 ...)

target_link_options(mycore PRIVATE
    "-O3" "-sWASM=1" "-sFORCE_FILESYSTEM=1"
    "-sINITIAL_MEMORY=<bytes>"
    "-sEXPORTED_FUNCTIONS=_emu_load_file,_emu_teardown,...,_malloc,_free"
    "-sEXPORTED_RUNTIME_METHODS=ccall,UTF8ToString,HEAP16,HEAPU8,HEAP32,FS_createDataFile,FS_createPath,FS_unlink")

# Assemble backend_mycore.js = shell-pre + emitted + shell-post + adapter
# (copy the add_custom_command block from an existing backend)
```

Then register it in the root [`CMakeLists.txt`](CMakeLists.txt):

```cmake
add_subdirectory(backends/mycore)
```

### 3. Wire it into the UI

In [`web/app.js`](web/app.js):

```js
const EXT_MYCORE = ['ext1', 'ext2'];
// ...in typeOf(): if (EXT_MYCORE.includes(ext)) return 'mycore';
// ...in makeAdapter(): if (type === 'mycore') return new MyCoreBackendAdapter();
```

And add `<script src="backend_mycore.js"></script>` to
[`web/index.html`](web/index.html) (after `scriptprocessor_player.js`).

### Porting checklist / gotchas

These are the things that differ from the original 2023-era `makeEmscripten.bat`
builds and tend to bite when building with a current emsdk:

- **Translate flags literally first.** Copy the include dirs (`-I…`), defines
  (`-D…`), and the `EXPORTED_FUNCTIONS` list verbatim from the core's
  `makeEmscripten.bat`. That file is the source of truth.
- **Modernize the emitted flags.** Drop `--closure 1`, `--llvm-lto`,
  `--memory-init-file`, and the `BINARYEN_*` options. Use
  `EXPORTED_RUNTIME_METHODS` (not the old `EXTRA_EXPORTED_RUNTIME_METHODS`).
- **Define `EMSCRIPTEN` yourself if the core needs it.** Modern emcc only
  defines `__EMSCRIPTEN__`. Cores that gate WASM code paths on the bare
  `EMSCRIPTEN` macro (webpsx does, for its BIOS overlays and `decode_xa` stubs)
  need `-DEMSCRIPTEN` added explicitly.
- **Export enough runtime methods.** The adapters and the file mapper touch
  `HEAP16/HEAPU8/HEAP32` and the `FS_*` helpers in addition to
  `ccall`/`UTF8ToString`. Export all of them or the adapter crashes at runtime.
- **`Pointer_stringify` shim.** Some adapters (e.g. `snes_adapter.js`) still call
  `Module.Pointer_stringify`, which modern emscripten removed. `app.js` installs
  a `Module.Pointer_stringify = UTF8ToString` shim — extend it if your adapter
  needs it too.
- **Stage dependency files.** If a format references sidecar files (PSF's
  `.psflib`), stage them next to the main file in `dist/` so the runtime file
  mapper can resolve them without a 404 (see the sample-file staging block in
  the root `CMakeLists.txt`).

### webnez quirks (2026-06)

When integrating `webnez` with current emsdk/clang, these extra tweaks were
required on top of the generic checklist:

- Use compatibility warnings for legacy signatures:
  `-Wno-incompatible-function-pointer-types`
  `-Wno-incompatible-pointer-types`
- Build `Adapter.cpp` with at least C++14 (`CXX_STANDARD 14`) because it relies
  on the `std::equal(first1,last1,first2,last2,pred)` overload.
- Allow duplicate legacy globals at link time:
  `-Wl,--allow-multiple-definition`.
- Do **not** export `Pointer_stringify` via `EXPORTED_RUNTIME_METHODS` on modern
  emsdk (it is removed). Keep the JS-side shim:
  `Module.Pointer_stringify = Module.UTF8ToString`.

### webn64 quirks (2026-06)

When integrating `webn64` (LazyUSF2 / Mupen64plus) with current emsdk/clang:

- The emulator is **CPU-intensive** — it uses the N64 cached-interpreter mode
  (no dynarec/SSE2 in WASM). A large `ScriptProcessor` buffer (0x4000 samples)
  is used by default in the adapter to compensate.
- Needs 128 MB initial memory (`-sINITIAL_MEMORY=134217728`) matching the
  original `TOTAL_MEMORY` flag.
- Uses `-fno-rtti` (C++ code does not use RTTI).
- Exception catching is disabled (`-sDISABLE_EXCEPTION_CATCHING=1`).
- Drop `--closure 1`, `--llvm-lto 1`, `--memory-init-file 0`,
  `BINARYEN_ASYNC_COMPILATION`, `BINARYEN_TRAP_MODE`, and `SINGLE_FILE` from the
  original `.bat` — these are obsolete/default in modern emsdk.
- Do **not** export `Pointer_stringify` via `EXPORTED_RUNTIME_METHODS`. Keep the
  JS-side shim (`Module.Pointer_stringify = Module.UTF8ToString`) since the
  adapter still calls it.
- The `.miniusf` format references `.usflib` sidecar files — ensure they are
  staged alongside the music files so the runtime file mapper can resolve them.

---

## Project layout

```
CMakeLists.txt              # root build: backends + player + dist staging
cmake/concat.cmake          # cross-platform JS concatenation helper
backends/
  psx/CMakeLists.txt        # PSX backend build
  snes/CMakeLists.txt       # SNES backend build
  nez/CMakeLists.txt        # NEZ backend build
  n64/CMakeLists.txt        # N64 backend build
web/
  index.html • app.js • app.css
sample-files/               # demo tracks
submodules/
  webaudio-player/          # generic engine (untouched)
  webpsx/                   # PSX core (untouched)
  websnes/                  # SNES core (untouched)
  webnez/                   # NEZ core (untouched)
  webn64/                   # N64 core (untouched)
  emsdk/                    # Emscripten SDK
```

## License

The bundled cores and player retain their upstream licenses (GPL/LGPL — see the
respective submodule directories). All new build/UI files in this repository are
provided as integration glue.
