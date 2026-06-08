/*
 * Trackify player frame app.
 *
 * Responsibilities in this phase:
 * - Own WASM backend loading and ScriptNodePlayer lifecycle.
 * - Handle transport controls and playback state.
 * - React to shell playlist events.
 */
'use strict';

import { createFrameBroker } from './broker.js';

const EXT_PSX = ['psf', 'minipsf', 'psf2', 'minipsf2', 'psflib'];
const EXT_SNES = ['spc', 'rsn'];
const EXT_NEZ = ['bgm', 'opx', 'nsf', 'sng', 'kss'];
const EXT_N64 = ['usf', 'miniusf', 'usflib'];
const EXT_VGM = ['vgm', 'vgz', 'cmf', 'dro'];

const runtime = globalThis;
const BACKEND_SCRIPT_BY_TYPE = {
    psx: '/wasm/backend_psx.js',
    snes: '/wasm/backend_snes.js',
    nez: '/wasm/backend_nez.js',
    n64: '/wasm/backend_n64.js',
    vgm: '/wasm/backend_vgm.js',
};
const BACKEND_LOAD_TIMEOUT_MS = 15000;
const SEEK_POLL_MS = 250;
const DEFAULT_MEDIA_SEEK_OFFSET_SEC = 10;

let currentIndex = -1;
let busy = false;
let tracks = [];
let seekDragging = false;
let seekMaxMs = 0;
const backendLoadPromises = new Map();

const broker = createFrameBroker({
    serviceId: 'player',
    targetOrigin: window.location.origin,
    requestTimeoutMs: 4000,
    allowedOrigins: [window.location.origin],
});

const mediaSessionState = {
    handlersBound: false,
    metadataKey: '',
    playbackState: 'none',
    positionStateKey: '',
};

// ScriptNodePlayer drives audio via the Web Audio API, which does not expose an
// HTMLMediaElement. Chrome only keeps the OS media controls (and Media Session)
// alive while a media element is playing or paused, so it tears the session down
// a few seconds after Web Audio output stops on pause. We anchor the session to
// a silent, looping <audio> element whose play/pause state mirrors real
// playback; pausing it (rather than stopping/removing it) keeps the OS card
// visible just like a normal paused audio track.
let silenceAnchorEl = null;
let silenceAnchorUrl = '';

function createSilentWavUrl() {
    const sampleRate = 8000;
    const numSamples = sampleRate; // 1 second of silence, looped.
    const dataSize = numSamples; // 8-bit mono.
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset, text) => {
        for (let i = 0; i < text.length; i++) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true); // byteRate (sampleRate * blockAlign)
    view.setUint16(32, 1, true); // blockAlign
    view.setUint16(34, 8, true); // bitsPerSample
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < numSamples; i++) {
        view.setUint8(44 + i, 128); // 8-bit PCM silence midpoint
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
}

function ensureSilenceAnchor() {
    if (silenceAnchorEl) return silenceAnchorEl;

    silenceAnchorUrl = createSilentWavUrl();
    silenceAnchorEl = new Audio();
    silenceAnchorEl.src = silenceAnchorUrl;
    silenceAnchorEl.loop = true;
    silenceAnchorEl.preload = 'auto';
    // Must stay unmuted with non-zero volume; muted elements do not anchor a
    // media session. The content itself is silent, so nothing is audible.
    silenceAnchorEl.volume = 1;
    return silenceAnchorEl;
}

function startSilenceAnchor() {
    const el = ensureSilenceAnchor();
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
            // Autoplay restrictions; the next user gesture will retry.
        });
    }
}

function pauseSilenceAnchor() {
    if (silenceAnchorEl) {
        silenceAnchorEl.pause();
    }
}

const els = {
    prev: document.getElementById('prevBtn'),
    play: document.getElementById('playBtn'),
    next: document.getElementById('nextBtn'),
    thumb: document.querySelector('.thumb'),
    status: document.getElementById('status'),
    trackTitle: document.getElementById('currentTrackTitle'),
    trackMeta: document.getElementById('currentTrackMeta'),
    seekWrap: document.getElementById('seekWrap'),
    seekBar: document.getElementById('seekBar'),
    volumeBar: document.getElementById('volumeBar'),
    timeCurrent: document.getElementById('timeCurrent'),
    timeTotal: document.getElementById('timeTotal'),
};

function normalizeInfoMap(info) {
    const normalized = {};
    if (!info || typeof info !== 'object') return normalized;

    for (const [key, value] of Object.entries(info)) {
        normalized[String(key).toLowerCase()] = value;
    }
    return normalized;
}

function firstInfoValue(infoMap, keys) {
    for (const key of keys) {
        const value = infoMap[key];
        if (value === undefined || value === null || value === '') continue;
        return String(value);
    }
    return null;
}

function extOf(file) {
    return file.slice(file.lastIndexOf('.') + 1).toLowerCase();
}

function typeOf(file) {
    const ext = extOf(file);
    if (EXT_VGM.includes(ext)) return 'vgm';
    if (EXT_N64.includes(ext)) return 'n64';
    if (EXT_NEZ.includes(ext)) return 'nez';
    if (EXT_SNES.includes(ext)) return 'snes';
    if (EXT_PSX.includes(ext)) return 'psx';
    return null;
}

function updateNowPlayingMeta(track, songInfo) {
    const infoMap = normalizeInfoMap(songInfo);

    const title = firstInfoValue(infoMap, ['title', 'song', 'track', 'name']) || (track ? track.title : 'No track selected');
    const game = firstInfoValue(infoMap, ['game', 'album', 'source', 'system']) || (track ? (track.game || 'Unknown game') : 'Unknown game');

    if (els.trackTitle) {
        els.trackTitle.textContent = title;
    }
    if (els.trackMeta) {
        const typeLabel = track ? (typeOf(track.file) || track.platform || '?').toUpperCase() : '?';
        els.trackMeta.textContent = game + ' - ' + typeLabel;
    }

    syncMediaSessionMetadata(track, infoMap);
}

function updateNowPlayingThumb(track) {
    if (!els.thumb) return;

    const coverArt = track && typeof track.coverArt === 'string' ? track.coverArt.trim() : '';
    if (!coverArt) {
        els.thumb.style.removeProperty('--thumb-bg');
        return;
    }

    let resolvedCoverArt = coverArt;
    try {
        resolvedCoverArt = new URL(coverArt, window.location.href).toString();
    } catch (_error) {
        // Keep original value; CSS will ignore malformed URLs.
    }

    els.thumb.style.setProperty('--thumb-bg', 'url("' + resolvedCoverArt.replace(/"/g, '\\"') + '")');

    // Keep media session artwork aligned when only cover art changed.
    syncMediaSessionMetadata(track, normalizeInfoMap(readSongInfo()));
}

function supportsMediaSession() {
    return typeof navigator !== 'undefined' && !!navigator.mediaSession;
}

function safeSetMediaActionHandler(action, handler) {
    if (!supportsMediaSession()) return;
    try {
        navigator.mediaSession.setActionHandler(action, handler);
    } catch (_error) {
        // Unsupported action on this browser/OS combination.
    }
}

function getPreferredTrackArtist(track) {
    if (track && typeof track.artist === 'string' && track.artist.trim()) {
        return track.artist.trim();
    }

    const infoMap = normalizeInfoMap(readSongInfo());
    return firstInfoValue(infoMap, ['artist', 'composer', 'arranger']) || '';
}

function createMediaArtworkList(track) {
    const coverArt = track && typeof track.coverArt === 'string' ? track.coverArt.trim() : '';
    if (!coverArt) return [];

    let src = coverArt;
    try {
        src = new URL(coverArt, window.location.href).toString();
    } catch (_error) {
        // Keep original value.
    }

    return [{ src }];
}

function buildMediaMetadataPayload(track, infoMap) {
    const normalized = normalizeInfoMap(infoMap);
    const title = firstInfoValue(normalized, ['title', 'song', 'track', 'name']) || (track ? track.title : 'Trackify');
    const album = firstInfoValue(normalized, ['game', 'album', 'source']) || (track ? (track.game || '') : '');
    const artist = firstInfoValue(normalized, ['artist', 'composer', 'arranger']) || getPreferredTrackArtist(track);
    const artwork = createMediaArtworkList(track);

    return {
        title,
        artist,
        album,
        artwork,
    };
}

function publishMediaSessionSync(partialPayload = {}) {
    const track = tracks[currentIndex] || null;
    const infoMap = normalizeInfoMap(readSongInfo());
    const metadata = buildMediaMetadataPayload(track, infoMap);
    const player = runtime.ScriptNodePlayer.getInstance();
    let playbackState = 'none';
    if (player) {
        playbackState = player.isPaused() ? 'paused' : 'playing';
    } else if (track) {
        // Some backends briefly drop player instance visibility while paused.
        // Preserve a stable session state so OS media controls don't disappear.
        playbackState = mediaSessionState.playbackState === 'playing' ? 'playing' : 'paused';
    }

    broker.publish('player.mediaSessionSync', {
        metadata,
        playbackState,
        positionState: getPositionStatePayload(),
        capabilities: {
            hasTracks: tracks.length > 0,
            hasCurrentTrack: !!track,
            supportsSeekTo: !!(player && Number.isFinite(seekMaxMs) && seekMaxMs > 0),
            supportsSeekStep: !!(player && Number.isFinite(seekMaxMs) && seekMaxMs > 0),
            canGoNext: tracks.length > 1,
            canGoPrevious: tracks.length > 1,
        },
        ...partialPayload,
    }, { target: 'shell' });
}

function syncMediaSessionMetadata(track, infoMap) {
    const metadata = buildMediaMetadataPayload(track, infoMap);
    const metadataKey = JSON.stringify(metadata);

    if (supportsMediaSession() && mediaSessionState.metadataKey !== metadataKey) {
        try {
            navigator.mediaSession.metadata = new MediaMetadata(metadata);
            mediaSessionState.metadataKey = metadataKey;
        } catch (_error) {
            // Ignore metadata assignment failures.
        }
    }

    publishMediaSessionSync({ metadata });
}

function getPositionStatePayload() {
    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player || !Number.isFinite(seekMaxMs) || seekMaxMs <= 0) {
        return null;
    }

    let position = 0;
    try {
        position = player.getPlaybackPosition();
    } catch (_error) {
        return null;
    }
    if (!Number.isFinite(position)) {
        return null;
    }

    return {
        duration: Math.max(0, seekMaxMs) / 1000,
        playbackRate: 1,
        position: Math.max(0, Math.min(seekMaxMs, position)) / 1000,
    };
}

function syncMediaSessionPlaybackState(forcedState) {
    const player = runtime.ScriptNodePlayer.getInstance();
    const playbackState = typeof forcedState === 'string'
        ? forcedState
        : (player ? (player.isPaused() ? 'paused' : 'playing') : 'none');

    if (supportsMediaSession() && mediaSessionState.playbackState !== playbackState) {
        try {
            navigator.mediaSession.playbackState = playbackState;
            mediaSessionState.playbackState = playbackState;
        } catch (_error) {
            // Ignore playback state assignment failures.
        }
    }

    publishMediaSessionSync({ playbackState });
}

function syncMediaSessionPositionState() {
    const positionState = getPositionStatePayload();
    const key = JSON.stringify(positionState);

    if (supportsMediaSession() && positionState && mediaSessionState.positionStateKey !== key) {
        try {
            navigator.mediaSession.setPositionState(positionState);
            mediaSessionState.positionStateKey = key;
        } catch (_error) {
            // Ignore unsupported position state updates.
        }
    }

    publishMediaSessionSync({ positionState });
}

function playCurrentOrSelected() {
    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player) {
        if (currentIndex >= 0) {
            selectTrack(currentIndex, true);
        } else if (tracks.length > 0) {
            selectTrack(0, true);
        }
        return;
    }

    player.play();
    startSilenceAnchor();
    updatePlayButton();
    refreshSeekUi();
    setStatus('Playing');
    syncMediaSessionPlaybackState('playing');
}

function pausePlayback() {
    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player) return;

    player.pause();
    pauseSilenceAnchor();
    updatePlayButton();
    refreshSeekUi();
    setStatus('Paused');
    syncMediaSessionPlaybackState('paused');
}

function seekRelativeBySeconds(deltaSeconds) {
    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player || !Number.isFinite(deltaSeconds)) return;

    let currentMs = 0;
    try {
        currentMs = player.getPlaybackPosition();
    } catch (_error) {
        return;
    }
    if (!Number.isFinite(currentMs)) return;

    const maxMs = Number.isFinite(seekMaxMs) && seekMaxMs > 0 ? seekMaxMs : Number.POSITIVE_INFINITY;
    const targetMs = Math.max(0, Math.min(maxMs, currentMs + deltaSeconds * 1000));

    try {
        player.seekPlaybackPosition(targetMs);
    } catch (_error) {
        return;
    }

    refreshSeekUi();
    syncMediaSessionPositionState();
}

function seekToSeconds(seconds) {
    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player || !Number.isFinite(seconds)) return;

    const maxSec = Number.isFinite(seekMaxMs) && seekMaxMs > 0 ? seekMaxMs / 1000 : Number.POSITIVE_INFINITY;
    const targetMs = Math.max(0, Math.min(maxSec, seconds)) * 1000;

    try {
        player.seekPlaybackPosition(targetMs);
    } catch (_error) {
        return;
    }

    refreshSeekUi();
    syncMediaSessionPositionState();
}

function bindMediaSessionHandlers() {
    if (!supportsMediaSession() || mediaSessionState.handlersBound) {
        return;
    }

    safeSetMediaActionHandler('play', () => {
        playCurrentOrSelected();
    });
    safeSetMediaActionHandler('pause', () => {
        pausePlayback();
    });
    safeSetMediaActionHandler('previoustrack', () => {
        if (!tracks.length) return;
        selectTrack((currentIndex - 1 + tracks.length) % tracks.length, true);
    });
    safeSetMediaActionHandler('nexttrack', () => {
        if (!tracks.length) return;
        selectTrack((currentIndex + 1 + tracks.length) % tracks.length, true);
    });
    safeSetMediaActionHandler('seekbackward', (details) => {
        const step = Number(details && details.seekOffset);
        seekRelativeBySeconds(-(Number.isFinite(step) && step > 0 ? step : DEFAULT_MEDIA_SEEK_OFFSET_SEC));
    });
    safeSetMediaActionHandler('seekforward', (details) => {
        const step = Number(details && details.seekOffset);
        seekRelativeBySeconds(Number.isFinite(step) && step > 0 ? step : DEFAULT_MEDIA_SEEK_OFFSET_SEC);
    });
    safeSetMediaActionHandler('seekto', (details) => {
        const target = Number(details && details.seekTime);
        seekToSeconds(target);
    });
    safeSetMediaActionHandler('stop', () => {
        pausePlayback();
    });

    mediaSessionState.handlersBound = true;
}

function formatMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '0:00';

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return String(hours) + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }
    return String(minutes) + ':' + String(seconds).padStart(2, '0');
}

function setStatus(message) {
    if (els.status) {
        els.status.textContent = message;
    }

    broker.publish('player.stateChanged', {
        status: message,
        currentIndex,
        busy,
        hasTracks: tracks.length > 0,
    }, { target: 'shell' });
}

function setSeekUiEnabled(enabled) {
    if (!els.seekBar || !els.seekWrap) return;

    els.seekBar.disabled = !enabled;
    els.seekWrap.classList.toggle('disabled', !enabled);
}

function updateSeekBarFill() {
    if (!els.seekBar) return;

    const max = Number(els.seekBar.max) || 1;
    const value = Number(els.seekBar.value) || 0;
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    els.seekBar.style.setProperty('--seek-progress', pct + '%');
}

function updateVolumeBarFill() {
    if (!els.volumeBar) return;

    const max = Number(els.volumeBar.max) || 100;
    const value = Number(els.volumeBar.value) || 0;
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    els.volumeBar.style.setProperty('--volume-progress', pct + '%');
}

function applyVolumeFromSlider() {
    if (!els.volumeBar) return;

    const value = Number(els.volumeBar.value);
    if (!Number.isFinite(value)) return;

    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player) return;

    player.setVolume(Math.max(0, Math.min(100, value)) / 100);
}

function syncVolumeUiFromPlayer() {
    if (!els.volumeBar) return;

    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player) return;

    const volume = player.getVolume();
    if (!Number.isFinite(volume)) return;

    const clamped = Math.max(0, Math.min(1, volume));
    els.volumeBar.value = String(Math.round(clamped * 100));
    updateVolumeBarFill();
}

function resetSeekUi() {
    seekDragging = false;
    seekMaxMs = 0;
    if (!els.seekBar || !els.timeCurrent || !els.timeTotal) return;

    els.seekBar.max = '100';
    els.seekBar.value = '0';
    els.timeCurrent.textContent = '0:00';
    els.timeTotal.textContent = '0:00';
    updateSeekBarFill();
    setSeekUiEnabled(false);
}

function refreshSeekUi() {
    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player) {
        resetSeekUi();
        return;
    }

    let maxMs = -1;
    try {
        maxMs = player.getMaxPlaybackPosition();
    } catch (_error) {
        resetSeekUi();
        return;
    }

    if (!Number.isFinite(maxMs) || maxMs <= 0) {
        resetSeekUi();
        return;
    }

    const normalizedMaxMs = Math.floor(maxMs);
    if (normalizedMaxMs !== seekMaxMs && els.seekBar) {
        seekMaxMs = normalizedMaxMs;
        els.seekBar.max = String(seekMaxMs);
    }
    setSeekUiEnabled(true);

    if (els.timeTotal) {
        els.timeTotal.textContent = formatMs(seekMaxMs);
    }

    if (seekDragging || !els.seekBar) return;

    let positionMs = 0;
    try {
        positionMs = player.getPlaybackPosition();
    } catch (_error) {
        return;
    }
    if (!Number.isFinite(positionMs) || positionMs < 0) {
        positionMs = 0;
    }

    const clampedPosition = Math.max(0, Math.min(seekMaxMs, Math.floor(positionMs)));
    els.seekBar.value = String(clampedPosition);
    updateSeekBarFill();
    if (els.timeCurrent) {
        els.timeCurrent.textContent = formatMs(clampedPosition);
    }

    syncMediaSessionPositionState();
}

// Modern Emscripten dropped Module.Pointer_stringify, but some legacy adapters
// still call it. Install a lazy shim that resolves UTF8ToString at call time.
function installPointerStringifyShim(moduleNamespace) {
    if (moduleNamespace && moduleNamespace.Module && !moduleNamespace.Module.Pointer_stringify) {
        const moduleRef = moduleNamespace.Module;
        moduleRef.Pointer_stringify = function (ptr) { return moduleRef.UTF8ToString(ptr); };
    }
}

function getAdapterCtor(type) {
    if (type === 'vgm') {
        return runtime.VgmBackendAdapter ||
            (typeof VgmBackendAdapter !== 'undefined' ? VgmBackendAdapter : null);
    }
    if (type === 'n64') {
        return runtime.N64BackendAdapter ||
            (typeof N64BackendAdapter !== 'undefined' ? N64BackendAdapter : null);
    }
    if (type === 'nez') {
        return runtime.NEZBackendAdapter ||
            (typeof NEZBackendAdapter !== 'undefined' ? NEZBackendAdapter : null);
    }
    if (type === 'snes') {
        return runtime.SNESBackendAdapter ||
            (typeof SNESBackendAdapter !== 'undefined' ? SNESBackendAdapter : null);
    }
    if (type === 'psx') {
        return runtime.PSXBackendAdapter ||
            (typeof PSXBackendAdapter !== 'undefined' ? PSXBackendAdapter : null);
    }
    return null;
}

function isBackendReady(type) {
    const ctor = getAdapterCtor(type);
    if (!ctor) return false;

    const state = runtime['spp_backend_state_' + type.toUpperCase()];
    if (state && state.notReady) return false;
    return true;
}

function waitForBackendReady(type, timeoutMs) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;

        const poll = () => {
            if (isBackendReady(type)) {
                resolve();
                return;
            }
            if (Date.now() > deadline) {
                reject(new Error('Timed out while initializing ' + type.toUpperCase() + ' backend'));
                return;
            }
            setTimeout(poll, 25);
        };

        poll();
    });
}

function injectScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load runtime script: ' + src));
        document.head.appendChild(script);
    });
}

async function ensureBackendLoaded(type) {
    if (isBackendReady(type)) return;

    if (backendLoadPromises.has(type)) {
        await backendLoadPromises.get(type);
        return;
    }

    const scriptSrc = BACKEND_SCRIPT_BY_TYPE[type];
    if (!scriptSrc) {
        throw new Error('Unknown backend type: ' + type);
    }

    const pending = (async () => {
        const scriptAlreadyPresent = document.querySelector('script[src="' + scriptSrc + '"]');
        if (!scriptAlreadyPresent) {
            await injectScript(scriptSrc);
        }
        await waitForBackendReady(type, BACKEND_LOAD_TIMEOUT_MS);
    })();

    backendLoadPromises.set(type, pending);
    try {
        await pending;
    } catch (err) {
        backendLoadPromises.delete(type);
        throw err;
    }
}

function makeAdapter(type) {
    const adapterCtor = getAdapterCtor(type);

    if (!adapterCtor) {
        throw new Error(type.toUpperCase() + ' backend adapter is not available');
    }

    if (type === 'vgm') {
        installPointerStringifyShim(runtime.backend_vgmPlay);
        return new adapterCtor('/sample-files/');
    }

    if (type === 'n64') {
        installPointerStringifyShim(runtime.backend_N64);
        return new adapterCtor();
    }

    if (type === 'nez') {
        installPointerStringifyShim(runtime.backend_NEZ);
        return new adapterCtor();
    }

    if (type === 'snes') {
        installPointerStringifyShim(runtime.backend_SNES);
        return new adapterCtor();
    }

    return new adapterCtor();
}

function readSongInfo() {
    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player) return null;

    let info;
    try {
        info = player.getSongInfo();
    } catch (_error) {
        return null;
    }

    if (!info) return null;
    return info;
}

function updatePlayButton() {
    if (!els.play) return;

    const player = runtime.ScriptNodePlayer.getInstance();
    const paused = !player || player.isPaused();
    els.play.innerHTML = paused
        ? '<span class="material-symbols-outlined filled">play_arrow</span>'
        : '<span class="material-symbols-outlined filled">pause</span>';
}

function publishTrackChanged() {
    broker.publish('player.trackChanged', {
        index: currentIndex,
        track: tracks[currentIndex] || null,
    }, { target: 'shell' });
}

async function selectTrack(index, autoplay) {
    if (busy) return;
    const track = tracks[index];
    if (!track) return;

    const type = typeOf(track.file);
    if (!type) {
        setStatus('Unsupported file type: ' + track.file);
        return;
    }

    busy = true;
    currentIndex = index;
    publishTrackChanged();

    if (!isBackendReady(type)) {
        setStatus('Loading ' + type.toUpperCase() + ' backend...');
    } else {
        setStatus('Loading "' + track.title + '"...');
    }
    updateNowPlayingMeta(track, null);
    updateNowPlayingThumb(track);
    resetSeekUi();

    try {
        await ensureBackendLoaded(type);

        setStatus('Loading "' + track.title + '"...');

        // A fresh adapter is created per selection; ScriptNodePlayer.initialize()
        // tears down the previous backend pipeline before wiring up the new one.
        const adapter = makeAdapter(type);
        await runtime.ScriptNodePlayer.initialize(adapter, onTrackEnd, [], false);
        await runtime.ScriptNodePlayer.loadMusicFromURL(track.file, {});

        const songInfo = readSongInfo();
        updateNowPlayingMeta(track, songInfo);
        updateNowPlayingThumb(track);
        syncVolumeUiFromPlayer();
        refreshSeekUi();

        const player = runtime.ScriptNodePlayer.getInstance();
        if (autoplay && player) {
            player.play();
            startSilenceAnchor();
        }

        updatePlayButton();
        setStatus(autoplay ? 'Playing' : 'Ready');
        syncMediaSessionPlaybackState();
        syncMediaSessionPositionState();
    } catch (error) {
        console.error('Failed to load track', error);
        setStatus('Error loading "' + track.title + '" (see console)');
        syncMediaSessionPlaybackState();
    } finally {
        busy = false;
    }
}

function onTrackEnd() {
    if (!tracks.length) return;

    const next = (currentIndex + 1) % tracks.length;
    selectTrack(next, true);
}

function togglePlay() {
    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player) {
        if (currentIndex >= 0) {
            selectTrack(currentIndex, true);
        }
        return;
    }

    if (player.isPaused()) {
        player.play();
        startSilenceAnchor();
    } else {
        player.pause();
        pauseSilenceAnchor();
    }

    updatePlayButton();
    refreshSeekUi();
    setStatus(player.isPaused() ? 'Paused' : 'Playing');
    syncMediaSessionPlaybackState();
}

function handlePlaylistSelected(payload, autoplay) {
    if (!payload || !Array.isArray(payload.tracks)) return;

    tracks = payload.tracks
        .filter((track) => track && typeof track.title === 'string' && typeof track.file === 'string')
        .map((track) => ({
            id: track.id,
            title: track.title,
            file: track.file,
            platform: typeof track.platform === 'string' ? track.platform : '',
            game: typeof track.game === 'string' ? track.game : '',
            artist: typeof track.artist === 'string' ? track.artist : '',
            coverArt: typeof track.coverArt === 'string' ? track.coverArt : '',
        }));

    if (!tracks.length) {
        currentIndex = -1;
        updateNowPlayingMeta(null, null);
        updateNowPlayingThumb(null);
        setStatus('Playlist is empty');
        return;
    }

    const preferredIndex = Number.isInteger(payload.selectedIndex) ? payload.selectedIndex : 0;
    const boundedIndex = Math.max(0, Math.min(tracks.length - 1, preferredIndex));
    currentIndex = boundedIndex;
    updateNowPlayingMeta(tracks[currentIndex], null);
    updateNowPlayingThumb(tracks[currentIndex]);
    setStatus('Playlist loaded');
    if (autoplay) {
        selectTrack(currentIndex, true);
    }
}

function bindBrokerHandlers() {
    broker.subscribe('playlist.selected', ({ payload }) => {
        const autoplay = payload && payload.autoplay === true;
        handlePlaylistSelected(payload, autoplay);
    });

    broker.subscribe('player.toggle', () => {
        togglePlay();
    });

    broker.subscribe('player.play', () => {
        playCurrentOrSelected();
    });

    broker.subscribe('player.pause', () => {
        pausePlayback();
    });

    broker.subscribe('player.next', () => {
        if (!tracks.length) return;
        selectTrack((currentIndex + 1 + tracks.length) % tracks.length, true);
    });

    broker.subscribe('player.prev', () => {
        if (!tracks.length) return;
        selectTrack((currentIndex - 1 + tracks.length) % tracks.length, true);
    });

    broker.subscribe('player.seek.relative', ({ payload }) => {
        const seconds = Number(payload && payload.seconds);
        if (!Number.isFinite(seconds) || seconds === 0) return;
        seekRelativeBySeconds(seconds);
    });

    broker.subscribe('player.seek.absolute', ({ payload }) => {
        const seconds = Number(payload && payload.seconds);
        if (!Number.isFinite(seconds)) return;
        seekToSeconds(seconds);
    });
}

function bindUiHandlers() {
    if (els.play) {
        els.play.addEventListener('click', togglePlay);
    }

    if (els.next) {
        els.next.addEventListener('click', () => {
            if (!tracks.length) return;
            selectTrack((currentIndex + 1 + tracks.length) % tracks.length, true);
        });
    }

    if (els.prev) {
        els.prev.addEventListener('click', () => {
            if (!tracks.length) return;
            selectTrack((currentIndex - 1 + tracks.length) % tracks.length, true);
        });
    }

    if (els.seekBar) {
        els.seekBar.addEventListener('input', () => {
            if (els.seekBar.disabled) return;
            seekDragging = true;
            const pendingMs = Number(els.seekBar.value);
            updateSeekBarFill();
            if (els.timeCurrent) {
                els.timeCurrent.textContent = formatMs(pendingMs);
            }
        });

        els.seekBar.addEventListener('change', () => {
            if (els.seekBar.disabled) return;

            const player = runtime.ScriptNodePlayer.getInstance();
            if (!player) {
                seekDragging = false;
                return;
            }

            const targetMs = Number(els.seekBar.value);
            if (!Number.isFinite(targetMs)) {
                seekDragging = false;
                return;
            }

            try {
                player.seekPlaybackPosition(targetMs);
            } catch (error) {
                console.error('Seek failed', error);
            } finally {
                seekDragging = false;
                refreshSeekUi();
            }
        });
    }

    if (els.volumeBar) {
        updateVolumeBarFill();
        els.volumeBar.addEventListener('input', () => {
            updateVolumeBarFill();
            applyVolumeFromSlider();
        });
    }
}

function init() {
    bindBrokerHandlers();
    bindUiHandlers();
    bindMediaSessionHandlers();

    broker.start();
    broker.publish('player.ready', {
        message: 'Player frame initialized',
    }, { target: 'shell' });

    updatePlayButton();
    resetSeekUi();
    setStatus('Waiting for playlist...');
    syncMediaSessionMetadata(null, null);
    syncMediaSessionPlaybackState();
    publishMediaSessionSync();

    setInterval(refreshSeekUi, SEEK_POLL_MS);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}