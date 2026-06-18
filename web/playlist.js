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
const EXT_GENH = ['genh'];

const els = {
    heroArt: document.querySelector('.hero-art'),
    heroEyebrow: document.getElementById('heroEyebrow'),
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
let favoriteTrackIds = new Set();

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
    if (EXT_GENH.includes(ext)) return 'genh';
    if (EXT_XA.includes(ext)) return 'xa';
    if (EXT_VGM.includes(ext)) return 'vgm';
    if (EXT_N64.includes(ext)) return 'n64';
    if (EXT_NEZ.includes(ext)) return 'nez';
    if (EXT_SNES.includes(ext)) return 'snes';
    if (EXT_PSX.includes(ext)) return 'psx';
    return null;
}

function applyFavoritesHeroState() {
    document.body.classList.add('is-favorites');
    if (els.heroEyebrow) els.heroEyebrow.textContent = 'Playlist';
    if (els.heroTitle) els.heroTitle.textContent = 'Liked Tracks';
    if (els.heroCompany) els.heroCompany.textContent = 'Your favorite tracks';
    if (els.heroYear) els.heroYear.textContent = '';
    if (els.heroMetaDot) els.heroMetaDot.style.display = 'none';
}

function clearFavoritesHeroState() {
    document.body.classList.remove('is-favorites');
    if (els.heroEyebrow) els.heroEyebrow.textContent = 'Game';
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

        const number = document.createElement('button');
        number.type = 'button';
        number.className = 'track-number';
        number.setAttribute('aria-label', 'Play ' + track.title);

        const numberLabel = document.createElement('span');
        numberLabel.className = 'track-number-label';
        numberLabel.textContent = String(index + 1);

        const numberPlay = document.createElement('span');
        numberPlay.className = 'track-number-play material-symbols-outlined filled';
        numberPlay.setAttribute('aria-hidden', 'true');
        numberPlay.textContent = 'play_arrow';

        number.append(numberLabel, numberPlay);
        number.addEventListener('click', () => {
            publishSelected(index, true);
        });

        const main = document.createElement('div');
        main.className = 'track-main';

        const meta = document.createElement('div');
        meta.className = 'track-meta';

        const name = document.createElement('span');
        name.className = 'track-name';
        name.textContent = track.title;

        const game = document.createElement('span');
        game.className = 'track-artist';
        game.textContent = track.game || PLACEHOLDER_GAME;

        meta.append(name, game);

        const favorite = document.createElement('button');
        favorite.type = 'button';
        favorite.className = 'track-favorite';
        const favoriteIcon = document.createElement('span');
        favoriteIcon.className = 'material-symbols-outlined';
        favoriteIcon.setAttribute('aria-hidden', 'true');
        favorite.append(favoriteIcon);
        applyFavoriteState(favorite, track, favoriteTrackIds.has(track.id));
        favorite.addEventListener('click', (event) => {
            event.stopPropagation();
            if (favoriteTrackIds.has(track.id)) {
                favoriteTrackIds.delete(track.id);
                broker.publish('playlist.unliked', { trackId: track.id }, { target: 'shell' });
            } else {
                favoriteTrackIds.add(track.id);
                broker.publish('playlist.liked', { trackId: track.id }, { target: 'shell' });
            }
            refreshFavoriteIcons();
        });

        main.append(meta, favorite);

        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = typeOf(track.file) || track.platform || '?';

        li.append(number, main, badge);
        els.list.appendChild(li);
    });
}

function applyFavoriteState(button, track, isFavorite) {
    button.classList.toggle('is-favorite', isFavorite);
    const icon = button.querySelector('.material-symbols-outlined');
    if (icon) {
        icon.textContent = isFavorite ? 'favorite' : 'favorite_border';
        icon.classList.toggle('filled', isFavorite);
    }
    button.setAttribute('aria-label', isFavorite
        ? 'Remove ' + track.title + ' from favorites'
        : 'Add ' + track.title + ' to favorites');
}

function refreshFavoriteIcons() {
    if (!els.list) return;
    const items = els.list.querySelectorAll('li');
    items.forEach((li) => {
        const index = Number(li.dataset.index);
        const track = tracks[index];
        if (!track) return;
        const button = li.querySelector('.track-favorite');
        if (!button) return;
        applyFavoriteState(button, track, favoriteTrackIds.has(track.id));
    });
}

async function queryFavorites() {
    let favorites = [];
    try {
        favorites = await broker.request('shell.queryFavorites', null, {
            target: 'shell',
            timeoutMs: 4000,
        });
    } catch (_error) {
        favorites = [];
    }
    favoriteTrackIds = new Set(
        Array.isArray(favorites) ? favorites.map((track) => track && track.id).filter((id) => typeof id === 'string') : []
    );
    refreshFavoriteIcons();
    return Array.isArray(favorites) ? favorites : [];
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
    const favorites = params.has('favorites');

    const filters = {};
    if (typeof game === 'string' && game.trim()) {
        filters.game = game.trim();
    }
    if (favorites) {
        filters.favorites = true;
    }
    return filters;
}

async function queryIndex(filters = {}) {
    try {
        const payload = await broker.request('shell.queryIndex', filters, {
            target: 'shell',
            timeoutMs: 15000,
        });
        handleIndexLoaded(payload);
        queryFavorites();
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

async function loadFavoritesPlaylist() {
    try {
        const favorites = await queryFavorites();
        handleIndexLoaded({
            source: 'favorites',
            tracks: favorites,
            selectedIndex: favorites.length > 0 ? 0 : -1,
        });
    } catch (error) {
        console.error('Failed to load favorites playlist', error);
        tracks = [];
        currentIndex = -1;
        renderTracks();
        setStatus('Error loading favorites (see console)');
    }
}

function evaluateFragmentParameters() {
    const filters = getIndexFiltersFromFragment();

    updateHeroArt('');

    if (filters.favorites) {
        applyFavoritesHeroState();
        loadFavoritesPlaylist();
        return;
    }

    clearFavoritesHeroState();
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

    broker.subscribe('player.stateChanged', ({ payload }) => {
        if (!payload) return;
        playerReady = true;
        if (typeof payload.status === 'string') {
            setStatus(payload.status);
        }

        if (payload.currentTrack !== undefined) {
            const currentTrackId = payload.currentTrack;
            let newIndex = -1;
            if (typeof currentTrackId === 'string' && currentTrackId) {
                newIndex = tracks.findIndex((track) => track && track.id === currentTrackId);
            }
            if (newIndex !== currentIndex) {
                currentIndex = newIndex;
                renderTracks();
            }
        }
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