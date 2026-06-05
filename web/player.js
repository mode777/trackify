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

const SAMPLE_BASE_PATH = 'sample-files/';
const EXT_PSX = ['psf', 'minipsf', 'psf2', 'minipsf2', 'psflib'];
const EXT_SNES = ['spc', 'rsn'];
const EXT_NEZ = ['bgm', 'opx', 'nsf', 'sng', 'kss'];
const EXT_N64 = ['usf', 'miniusf', 'usflib'];

const runtime = globalThis;
const BACKEND_SCRIPT_BY_TYPE = {
    psx: '/wasm/backend_psx.js',
    snes: '/wasm/backend_snes.js',
    nez: '/wasm/backend_nez.js',
    n64: '/wasm/backend_n64.js',
};
const BACKEND_LOAD_TIMEOUT_MS = 15000;
const SEEK_POLL_MS = 250;

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

const els = {
    prev: document.getElementById('prevBtn'),
    play: document.getElementById('playBtn'),
    next: document.getElementById('nextBtn'),
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
    resetSeekUi();

    try {
        await ensureBackendLoaded(type);

        setStatus('Loading "' + track.title + '"...');

        // A fresh adapter is created per selection; ScriptNodePlayer.initialize()
        // tears down the previous backend pipeline before wiring up the new one.
        const adapter = makeAdapter(type);
        await runtime.ScriptNodePlayer.initialize(adapter, onTrackEnd, [], false);
        await runtime.ScriptNodePlayer.loadMusicFromURL(SAMPLE_BASE_PATH + track.file, {});

        const songInfo = readSongInfo();
        updateNowPlayingMeta(track, songInfo);
        syncVolumeUiFromPlayer();
        refreshSeekUi();

        const player = runtime.ScriptNodePlayer.getInstance();
        if (autoplay && player) {
            player.play();
        }

        updatePlayButton();
        setStatus(autoplay ? 'Playing' : 'Ready');
    } catch (error) {
        console.error('Failed to load track', error);
        setStatus('Error loading "' + track.title + '" (see console)');
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
    } else {
        player.pause();
    }

    updatePlayButton();
    refreshSeekUi();
    setStatus(player.isPaused() ? 'Paused' : 'Playing');
}

function handlePlaylistSelected(payload) {
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
        }));

    if (!tracks.length) {
        currentIndex = -1;
        updateNowPlayingMeta(null, null);
        setStatus('Playlist is empty');
        return;
    }

    const preferredIndex = Number.isInteger(payload.selectedIndex) ? payload.selectedIndex : 0;
    const boundedIndex = Math.max(0, Math.min(tracks.length - 1, preferredIndex));
    currentIndex = boundedIndex;
    updateNowPlayingMeta(tracks[currentIndex], null);
    setStatus('Playlist loaded');
}

function bindBrokerHandlers() {
    broker.subscribe('playlist-selected', ({ payload }) => {
        handlePlaylistSelected(payload);
    });

    broker.subscribe('playlist-track-selected', ({ payload }) => {
        if (!payload || typeof payload.index !== 'number') return;
        const autoplay = payload.autoplay !== false;
        selectTrack(payload.index, autoplay);
    });

    broker.subscribe('player.toggle', () => {
        togglePlay();
    });

    broker.subscribe('player.next', () => {
        if (!tracks.length) return;
        selectTrack((currentIndex + 1 + tracks.length) % tracks.length, true);
    });

    broker.subscribe('player.prev', () => {
        if (!tracks.length) return;
        selectTrack((currentIndex - 1 + tracks.length) % tracks.length, true);
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

    broker.start();
    broker.publish('player.ready', {
        message: 'Player frame initialized',
    }, { target: 'shell' });

    updatePlayButton();
    resetSeekUi();
    setStatus('Waiting for playlist...');

    setInterval(refreshSeekUi, SEEK_POLL_MS);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}