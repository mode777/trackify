/*
 * Trackify AudioWorklet player shim.
 *
 * Mirrors the subset of the legacy `ScriptNodePlayer` global that the
 * per-backend adapter code (`ScriptNodeBackendAdapter`,
 * `EmsHEAP16BackendAdapter`, `OutputTransformer`) reaches for. The
 * worklet has no real `ScriptNodePlayer` instance; instead each
 * WpWorkletProcessor owns a `WpPlayerShim` that exposes the player
 * state methods the transformer uses, and a top-level
 * `ScriptNodePlayer` shim that exposes the static helpers
 * (`getInstance`, `getWebAudioSampleRate`).
 *
 * The `setOnTrackEnd` callback installed on the adapter by the
 * constructor chain (`PlayerImpl._ctor` in the legacy code) is set up
 * by the WpWorkletProcessor itself; the shim just forwards
 * `notifySongEnd` to the adapter so MP3-style adapters keep working.
 */
'use strict';

class WpPlayerShim {
    constructor(processor) {
        this._processor = processor;
        this._isPaused = true;
        this._isSongReady = false;
        this._isWaitingForFileState = false;
        this._pan = null;
    }

    _isNotPlaying() {
        return !this._isSongReady || this._isWaitingForFileState || this._isPaused;
    }

    _setPaused() {
        this._isPaused = true;
    }

    _setWaitingForFile(val) {
        this._isWaitingForFileState = !!val;
    }

    _isWaitingForFile() {
        return this._isWaitingForFileState;
    }

    _signalFileNotReady() {
        this._isPaused = true;
        this._isSongReady = false;
        this._setWaitingForFile(true);
        if (this._processor && typeof this._processor._onFileNotReady === 'function') {
            this._processor._onFileNotReady();
        }
    }

    getPanning() {
        return this._pan;
    }

    setPanning(pan) {
        this._pan = pan;
    }

    setPlaybackTimeout(t) {
        if (this._processor && this._processor._adapter &&
                typeof this._processor._adapter.setPlaybackTimeout === 'function') {
            this._processor._adapter.setPlaybackTimeout(t);
        }
    }

    getPlaybackTimeout() {
        if (this._processor && this._processor._adapter &&
                typeof this._processor._adapter.getPlaybackTimeout === 'function') {
            return this._processor._adapter.getPlaybackTimeout();
        }
        return -1;
    }

    notifySongEnd() {
        this._isPaused = true;
        if (this._processor && this._processor._adapter &&
                typeof this._processor._adapter.doOnTrackEnd === 'function') {
            this._processor._adapter.doOnTrackEnd();
        }
    }

    _fileRequestCallback(namePtr) {
        if (this._processor && typeof this._processor._fileRequestCallback === 'function') {
            return this._processor._fileRequestCallback(namePtr);
        }
        return -1;
    }

    _fileDataRequestCallback(namePtr) {
        if (this._processor && typeof this._processor._fileDataRequestCallback === 'function') {
            return this._processor._fileDataRequestCallback(namePtr);
        }
        return null;
    }

    _fileSizeRequestCallback(namePtr) {
        const data = this._fileDataRequestCallback(namePtr);
        return data ? data.length : 0;
    }
}

let wpCurrentPlayerShim = null;

const ScriptNodePlayer = {
    getWebAudioSampleRate: () => (typeof globalThis.sampleRate === 'number' && globalThis.sampleRate > 0)
        ? globalThis.sampleRate
        : 44100,
    getInstance: () => wpCurrentPlayerShim,
    // Adapter-side hooks that the legacy runtime always defined on
    // `ScriptNodePlayer` itself. The proxy uses these too; expose
    // safe no-ops so the per-backend code can run unmodified.
    isReady: () => wpCurrentPlayerShim !== null,
};
