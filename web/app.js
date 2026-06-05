/*
 * Trackify UI - minimal VGM player.
 *
 * Auto-selects an Emscripten backend by file extension (PSX, SNES, NEZ)
 * and drives the generic ScriptNodePlayer.
 */
'use strict';

const SAMPLE_INDEX_URL = 'sample-files/index.json';
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

const els = {
    list: document.getElementById('trackList'),
    prev: document.getElementById('prevBtn'),
    play: document.getElementById('playBtn'),
    next: document.getElementById('nextBtn'),
    status: document.getElementById('status'),
    info: document.getElementById('songInfo'),
    seekWrap: document.getElementById('seekWrap'),
    seekBar: document.getElementById('seekBar'),
    timeCurrent: document.getElementById('timeCurrent'),
    timeTotal: document.getElementById('timeTotal'),
};

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

function setSeekUiEnabled(enabled) {
    els.seekBar.disabled = !enabled;
    els.seekWrap.classList.toggle('disabled', !enabled);
}

function resetSeekUi() {
    seekDragging = false;
    seekMaxMs = 0;
    els.seekBar.max = '100';
    els.seekBar.value = '0';
    els.timeCurrent.textContent = '0:00';
    els.timeTotal.textContent = '0:00';
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
    } catch (e) {
        resetSeekUi();
        return;
    }

    if (!Number.isFinite(maxMs) || maxMs <= 0) {
        resetSeekUi();
        return;
    }

    const normalizedMaxMs = Math.floor(maxMs);
    if (normalizedMaxMs !== seekMaxMs) {
        seekMaxMs = normalizedMaxMs;
        els.seekBar.max = String(seekMaxMs);
    }
    setSeekUiEnabled(true);

    els.timeTotal.textContent = formatMs(seekMaxMs);
    if (seekDragging) return;

    let positionMs = 0;
    try {
        positionMs = player.getPlaybackPosition();
    } catch (e) {
        return;
    }
    if (!Number.isFinite(positionMs) || positionMs < 0) {
        positionMs = 0;
    }

    const clampedPosition = Math.max(0, Math.min(seekMaxMs, Math.floor(positionMs)));
    els.seekBar.value = String(clampedPosition);
    els.timeCurrent.textContent = formatMs(clampedPosition);
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

// Modern Emscripten dropped Module.Pointer_stringify, but some legacy adapters
// still call it. Install a lazy shim that resolves UTF8ToString at call time.
function installPointerStringifyShim(moduleNamespace) {
    if (moduleNamespace && moduleNamespace.Module && !moduleNamespace.Module.Pointer_stringify) {
        const m = moduleNamespace.Module;
        m.Pointer_stringify = function (ptr) { return m.UTF8ToString(ptr); };
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

function setStatus(msg) { els.status.textContent = msg; }

function parseTracksManifest(data) {
    const entries = Array.isArray(data) ? data : data && Array.isArray(data.tracks) ? data.tracks : null;
    if (!entries) throw new Error('Invalid tracks manifest format');

    return entries
        .filter((entry) => entry && typeof entry.title === 'string' && typeof entry.file === 'string')
        .map((entry) => ({ title: entry.title, file: entry.file }));
}

async function loadTracks() {
    const res = await fetch(SAMPLE_INDEX_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to fetch tracks manifest: ' + res.status);
    const json = await res.json();
    tracks = parseTracksManifest(json);
}

function renderTracks() {
    els.list.innerHTML = '';
    tracks.forEach((t, i) => {
        const li = document.createElement('li');
        li.dataset.index = String(i);
        if (i === currentIndex) li.classList.add('active');

        const name = document.createElement('span');
        name.textContent = t.title;

        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = typeOf(t.file) || '?';

        li.append(name, badge);
        li.addEventListener('click', () => selectTrack(i, true));
        els.list.appendChild(li);
    });
}

function renderSongInfo() {
    els.info.innerHTML = '';
    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player) return;

    let info;
    try { info = player.getSongInfo(); } catch (e) { return; }
    if (!info) return;

    for (const key of Object.keys(info)) {
        const value = info[key];
        if (value === undefined || value === null || value === '') continue;

        const dt = document.createElement('dt');
        dt.textContent = key;
        const dd = document.createElement('dd');
        dd.textContent = String(value);
        els.info.append(dt, dd);
    }
}

function updatePlayButton() {
    const player = runtime.ScriptNodePlayer.getInstance();
    const paused = !player || player.isPaused();
    els.play.innerHTML = paused ? '&#9654;' : '&#10074;&#10074;';
}

async function selectTrack(index, autoplay) {
    if (busy) return;
    const track = tracks[index];
    if (!track) return;
    const type = typeOf(track.file);
    if (!type) { setStatus('Unsupported file type: ' + track.file); return; }

    busy = true;
    currentIndex = index;
    renderTracks();
    if (!isBackendReady(type)) {
        setStatus('Loading ' + type.toUpperCase() + ' backend...');
    } else {
        setStatus('Loading "' + track.title + '"\u2026');
    }
    els.info.innerHTML = '';
    resetSeekUi();

    try {
        await ensureBackendLoaded(type);

        setStatus('Loading "' + track.title + '"\u2026');

        // A fresh adapter is created per selection; ScriptNodePlayer.initialize()
        // tears down the previous backend pipeline before wiring up the new one.
        const adapter = makeAdapter(type);
        await runtime.ScriptNodePlayer.initialize(adapter, onTrackEnd, [], false);
        await runtime.ScriptNodePlayer.loadMusicFromURL(SAMPLE_BASE_PATH + track.file, {});

        renderSongInfo();
    refreshSeekUi();
        const player = runtime.ScriptNodePlayer.getInstance();
        if (autoplay && player) player.play();
        updatePlayButton();
        setStatus(autoplay ? 'Playing' : 'Ready');
    } catch (err) {
        console.error('Failed to load track', err);
        setStatus('Error loading "' + track.title + '" (see console)');
    } finally {
        busy = false;
    }
}

function onTrackEnd() {
    if (!tracks.length) return;
    // Auto-advance to the next track.
    const next = (currentIndex + 1) % tracks.length;
    selectTrack(next, true);
}

function togglePlay() {
    const player = runtime.ScriptNodePlayer.getInstance();
    if (!player) {
        if (currentIndex >= 0) selectTrack(currentIndex, true);
        return;
    }
    if (player.isPaused()) player.play();
    else player.pause();
    updatePlayButton();
    refreshSeekUi();
    setStatus(player.isPaused() ? 'Paused' : 'Playing');
}

function init() {
    els.play.addEventListener('click', togglePlay);
    els.next.addEventListener('click', () => {
        if (!tracks.length) return;
        selectTrack((currentIndex + 1 + tracks.length) % tracks.length, true);
    });
    els.prev.addEventListener('click', () => {
        if (!tracks.length) return;
        selectTrack((currentIndex - 1 + tracks.length) % tracks.length, true);
    });
    els.seekBar.addEventListener('input', () => {
        if (els.seekBar.disabled) return;
        seekDragging = true;
        const pendingMs = Number(els.seekBar.value);
        els.timeCurrent.textContent = formatMs(pendingMs);
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
        } catch (err) {
            console.error('Seek failed', err);
        } finally {
            seekDragging = false;
            refreshSeekUi();
        }
    });
    setInterval(refreshSeekUi, SEEK_POLL_MS);

    setStatus('Loading track list...');
    loadTracks()
        .then(() => {
            renderTracks();
            if (!tracks.length) {
                setStatus('No tracks found in sample-files/index.json');
                return;
            }

            // Preload the first track's metadata (without autoplay - browsers require a
            // user gesture before audio can start).
            selectTrack(0, false);
        })
        .catch((err) => {
            console.error('Failed to load tracks', err);
            setStatus('Error loading sample-files/index.json (see console)');
        });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
