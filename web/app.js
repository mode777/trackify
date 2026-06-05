/*
 * Trackify shell app.
 *
 * Responsibilities in this phase:
 * - Load and render playlist metadata in the shell.
 * - Publish playlist events to the player iframe service.
 * - Keep shell selection state synced with player events.
 */
'use strict';

import { createShellBroker } from './broker.js';

const SAMPLE_INDEX_URL = 'sample-files/index.json';

const EXT_PSX = ['psf', 'minipsf', 'psf2', 'minipsf2', 'psflib'];
const EXT_SNES = ['spc', 'rsn'];
const EXT_NEZ = ['bgm', 'opx', 'nsf', 'sng', 'kss'];
const EXT_N64 = ['usf', 'miniusf', 'usflib'];
const PLACEHOLDER_GAME = 'Unknown game';

const els = {
    list: document.getElementById('trackList'),
    status: document.getElementById('status'),
    playerFrame: document.getElementById('playerFrame'),
};

let tracks = [];
let currentIndex = -1;
let playerReady = false;
let pendingPlayerEvents = [];

const shellBroker = createShellBroker({
    serviceId: 'shell',
    allowedServices: ['player'],
    allowedOrigins: [window.location.origin],
});

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

function setStatus(message) {
    if (els.status) {
        els.status.textContent = message;
    }
}

function parseTracksManifest(data) {
    const entries = Array.isArray(data) ? data : data && Array.isArray(data.tracks) ? data.tracks : null;
    if (!entries) throw new Error('Invalid tracks manifest format');

    return entries
        .filter((entry) => entry && typeof entry.title === 'string' && typeof entry.file === 'string')
        .map((entry, index) => ({
            id: 'sample-' + index,
            title: entry.title,
            file: entry.file,
            platform: typeof entry.platform === 'string' ? entry.platform.trim() : '',
            game: typeof entry.game === 'string' ? entry.game.trim() : '',
            artist: typeof entry.artist === 'string' ? entry.artist.trim() : '',
        }));
}

async function loadTracks() {
    const res = await fetch(SAMPLE_INDEX_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to fetch tracks manifest: ' + res.status);
    const json = await res.json();
    tracks = parseTracksManifest(json);
}

function renderTracks() {
    if (!els.list) return;

    els.list.innerHTML = '';
    tracks.forEach((track, index) => {
        const li = document.createElement('li');
        li.dataset.index = String(index);
        if (index === currentIndex) li.classList.add('active');

        const number = document.createElement('span');
        number.className = 'track-number';
        number.textContent = String(index + 1);

        const main = document.createElement('div');
        main.className = 'track-main';

        const name = document.createElement('span');
        name.className = 'track-name';
        name.textContent = track.title;

        const game = document.createElement('span');
        game.className = 'track-artist';
        game.textContent = track.game || PLACEHOLDER_GAME;

        main.append(name, game);

        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = typeOf(track.file) || track.platform || '?';

        li.append(number, main, badge);
        li.addEventListener('click', () => {
            currentIndex = index;
            renderTracks();
            publishToPlayer('playlist-track-selected', {
                index,
                autoplay: true,
            });
        });
        els.list.appendChild(li);
    });
}

function queuePlayerEvent(topic, payload) {
    pendingPlayerEvents.push({ topic, payload });
}

function flushQueuedPlayerEvents() {
    const queued = pendingPlayerEvents;
    pendingPlayerEvents = [];

    for (const item of queued) {
        sendEventToPlayer(item.topic, item.payload);
    }
}

function sendEventToPlayer(topic, payload) {
    shellBroker.publish(topic, payload, { target: 'player' });
}

function publishToPlayer(topic, payload) {
    if (!playerReady) {
        queuePlayerEvent(topic, payload);
        return;
    }

    try {
        sendEventToPlayer(topic, payload);
    } catch (error) {
        queuePlayerEvent(topic, payload);
    }
}

function publishPlaylistSelected() {
    publishToPlayer('playlist-selected', {
        playlistId: 'sample-files-index',
        source: SAMPLE_INDEX_URL,
        selectedIndex: tracks.length > 0 ? 0 : -1,
        tracks,
    });
}

function initBroker() {
    shellBroker.subscribe('player.ready', () => {
        playerReady = true;
        setStatus('Player connected');
        flushQueuedPlayerEvents();
    });

    shellBroker.subscribe('player.trackChanged', ({ payload }) => {
        if (!payload || typeof payload.index !== 'number') return;
        if (payload.index < 0 || payload.index >= tracks.length) return;

        currentIndex = payload.index;
        renderTracks();
    });

    shellBroker.subscribe('player.stateChanged', ({ payload }) => {
        if (!payload || typeof payload.status !== 'string') return;
        setStatus(payload.status);
    });

    shellBroker.start();
}

function init() {
    initBroker();

    if (els.playerFrame) {
        els.playerFrame.addEventListener('load', () => {
            setStatus('Waiting for player registration...');
        });
    }

    setStatus('Loading track list...');
    loadTracks()
        .then(() => {
            currentIndex = tracks.length > 0 ? 0 : -1;
            renderTracks();

            if (!tracks.length) {
                setStatus('No tracks found in sample-files/index.json');
                return;
            }

            publishPlaylistSelected();
        })
        .catch((error) => {
            console.error('Failed to load tracks', error);
            setStatus('Error loading sample-files/index.json (see console)');
        });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
