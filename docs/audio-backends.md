# Audio Backends

Detailed reference for the WASM and pure-JS audio backends that power
Trackify. The high-level overview (format → core mapping, build flow,
output layout) lives in the top-level [`README.md`](../README.md); this
document covers the contract between the player runtime and a backend,
how each backend is built, and how to add or port a new one.

> **Planned AudioWorklet migration.** The current player runtime
> (`scriptprocessor_player.js` from the upstream
> `submodules/webaudio-player`) is built on the deprecated
> `ScriptProcessorNode`. The replacement design — moving the entire hot
> path (WASM module + adapter + `OutputTransformer`) into an
> `AudioWorkletGlobalScope` while preserving the public
> `ScriptNodePlayer` API — is documented in
> [`docs/audio-worklet-migration.md`](./audio-worklet-migration.md). That
> document also lists the per-file adoption and a milestone-by-milestone
> roadmap (WP-0 … WP-H).

## 1. The backend catalog

| Backend key | Source core                       | Build        | Extensions                                                       | `INITIAL_MEMORY` |
| ----------- | --------------------------------- | ------------ | ---------------------------------------------------------------- | ---------------- |
| `psx`       | `submodules/webpsx` (HighlyExperimental) | CMake + Emscripten | `.psf` `.minipsf` `.psf2` `.minipsf2` `.psflib`                  | 128 MB           |
| `snes`      | `submodules/websnes` (Game Music Emu)   | CMake + Emscripten | `.spc` `.rsn`                                                    | 64 MB            |
| `nez`       | `submodules/webnez` (NEZplug++)         | CMake + Emscripten | `.bgm` `.opx` `.nsf` `.sng` `.kss`                                | 64 MB            |
| `n64`       | `submodules/webn64` (LazyUSF2 / Mupen64plus) | CMake + Emscripten | `.usf` `.miniusf` `.usflib`                                       | 128 MB           |
| `vgm`       | `submodules/vgmplay-0.40.9` (VGMPlay)  | CMake + Emscripten | `.vgm` `.vgz` `.cmf` `.dro`                                      | 64 MB            |
| `xa`        | n/a (native JS)                  | copied as-is | `.xa`                                                            | n/a              |
| `genh`      | n/a (native JS)                  | copied as-is | `.genh`                                                          | n/a              |
| `mp3`       | n/a (native JS)                  | copied as-is | `.mp3`                                                           | n/a              |

The pure-JS backends (`xa`, `genh`, `mp3`) are not built by CMake. They
are copied verbatim from `web/` into `build/web-public/wasm/` by
`tools/prepare-web-assets.mjs`.

## 2. Per-backend locations

```
backends/<core>/CMakeLists.txt   # per-core build flags, sources, export list
submodules/<core>/emscripten/    # upstream shell-pre/shell-post, adapter, etc.
patches/<core>/emscripten/       # local overrides for VGM, N64, PSX (see §7)
tools/prepare-web-assets.mjs     # copies CMake artifacts + JS backends
tools/verify-build-output.mjs    # asserts build/dist contains every required file
web/player/backend_catalog.js    # file-extension → backend-type → script-src map
```

Two lists must be kept in sync when adding a backend:

- `requiredRuntimeFiles` in `tools/prepare-web-assets.mjs`
- `required` in `tools/verify-build-output.mjs`

If you only ship a pure-JS backend, add it to the second list (it is
copied into the build) and to the runtime list in
`tools/prepare-web-assets.mjs`.

## 3. The `emu_*` ABI

All WASM cores expose the following shared base ABI. The player runtime
calls into it through `EmsHEAP16BackendAdapter`; the per-core
`*_adapter.js` translates these calls into `Module.ccall(...)` against
the compiled C symbols.

```
emu_load_file, emu_teardown,
emu_compute_audio_samples, emu_get_audio_buffer, emu_get_audio_buffer_length,
emu_get_sample_rate,
emu_get_current_position, emu_seek_position, emu_get_max_position,
emu_set_subsong, emu_get_track_info,
malloc, free
```

Per-core extensions:

- **PSX** — `emu_set_bios`, `emu_set_boost`
- **N64** — `emu_set_boost`
- **VGM** — `emu_set_resource_path`, `emu_set_boost`
- **NEZ** — `emu_set_loop`, `emu_number_trace_streams`,
  `emu_get_trace_streams`, `emu_get_trace_titles`, `emu_force_mbm_device`

`EXPORTED_FUNCTIONS` in each `backends/<core>/CMakeLists.txt` must list
the exact same set of `_emu_*` / `_malloc` / `_free` symbols that the
per-core `Adapter.cpp` and `*_adapter.js` files expect.

## 4. Seek support by backend

The player UI shows a seek bar only when the active backend reports a
positive `getMaxPlaybackPosition()`.

- **PSX / SNES / N64 / VGM** — `emu_get_current_position`,
  `emu_seek_position`, `emu_get_max_position` are implemented; the
  seek bar is enabled.
- **NEZ** — position APIs are stubbed (`emu_get_current_position` /
  `emu_get_max_position` return `-1`, `emu_seek_position` is a no-op);
  the seek bar stays disabled.

## 5. Build assembly (CMake)

Every `backend_*.js` is assembled by **plain concatenation** — there is
no bundler. The per-core `CMakeLists.txt` runs a custom command that
concatenates:

```
shell-pre.js  +  <emscripten-emitted>.js  +  shell-post.js  +  <core>_adapter.js
```

- `shell-pre.js` / `shell-post.js` wrap the emitted module in the
  `backend_PSX` / `backend_SNES` / `backend_NEZ` / `backend_N64` /
  `backend_vgmPlay` IIFE and provide the async-ready hook.
- `<core>_adapter.js` is the per-core adapter subclass (sourced from
  the submodule for SNES, from `patches/<core>/` for VGM/N64/PSX).
- The concatenation helper is `cmake/concat.cmake`, invoked as
  `-P` from each `add_custom_command`.

The generic player (`scriptprocessor_player.js`) is built the same way
in the root `CMakeLists.txt` — `submodules/webaudio-player/src/*.js`
files are concatenated in the order defined by the upstream build
script, no minify.

## 6. Emscripten gotchas (verified working set)

These are the deviations from the original 2023-era
`makeEmscripten.bat` flags that are required for a current emsdk:

- **Drop obsolete flags.** `--closure 1`, `--llvm-lto`,
  `--memory-init-file`, all `BINARYEN_*`, `SINGLE_FILE`, and
  `EXTRA_EXPORTED_RUNTIME_METHODS` are gone.
- **Define `EMSCRIPTEN` explicitly.** Modern emcc only sets
  `__EMSCRIPTEN__`; cores that gate WASM code paths on the bare
  `EMSCRIPTEN` macro (webpsx does, for its BIOS overlays and
  `decode_xa` stubs) need `-DEMSCRIPTEN` added explicitly.
- **Export enough runtime methods.** The adapters and the file mapper
  touch `HEAP16`, `HEAPU8`, `HEAP32` and the `FS_*` helpers in
  addition to `ccall` / `UTF8ToString`. Export all of them, otherwise
  the adapter crashes at runtime:
  `HEAP16,HEAPU8,HEAP32,FS_createDataFile,FS_createPath,FS_unlink`.
- **`Pointer_stringify` shim.** Modern emscripten removed
  `Module.Pointer_stringify`. The PSX, N64, SNES, and VGM adapters
  still call it. Do **not** try to export it via
  `EXPORTED_RUNTIME_METHODS` — install the JS-side shim instead:
  ```js
  Module.Pointer_stringify = function (ptr) {
      return Module.UTF8ToString(ptr);
  };
  ```
  `web/player/player_host.js#installPointerStringifyShim` does this
  for the adapters that need it.

## 7. Per-core quirks

### webpsx (PSX)

- `submodules/webpsx/emscripten/heplug.c` is **overridden** by
  `patches/webpsx/emscripten/heplug.c`. The `patches/` copy is what
  CMake compiles; the submodule file is left untouched.
- The adapter relies on `Module.Pointer_stringify` — keep the shim.
- PSF `.psflib` and `.minipsf` files reference sidecar data. The
  `SimpleFileMapper` resolves them at runtime, so they must be
  reachable from the same origin the player fetched the main file
  from (see the PocketBase / file-staging section in the README).

### webnez (NEZ)

- Use compatibility warnings for legacy signatures:
  `-Wno-incompatible-function-pointer-types`,
  `-Wno-incompatible-pointer-types`.
- Build `Adapter.cpp` with at least C++14 (`CXX_STANDARD 14`) because
  it relies on the `std::equal(first1,last1,first2,last2,pred)`
  overload.
- Allow duplicate legacy globals at link time:
  `-Wl,--allow-multiple-definition`.
- Seek is intentionally disabled — see §4.
- The adapter still calls `Module.Pointer_stringify`; install the shim.

### webn64 (N64)

- The core runs in **cached-interpreter mode** (no dynarec / SSE2 in
  WASM) and is CPU-intensive. The N64 adapter uses a `0x4000`-sample
  `ScriptProcessor` buffer to compensate.
- `INITIAL_MEMORY=134217728` (128 MB) — matches the original
  `TOTAL_MEMORY` flag.
- `-fno-rtti` (no RTTI in the C++ code).
- `-sDISABLE_EXCEPTION_CATCHING=1`.
- `submodules/webn64/emscripten/n64plug.cpp` is **overridden** by
  `patches/webn64/emscripten/n64plug.cpp`.
- `.miniusf` files reference `.usflib` sidecars — stage them next to
  the main file in the same origin.
- Adapter still calls `Module.Pointer_stringify`; install the shim.

### vgmplay-0.40.9 (VGM)

- `submodules/vgmplay-0.40.9/emscripten/{Adapter.cpp, vgm_adapter.js,
  vgminterface.h}` are **fully overridden** by
  `patches/vgmplay-0.40.9/emscripten/`. The submodule copies are not
  compiled.
- Keep `--js-library ${VGM_EMS}/callback.js` so VGMPlay's async file
  requests still bridge into `ScriptNodePlayer`.
- Preserve the original compile defines: `ENABLE_ALL_CORES`, `FM_EMU`,
  `ADDITIONAL_FORMATS`, `SET_CONSOLE_TITLE`, `DISABLE_HW_SUPPORT`,
  `NO_DEBUG_LOGS`, `HAVE_STDINT_H`, `EMSCRIPTEN`.
- The adapter relies on `SimpleFileMapper` and
  `Module.Pointer_stringify`; ensure the player runtime is loaded
  first and the shim is installed.
- `-Wl,--allow-multiple-definition` and
  `-sERROR_ON_UNDEFINED_SYMBOLS=0` are required because of legacy
  global symbol collisions in upstream.

### websnes (SNES)

- Plain Game Music Emu + zlib build; no per-core flags beyond the
  standard `EXPORTED_FUNCTIONS` / `EXPORTED_RUNTIME_METHODS` set.
- Adapter still calls `Module.Pointer_stringify`; install the shim.

## 8. Adding another backend

If a new core ships in the same shape as `webpsx` / `websnes` / `webnez`
/ `webn64` — an `emscripten/` directory containing `shell-pre.js`,
`shell-post.js`, a `*_adapter.js`, glue sources, and the `emu_*` ABI —
integration is mechanical.

### 1. Drop the core in

Add it under `submodules/<mycore>` with its `emscripten/` glue intact.
If the core needs a non-upstream patch, mirror the structure under
`patches/<mycore>/emscripten/` and use those paths in the CMakeLists
(SNES does not need this; PSX/N64/VGM do).

### 2. Create `backends/<mycore>/CMakeLists.txt`

Use [`backends/snes/CMakeLists.txt`](../backends/snes/CMakeLists.txt)
as the template. The essentials:

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

Then register it in the root [`CMakeLists.txt`](../CMakeLists.txt):

```cmake
add_subdirectory(backends/mycore)
```

### 3. Wire it into the UI

In [`web/player/backend_catalog.js`](../web/player/backend_catalog.js):

```js
const EXT_MYCORE = ['ext1', 'ext2'];
const BACKEND_SCRIPT_BY_TYPE = {
  // ...
  mycore: '/wasm/backend_mycore.js',
};
// ...in typeOf(): if (EXT_MYCORE.includes(ext)) return 'mycore';
```

If the core still calls `Module.Pointer_stringify`, add a case in
[`web/player/backend_loader.js`](../web/player/backend_loader.js)
`makeAdapter(type)` to invoke `installPointerStringifyShim(...)` on
its module namespace before `new adapterCtor(...)`.

If the catalog layer (e.g. the PocketBase-based
[`ShellCatalogService`](../web/catalog_service.js)) needs to classify
the new format, mirror the `EXT_*` array in
`catalog_service.js#EXTENSIONS` so the same backend type is resolved
when matching filenames to backends.

### 4. Update the build/verify scripts

Both of these must list every runtime file your new backend emits:

- `requiredRuntimeFiles` in
  [`tools/prepare-web-assets.mjs`](../tools/prepare-web-assets.mjs)
- `required` in
  [`tools/verify-build-output.mjs`](../tools/verify-build-output.mjs)

The CI workflow (`.github/workflows/ci.yml`) runs `npm run verify:dist`
after `npm run build`, so a missing entry will break the pipeline.

### Porting checklist (from-scratch port, not just adding a parallel core)

These are the differences from the original 2023-era
`makeEmscripten.bat` builds that tend to bite when porting with a
current emsdk:

- **Translate flags literally first.** Copy the include dirs
  (`-I…`), defines (`-D…`), and the `EXPORTED_FUNCTIONS` list
  verbatim from the core's `makeEmscripten.bat`. That file is the
  source of truth.
- **Modernize the emitted flags.** Drop `--closure 1`,
  `--llvm-lto`, `--memory-init-file`, and the `BINARYEN_*` options.
  Use `EXPORTED_RUNTIME_METHODS` (not the old
  `EXTRA_EXPORTED_RUNTIME_METHODS`).
- **Define `EMSCRIPTEN` yourself** if the core needs it (§6).
- **Export enough runtime methods** (§6) or the adapter will crash.
- **`Pointer_stringify` shim** (§6) — extend
  `backend_loader.js#makeAdapter` if your adapter needs it.
- **Stage dependency files.** If a format references sidecar files
  (PSF's `.psflib`, USF's `.usflib`), stage them next to the main
  file so the runtime file mapper can resolve them without a 404.

## 9. Pure-JS backends

`xa`, `genh`, and `mp3` are not built by CMake. They are plain
JavaScript modules that live in `web/` and are copied into
`build/web-public/wasm/` as-is by `tools/prepare-web-assets.mjs`. To
add another pure-JS backend:

1. Drop the file at `web/backend_<key>.js` and make sure it attaches a
   `<Key>BackendAdapter` constructor to a stable runtime namespace
   (typically `globalThis.runtime` or the `backend_*` IIFE for the
   compiled cores).
2. Add the file name to `requiredRuntimeFiles` in
   `tools/prepare-web-assets.mjs` and the corresponding `required`
   entry in `tools/verify-build-output.mjs`.
3. Add an `EXT_<KEY>` array, a `BACKEND_SCRIPT_BY_TYPE` entry, and a
   `typeOf()` case in `web/player/backend_catalog.js`.
4. If `ShellCatalogService` needs to know about the new extensions
   for filename → backend mapping, mirror the entry in
   `web/catalog_service.js#EXTENSIONS`.
