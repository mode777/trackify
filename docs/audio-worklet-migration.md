# AudioWorklet "inside-worklet" migration — specification & roadmap

> Status: design proposal
> Target codebase: Trackify
> Author: based on the analysis thread that produced this document

This document specifies a migration of Trackify's audio pipeline from the
deprecated `ScriptProcessorNode` to `AudioWorkletNode`, using the
"all-in-worklet" strategy: the entire hot path (Emscripten WASM module,
backend adapter, `OutputTransformer`, sample generation) runs inside an
`AudioWorkletGlobalScope` and is not split. The main thread keeps a thin
proxy that exposes the same `globalThis.ScriptNodePlayer` surface that the
existing `web/player/*.js` modules already call.

The MP3 backend is intentionally excluded from the worklet; it continues to
use `HTMLAudioElement` + `createMediaElementSource` (see
`web/backend_mp3.js:21`) and participates in the new pipeline as a special
case handled on the main thread.

---

## 1. Goals and non-goals

### 1.1 Goals

- G1. Remove `createScriptProcessor` calls from the hot path. The only two
  call sites today are `submodules/webaudio-player/src/impl/ScriptNodeBackendAdapter.js:49`
  and `:76`. After the migration they are gone.
- G2. Keep the per-backend adapter code unchanged. The five WASM adapter
  files in `submodules/<core>/emscripten/*_adapter.js` and
  `patches/<core>/emscripten/*_adapter.js`, plus the three pure-JS
  adapters in `web/backend_{xa,genh}.js`, must continue to work as
  written. They subclass `ScriptNodeBackendAdapter` (or
  `EmsHEAP16BackendAdapter`) and call into their captured `Module` — that
  contract must not change.
- G3. Keep the public `ScriptNodePlayer` API stable. `web/player/*.js`
  modules call into `globalThis.ScriptNodePlayer.{initialize,
  loadMusicFromURL, play, pause, isPaused, getPlaybackPosition,
  getMaxPlaybackPosition, seekPlaybackPosition, setVolume, getVolume,
  getInstance, getWebAudioContext, getWebAudioSampleRate}`. None of
  those call sites should change.
- G4. Keep the `silent <audio>` anchor. It exists because Chrome keeps a
  `MediaSession` alive only while an `HTMLMediaElement` is playing/paused
  (see `web/player/media_session_anchor.js:1-11`); AudioWorklet output
  is still Web Audio output, so the anchor is still required. The MP3
  backend, which already uses an `HTMLAudioElement`, remains anchor-free
  as today.
- G5. Stage the migration so that the existing ScriptProcessor pipeline
  can ship side-by-side with the new one for the duration of the
  transition, behind a feature flag. Falling back to ScriptProcessor if
  AudioWorklet misbehaves in a given browser must be possible without a
  redeploy of the wasm artifacts.
- G6. Eliminate the N64 "big buffer" hack. `setProcessorBufSize(0x4000)`
  at `submodules/webn64/emscripten/n64_adapter.js:34` exists only to
  amortise the cost of slow emulators across a 16384-sample ScriptProcessor
  buffer. The worklet's 128-sample quantum makes it unnecessary.

### 1.2 Non-goals

- N1. The deprecated browser warning goes away, but we are not optimising
  for end-to-end CPU usage. AudioWorklet removes main-thread contention,
  not per-sample work.
- N2. We are not splitting `OutputTransformer.js`. It runs in full inside
  the worklet.
- N3. We are not migrating to a non-Emscripten build of the cores. The
  cores stay as `.wasm` blobs produced by the existing CMake pipeline.
- N4. We are not adding new backends.
- N5. The `channelstreamer.js` add-on (the visualizer ticker) is not
  ported. Trackify does not load it today (no reference in `web/`);
  if it is ever needed, the ticker can be re-introduced later as its
  own `AudioWorkletProcessor` that subscribes to the same `MessageChannel`
  as the proxy.

---

## 2. Architectural decision: new player backend, no submodule fork

The worklet strategy needs a piece of code that:

1. Lives on the main thread and exposes `globalThis.ScriptNodePlayer`
   with the legacy API (so `web/player/transport.js` is unchanged).
2. Lives on the worklet side and owns the Emscripten module instance,
   the backend adapter instance, and the `OutputTransformer`.
3. Wires those two together via a `MessageChannel` so that main-thread
   API calls forward to the worklet, and the worklet can post back
   position/state changes.

There are two places this code could live:

- **Option A — fork `submodules/webaudio-player`** into a
  `webaudio-player-worklet` variant that ships its own
  `WorkletBackendAdapter`, modified `ScriptNodePlayer.js`, etc. Per
  `AGENTS.md` and the `patches/` convention we don't currently modify
  submodule contents; carrying a fork means a permanent maintenance
  burden, and pulling upstream changes becomes a manual merge.
- **Option B — keep the submodule as a ScriptProcessor fallback and
  add a new player backend** that sits next to it. The new backend
  ships as part of Trackify's own code (under `web/player/worklet_player/`
  or similar), is bundled by the existing CMake + Vite pipeline into
  `build/web-public/wasm/`, and is loaded by `web/player.html` in
  addition to (or instead of) `scriptprocessor_player.js`. The
  per-backend adapter code is reused by virtue of being loaded inside
  the worklet's global scope.

**Decision: Option B.** A new player backend, no submodule fork.

Rationale:

- The submodule is upstream-maintained and the author's own comments
  (`submodules/webaudio-player/src/ScriptNodePlayer.js:25-31`, `:588-594`)
  indicate the upstream maintainer has no plans to finish the worklet
  story. We would be the sole maintainer of a fork.
- The "all-in-worklet" property — the entire hot path runs in the
  worklet realm — lets us reuse the existing per-backend adapter code
  with zero changes, including the `patches/*/emscripten/*_adapter.js`
  files. We get the upstream-friendliness we want by not forking.
- The fallback is real: `scriptprocessor_player.js` can stay in the
  build for the entire migration. A feature flag selects which one
  runs, which makes regressions in the new backend survivable in
  production.
- The new code lives next to the rest of Trackify's first-party
  modules and follows the same review / test conventions
  (see `AGENTS.md` "Conventions worth knowing").

---

## 3. Architecture overview

```
                              main thread
                       ┌────────────────────────────────────┐
                       │ web/player.html                    │
                       │   <script src="wasm/wp_player.js"> │  (proxy, replaces
                       │   <script src="wasm/wp_worklet.js"> │   scriptprocessor_player.js
                       │   <script src="wasm/wp_mp3.js">     │   as the runtime entry)
                       │   <script src="wasm/backend_*.js">  │
                       │   <script type="module"             │
                       │           src="/player.js">          │
                       └──────────────┬─────────────────────┘
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            │                                                   │
   globalThis.ScriptNodePlayer                       audioCtx (main)
   (proxy implementation,                        AudioWorkletNode ──┐
    API identical to v1.3.11)                                  │    │
   ┌───────────────────────┐                                   │    │
   │  initialize(adapter)  │── port.postMessage ─────┐         │    │
   │  loadMusicFromURL()   │                        │         │    │
   │  play / pause         │                        │         │    │
   │  getPlaybackPosition()│◀── port.onmessage ─────┤         │    │
   │  seekPlaybackPosition │                        │         │    │
   │  setVolume / getVolume│                        │         │    │
   │  isPaused             │                        │         │    │
   └───────────────────────┘                        │         │    │
                                                    │         │    │
                            ┌───────────────────────┴───┐     │    │
                            │  MessageChannel           │     │    │
                            └───────────────────────┬───┘     │    │
                                                    │         │    │
              worklet global scope                  │         │    │
   ┌────────────────────────────────────────────────┴───┐     │    │
   │  AudioWorkletGlobalScope                            │     │    │
   │                                                    │     │    │
   │  WpWorkletProcessor                                │     │    │
   │   ├─ receives one backend_<x>.js script text via   │     │    │
   │   │  port (or, alternatively, fetch() from the      │     │    │
   │   │  worklet)                                       │     │    │
   │   ├─ on startup:                                   │     │    │
   │   │   WebAssembly.instantiate(wasmBytes, imports)  │     │    │
   │   │   → worklet-local backend_Xxx.Module           │     │    │
   │   │   new XxxBackendAdapter()                      │     │    │
   │   │   new OutputTransformer(adapter)               │     │    │
   │   ├─ on message { cmd: 'loadFile', name, data }:   │     │    │
   │   │   Module.FS_createDataFile(...)                │     │    │
   │   ├─ on message { cmd: 'play' | 'pause' |         │     │    │
   │   │   'seek' | 'setVolume' | ... }:                │     │    │
   │   │   mutates adapter / transformer state          │     │    │
   │   ├─ on each audio frame (process()):              │     │    │
   │   │   transformer.genSamples(outputs[0])           │◀────┴────┘
   │   │   posts { 'position', 'isPaused', ... }        │──┐
   │   └─ on 'ended' / 'error':                         │  │
   │      posts { 'trackEnd' }                          │  │
   └────────────────────────────────────────────────────┘  │
                                                             │
   ┌─────────────────────────────────────────────────────────┴────────┐
   │  GainNode (main) → AudioContext.destination                      │
   └──────────────────────────────────────────────────────────────────┘
```

**MP3 exception:** the existing `Mp3BackendAdapter` keeps its
`createMediaElementSource(audioEl)` path. It registers as a
`WpWorkletProcessor` of a special kind, but the actual audio is
produced by an `HTMLAudioElement` on the main thread. The proxy
exposes it through the same `ScriptNodePlayer` API so the rest of the
UI doesn't notice. (This is the only per-backend path that does not
move to the worklet.)

---

## 4. Component design

### 4.1 `wp_player.js` — main-thread proxy

Lives in `web/player/worklet_player/wp_player.js`. Bundled by CMake
into `build/web-public/wasm/wp_player.js`. Loaded by `web/player.html`
via `<script src="/wasm/wp_player.js">` (replacing
`/wasm/scriptprocessor_player.js`).

Exposes `globalThis.ScriptNodePlayer` with the same surface as the
existing module (cross-checked against
`submodules/webaudio-player/src/ScriptNodePlayer.js:1419-1611`). The
implementation:

- Holds a `MessageChannel` whose `port1` is sent into the worklet at
  audio-context-init time.
- Holds a per-instance state object: `{ adapter, options, lastVolume,
  sampleRate, isPaused, currentBuffer, ... }`. The state on the main
  side mirrors what the upstream `PlayerImpl` keeps today, except
  the audio graph lives in the worklet.
- `getInstance()` returns the proxy singleton.
- `initialize(adapter, onTrackEnd, requiredFiles, spectrumEnabled, flag)`
  is the entry point used by `web/player/transport.js:234` via
  `web/player/player_host.js:18-20`. It:
  1. Stops any existing pipeline (analogous to the cleanup at
     `submodules/webaudio-player/src/ScriptNodePlayer.js:1436-1454`).
  2. Asks the audio context to load the worklet module
     (`audioCtx.audioWorklet.addModule('/wasm/wp_worklet.js')`).
  3. Creates an `AudioWorkletNode` parameterised by backend type.
  4. Sends `{ cmd: 'init', adapterKind, sampleRate, ... }` over the
     port and awaits the ready reply.
  5. Resolves the Promise (so `await initialize(...)` in
     `web/player/transport.js:234` behaves the same as today).
- `loadMusicFromURL(url, options)` posts
  `{ cmd: 'loadFromURL', url, options }` and awaits
  `{ status: 'trackReadyToPlay', file }`. The proxy-side main thread
  does the XHR (it has `fetch`/`XMLHttpRequest`), sends the
  `ArrayBuffer` to the worklet, the worklet registers it in MEMFS via
  `FS_createDataFile`, and runs `emu_load_file`.
- `play()` / `pause()` / `seekPlaybackPosition(ms)` /
  `setVolume(v)` / `getVolume()` are 1-line postMessage wrappers,
  with the proxy caching the values it has just sent for cheap
  reads.
- `getPlaybackPosition()` and `getMaxPlaybackPosition()` are read
  requests: the proxy posts a `getPosition` command and awaits a
  reply. The 250 ms seek-polling loop in
  `web/player/seek_ui.js:161` is unaffected. One postMessage
  round-trip per poll is sub-millisecond on every supported
  browser.
- `isPaused()` reads a cached value updated by the most recent
  `play`/`pause` reply (the existing code already assumes the
  player instance is the source of truth, see
  `web/player/media_session_sync.js:107`).

The proxy does **not** rebuild `globalThis.ScriptNodePlayer` from
scratch — it implements the same function set the legacy version
exposes, and the only observable change for the rest of the code is
that the audio now goes through an `AudioWorkletNode` instead of a
`ScriptProcessorNode`.

### 4.2 `wp_worklet.js` — worklet processor module

Lives in `web/player/worklet_player/wp_worklet.js`. Bundled to
`build/web-public/wasm/wp_worklet.js`. Loaded by the audio context
via `audioCtx.audioWorklet.addModule(...)` exactly once per
`AudioContext`.

The file is a single `AudioWorkletProcessor` subclass per backend
family plus a common base. There is no AudioWorkletGlobalScope
version of `ScriptNodePlayer`; the worklet processor is the
destination of every command and is the source of every event.

#### 4.2.1 The processor base class

```text
class WpWorkletProcessor extends AudioWorkletProcessor {
    // received via port.onmessage:
    //   { cmd: 'init',         sampleRate, channels }
    //   { cmd: 'loadFromURL',  url, options }   // main thread will follow up with loadFile
    //   { cmd: 'loadFile',     virtualName, data: ArrayBuffer }
    //   { cmd: 'play' } { cmd: 'pause' } { cmd: 'seek', ms }
    //   { cmd: 'setVolume', value }
    //   { cmd: 'getPosition' }  // replies with { position, maxPosition }
    //
    // posted via port.postMessage:
    //   { kind: 'ready' }                       // after addModule + init
    //   { kind: 'trackReadyToPlay', file }
    //   { kind: 'trackEnd' }
    //   { kind: 'error', message }
    //   { kind: 'position', position, maxPosition }
    //
    // process(inputs, outputs, parameters):
    //   if (this._paused || !this._songReady) fill outputs[0] with 0
    //   else this._transformer.genSamples(outputs[0])   // genSamples now
    //                                                   // takes an
    //                                                   // AudioWorkletNode
    //                                                   // -shaped target
    //                                                   // instead of an
    //                                                   // AudioProcessingEvent
    //   update this._currentPlaytime
    //   return true
}
```

The trick that keeps `OutputTransformer.js` un-split:

`OutputTransformer.genSamples` currently takes an
`AudioProcessingEvent` and reads `e.outputBuffer.numberOfChannels`
and `e.outputBuffer.getChannelData(0/1)`. The worklet gives us
`outputs[0]` whose shape is `{ numberOfChannels, getChannelData(i) }`
— identical. A five-line shim in the worklet processor converts the
two:

```text
function eventShim(out) {
    return {
        outputBuffer: {
            numberOfChannels: out.length > 0 ? out[0].length > 0 ? out.length : 0 : 0,
            getChannelData: (i) => out[i],
        },
    };
}
```

and then `this._transformer.genSamples(eventShim(outputs))`. The
`OutputTransformer` itself is not modified.

#### 4.2.2 Per-backend worklet entry point

The worklet processor must be parameterised by backend kind
(`psx`, `snes`, `nez`, `n64`, `vgm`, `xa`, `genh`). The cleanest
split is:

- A small `wp_worklet_common.js` containing the `WpWorkletProcessor`
  base and the per-backend registration
  (`registerProcessor('wp-psx', class extends WpWorkletProcessor {}`).
- A `wp_worklet_psx.js` per backend, which:
  1. fetches the matching `backend_psx.wasm` (using the worklet's
     `fetch`),
  2. fetches `backend_psx.js` *minus* the `window.spp_backend_state_PSX = ...`
     IIFE wrapper — see §4.4,
  3. instantiates the WebAssembly module,
  4. constructs the appropriate `*BackendAdapter` against the
     worklet-local `Module`,
  5. constructs the `OutputTransformer`,
  6. registers the processor with `registerProcessor`.

The seven per-backend worklet files are tiny (a dozen lines each);
they all share the same template.

### 4.3 File routing — `loadFromURL` flow

The legacy `loadMusicFromURL` in
`submodules/webaudio-player/src/ScriptNodePlayer.js:698-770` does an
`XMLHttpRequest` on the main thread, decodes the response to
`Uint8Array`, registers the bytes in the Emscripten MEMFS via
`_loadMusicData`, and then calls `_initIfNeeded` which calls
`emu_load_file`. The same flow works across the worklet boundary:

1. Main proxy: `fetch(url) → ArrayBuffer`.
2. Main proxy: post `{ cmd: 'loadFile', virtualName, data }` to
   the worklet (the `data` field is a transferred `ArrayBuffer`, so
   there is no copy cost).
3. Worklet: `Module.FS_createPath(...)`, `Module.FS_createDataFile(..., data, true, true)`,
   `Module._loadMusicDataBuffer(name, new Uint8Array(data), ...)`,
   or the equivalent depending on backend.
4. Worklet: post `{ kind: 'trackReadyToPlay', file }` back to the
   main proxy. The proxy resolves the `loadMusicFromURL` Promise
   exactly as the legacy code does.

`ScriptNodePlayer._preloadFile` is the same pattern, just a
prefetched variant.

### 4.4 Bootstrap glue adaptation

The two places where shell glue currently references `window`:

- `submodules/webpsx/emscripten/shell-pre.js` (and per-backend siblings):
  sets `window.spp_backend_state_PSX = {...}`.
- `scriptprocessor_player.js`: defines `var ScriptNodePlayer = ...`
  at top level, references `window._gPlayerAudioCtx`,
  `window._fileCache`, etc.

The submodule shell-pre/shell-post files are not used by the new
worklet pipeline at all: the worklet processor instantiates the
Emscripten module directly from the `.wasm` bytes, no IIFE wrapper
required. The window references in those files are ignored.

For the new pipeline's main-thread entry, `wp_player.js`, we write
a brand-new file under `web/player/worklet_player/` and do not touch
`scriptprocessor_player.js`. The two coexist for the duration of
the migration (G5).

If the new worklet pipeline needs `Module.UTF8ToString`,
`Module.HEAP16`, etc., those are exported by the Emscripten build
flag set in `backends/<core>/CMakeLists.txt` (see
`docs/audio-backends.md:122-125`); they work identically inside the
worklet. The `Pointer_stringify` shim currently installed by
`web/player/player_host.js#installPointerStringifyShim` is also
unaffected: the shim is set on the worklet-local `Module` after
instantiation, in the same `backend_loader.js#makeAdapter` flow.

### 4.5 `Mp3BackendAdapter` exception

`Mp3BackendAdapter` (in `web/backend_mp3.js`) is the one backend
that does not move to the worklet. The legacy code path uses
`createMediaElementSource(this._audioEl)` and a 2-channel
`AudioBufferSourceNode`-style flow, with a real `HTMLAudioElement`
that Chrome can see. This is the only format where the
`HTMLAudioElement` doubles as the audio source, and it is the only
format that has its own MediaSession without needing the silent
anchor.

Implementation:

- `wp_player.js` keeps a small switch keyed on the `runtime.Mp3BackendAdapter`
  ctor used in `web/player/backend_loader.js:18`. If the adapter is
  an `Mp3BackendAdapter`, the proxy:
  1. Does **not** create an `AudioWorkletNode`.
  2. Calls the existing `ScriptNodeBackendAdapter` instance method
     `_createProducerNode(audioCtx)` and uses the returned
     `MediaElementAudioSourceNode` to wire the MP3 element into the
     `GainNode` and `AudioContext.destination`.
  3. Re-exposes the same `ScriptNodePlayer` methods, delegating
     `play` / `pause` / `seekPlaybackPosition` /
     `getPlaybackPosition` / `getMaxPlaybackPosition` to the
     `Mp3BackendAdapter` instance methods that already exist
     (`web/backend_mp3.js:77-143`).

The MP3 path is **fully backward compatible**: no change to
`web/backend_mp3.js`. The proxy just special-cases one backend
type. The silent `<audio>` anchor is not used for MP3 either
before or after the migration.

### 4.6 Audio graph

The audio graph on the main thread is unchanged from the current
`ScriptNodePlayer._initByUserGesture` layout (cross-checked against
`submodules/webaudio-player/src/ScriptNodePlayer.js:262-307`):

```text
AudioWorkletNode (or MediaElementAudioSourceNode for MP3)
   → GainNode
        → AudioContext.destination
```

`AudioContext` is still created on the main thread
(`ScriptNodePlayer.getWebAudioContext()` →
`new AudioContext({ latencyHint: 'playback' })`). The
`{ latencyHint: 'playback' }` value is preserved verbatim from the
current code (`submodules/webaudio-player/src/ScriptNodePlayer.js:1383`).

---

## 5. Adoption analysis

For every place in the repository that the migration touches, this
section records the impact, the resulting change, and the work
package that owns it.

### 5.1 First-party code (Trackify, owned)

| File | Status | Change |
| --- | --- | --- |
| `web/player.html` | Modified | Load `/wasm/wp_player.js` instead of `/wasm/scriptprocessor_player.js`. A feature flag controlled by URL query (e.g. `?wp=0`) loads the legacy bundle for the duration of the rollout (G5). |
| `web/player/player_host.js` | No change | Already a thin wrapper around `globalThis.ScriptNodePlayer` (lines 14-23). The new proxy preserves the API. |
| `web/player/transport.js` | No change | All entry points are `getPlayer()`, `initialize()`, `loadMusicFromURL()` — preserved. |
| `web/player/seek_ui.js` | No change | Polls `getPlaybackPosition()` / `getMaxPlaybackPosition()` — preserved. |
| `web/player/volume_ui.js` | No change | `setVolume()` / `getVolume()` — preserved. |
| `web/player/media_session_sync.js` | No change | Uses `isPaused()`, `getPlaybackPosition()` — preserved. |
| `web/player/media_session_anchor.js` | No change | Still required for the seven non-MP3 backends. |
| `web/player/backend_loader.js` | Modified (small) | The `mp3` branch must, after constructing the adapter, hand it to the proxy and ensure the proxy routes the MP3 case through the main-thread path (§4.5). All other branches unchanged. |
| `web/player/backend_catalog.js` | No change | Extension→backend map is unaffected. |
| `web/backend_xa.js` | No change | Subclasses `ScriptNodeBackendAdapter`; the new proxy handles the worklet instantiation. |
| `web/backend_genh.js` | No change | Same as `web/backend_xa.js`. |
| `web/backend_mp3.js` | No change | Special-cased by the proxy; legacy code path preserved. |
| `web/app.js` | No change | Shell does not know about audio internals. |
| `web/main.js` | No change | Same. |
| `web/broker.js` | No change | Communication layer, not audio. |

### 5.2 Submodule / patch code (upstream, to be left alone)

| File | Status | Change |
| --- | --- | --- |
| `submodules/webaudio-player/scriptprocessor_player.js` | No change | Kept as the fallback runtime. Loaded only when the feature flag is off. |
| `submodules/webaudio-player/src/impl/ScriptNodeBackendAdapter.js` | No change | The new code path does not extend this; it is only kept around for the fallback. |
| `submodules/webpsx/emscripten/psx_adapter.js` | No change | Used by the new worklet pipeline as-is (it subclasses `EmsHEAP16BackendAdapter` and operates on the worklet-local `Module`). |
| `submodules/websnes/emscripten/snes_adapter.js` | No change | Same. |
| `submodules/webnez/emscripten/nez_adapter.js` | No change | Same. |
| `submodules/webn64/emscripten/n64_adapter.js` | No change (G6: the 0x4000 buffer hack becomes unnecessary but the code is harmless — the buffer size is simply ignored by the worklet) | |
| `patches/vgmplay-0.40.9/emscripten/vgm_adapter.js` | No change | Same. |
| `patches/webn64/emscripten/n64_adapter.js` | No change | Same. |
| `patches/webpsx/emscripten/heplug.c` | No change | C source, compile-time only. |
| `patches/vgmplay-0.40.9/emscripten/{Adapter.cpp,vgm_adapter.js,vgminterface.h}` | No change | Same. |
| `patches/webn64/emscripten/n64plug.cpp` | No change | Same. |

### 5.3 Build / tooling

| File | Status | Change |
| --- | --- | --- |
| `package.json` | Modified | New npm script(s) if needed for the worklet asset bundling. |
| `tools/prepare-web-assets.mjs` | Modified | `requiredRuntimeFiles` extended with `wp_player.js`, `wp_worklet.js`, `wp_worklet_*.js`, plus the per-backend `worklet_*.js` companions. |
| `tools/verify-build-output.mjs` | Modified | `required` extended with the new files (CI runs this after `npm run build`, see `docs/audio-backends.md:282-284`). |
| `CMakeLists.txt` (root) | Modified | Adds a target for the worklet JS bundle assembly. |
| `cmake/concat.cmake` | Modified (or: not modified — see WP-A) | The new files are produced by an additional CMake custom command that concatenates the per-backend worklet templates. |
| `Dockerfile` | No change | Picks up `build/dist`; the new files in `wasm/` come along automatically. |

### 5.4 Documentation

| File | Status | Change |
| --- | --- | --- |
| `docs/audio-backends.md` | Modified | New section explaining the worklet pipeline, the feature flag, the MP3 exception, and the worklet file list. |
| `README.md` | Possibly modified | If the high-level architecture diagram mentions `ScriptProcessorNode` explicitly, update it. |
| `AGENTS.md` | Modified | Note the new directory `web/player/worklet_player/`, the new wasm artifacts, and the new feature flag. |
| `ui.md` | No change | The iframe broker contract is independent of the audio pipeline. |

---

## 6. File-by-file change list (delta from today)

**New files**

- `web/player/worklet_player/wp_player.js` — main-thread proxy.
- `web/player/worklet_player/wp_worklet.js` — common worklet base
  (`WpWorkletProcessor`).
- `web/player/worklet_player/wp_worklet_psx.js` — per-backend
  worklet entry. One file per WASM backend and per pure-JS backend
  that moves to the worklet (seven total: psx, snes, nez, n64, vgm,
  xa, genh).
- `web/player/worklet_player/event_shim.js` — the five-line shim
  that turns `outputs[0]` into an `AudioProcessingEvent`-shaped
  object so `OutputTransformer.genSamples` runs unchanged.
- `web/player/worklet_player/message_protocol.js` — shared message
  type definitions / zod-ish validators (no real schema lib needed —
  a tiny `isInit`, `isLoadFile`, etc., helper module is enough).
- `web/player/worklet_player/feature_flag.js` — small helper that
  reads `?wp=0` from the URL and exposes `useWorkletPlayer()`.

**Modified files**

- `web/player.html` — swap `<script src="/wasm/scriptprocessor_player.js">`
  for a conditional based on `useWorkletPlayer()`. In default
  configuration load `/wasm/wp_player.js`; in fallback configuration
  load `/wasm/scriptprocessor_player.js`.
- `web/player/backend_loader.js` — when the constructed adapter is
  an `Mp3BackendAdapter`, ensure the proxy is informed so it can
  switch to the main-thread audio path.
- `tools/prepare-web-assets.mjs` — extend `requiredRuntimeFiles`.
- `tools/verify-build-output.mjs` — extend `required`.
- `CMakeLists.txt` (root) — add a new build target for the
  worklet JS bundle.
- `docs/audio-backends.md` — new section.
- `AGENTS.md` — note the new directory and the new wasm artifacts.
- `package.json` — possibly add a `prepare:worklet` script that
  assembles the worklet files (or fold into `assets:prepare`).

**Unmodified files** (everything else).

---

## 7. Build pipeline changes

Today the build chain produces `build/wasm/scriptprocessor_player.js`
plus `backend_*.js` files and a few pure-JS backends. See
`docs/audio-backends.md:88-108` and `AGENTS.md:46-58` for the
existing layout.

The new files (`wp_player.js`, `wp_worklet.js`,
`wp_worklet_<backend>.js`) need to land in `build/wasm/` the same
way the existing wasm artifacts do. Two viable strategies:

- **WP-A: keep concatenation.** The worklet JS files are plain JS,
  they do not need to be minified or processed. CMake concatenates
  them in the right order, mirroring what `build.bat` does upstream
  (see `submodules/webaudio-player/build.bat`). This keeps the
  build chain tool-agnostic.
- **WP-B: bundle with Vite.** Move the worklet JS files into
  `web/` and let Vite handle the bundling. This is more
  ergonomic but means the worklet files get a hash in their name
  and must be looked up dynamically from `wp_player.js` (which
  knows its own URL).

The recommended option is **WP-A** because the worklet files are
intentionally side-effecty (each one calls `registerProcessor`) and
need a deterministic, easily-debugged order. Vite's bundler can be
tricky with side-effecty entry points.

**`tools/prepare-web-assets.mjs`** gets a new entry
`requiredRuntimeFiles.push('wp_player.js', 'wp_worklet.js',
'wp_worklet_psx.js', 'wp_worklet_snes.js', 'wp_worklet_nez.js',
'wp_worklet_n64.js', 'wp_worklet_vgm.js', 'wp_worklet_xa.js',
'wp_worklet_genh.js')`. `tools/verify-build-output.mjs#required` is
mirrored.

The two lists must be kept in sync. Per
`docs/audio-backends.md:37-44`, this is already a CI-breaking
invariant; the new files just join the list.

**`docs/audio-backends.md`** gets a new section "## 10. AudioWorklet
pipeline" with the diagram from §3, the message protocol, and the
file list.

---

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `AudioWorkletGlobalScope` lacks some API the backend expects (e.g. `console.group`, `performance.now` sub-ms precision) | Low | Low | All Trackify backends only use what Emscripten itself uses, which is portable. The first spike validates this empirically. |
| `Module._malloc` / `Module.HEAP16` work but Module's MEMFS cannot be filled by postMessage'd `ArrayBuffer`s | Low | Medium | `FS_createDataFile` accepts an `ArrayBuffer` since Emscripten 3.x. If it does not, the worklet does the fetch directly using `fetch()` and the legacy XHR path is no longer needed. |
| Sub-second round-trip latency for `getPlaybackPosition` is too high for the 250 ms seek poll | Very low | Low | One postMessage round-trip is sub-millisecond on every evergreen browser. We measure it in the first spike. |
| N64 emulation's "long audioprocess" warnings get worse, not better, on the worklet | Low | Medium | The worklet's audio thread is isolated from the main thread, so the only thing that matters is per-frame CPU. The 0x4000 buffer hack was there because the *main* thread was blocking; the worklet removes that blocker. If perf is still bad, the spike shows the actual numbers. |
| Side-by-side `scriptprocessor_player.js` + `wp_player.js` doubles the wasm artifact size | Low | Low | The legacy bundle can be dropped from the build once the new pipeline is stable in production; it is not bundled by default. |
| Browser autoplay policy still requires a user gesture for the worklet processor to start | Low | High | Documented and identical to the current behaviour. The first user gesture (clicking play) triggers the `AudioContext.resume()` and `audioWorklet.addModule` chain. |
| Cross-origin isolation (COOP/COEP) becomes required for `SharedArrayBuffer` | Very low | High | The "all-in-worklet" design does not require `SharedArrayBuffer`. If a future feature ever needs it, headers are added at the PocketBase / nginx level. |
| A future Chromium change to WebAudio ↔ MediaSession makes the silent anchor unnecessary | Very low | Low | When that happens we can drop the anchor in a one-line PR. The worklet migration is independent. |
| `Mp3BackendAdapter` regression (e.g. `createMediaElementSource` misbehaves) | Low | Medium | The MP3 path is preserved verbatim, and the worklet pipeline is opt-in. The fallback flag flips the entire stack back to the legacy code. |

---

## 9. Migration strategy / rollout

The migration is staged so that no behavioural change ships without
a kill switch:

1. **WP-1: spike.** A two-day prototype that wires up one backend
   (NEZ — smallest, no extra file dependencies) end-to-end.
   Validates the message protocol and the event-shim approach.
2. **WP-2: full backend coverage.** Once the spike passes,
   generalise to all seven backends and add the proxy. The
   `?wp=0` feature flag is in place.
3. **WP-3: shadow.** For one release, ship the worklet bundle in
   the build but keep `useWorkletPlayer()` defaulting to `false`
   (`?wp=0` is the default). Manually opt-in via the URL on a
   staging environment; verify behaviour on the seven backends.
4. **WP-4: rollout.** Flip the default to `true`. Keep the legacy
   `scriptprocessor_player.js` in the build but no longer loaded
   by default. Monitor for regressions.
5. **WP-5: cleanup.** Remove `scriptprocessor_player.js` and the
   `?wp=0` fallback. Delete the feature flag.

The silent anchor is preserved throughout.

---

## 10. Work packages and milestones

### WP-0 — preflight (no code)

- Read the spike plan in §11, agree on it.
- Decide the file split between `web/player/worklet_player/`
  (this document's proposal) and an alternative layout.
- Decide the feature-flag mechanism (`?wp=0` query vs. a
  build-time constant). The query flag is more flexible for
  staging; the build-time constant is more secure.

**Milestone M0**: agreement on §11 and on the three decisions
above.

### WP-A — build infrastructure

- Add `wp_player.js`, `wp_worklet.js`, `wp_worklet_<backend>.js`
  skeleton files (each is a 5-line stub for now) under
  `web/player/worklet_player/`.
- Add a CMake target that concatenates the new files into
  `build/wasm/wp_*.js`. Reuse `cmake/concat.cmake` if possible.
- Update `tools/prepare-web-assets.mjs#requiredRuntimeFiles` and
  `tools/verify-build-output.mjs#required`.
- Add `npm run prepare:worklet` and have `npm run assets:prepare`
  chain it in.
- `npm run verify:dist` passes.

**Milestone M1**: `npm run build` produces the new wasm artifacts
and `npm run verify:dist` is green.

### WP-B — spike (NEZ end-to-end)

See §11 for the spike plan in full.

**Milestone M2**: a user gesture in `player.html` triggers
`AudioContext.resume()` → `audioWorklet.addModule('/wasm/wp_worklet.js')` →
the proxy posts `{ cmd: 'init', kind: 'nez' }` → a `NEZBackendAdapter`
constructs inside the worklet → `loadMusicFromURL('/sample-files/...')`
resolves → `play()` produces audible NEZ audio through the worklet.

### WP-C — full backend coverage

- Add `wp_worklet_psx.js`, `wp_worklet_snes.js`,
  `wp_worklet_n64.js`, `wp_worklet_vgm.js`, `wp_worklet_xa.js`,
  `wp_worklet_genh.js`. Each is a copy of the NEZ template with
  the right `backend` symbol and constructor wired up.
- For PSX, SNES, NEZ, N64, VGM: the worklet fetches the same
  `backend_<x>.js` script that the legacy pipeline loads on the
  main thread, but evaluates it inside the worklet global scope.
  The script body needs to be parseable inside a worklet — that
  means `window` references (in `shell-pre.js`) become
  `globalThis` references. The upstream files do not need to
  change; we ship a tiny shim in `wp_worklet.js` that aliases
  `globalThis.window = globalThis` for the duration of the
  evaluation.
- For XA and GENH: the pure-JS backends are loaded into the
  worklet as text and evaluated the same way.
- The proxy dispatches to the right worklet processor kind
  based on `runtime.Mp3BackendAdapter` vs. anything else.

**Milestone M3**: a single user gesture plays a track from each
of the seven backends end-to-end. The 250 ms seek poll shows
non-zero positions. Volume slider works. Pause/resume works.

### WP-D — MP3 special case

- Detect `Mp3BackendAdapter` in `wp_player.js#initialize`.
- Skip worklet instantiation.
- Use the existing `Mp3BackendAdapter._createProducerNode` to get
  the `MediaElementAudioSourceNode`.
- Re-expose the proxy's API, delegating to the existing
  `Mp3BackendAdapter` instance methods (`web/backend_mp3.js:77-143`).
- The proxy's `loadMusicFromURL` for MP3 calls
  `Mp3BackendAdapter.loadMusicData` directly (the MP3 backend
  already implements its own loading in
  `web/backend_mp3.js:44-75`).

**Milestone M4**: MP3 plays through the new proxy. No regressions
vs. the current behaviour.

### WP-E — feature flag & fallback path

- Implement `feature_flag.js#useWorkletPlayer()` (URL query + a
  localStorage override for ops).
- `web/player.html` switches between
  `<script src="/wasm/wp_player.js">` and
  `<script src="/wasm/scriptprocessor_player.js">` accordingly.
- Add a small `console.info` that logs which pipeline is active
  on startup.

**Milestone M5**: `?wp=0` in the URL flips the entire stack to
the legacy pipeline. `?wp=1` (or no flag) uses the new pipeline.
Both play the same NEZ track without artefacts.

### WP-F — feature-flag default flip

- Flip `useWorkletPlayer()` default to `true` in the URL
  resolver.
- Watch production logs for one release.

**Milestone M6**: production traffic runs the worklet pipeline
by default. Legacy `?wp=0` is still available as a kill switch.

### WP-G — legacy removal

- Delete `scriptprocessor_player.js` from the CMake build.
- Delete the `?wp=0` flag.
- Update `docs/audio-backends.md` and `AGENTS.md` to reflect the
  worklet-only world.

**Milestone M7**: only the worklet pipeline ships.

### WP-H — N64 cleanup (G6)

- Remove the `setProcessorBufSize(0x4000)` call from
  `submodules/webn64/emscripten/n64_adapter.js:34`.
- Re-pin via `patches/webn64/emscripten/n64_adapter.js` if the
  upstream file is in `submodules/`.

**Milestone M8**: N64 plays correctly with the default 128-sample
worklet quantum.

---

## 11. Spike specification (WP-B)

A focused two-day spike to validate the design.

### Goal

Play one NEZ track through the AudioWorklet pipeline end-to-end
in a development build.

### Setup

- Pick the smallest NEZ file in `sample-files/` (use
  `tools/generate-sample-index.mjs` output for a list).
- Build with `npm run build`.
- Serve with `npm run pocketbase:serve` (per
  `AGENTS.md:103-105`).

### Tasks

1. Implement `wp_player.js` skeleton: getInstance,
   getWebAudioContext, getWebAudioSampleRate, no-op
   initialize/play/pause that logs.
2. Implement `wp_worklet.js` skeleton: empty
   `AudioWorkletProcessor` that does nothing but logs
   `process()` invocations.
3. Implement `wp_worklet_nez.js`: fetch `backend_nez.js`,
   fetch `backend_nez.wasm`, `WebAssembly.instantiate` inside
   the worklet, construct `NEZBackendAdapter`, construct
   `OutputTransformer`, store on `this._adapter` and
   `this._transformer`.
4. Implement the message protocol:
   `{ cmd: 'init' }`, `{ cmd: 'loadFile', name, data }`,
   `{ cmd: 'play' }`, `{ cmd: 'pause' }`, `{ cmd: 'seek', ms }`.
5. Implement `wp_player.js#initialize(adapter, ...)` so it
   posts `{ cmd: 'init' }` to the worklet and awaits
   `{ kind: 'ready' }`.
6. Implement `wp_player.js#loadMusicFromURL(url, options)` so
   the main thread does the XHR, posts the bytes, and awaits
   `{ kind: 'trackReadyToPlay' }`.
7. Implement `wp_player.js#play` / `#pause` /
   `#seekPlaybackPosition`.
8. Wire up `web/player.html` to load `/wasm/wp_player.js`
   only (legacy `scriptprocessor_player.js` is not loaded for
   the spike; it can come back in WP-E).
9. Click play on a NEZ track. Verify audio is heard.

### Pass criteria

- Audio is heard.
- The 250 ms seek poll in `web/player/seek_ui.js:161` shows
  monotonically increasing position values.
- Pause stops the audio. Play resumes from the same position.
- Volume slider works.
- The "Lua not supported" warnings in `web/player/seek_ui.js`
  (if any) are not regressions vs. the legacy build.
- No exceptions in the DevTools console.
- `process()` runs at 44100/128 ≈ 344 Hz (the audio thread
  quantum), confirmed by a temporary `console.log` in the
  worklet.

### Fail criteria

- `process()` is called but `this._transformer.genSamples(...)`
  produces silence.
- `Module.HEAP16` is empty inside the worklet (indicates the
  wrong memory was passed).
- `FS_createDataFile` throws on the posted `ArrayBuffer`
  (indicates the data was not transferred correctly).
- Round-trip latency for `getPlaybackPosition` exceeds 5 ms
  (indicates the message-channel design is too slow for the
  250 ms polling).

A failed spike sends us back to the drawing board on §4.2.1
specifically — most likely the worklet-side `Module`
instantiation or the `Module._malloc` /
`FS_createDataDataFile` interaction. The proxy and the message
protocol are not the risk.

---

## 12. Open questions

These are the questions that need answers before WP-A starts.

1. **Feature flag mechanism.** URL query (`?wp=0`) vs. build-time
   constant vs. localStorage. Recommendation: URL query plus a
   localStorage override.
2. **Cross-backend file size impact.** The seven per-backend
   worklet files are tiny. The shared `wp_player.js` and
   `wp_worklet.js` are larger but not unreasonable. Confirm by
   measuring after WP-A.
3. **Probe latency budget for the seek poll.** 250 ms polling
   gives 250x the headroom we need; a sub-millisecond
   postMessage round-trip is fine. Still, the spike should
   measure it.
4. **Worker fallback.** Some browsers (older Safari) do not
   implement `AudioWorkletNode`. The fallback is
   `ScriptProcessorNode` (the legacy pipeline). The feature flag
   can detect `typeof AudioWorkletNode === 'undefined'` and
   default to the legacy path even when `?wp=1` is requested.
5. **Per-backend worklet caching.** If a user plays PSX then
   SNES, do we instantiate a new worklet processor for SNES or
   reuse the existing context? Recommendation: one worklet
   module (`wp_worklet.js`) loaded once; per-backend processors
   are constructed on demand inside the worklet global scope.
6. **MP3 / future HTMLAudioElement-using backends.** If we ever
   add a second HTMLAudioElement backend, the proxy's MP3
   special-case becomes a "HTMLMediaElement-using" branch that
   takes the same code path. No change needed today.

---

## 13. References

- Existing `ScriptNodePlayer` source:
  `submodules/webaudio-player/src/ScriptNodePlayer.js`
- `ScriptNodeBackendAdapter` (only place that calls
  `createScriptProcessor`):
  `submodules/webaudio-player/src/impl/ScriptNodeBackendAdapter.js:49,76`
- `OutputTransformer` (will run un-split inside the worklet):
  `submodules/webaudio-player/src/impl/OutputTransformer.js`
- Trackify transport (public API to preserve):
  `web/player/transport.js:189-262`
- Trackify `ScriptNodePlayer` wrapper:
  `web/player/player_host.js:14-23`
- Trackify silent anchor (must remain):
  `web/player/media_session_anchor.js`
- Backend build / artifact contract:
  `docs/audio-backends.md`
- Emscripten gotchas (apply unchanged inside the worklet):
  `docs/audio-backends.md:109-138`
