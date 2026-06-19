/*
 * Trackify AudioWorklet main-thread proxy.
 *
 * Exposes the legacy `globalThis.ScriptNodePlayer` API so the rest of
 * the Trackify player modules (`web/player/transport.js`,
 * `web/player/seek_ui.js`, etc.) can stay unchanged. The audio graph
 * is now an `AudioWorkletNode` per backend; the worklet owns the
 * Emscripten module, the per-backend adapter, and the
 * `OutputTransformer`.
 *
 * The MP3 backend is the one exception: it continues to use an
 * `HTMLAudioElement` + `MediaElementAudioSourceNode` on the main
 * thread (see `docs/audio-worklet-migration.md` §4.5). The proxy
 * detects `Mp3BackendAdapter` in `initialize()` and routes the call
 * through the existing main-thread path.
 *
 * The `ScriptNodeBackendAdapter` / `BaseFileMapper` stubs near the
 * bottom of this file satisfy the `Mp3BackendAdapter` parent class
 * without dragging the entire legacy `scriptprocessor_player.js`
 * into the worklet pipeline.
 */
'use strict';

/*
 * Minimal stubs for the legacy runtime classes that `Mp3BackendAdapter`
 * (`web/backend_mp3.js`) extends. The full legacy `BaseFileMapper` and
 * `ScriptNodeBackendAdapter` live in
 * `submodules/webaudio-player/src/{BaseFileMapper.js,
 *  impl/ScriptNodeBackendAdapter.js}`. The worklet pipeline doesn't
 * load the legacy `scriptprocessor_player.js` (per WP-D in
 * `docs/audio-worklet-migration.md`), so we expose just enough surface
 * here for the MP3 adapter to instantiate and tear down. The MP3
 * adapter overrides every method it actually uses; the stubs only
 * satisfy the parent constructor signature and `teardown()`.
 */
class BaseFileMapper {
    constructor() {}
    init() {}
    mapToVirtualFilename(name) { return name; }
    mapFromVirtualFilename(name) { return name; }
    mapBackendFilename(name) { return name; }
    registerFileData() { return true; }
}

class ScriptNodeBackendAdapter {
    constructor(channels, bytesPerSample, fileMapper) {
        this._channels = channels;
        this._bytesPerSample = bytesPerSample;
        this._fileMapper = fileMapper || new BaseFileMapper();
        this._transformer = {
            seekPosition: function () {},
            initPlayback: function () {},
            resetBuffers: function () {},
            initTicker: function () {},
            getPlaytime: function () { return 0; },
        };
        this._currentTimeout = -1;
        this._songInfo = {};
        this._onTrackEnd = null;
        this._observer = null;
        this._externalTicker = null;
        this._processorBufSize = 2048;
    }
    teardown() { this._songInfo = {}; }
    setOnTrackEnd(fn) { this._onTrackEnd = fn; }
    doOnTrackEnd() { if (typeof this._onTrackEnd === 'function') { this._onTrackEnd(); } }
    getChannels() { return this._channels; }
    getBytesPerSample() { return this._bytesPerSample; }
    isAdapterReady() { return true; }
    play() {}
    pause() {}
    setPlaybackTimeout(t) {
        const rate = ScriptNodePlayer.getWebAudioSampleRate();
        this._currentTimeout = (t < 0) ? -1 : t / 1000 * rate;
    }
    getPlaybackTimeout() {
        if (this._currentTimeout < 0) return -1;
        const rate = ScriptNodePlayer.getWebAudioSampleRate();
        return Math.round(this._currentTimeout / rate * 1000);
    }
    getCurrentPlaytime() { return 0; }
    getMaxPlaybackPosition() { return 0; }
    getPlaybackPosition() { return 0; }
    seekPlaybackPosition() {}
    getAudioBuffer() { return 0; }
    getAudioBufferLength() { return 0; }
    readFloatSample() { return 0; }
    computeAudioSamples() { return 1; }
    init() {}
    _resetBuffers() {}
    setSilenceTimeout() {}
    resetSampleRate() {}
    loadMusicData() { return -1; }
    evalTrackOptions() {
        // Default timeout handling, mirrors the legacy base.
        if (typeof ScriptNodePlayer !== 'undefined' && ScriptNodePlayer.getInstance) {
            const inst = ScriptNodePlayer.getInstance();
            if (inst) {
                inst.setPlaybackTimeout(typeof arguments[0] !== 'undefined' && arguments[0] && arguments[0].timeout
                    ? arguments[0].timeout * 1000 : -1);
            }
        }
        return 0;
    }
    updateSongInfo() {}
    getSongInfo() { return this._songInfo; }
    getSongInfoMeta() { return {}; }
    notifyAdapterReady() {
        if (this._observer && typeof this._observer.notify === 'function') {
            this._observer.notify();
        }
    }
    setObserver(o) {
        this._observer = o;
        if (this.isAdapterReady()) this.notifyAdapterReady();
    }
    getBufNum() { return 0; }
    getCurrentTick() { return 0; }
    getMaxTicks() { return 1; }
    setTicker(t) { this._externalTicker = t; }
    initTicker() {}
    enableScope() {}
    getNumberTraceStreams() { return 0; }
    getTraceStreams() { return []; }
    readFloatTrace() { return 0; }
    handleBackendSongAttributes() {}
    setProcessorBufSize(size) { this._processorBufSize = size; }
    getProcessorBufSize() { return this._processorBufSize; }
    _createProducerNode() { return null; }
    _assertSyncNodeReadiness(cb) { cb(); }
    _connectTickerNode() { return null; }
    cacheStartupAudioBuffer() { return true; }
    skipFileLoad() { return false; }
    prepareToPlay() { this._songInfo = {}; }
    initPlayback() {}
    mapToVirtualFilename(name) { return this._fileMapper.mapToVirtualFilename(name); }
    mapFromVirtualFilename(name) { return this._fileMapper.mapFromVirtualFilename(name); }
    registerFileData(p, d) { return this._fileMapper.registerFileData(p, d); }
    mapBackendFilename(name) { return this._fileMapper.mapBackendFilename(name); }
    _getFilename(path, name) {
        if (path && path.length) {
            return path + (path.endsWith('/') ? '' : '/') + name;
        }
        return name;
    }
    _makeTitleFromPath(path) {
        return decodeURI(path).replace(/^.*[\\\/]/, '').split('.').slice(0, -1).join('.');
    }
}

if (typeof globalThis !== 'undefined') {
    globalThis.BaseFileMapper = BaseFileMapper;
    globalThis.ScriptNodeBackendAdapter = ScriptNodeBackendAdapter;
}
if (typeof window !== 'undefined') {
    window.BaseFileMapper = BaseFileMapper;
    window.ScriptNodeBackendAdapter = ScriptNodeBackendAdapter;
}

const WP_KIND_TO_PROCESSOR = {
    psx: 'wp-psx',
    snes: 'wp-snes',
    nez: 'wp-nez',
    n64: 'wp-n64',
    vgm: 'wp-vgm',
    xa: 'wp-xa',
    genh: 'wp-genh',
};

const WP_DEFAULT_LATENCY_HINT = 'playback';

class WpPositionCache {
    constructor() {
        this._position = 0;
        this._maxPosition = 0;
        this._isPaused = true;
        this._isPausedDirty = false;
    }

    setPosition(position, maxPosition) {
        if (Number.isFinite(position)) this._position = Math.max(0, position);
        if (Number.isFinite(maxPosition)) this._maxPosition = Math.max(0, maxPosition);
    }

    setIsPaused(isPaused) {
        this._isPaused = !!isPaused;
    }

    getPosition() { return this._position; }
    getMaxPosition() { return this._maxPosition; }
    isPaused() { return this._isPaused; }
}

class WpMp3Bridge {
    constructor() {
        this._adapter = null;
        this._audioEl = null;
        this._sourceNode = null;
        this._gainNode = null;
        this._onTrackEnd = null;
        this._endedHandler = null;
        this._lastVolume = 0.8;
        this._isPaused = true;
        this._currentFile = '';
    }

    initialize(adapter, audioCtx) {
        this._adapter = adapter;
        // The MP3 adapter has already constructed its `Audio` element;
        // ask it to create the Web Audio producer node and wire it up.
        this._sourceNode = adapter._createProducerNode(audioCtx);
        this._gainNode = audioCtx.createGain();
        this._gainNode.gain.value = this._lastVolume;
        this._sourceNode.connect(this._gainNode);
        this._gainNode.connect(audioCtx.destination);
        this._audioEl = adapter._audioEl;
        this._attachEndedHandler();
        if (typeof adapter.setOnTrackEnd === 'function') {
            adapter.setOnTrackEnd(() => this._fireTrackEnd());
        }
    }

    _attachEndedHandler() {
        if (!this._audioEl) return;
        this._detachEndedHandler();
        this._endedHandler = () => {
            this._isPaused = true;
            this._fireTrackEnd();
        };
        this._audioEl.addEventListener('ended', this._endedHandler);
    }

    _detachEndedHandler() {
        if (this._endedHandler && this._audioEl) {
            this._audioEl.removeEventListener('ended', this._endedHandler);
        }
        this._endedHandler = null;
    }

    _fireTrackEnd() {
        if (typeof this._onTrackEnd === 'function') {
            try { this._onTrackEnd(); } catch (_e) { /* ignore */ }
        }
    }

    setOnTrackEnd(fn) { this._onTrackEnd = fn; }

    loadMusic(url, options) {
        if (!this._adapter) return Promise.reject(new Error('MP3 adapter not initialized'));
        return fetch(url).then((response) => {
            if (!response.ok) {
                throw new Error('Failed to fetch ' + url + ': ' + response.status);
            }
            return response.arrayBuffer();
        }).then((arrayBuffer) => {
            const data = new Uint8Array(arrayBuffer);
            const result = this._adapter.loadMusicData(
                ScriptNodePlayer.getWebAudioSampleRate(), '', this._filenameFromUrl(url), data);
            if (result !== 0) {
                throw new Error('Mp3BackendAdapter.loadMusicData returned ' + result);
            }
            this._currentFile = this._filenameFromUrl(url);
            this._isPaused = true;
            return { status: 'trackReadyToPlay', file: this._currentFile };
        });
    }

    _filenameFromUrl(url) {
        const qIdx = url.indexOf('?');
        const clean = qIdx >= 0 ? url.substring(0, qIdx) : url;
        const slash = clean.lastIndexOf('/');
        return slash >= 0 ? clean.substring(slash + 1) : clean;
    }

    play() {
        if (!this._adapter || !this._audioEl) return;
        const result = this._audioEl.play();
        if (result && typeof result.catch === 'function') {
            result.catch(() => { /* autoplay restrictions */ });
        }
        this._isPaused = false;
    }

    pause() {
        if (!this._audioEl) return;
        this._audioEl.pause();
        this._isPaused = true;
    }

    isPaused() { return this._isPaused; }

    getPlaybackPosition() {
        if (!this._audioEl) return 0;
        const t = this._audioEl.currentTime;
        return Number.isFinite(t) ? Math.max(0, Math.round(t * 1000)) : 0;
    }

    getMaxPlaybackPosition() {
        if (!this._audioEl) return 0;
        const d = this._audioEl.duration;
        return Number.isFinite(d) ? Math.max(0, Math.round(d * 1000)) : 0;
    }

    seekPlaybackPosition(ms) {
        if (!this._audioEl) return;
        const clamped = Number.isFinite(ms) ? Math.max(0, ms) : 0;
        try { this._audioEl.currentTime = clamped / 1000; } catch (_e) { /* ignore */ }
        if (this._adapter && this._adapter._transformer &&
                typeof this._adapter._transformer.seekPosition === 'function') {
            this._adapter._transformer.seekPosition(clamped);
        }
    }

    setVolume(v) {
        this._lastVolume = Number.isFinite(v) && v > 0 ? v : 0.001;
        if (this._gainNode) this._gainNode.gain.value = this._lastVolume;
    }

    getVolume() { return this._lastVolume; }

    teardown() {
        this._detachEndedHandler();
        if (this._adapter && typeof this._adapter.teardown === 'function') {
            try { this._adapter.teardown(); } catch (_e) { /* ignore */ }
        }
        this._adapter = null;
        this._audioEl = null;
        this._sourceNode = null;
        this._gainNode = null;
    }
}

class WpPlayer {
    constructor() {
        this._audioCtx = null;
        this._workletReady = null;
        this._workletNode = null;
        this._workletKind = '';
        this._adapter = null;
        this._positionCache = new WpPositionCache();
        this._mp3Bridge = null;
        this._onTrackEnd = null;
        this._lastVolume = 0.8;
        this._pendingTrackReady = null;
        this._pendingAuxFiles = new Map();
        this._warnedOnce = false;
        this._backendReady = false;
        this._backendReadyResolvers = [];
        this._backendReadyRejecters = [];
    }

    _setGlobalWebAudioCtx() {
        if (this._audioCtx) return;
        if (typeof AudioContext === 'undefined') {
            throw new Error('Web Audio API is not supported in this browser');
        }
        this._audioCtx = new AudioContext({ latencyHint: WP_DEFAULT_LATENCY_HINT });
        if (this._audioCtx.state === 'suspended') {
            this._audioCtx.resume().catch(() => { /* autoplay */ });
        }
    }

    getWebAudioContext() {
        this._setGlobalWebAudioCtx();
        return this._audioCtx;
    }

    getWebAudioSampleRate() {
        this._setGlobalWebAudioCtx();
        return this._audioCtx.sampleRate;
    }

    _ensureWorkletReady() {
        if (this._workletReady) return this._workletReady;
        this._setGlobalWebAudioCtx();
        this._workletReady = this._audioCtx.audioWorklet.addModule('/wasm/wp_worklet.js')
            .then(() => { /* module loaded */ })
            .catch((err) => {
                this._workletReady = null;
                throw err;
            });
        return this._workletReady;
    }

    _isMp3Adapter(adapter) {
        if (!adapter) return false;
        return adapter.constructor && adapter.constructor.name === 'Mp3BackendAdapter';
    }

    initialize(adapter, onTrackEnd, _requiredFiles, _spectrumEnabled, _flag) {
        this._setGlobalWebAudioCtx();
        this._adapter = adapter;
        this._onTrackEnd = onTrackEnd || null;
        this._positionCache.setPosition(0, 0);
        this._positionCache.setIsPaused(true);
        this._backendReady = false;
        this._backendReadyResolvers = [];
        this._backendReadyRejecters = [];

        if (this._isMp3Adapter(adapter)) {
            this._teardownWorklet();
            this._mp3Bridge = new WpMp3Bridge();
            this._mp3Bridge.setOnTrackEnd(onTrackEnd);
            this._mp3Bridge.initialize(adapter, this._audioCtx);
            this._mp3Bridge.setVolume(this._lastVolume);
            return Promise.resolve('playerIsReady');
        }

        return this._ensureWorkletReady().then(() => {
            this._teardownWorklet();
            const kind = this._detectKind(adapter);
            if (!kind) {
                throw new Error('Unsupported backend adapter: ' +
                    (adapter && adapter.constructor ? adapter.constructor.name : adapter));
            }
            this._workletKind = kind;
            this._workletNode = new AudioWorkletNode(this._audioCtx, WP_KIND_TO_PROCESSOR[kind], {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                processorOptions: {
                    kind: kind,
                    sampleRate: this._audioCtx.sampleRate,
                },
            });
            this._workletNode.port.onmessage = (event) => this._onWorkletMessage(event.data);
            this._workletNode.port.start();
            this._workletNode.connect(this._audioCtx.destination);

            this._pendingAuxFiles.clear();
            this._workletNode.port.postMessage({ cmd: 'init' });
            return this._waitForBackendReady().then(() => 'playerIsReady');
        });
    }

    _detectKind(adapter) {
        if (!adapter || !adapter.constructor) return null;
        const name = adapter.constructor.name;
        switch (name) {
            case 'PSXBackendAdapter': return 'psx';
            case 'SNESBackendAdapter': return 'snes';
            case 'NEZBackendAdapter': return 'nez';
            case 'N64BackendAdapter': return 'n64';
            case 'VgmBackendAdapter': return 'vgm';
            case 'XaBackendAdapter': return 'xa';
            case 'GenhBackendAdapter': return 'genh';
            case 'Mp3BackendAdapter': return 'mp3';
            default: return null;
        }
    }

    _teardownWorklet() {
        if (!this._workletNode) return;
        try { this._workletNode.port.postMessage({ cmd: 'teardown' }); } catch (_e) { /* ignore */ }
        try { this._workletNode.disconnect(); } catch (_e) { /* ignore */ }
        this._workletNode = null;
        this._workletKind = '';
    }

    _onWorkletMessage(message) {
        if (!message || typeof message !== 'object') return;
        switch (message.kind) {
            case 'ready':
                // The worklet module is loaded. No-op; the
                // `addModule()` call already resolved initialize().
                break;
            case 'backendReady':
                this._markBackendReady();
                break;
            case 'adapterReady':
                // The async backend (WASM) finished initialization.
                this._markBackendReady();
                break;
            case 'position':
                this._positionCache.setPosition(message.position, message.maxPosition);
                break;
            case 'isPaused':
                this._positionCache.setIsPaused(message.isPaused);
                break;
            case 'trackEnd':
                if (typeof this._onTrackEnd === 'function') {
                    try { this._onTrackEnd(); } catch (_e) { /* ignore */ }
                }
                break;
            case 'trackReadyToPlay':
                if (this._pendingTrackReady) {
                    const resolve = this._pendingTrackReady.resolve;
                    this._pendingTrackReady = null;
                    resolve({ status: 'trackReadyToPlay', file: message.file });
                }
                break;
            case 'fileNotReady':
                this._requestPendingAuxFile();
                break;
            case 'requestFile':
                this._requestAuxFile(message.name);
                break;
            case 'error':
                console.error('Worklet error:', message.message);
                this._failBackendReady(new Error(message.message));
                if (this._pendingTrackReady) {
                    const reject = this._pendingTrackReady.reject;
                    this._pendingTrackReady = null;
                    reject(new Error(message.message));
                }
                break;
            default:
                // Unknown messages are ignored.
                break;
        }
    }

    _markBackendReady() {
        if (this._backendReady) return;
        this._backendReady = true;
        const resolvers = this._backendReadyResolvers;
        this._backendReadyResolvers = [];
        this._backendReadyRejecters = [];
        for (let i = 0; i < resolvers.length; i++) {
            try { resolvers[i](); } catch (_e) { /* ignore */ }
        }
    }

    _failBackendReady(err) {
        const rejecters = this._backendReadyRejecters;
        this._backendReadyResolvers = [];
        this._backendReadyRejecters = [];
        for (let i = 0; i < rejecters.length; i++) {
            try { rejecters[i](err); } catch (_e) { /* ignore */ }
        }
    }

    _waitForBackendReady() {
        if (this._backendReady) return Promise.resolve();
        return new Promise((resolve, reject) => {
            this._backendReadyResolvers.push(resolve);
            this._backendReadyRejecters.push(reject);
        });
    }

    _requestPendingAuxFile() {
        // No-op stub: the main thread never proactively pushes aux
        // files today; the worklet re-asks for them on the next
        // process() call via `_signalFileNotReady`.
    }

    _requestAuxFile(name) {
        // Aux file requests originate from the worklet's
        // `_fileRequestCallback`. We can't fetch them here (we don't
        // have a URL — only a virtual filename). Mark them as
        // unavailable; the adapter will surface the failure on the
        // next computeAudioSamples().
        if (this._workletNode) {
            this._workletNode.port.postMessage({
                cmd: 'loadAuxFile',
                virtualName: name,
                data: null,
            });
        }
    }

    loadMusicFromURL(url, options) {
        if (this._mp3Bridge) {
            return this._mp3Bridge.loadMusic(url, options || {});
        }
        if (!this._workletNode) {
            return Promise.reject(new Error('Player not initialized'));
        }
        return fetch(url).then((response) => {
            if (!response.ok) {
                throw new Error('Failed to fetch ' + url + ': ' + response.status);
            }
            return response.arrayBuffer();
        }).then((arrayBuffer) => {
            return new Promise((resolve, reject) => {
                this._pendingTrackReady = { resolve, reject };
                this._workletNode.port.postMessage({
                    cmd: 'loadFile',
                    virtualName: this._filenameFromUrl(url),
                    data: arrayBuffer,
                    options: options || {},
                }, [arrayBuffer]);
                setTimeout(() => {
                    if (this._pendingTrackReady) {
                        const rej = this._pendingTrackReady.reject;
                        this._pendingTrackReady = null;
                        rej(new Error('Timed out waiting for track ready'));
                    }
                }, 30000);
            });
        });
    }

    _filenameFromUrl(url) {
        const qIdx = url.indexOf('?');
        const clean = qIdx >= 0 ? url.substring(0, qIdx) : url;
        const slash = clean.lastIndexOf('/');
        return slash >= 0 ? clean.substring(slash + 1) : clean;
    }

    play() {
        if (this._mp3Bridge) { this._mp3Bridge.play(); return; }
        if (!this._workletNode) {
            if (!this._warnedOnce) {
                console.log('warning: ScriptNodePlayer.play() called before init complete');
                this._warnedOnce = true;
            }
            return;
        }
        this._workletNode.port.postMessage({ cmd: 'play' });
        this._positionCache.setIsPaused(false);
    }

    pause() {
        if (this._mp3Bridge) { this._mp3Bridge.pause(); return; }
        if (!this._workletNode) return;
        this._workletNode.port.postMessage({ cmd: 'pause' });
        this._positionCache.setIsPaused(true);
    }

    isPaused() {
        if (this._mp3Bridge) return this._mp3Bridge.isPaused();
        return this._positionCache.isPaused();
    }

    getPlaybackPosition() {
        if (this._mp3Bridge) return this._mp3Bridge.getPlaybackPosition();
        return this._positionCache.getPosition();
    }

    getMaxPlaybackPosition() {
        if (this._mp3Bridge) return this._mp3Bridge.getMaxPlaybackPosition();
        return this._positionCache.getMaxPosition();
    }

    seekPlaybackPosition(ms) {
        if (this._mp3Bridge) { this._mp3Bridge.seekPlaybackPosition(ms); return; }
        if (!this._workletNode) return;
        this._workletNode.port.postMessage({ cmd: 'seek', ms: Number(ms) || 0 });
    }

    setVolume(v) {
        this._lastVolume = Number.isFinite(v) && v > 0 ? v : 0.001;
        if (this._mp3Bridge) { this._mp3Bridge.setVolume(this._lastVolume); return; }
        if (!this._workletNode) return;
        this._workletNode.port.postMessage({ cmd: 'setVolume', value: this._lastVolume });
    }

    getVolume() {
        return this._lastVolume;
    }

    notifySongEnd() {
        // Backwards-compat hook for the MP3 adapter (see
        // `web/backend_mp3.js`), whose `ended` event handler calls
        // `player.notifySongEnd()`. The MP3 bridge in this class
        // also wires its own handler; the call is idempotent because
        // `onTrackEnd` schedules a single next-track selection via
        // `transport.js#selectNextTrack`.
        if (typeof this._onTrackEnd === 'function') {
            try { this._onTrackEnd(); } catch (_e) { /* ignore */ }
        }
    }
}

let wpInstance = null;

const ScriptNodePlayer = {
    getInstance: function () {
        if (!wpInstance) {
            if (!this._warnedOnce) {
                console.log('warning: ScriptNodePlayer.getInstance() called before init');
                this._warnedOnce = true;
            }
            return null;
        }
        return wpInstance;
    },
    getWebAudioContext: function () {
        if (!wpInstance) wpInstance = new WpPlayer();
        return wpInstance.getWebAudioContext();
    },
    getWebAudioSampleRate: function () {
        if (!wpInstance) wpInstance = new WpPlayer();
        return wpInstance.getWebAudioSampleRate();
    },
    initialize: function (backendAdapter, onTrackEnd, requiredFiles, spectrumEnabled, flag) {
        if (!wpInstance) wpInstance = new WpPlayer();
        return wpInstance.initialize(backendAdapter, onTrackEnd, requiredFiles, spectrumEnabled, flag);
    },
    loadMusicFromURL: function (url, options, onFail, onProgress) {
        if (!wpInstance) return Promise.reject(new Error('ScriptNodePlayer not initialized'));
        return wpInstance.loadMusicFromURL(url, options);
    },
    play: function () { if (wpInstance) wpInstance.play(); },
    pause: function () { if (wpInstance) wpInstance.pause(); },
    isPaused: function () { return wpInstance ? wpInstance.isPaused() : true; },
    getPlaybackPosition: function () { return wpInstance ? wpInstance.getPlaybackPosition() : 0; },
    getMaxPlaybackPosition: function () { return wpInstance ? wpInstance.getMaxPlaybackPosition() : 0; },
    seekPlaybackPosition: function (ms) { if (wpInstance) wpInstance.seekPlaybackPosition(ms); },
    setVolume: function (v) { if (wpInstance) wpInstance.setVolume(v); },
    getVolume: function () { return wpInstance ? wpInstance.getVolume() : 0.8; },
    loadFileData: function () { return Promise.resolve([]); },
    playSong: function () { return Promise.reject(new Error('playSong not supported in worklet pipeline')); },
    isReady: function () { return wpInstance !== null; },
};

globalThis.ScriptNodePlayer = ScriptNodePlayer;

if (typeof window !== 'undefined') {
    window.ScriptNodePlayer = ScriptNodePlayer;
}
