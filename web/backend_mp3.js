'use strict';

class Mp3BackendAdapter extends ScriptNodeBackendAdapter {
    constructor() {
        super(2, 2, new BaseFileMapper());

        this._audioEl = new Audio();
        this._audioEl.preload = 'auto';
        this._audioEl.crossOrigin = 'anonymous';

        this._sourceNode = null;
        this._objectUrl = '';
        this._endedHandler = null;
    }

    isAdapterReady() {
        return true;
    }

    _createProducerNode(audioCtx) {
        this._sourceNode = audioCtx.createMediaElementSource(this._audioEl);
        return this._sourceNode;
    }

    teardown() {
        super.teardown();
        this._detachEndedHandler();
        try {
            this._audioEl.pause();
        } catch (_error) {
            // Element may already be torn down.
        }
        if (this._audioEl) {
            this._audioEl.removeAttribute('src');
            this._audioEl.load();
        }
        if (this._objectUrl) {
            URL.revokeObjectURL(this._objectUrl);
            this._objectUrl = '';
        }
        this._sourceNode = null;
    }

    loadMusicData(sampleRate, path, filename, data) {
        let input = data;
        if (input instanceof ArrayBuffer) {
            input = new Uint8Array(input);
        }
        if (!(input instanceof Uint8Array) || !input.length) {
            return -1;
        }

        this._detachEndedHandler();

        if (this._objectUrl) {
            URL.revokeObjectURL(this._objectUrl);
        }

        const blob = new Blob([input], { type: 'audio/mpeg' });
        this._objectUrl = URL.createObjectURL(blob);
        this._audioEl.src = this._objectUrl;

        this._endedHandler = () => {
            const player = window.ScriptNodePlayer && window.ScriptNodePlayer.getInstance
                ? window.ScriptNodePlayer.getInstance()
                : null;
            if (player && typeof player.notifySongEnd === 'function') {
                player.notifySongEnd();
            }
        };
        this._audioEl.addEventListener('ended', this._endedHandler);

        this.resetSampleRate(sampleRate, 44100);
        return 0;
    }

    play() {
        const result = this._audioEl.play();
        if (result && typeof result.catch === 'function') {
            result.catch(() => {
                // Autoplay restrictions; the next user gesture will retry.
            });
        }
        return result;
    }

    pause() {
        this._audioEl.pause();
    }

    getChannels() {
        return 2;
    }

    getAudioBuffer() {
        return 0;
    }

    getAudioBufferLength() {
        return 0;
    }

    readFloatSample() {
        return 0;
    }

    computeAudioSamples() {
        return 1;
    }

    getSongInfoMeta() {
        return {};
    }

    updateSongInfo() {
    }

    getMaxPlaybackPosition() {
        const duration = this._audioEl && Number.isFinite(this._audioEl.duration)
            ? this._audioEl.duration
            : 0;
        return Math.max(0, Math.round(duration * 1000));
    }

    getPlaybackPosition() {
        const currentTime = this._audioEl && Number.isFinite(this._audioEl.currentTime)
            ? this._audioEl.currentTime
            : 0;
        return Math.max(0, Math.round(currentTime * 1000));
    }

    seekPlaybackPosition(ms) {
        const clampedMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
        const targetSec = clampedMs / 1000;
        try {
            this._audioEl.currentTime = targetSec;
        } catch (_error) {
            // Seek before metadata is loaded; ignore.
        }
        if (this._transformer && typeof this._transformer.seekPosition === 'function') {
            this._transformer.seekPosition(clampedMs);
        }
    }

    _detachEndedHandler() {
        if (this._endedHandler && this._audioEl) {
            this._audioEl.removeEventListener('ended', this._endedHandler);
        }
        this._endedHandler = null;
    }
}

window.Mp3BackendAdapter = Mp3BackendAdapter;
window.spp_backend_state_MP3 = { notReady: false };