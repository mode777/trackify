/*
 * Trackify games frame app.
 *
 * Responsibilities:
 * - Load games metadata from the shell service.
 * - Render the games grid in the content area.
 * - Open filtered playlist view when a game is selected.
 */
'use strict';

import { createFrameBroker } from './broker.js';

const els = {
    grid: document.getElementById('gamesGrid'),
    status: document.getElementById('gamesStatus'),
};

const broker = createFrameBroker({
    serviceId: 'games',
    targetOrigin: window.location.origin,
    requestTimeoutMs: 4000,
    allowedOrigins: [window.location.origin],
});

let games = [];

function setStatus(message) {
    if (!els.status) return;
    els.status.textContent = message;
}

function filtersFromFragment() {
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
    const platform = params.get('platform');
    const filters = {};

    if (typeof game === 'string' && game.trim()) {
        filters.game = game.trim();
    }

    if (typeof platform === 'string' && platform.trim()) {
        filters.platform = platform.trim();
    }

    return filters;
}

function safeCoverArtUrl(coverArt) {
    if (typeof coverArt !== 'string' || !coverArt.trim()) return '';

    try {
        return new URL(coverArt, window.location.href).toString();
    } catch {
        return coverArt;
    }
}

function buildMetaLine(game) {
    const company = Array.isArray(game.company)
        ? game.company.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean).join(', ')
        : '';

    const year = typeof game.year === 'string' ? game.year.trim() : '';
    return { company, year };
}

function openPlaylist(gameTitle) {
    const target = '/playlist.html#?game=' + encodeURIComponent(gameTitle);
    window.location.assign(target);
}

async function playGame(gameTitle) {
    if (typeof gameTitle !== 'string' || !gameTitle.trim()) return;

    setStatus('Loading tracks for ' + gameTitle + '...');

    try {
        const payload = await broker.request('shell.queryIndex', { game: gameTitle }, {
            target: 'shell',
            timeoutMs: 15000,
        });

        if (!payload || (typeof payload.error === 'string' && payload.error)) {
            setStatus(payload && typeof payload.error === 'string' && payload.error
                ? payload.error
                : 'No playlist payload returned');
            return;
        }

        const tracks = Array.isArray(payload.tracks)
            ? payload.tracks.filter((track) => track && typeof track.title === 'string' && typeof track.file === 'string')
            : [];

        if (!tracks.length) {
            setStatus('No tracks found for ' + gameTitle);
            return;
        }

        const preferredIndex = Number.isInteger(payload.selectedIndex) ? payload.selectedIndex : 0;
        const selectedIndex = Math.max(0, Math.min(tracks.length - 1, preferredIndex));

        broker.publish('playlist.selected', {
            source: typeof payload.source === 'string' ? payload.source : 'sample-files/index.json',
            selectedIndex,
            tracks,
            autoplay: true,
        }, { target: 'player' });

        setStatus('Now playing ' + gameTitle);
    } catch (error) {
        console.error('Failed to query shell index for game playback', error);
        setStatus('Error loading sample-files/index.json (see console)');
    }
}

function renderGames() {
    if (!els.grid) return;

    els.grid.innerHTML = '';

    games.forEach((game) => {
        const item = document.createElement('li');
        item.className = 'game-card';

        const card = document.createElement('div');
        card.className = 'game-link';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Open playlist for ' + game.title);

        const cover = document.createElement('div');
        cover.className = 'game-cover';
        const coverUrl = safeCoverArtUrl(game.coverArt);
        if (coverUrl) {
            cover.classList.add('has-art');
            cover.style.setProperty('--cover-url', 'url("' + coverUrl.replace(/"/g, '\\"') + '")');
        }

        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.className = 'game-play-button material-symbols-outlined filled';
        playButton.textContent = 'play_arrow';
        playButton.setAttribute('aria-label', 'Play ' + game.title);
        cover.appendChild(playButton);

        const body = document.createElement('div');
        body.className = 'game-body';

        const title = document.createElement('h3');
        title.className = 'game-title';
        title.textContent = game.title;

        const meta = buildMetaLine(game);
        const metaRow = document.createElement('p');
        metaRow.className = 'game-meta';

        const companyText = meta.company || 'Unknown company';
        const yearText = meta.year || 'Unknown year';
        const inlineMeta = meta.company && meta.year
            ? companyText + ' \u00b7 ' + yearText
            : companyText + ' ' + yearText;
        metaRow.textContent = inlineMeta;

        body.append(title, metaRow);
        card.append(cover, body);
        item.appendChild(card);
        els.grid.appendChild(item);

        card.addEventListener('click', () => {
            openPlaylist(game.id);
        });

        card.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openPlaylist(game.id);
        });

        playButton.addEventListener('click', (event) => {
            event.stopPropagation();
            playGame(game.title);
        });
    });
}

function handleGamesPayload(payload) {
    if (!payload) return;

    if (typeof payload.error === 'string' && payload.error) {
        games = [];
        renderGames();
        setStatus(payload.error);
        return;
    }

    if (!Array.isArray(payload.games)) {
        games = [];
        renderGames();
        setStatus('No games payload returned');
        return;
    }

    games = payload.games
        .filter((entry) => entry && typeof entry.title === 'string')
        .map((entry) => ({
            ...entry,
            title: entry.title.trim(),
            company: Array.isArray(entry.company) ? entry.company : [],
            year: typeof entry.year === 'string' ? entry.year : '',
            coverArt: typeof entry.coverArt === 'string' ? entry.coverArt : '',
        }));

    renderGames();

    if (!games.length) {
        setStatus('No games found');
        return;
    }

    setStatus('Loaded ' + games.length + ' games');
}

async function queryGames() {
    try {
        const payload = await broker.request('shell.queryGames', filtersFromFragment(), {
            target: 'shell',
            timeoutMs: 15000,
        });
        handleGamesPayload(payload);
    } catch (error) {
        console.error('Failed to query shell games index', error);
        games = [];
        renderGames();
        setStatus('Error loading sample-files/games.json (see console)');
    }
}

function init() {
    broker.start();
    setStatus('Waiting for library...');

    window.addEventListener('hashchange', queryGames);
    queryGames();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}