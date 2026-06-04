/*
 * Trackify UI - minimal VGM player.
 *
 * Auto-selects the PSX (PSF) or SNES (SPC) Emscripten backend by file
 * extension and drives the generic ScriptNodePlayer.
 */
'use strict';

const TRACKS = [
    { title: 'Super James Pond - Codename RoboCod', file: 'super james pond - codename robocod.spc' },
    { title: '01 Main Menu', file: '01 main menu.minipsf' },
];

const EXT_PSX = ['psf', 'minipsf', 'psf2', 'minipsf2', 'psflib'];
const EXT_SNES = ['spc', 'rsn'];

let currentIndex = -1;
let busy = false;

const els = {
    list: document.getElementById('trackList'),
    prev: document.getElementById('prevBtn'),
    play: document.getElementById('playBtn'),
    next: document.getElementById('nextBtn'),
    status: document.getElementById('status'),
    info: document.getElementById('songInfo'),
};

function extOf(file) {
    return file.slice(file.lastIndexOf('.') + 1).toLowerCase();
}

function typeOf(file) {
    const ext = extOf(file);
    if (EXT_SNES.includes(ext)) return 'snes';
    if (EXT_PSX.includes(ext)) return 'psx';
    return null;
}

// Modern Emscripten dropped Module.Pointer_stringify, but snes_adapter.js still
// calls it. Install a lazy shim that resolves UTF8ToString at call time.
function installPointerStringifyShim() {
    if (typeof backend_SNES !== 'undefined' && backend_SNES.Module && !backend_SNES.Module.Pointer_stringify) {
        const m = backend_SNES.Module;
        m.Pointer_stringify = function (ptr) { return m.UTF8ToString(ptr); };
    }
}

function makeAdapter(type) {
    if (type === 'snes') {
        installPointerStringifyShim();
        return new SNESBackendAdapter();
    }
    return new PSXBackendAdapter();
}

function setStatus(msg) { els.status.textContent = msg; }

function renderTracks() {
    els.list.innerHTML = '';
    TRACKS.forEach((t, i) => {
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
    const player = ScriptNodePlayer.getInstance();
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
    const player = ScriptNodePlayer.getInstance();
    const paused = !player || player.isPaused();
    els.play.innerHTML = paused ? '&#9654;' : '&#10074;&#10074;';
}

async function selectTrack(index, autoplay) {
    if (busy) return;
    const track = TRACKS[index];
    const type = typeOf(track.file);
    if (!type) { setStatus('Unsupported file type: ' + track.file); return; }

    busy = true;
    currentIndex = index;
    renderTracks();
    setStatus('Loading "' + track.title + '"\u2026');
    els.info.innerHTML = '';

    try {
        // A fresh adapter is created per selection; ScriptNodePlayer.initialize()
        // tears down the previous backend pipeline before wiring up the new one.
        const adapter = makeAdapter(type);
        await ScriptNodePlayer.initialize(adapter, onTrackEnd, [], false);
        await ScriptNodePlayer.loadMusicFromURL(track.file, {});

        renderSongInfo();
        const player = ScriptNodePlayer.getInstance();
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
    // Auto-advance to the next track.
    const next = (currentIndex + 1) % TRACKS.length;
    selectTrack(next, true);
}

function togglePlay() {
    const player = ScriptNodePlayer.getInstance();
    if (!player) {
        if (currentIndex >= 0) selectTrack(currentIndex, true);
        return;
    }
    if (player.isPaused()) player.play();
    else player.pause();
    updatePlayButton();
    setStatus(player.isPaused() ? 'Paused' : 'Playing');
}

function init() {
    renderTracks();

    els.play.addEventListener('click', togglePlay);
    els.next.addEventListener('click', () => selectTrack((currentIndex + 1 + TRACKS.length) % TRACKS.length, true));
    els.prev.addEventListener('click', () => selectTrack((currentIndex - 1 + TRACKS.length) % TRACKS.length, true));

    // Preload the first track's metadata (without autoplay - browsers require a
    // user gesture before audio can start).
    selectTrack(0, false);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
