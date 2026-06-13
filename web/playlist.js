/*
 * Trackify playlist frame app.
 *
 * Responsibilities in this phase:
 * - Render playlist metadata in the content iframe.
 * - Publish playlist selection changes to the player service.
 * - Mirror player state back into playlist UI.
 */
'use strict';

import { createFrameBroker } from './broker.js';

const PLACEHOLDER_GAME = 'Unknown game';

const EXT_PSX = ['psf', 'minipsf', 'psf2', 'minipsf2', 'psflib'];
const EXT_SNES = ['spc', 'rsn'];
const EXT_NEZ = ['bgm', 'opx', 'nsf', 'sng', 'kss'];
const EXT_N64 = ['usf', 'miniusf', 'usflib'];
const EXT_VGM = ['vgm', 'vgz', 'cmf', 'dro'];
const EXT_XA = ['xa'];

const els = {
    heroArt: document.querySelector('.hero-art'),
    heroTitle: document.getElementById('heroTitle'),
    heroCompany: document.getElementById('heroCompany'),
    heroYear: document.getElementById('heroYear'),
    heroMetaDot: document.getElementById('heroMetaDot'),
    list: document.getElementById('trackList'),
    status: document.getElementById('status'),
    playButton: document.querySelector('.primary-action'),
};

const broker = createFrameBroker({
    serviceId: 'playlist',
    targetOrigin: window.location.origin,
    requestTimeoutMs: 4000,
    allowedOrigins: [window.location.origin],
});

let tracks = [];
let currentIndex = -1;
let playerReady = false;
let pendingSelection = null;
let playlistInfo = {};

function updateHeroArt(coverArt) {
    if (!els.heroArt) return;

    if (typeof coverArt !== 'string' || !coverArt.trim()) {
        els.heroArt.style.backgroundImage = '';
        return;
    }

    let resolvedCoverArt = coverArt;
    try {
        resolvedCoverArt = new URL(coverArt, window.location.href).toString();
    } catch {
        resolvedCoverArt = coverArt;
    }

    els.heroArt.style.backgroundImage = 'linear-gradient(rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.2)), url("' + resolvedCoverArt.replace(/"/g, '\\"') + '")';
    els.heroArt.style.backgroundSize = 'cover';
    els.heroArt.style.backgroundPosition = 'center';
}

function setHeroMetadata(gameEntry) {
    if (!gameEntry || typeof gameEntry !== 'object') return;

    const title = typeof gameEntry.title === 'string' ? gameEntry.title.trim() : '';
    const company = Array.isArray(gameEntry.company)
        ? gameEntry.company.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean).join(', ')
        : '';

    let year = '';
    if (typeof gameEntry.year === 'number' && Number.isFinite(gameEntry.year)) {
        year = String(Math.trunc(gameEntry.year));
    } else if (typeof gameEntry.year === 'string') {
        year = gameEntry.year.trim();
    }

    if (els.heroTitle && title) {
        els.heroTitle.textContent = title;
    }

    if (els.heroCompany) {
        els.heroCompany.textContent = company || 'Unknown company';
    }

    if (els.heroYear) {
        els.heroYear.textContent = year || 'Unknown year';
    }

    if (els.heroMetaDot) {
        const showDot = Boolean(company && year);
        els.heroMetaDot.style.display = showDot ? '' : 'none';
    }

    updateHeroArt(gameEntry.coverArt);
}

function extOf(file) {
    return file.slice(file.lastIndexOf('.') + 1).toLowerCase();
}

function typeOf(file) {
    const ext = extOf(file);
    if (EXT_XA.includes(ext)) return 'xa';
    if (EXT_VGM.includes(ext)) return 'vgm';
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
            publishSelected(index, true);
        });
        els.list.appendChild(li);
    });
}

function publishSelected(index, autoplay) {
    if (!tracks.length) return;

    currentIndex = Math.max(0, Math.min(tracks.length - 1, index));
    renderTracks();

    const payload = {
        source: playlistInfo.source,
        selectedIndex: currentIndex,
        tracks,
        autoplay,
    };

    if (!playerReady) {
        pendingSelection = payload;
    }

    if (playerReady) {
        pendingSelection = null;
    }
    broker.publish('playlist.selected', payload, { target: 'player' });
}

function playCurrentSelection() {
    if (!tracks.length) return;

    const selectedIndex = currentIndex >= 0 ? currentIndex : 0;
    publishSelected(selectedIndex, true);
}

function handleIndexLoaded(payload) {
    if (!payload) return;

    playlistInfo = {
        source: typeof payload.source === 'string' ? payload.source : 'sample-files/index.json',
    };

    if (typeof payload.error === 'string' && payload.error) {
        tracks = [];
        currentIndex = -1;
        renderTracks();
        setStatus(payload.error);
        return;
    }

    if (!Array.isArray(payload.tracks)) return;

    tracks = payload.tracks
        .filter((track) => track && typeof track.title === 'string' && typeof track.file === 'string')
        .map((track) => ({
            ...track,
            platform: typeof track.platform === 'string' ? track.platform : '',
            game: typeof track.game === 'string' ? track.game : '',
            artist: typeof track.artist === 'string' ? track.artist : '',
        }));

    if (!tracks.length) {
        currentIndex = -1;
        renderTracks();
        setStatus('No tracks found in sample-files/index.json');
        return;
    }

    const preferredIndex = Number.isInteger(payload.selectedIndex) ? payload.selectedIndex : 0;
    currentIndex = Math.max(0, Math.min(tracks.length - 1, preferredIndex));
    renderTracks();
    setStatus('Playlist loaded');
}

function getIndexFiltersFromFragment() {
    const hash = window.location.hash || '';
    const fragment = hash.startsWith('#') ? hash.slice(1) : hash;

    if (!fragment) return {};

    const queryString = fragment.startsWith('?')
        ? fragment.slice(1)
        : fragment.includes('?')
            ? fragment.slice(fragment.indexOf('?') + 1)
            : '';

    if (!queryString) return {};

    const params = new URLSearchParams(queryString);
    const game = params.get('game');

    if (typeof game !== 'string' || !game.trim()) return {};
    return { game: game.trim() };
}

async function queryIndex(filters = {}) {
    try {
        const payload = await broker.request('shell.queryIndex', filters, {
            target: 'shell',
            timeoutMs: 15000,
        });
        handleIndexLoaded(payload);
    } catch (error) {
        console.error('Failed to query shell index', error);
        tracks = [];
        currentIndex = -1;
        renderTracks();
        setStatus('Error loading sample-files/index.json (see console)');
    }
}

async function queryGames(filters = {}) {
    try {
        const payload = await broker.request('shell.queryGames', filters, {
            target: 'shell',
            timeoutMs: 15000,
        });

        if (!payload || typeof payload.error !== 'string' || payload.error) {
            return;
        }

        if (!Array.isArray(payload.games) || payload.games.length === 0) {
            return;
        }

        setHeroMetadata(payload.games[0]);
    } catch (error) {
        console.error('Failed to query shell games index', error);
    }
}

function evaluateFragmentParameters() {
    const filters = getIndexFiltersFromFragment();
    queryIndex(filters);

    if (typeof filters.game === 'string' && filters.game) {
        queryGames({ game: filters.game });
    }
}

function bindBrokerHandlers() {
    broker.subscribe('player.ready', () => {
        playerReady = true;

        if (pendingSelection) {
            broker.publish('playlist.selected', pendingSelection, { target: 'player' });
            pendingSelection = null;
        }
    });

    broker.subscribe('player.trackChanged', ({ payload }) => {
        if (!payload || typeof payload.index !== 'number') return;
        if (payload.index < 0 || payload.index >= tracks.length) return;

        playerReady = true;
        currentIndex = payload.index;
        renderTracks();
    });

    broker.subscribe('player.stateChanged', ({ payload }) => {
        if (!payload || typeof payload.status !== 'string') return;
        playerReady = true;
        setStatus(payload.status);
    });
}

function bindUiHandlers() {
    if (els.playButton) {
        els.playButton.addEventListener('click', playCurrentSelection);
    }

    if (els.heroArt) {
        els.heroArt.addEventListener('click', playCurrentSelection);
    }
}

function init() {
    bindBrokerHandlers();
    bindUiHandlers();
    broker.start();
    setStatus('Waiting for library...');

    window.addEventListener('hashchange', evaluateFragmentParameters);

    evaluateFragmentParameters();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}