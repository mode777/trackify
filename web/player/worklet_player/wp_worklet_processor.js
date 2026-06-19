/*
 * Trackify AudioWorklet processor base + per-backend entry points.
 *
 * The processor is a thin wrapper around the per-backend adapter and
 * the legacy `OutputTransformer`. The `process()` callback is a 5-line
 * shim that turns the worklet's `outputs[0]` array into the
 * `AudioProcessingEvent`-shaped object the transformer expects.
 *
 * The processor owns a `MessagePort` (the AudioWorkletNode's `port`)
 * and speaks the small command set documented in
 * `docs/audio-worklet-migration.md` §4.2.1.
 */
'use strict';

const WP_PROCESSOR_KIND_WASM = 'wasm';
const WP_PROCESSOR_KIND_PURE_JS = 'pure-js';

function wpEventShim(outputs) {
    const channelArrays = (outputs && outputs[0]) || [];
    return {
        outputBuffer: {
            numberOfChannels: channelArrays.length,
            getChannelData: (i) => channelArrays[i],
        },
    };
}

function wpFillSilence(outputs) {
    const channelArrays = (outputs && outputs[0]) || [];
    for (let i = 0; i < channelArrays.length; i++) {
        channelArrays[i].fill(0);
    }
}

class WpFileCache {
    constructor() {
        this._files = new Map();
    }

    has(name) {
        return this._files.has(name);
    }

    get(name) {
        return this._files.get(name);
    }

    set(name, data) {
        this._files.set(name, data);
    }

    clear() {
        this._files.clear();
    }
}

class WpWorkletProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const opts = (options && options.processorOptions) || {};
        this._kind = opts.kind || '';
        this._sampleRate = (typeof globalThis.sampleRate === 'number' && globalThis.sampleRate > 0)
            ? globalThis.sampleRate
            : 44100;
        this._adapter = null;
        this._transformer = null;
        this._paused = true;
        this._songReady = false;
        this._lastVolume = 0.8;
        this._fileCache = new WpFileCache();
        this._pendingTrackResolve = null;
        this._pendingTrackReject = null;
        this._pendingPositionResolve = null;
        this._pendingPositionRequest = null;
        this._lastSentIsPaused = null;
        this._isFirstProcessCall = true;
        this._volumeNode = null;

        this._playerShim = new WpPlayerShim(this);
        wpCurrentPlayerShim = this._playerShim;

        this.port.onmessage = (event) => this._onMessage(event.data);

        this._postReady();
    }

    _postReady() {
        try {
            this.port.postMessage({ kind: 'ready', kindId: this._kind });
        } catch (_error) {
            // Port may not be open yet during construction; the main thread
            // will retry via the `ready` round-trip on first interaction.
        }
    }

    _onMessage(message) {
        if (!message || typeof message !== 'object') return;
        switch (message.cmd) {
            case 'init':
                this._handleInit(message);
                break;
            case 'loadFile':
                this._handleLoadFile(message);
                break;
            case 'play':
                this._handlePlay();
                break;
            case 'pause':
                this._handlePause();
                break;
            case 'seek':
                this._handleSeek(message);
                break;
            case 'setVolume':
                this._handleSetVolume(message);
                break;
            case 'getPosition':
                this._handleGetPosition();
                break;
            case 'loadAuxFile':
                this._handleLoadAuxFile(message);
                break;
            case 'teardown':
                this._handleTeardown();
                break;
            default:
                // Unknown commands are ignored.
                break;
        }
    }

    _handleInit(_message) {
        // Subclasses may override to do backend-specific init. The base
        // class only resets the player shim state.
        this._playerShim._isPaused = true;
        this._playerShim._isSongReady = false;
        this._playerShim._isWaitingForFileState = false;
    }

    _handleLoadFile(message) {
        if (!this._adapter || typeof this._adapter.loadMusicData !== 'function') {
            this._postError('Adapter not initialized');
            return;
        }
        const virtualName = String(message.virtualName || '');
        const data = message.data;
        if (!virtualName || !data) {
            this._postError('loadFile: missing virtualName or data');
            return;
        }

        // Cache the bytes for later sub-file requests.
        this._fileCache.set(virtualName, data);

        try {
            this._installInMemFs(virtualName, data);
        } catch (err) {
            this._postError('Failed to register file in MEMFS: ' + err);
            return;
        }

        const result = this._loadMusicData(virtualName, data, message.options || {});
        this._songReady = (result === 0 || result === undefined);
        this._playerShim._isSongReady = this._songReady;
        this._playerShim._isPaused = false;
        this._paused = false;

        if (this._pendingTrackResolve) {
            const resolve = this._pendingTrackResolve;
            this._pendingTrackResolve = null;
            this._pendingTrackReject = null;
            resolve({ status: 'trackReadyToPlay', file: virtualName });
        } else {
            this.port.postMessage({ kind: 'trackReadyToPlay', file: virtualName });
        }
    }

    _loadMusicData(virtualName, data, options) {
        // Subclasses may override to apply backend-specific paths.
        return this._adapter.loadMusicData(this._sampleRate, '', virtualName, data, options);
    }

    _installInMemFs(virtualName, data) {
        const Module = this._adapter && this._adapter.Module;
        if (!Module || typeof Module.FS_createPath !== 'function') return;
        const slash = virtualName.lastIndexOf('/');
        const path = slash > 0 ? virtualName.substring(0, slash) : '/';
        const name = slash > 0 ? virtualName.substring(slash + 1) : virtualName;
        try { Module.FS_createPath('/', path, true, true); } catch (_e) { /* ignore */ }
        try { Module.FS_unlink(path + '/' + name); } catch (_e) { /* ignore */ }
        Module.FS_createDataFile(path, name, data, true, true);
    }

    _handlePlay() {
        if (!this._adapter) return;
        this._paused = false;
        this._playerShim._isPaused = false;
        if (typeof this._adapter.play === 'function') {
            try { this._adapter.play(); } catch (_e) { /* ignore */ }
        }
        this._sendIsPausedIfChanged();
    }

    _handlePause() {
        if (!this._adapter) return;
        this._paused = true;
        this._playerShim._isPaused = true;
        if (typeof this._adapter.pause === 'function') {
            try { this._adapter.pause(); } catch (_e) { /* ignore */ }
        }
        this._sendIsPausedIfChanged();
    }

    _handleSeek(message) {
        if (!this._adapter || typeof this._adapter.seekPlaybackPosition !== 'function') return;
        const ms = Number(message.ms);
        if (!Number.isFinite(ms)) return;
        try { this._adapter.seekPlaybackPosition(ms); } catch (_e) { /* ignore */ }
    }

    _handleSetVolume(message) {
        const v = Number(message.value);
        if (!Number.isFinite(v)) return;
        // Clamp to a small positive value because Web Audio mutes when
        // gain is exactly 0; mirrors the legacy behaviour.
        this._lastVolume = v <= 0 ? 0.001 : v;
    }

    _handleGetPosition() {
        if (!this._adapter) {
            this._sendPosition(0, 0);
            return;
        }
        let position = 0;
        let max = 0;
        try {
            if (typeof this._adapter.getPlaybackPosition === 'function') {
                position = this._adapter.getPlaybackPosition();
            }
        } catch (_e) { /* ignore */ }
        try {
            if (typeof this._adapter.getMaxPlaybackPosition === 'function') {
                max = this._adapter.getMaxPlaybackPosition();
            }
        } catch (_e) { /* ignore */ }
        this._sendPosition(Number.isFinite(position) ? position : 0,
                          Number.isFinite(max) ? max : 0);
    }

    _handleLoadAuxFile(message) {
        if (!this._adapter || !this._adapter.Module) return;
        const virtualName = String(message.virtualName || '');
        const data = message.data;
        if (!virtualName || !data) return;
        this._fileCache.set(virtualName, data);
        try {
            this._installInMemFs(virtualName, data);
        } catch (_e) { /* ignore */ }
    }

    _handleTeardown() {
        this._teardown();
    }

    _teardown() {
        this._paused = true;
        this._playerShim._isPaused = true;
        this._songReady = false;
        this._playerShim._isSongReady = false;
        this._fileCache.clear();
        if (this._adapter && typeof this._adapter.teardown === 'function') {
            try { this._adapter.teardown(); } catch (_e) { /* ignore */ }
        }
    }

    _sendPosition(position, maxPosition) {
        if (this._pendingPositionResolve) {
            const resolve = this._pendingPositionResolve;
            const request = this._pendingPositionRequest;
            this._pendingPositionResolve = null;
            this._pendingPositionRequest = null;
            if (request) {
                resolve({ position, maxPosition });
                return;
            }
        }
        this.port.postMessage({ kind: 'position', position, maxPosition });
    }

    _sendIsPausedIfChanged() {
        const paused = !!this._paused;
        if (this._lastSentIsPaused === paused) return;
        this._lastSentIsPaused = paused;
        this.port.postMessage({ kind: 'isPaused', isPaused: paused });
    }

    _postError(message) {
        try {
            this.port.postMessage({ kind: 'error', message: String(message) });
        } catch (_e) { /* ignore */ }
        if (this._pendingTrackReject) {
            const reject = this._pendingTrackReject;
            this._pendingTrackResolve = null;
            this._pendingTrackReject = null;
            reject(new Error(String(message)));
        }
    }

    _onFileNotReady() {
        // The OutputTransformer / Emscripten adapter signalled that a
        // sub-file is missing. We surface this as a request to the main
        // thread so it can fetch and ship the file back via
        // `loadAuxFile`.
        this.port.postMessage({ kind: 'fileNotReady' });
    }

    fileRequestCallback(namePtr) {
        // Called synchronously from Emscripten C code via
        // `ems_request_file` (see the per-core `callback.js`). Decode
        // the name, check the worklet-local cache, and either return 0
        // (file is ready) or -1 (file is not yet available).
        if (!this._adapter || !this._adapter.Module) return -1;
        const Module = this._adapter.Module;
        if (typeof Module.UTF8ToString !== 'function') return -1;
        let name = '';
        try { name = Module.UTF8ToString(namePtr); } catch (_e) { return -1; }
        if (!name) return -1;
        if (this._fileCache.has(name)) {
            this._installInMemFs(name, this._fileCache.get(name));
            return 0;
        }
        if (typeof this._adapter.mapBackendFilename === 'function') {
            try {
                const mapped = this._adapter.mapBackendFilename(name);
                if (mapped && this._fileCache.has(mapped)) {
                    this._installInMemFs(mapped, this._fileCache.get(mapped));
                    return 0;
                }
            } catch (_e) { /* ignore */ }
        }
        this.port.postMessage({ kind: 'requestFile', name });
        return -1;
    }

    fileDataRequestCallback(namePtr) {
        if (!this._adapter || !this._adapter.Module) return null;
        const Module = this._adapter.Module;
        if (typeof Module.UTF8ToString !== 'function') return null;
        let name = '';
        try { name = Module.UTF8ToString(namePtr); } catch (_e) { return null; }
        if (!name) return null;
        if (this._fileCache.has(name)) return this._fileCache.get(name);
        if (typeof this._adapter.mapBackendFilename === 'function') {
            try {
                const mapped = this._adapter.mapBackendFilename(name);
                if (mapped && this._fileCache.has(mapped)) return this._fileCache.get(mapped);
            } catch (_e) { /* ignore */ }
        }
        return null;
    }

    _initTransformer(adapter) {
        this._adapter = adapter;
        this._transformer = new OutputTransformer(adapter);
        this._playerShim._isPaused = true;
        this._playerShim._isSongReady = false;
        this._playerShim._isWaitingForFileState = false;
        if (typeof adapter.setOnTrackEnd === 'function') {
            const shim = this._playerShim;
            adapter.setOnTrackEnd(() => {
                shim._isPaused = true;
                this._paused = true;
                this.port.postMessage({ kind: 'trackEnd' });
            });
        }
        // The adapter's `ensureReadyNotification` either defers the
        // notify to the Emscripten runtime callback (async case) or
        // fires it synchronously from the constructor (sync case).
        // In the sync case no observer is installed yet; mirror the
        // "observer must be set before notify fires" guarantee by
        // checking the adapter's readiness after we install ours.
        let observedNotify = null;
        if (typeof adapter.setObserver === 'function') {
            observedNotify = () => {
                this._adapterReady = true;
                this.port.postMessage({ kind: 'adapterReady' });
            };
            adapter.setObserver({ notify: observedNotify });
        }
        this._adapterReady = (typeof adapter.isAdapterReady === 'function') ? !!adapter.isAdapterReady() : true;
        if (this._adapterReady && observedNotify) {
            // Sync case: the adapter already considers itself ready.
            // Fire the notification manually.
            try { observedNotify(); } catch (_e) { /* ignore */ }
        }
    }

    _sendPositionUpdate() {
        if (!this._adapter) return;
        let position = 0;
        let max = 0;
        try {
            if (typeof this._adapter.getPlaybackPosition === 'function') {
                position = this._adapter.getPlaybackPosition();
            }
        } catch (_e) { /* ignore */ }
        try {
            if (typeof this._adapter.getMaxPlaybackPosition === 'function') {
                max = this._adapter.getMaxPlaybackPosition();
            }
        } catch (_e) { /* ignore */ }
        const pos = Number.isFinite(position) ? position : 0;
        const mx = Number.isFinite(max) ? max : 0;
        if (pos === this._lastSentPosition && mx === this._lastSentMax) return;
        this._lastSentPosition = pos;
        this._lastSentMax = mx;
        try {
            this.port.postMessage({ kind: 'position', position: pos, maxPosition: mx });
        } catch (_e) { /* ignore */ }
    }

    process(_inputs, outputs) {
        if (this._isFirstProcessCall) {
            this._isFirstProcessCall = false;
            this.port.start && this.port.start();
            // Throttle position updates to ~10 Hz: at 44100 Hz /
            // 128 quantum that's one update every ~34 process()
            // calls. Cheap and keeps the main thread's position
            // cache warm for the 250 ms UI poll.
            this._positionUpdateEvery = 34;
            this._processCallCounter = 0;
            this._lastSentPosition = -1;
            this._lastSentMax = -1;
        }
        if (this._paused || !this._songReady || !this._transformer) {
            wpFillSilence(outputs);
            return true;
        }
        try {
            this._transformer.genSamples(wpEventShim(outputs));
        } catch (err) {
            this._postError('genSamples failed: ' + (err && err.message ? err.message : err));
            wpFillSilence(outputs);
            this._paused = true;
            this._playerShim._isPaused = true;
            return true;
        }
        this._processCallCounter++;
        if (this._processCallCounter >= this._positionUpdateEvery) {
            this._processCallCounter = 0;
            this._sendPositionUpdate();
        }
        return true;
    }
}

function wpEvaluateBackendScript(scriptText, kind) {
    // The `backend_<kind>.js` artifact is `shell-pre.js` +
    // Emscripten-emitted code + `shell-post.js` + `<core>_adapter.js`,
    // concatenated by CMake. The Emscripten merge logic preserves any
    // property set on the input `Module` (via the internal `aa`
    // snapshot) and re-applies them at the end, so this is the right
    // place to attach a fetch-based `read` / `readBinary` to survive
    // the Emscripten init pass.
    const namespace = 'spp_backend_state_' + kind.toUpperCase();
    const state = globalThis[namespace] || {};
    if (typeof state.read !== 'function') {
        state.read = function (url) {
            // Synchronous fallback; only used for files that the
            // Emscripten runtime pre-loads via `--embed-file` /
            // `--preload-file`, which Trackify's backends do not use.
            return '';
        };
    }
    if (typeof state.readBinary !== 'function') {
        state.readBinary = function (url) {
            return new Uint8Array(0);
        };
    }
    globalThis[namespace] = state;

    // Evaluate the script in a function scope so the `var backend_X`
    // and the `var *BackendAdapter` declarations do not leak to the
    // global scope, then return the populated IIFE result.
    const wrapped = scriptText + '\n;return backend_' + kind.toUpperCase() + ';';
    const fn = new Function(wrapped);
    return fn();
}

function wpFetchText(url) {
    return fetch(url).then((response) => {
        if (!response.ok) {
            throw new Error('Failed to fetch ' + url + ': ' + response.status);
        }
        return response.text();
    });
}

function wpFetchBinary(url) {
    return fetch(url).then((response) => {
        if (!response.ok) {
            throw new Error('Failed to fetch ' + url + ': ' + response.status);
        }
        return response.arrayBuffer();
    });
}

function wpInstallPointerStringifyShim(Module) {
    if (!Module || Module.Pointer_stringify) return;
    Module.Pointer_stringify = function (ptr) { return Module.UTF8ToString(ptr); };
}

function wpMakeWasmProcessor(kind, adapterCtorName) {
    class WpWasmProcessor extends WpWorkletProcessor {
        constructor(options) {
            super(options);
            this._initPromise = this._init();
        }

        async _init() {
            const scriptUrl = '/wasm/backend_' + kind + '.js';
            const wasmUrl = '/wasm/' + kind + '.wasm';
            try {
                // Aliases for the upstream shell-pre.js, which sets
                // `window.spp_backend_state_X` and references
                // `window.WASM_SEARCH_PATH`. Inside the worklet there
                // is no `window`; `globalThis` plays the same role and
                // `WASM_SEARCH_PATH` is set to a value that resolves
                // correctly relative to this module's URL.
                globalThis.window = globalThis;
                globalThis.WASM_SEARCH_PATH = './';
                globalThis.document = { currentScript: null };

                const scriptText = await wpFetchText(scriptUrl);
                const backend = wpEvaluateBackendScript(scriptText, kind);
                if (!backend || !backend.Module) {
                    throw new Error('Backend script produced no Module');
                }
                const Module = backend.Module;
                wpInstallPointerStringifyShim(Module);

                const AdapterCtor = globalThis[adapterCtorName];
                if (typeof AdapterCtor !== 'function') {
                    throw new Error('Adapter constructor ' + adapterCtorName + ' not found');
                }
                const adapter = this._buildAdapter(AdapterCtor, Module);
                this._initTransformer(adapter);

                this.port.postMessage({ kind: 'backendReady', kindId: this._kind });
            } catch (err) {
                this._postError('Failed to initialize ' + kind + ' backend: ' +
                    (err && err.message ? err.message : err));
            }
        }

        _buildAdapter(AdapterCtor, Module) {
            // Most per-backend adapters follow a uniform pattern: take
            // the Emscripten module and a few sub-objects, then return
            // an adapter instance. The VGM backend takes a resource
            // path; everything else is parameterless.
            if (this._kind === 'vgm') {
                return new AdapterCtor(Module, '/sample-files/');
            }
            return new AdapterCtor(Module);
        }
    }
    registerProcessor('wp-' + kind, WpWasmProcessor);
    return WpWasmProcessor;
}

function wpMakePureJsProcessor(kind, adapterCtorName) {
    class WpPureJsProcessor extends WpWorkletProcessor {
        constructor(options) {
            super(options);
            this._initPromise = this._init();
        }

        async _init() {
            try {
                globalThis.window = globalThis;
                globalThis.WASM_SEARCH_PATH = './';
                const scriptUrl = '/wasm/backend_' + kind + '.js';
                const scriptText = await wpFetchText(scriptUrl);
                wpEvaluateBackendScript(scriptText, kind);
                const AdapterCtor = globalThis[adapterCtorName];
                if (typeof AdapterCtor !== 'function') {
                    throw new Error('Adapter constructor ' + adapterCtorName + ' not found');
                }
                const adapter = new AdapterCtor();
                this._initTransformer(adapter);
                this.port.postMessage({ kind: 'backendReady', kindId: this._kind });
            } catch (err) {
                this._postError('Failed to initialize ' + kind + ' backend: ' +
                    (err && err.message ? err.message : err));
            }
        }
    }
    registerProcessor('wp-' + kind, WpPureJsProcessor);
    return WpPureJsProcessor;
}

wpMakeWasmProcessor('psx', 'PSXBackendAdapter');
wpMakeWasmProcessor('snes', 'SNESBackendAdapter');
wpMakeWasmProcessor('nez', 'NEZBackendAdapter');
wpMakeWasmProcessor('n64', 'N64BackendAdapter');
wpMakeWasmProcessor('vgm', 'VgmBackendAdapter');
wpMakePureJsProcessor('xa', 'XaBackendAdapter');
wpMakePureJsProcessor('genh', 'GenhBackendAdapter');
