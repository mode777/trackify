/*
 * Trackify shell app.
 *
 * Responsibilities in this phase:
 * - Load playlist metadata in the shell.
 * - Publish shell events to embedded iframe services.
 */
'use strict';

import { createShellBroker } from './broker.js';

const SAMPLE_BASE_PATH = 'sample-files/';
const SAMPLE_INDEX_URL = SAMPLE_BASE_PATH + 'index.json';
const SAMPLE_GAMES_URL = SAMPLE_BASE_PATH + 'games.json';

const EXT_PSX = ['psf', 'minipsf', 'psf2', 'minipsf2', 'psflib'];
const EXT_SNES = ['spc', 'rsn'];
const EXT_NEZ = ['bgm', 'opx', 'nsf', 'sng', 'kss'];
const EXT_N64 = ['usf', 'miniusf', 'usflib'];
const EXT_VGM = ['vgm', 'vgz', 'cmf', 'dro'];

const INDEX_LOAD_ERROR_MESSAGE = 'Error loading ' + SAMPLE_INDEX_URL + ' (see console)';
const GAMES_LOAD_ERROR_MESSAGE = 'Error loading ' + SAMPLE_GAMES_URL + ' (see console)';

let indexTracks = [];
let indexLoadError = '';
let indexLoadPromise = null;
let games = [];
let gamesLoadError = '';
let gamesLoadPromise = null;

const shellBroker = createShellBroker({
    serviceId: 'shell',
    allowedServices: ['player', 'playlist', 'games'],
    allowedOrigins: [window.location.origin],
});

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

function parseTracksManifest(data) {
    const entries = Array.isArray(data) ? data : data && Array.isArray(data.tracks) ? data.tracks : null;
    if (!entries) throw new Error('Invalid tracks manifest format');

    return entries
        .filter((entry) => entry && typeof entry.title === 'string' && typeof entry.file === 'string')
        .map((entry, index) => ({
            ...entry,
            id: 'sample-' + index,
            platform: typeof entry.platform === 'string' ? entry.platform.trim() : '',
            game: typeof entry.game === 'string' ? entry.game.trim() : '',
            artist: typeof entry.artist === 'string' ? entry.artist.trim() : '',
            file: SAMPLE_BASE_PATH + entry.file,
            coverArt: (typeof entry.coverArt === 'string' && entry.coverArt.trim() !== '') ? SAMPLE_BASE_PATH + entry.coverArt : '',
        }));
}

function parseGamesManifest(data) {
    const entries = Array.isArray(data) ? data : data && Array.isArray(data.games) ? data.games : null;
    if (!entries) throw new Error('Invalid games manifest format');

    return entries
        .filter((entry) => entry && typeof entry.title === 'string')
        .map((entry, index) => ({
            ...entry,
            id: 'game-' + index,
            title: entry.title.trim(),
            platform: typeof entry.platform === 'string' ? entry.platform.trim() : '',
            year: typeof entry.year === 'string' ? entry.year.trim() : '',
            company: Array.isArray(entry.company)
                ? entry.company.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
                : [],
            coverArt: (typeof entry.coverArt === 'string' && entry.coverArt.trim() !== '') ? SAMPLE_BASE_PATH + entry.coverArt : '',
        }));
}

async function loadTracks() {
    const res = await fetch(SAMPLE_INDEX_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to fetch tracks manifest: ' + res.status);
    const json = await res.json();
    return parseTracksManifest(json);
}

async function loadGames() {
    const res = await fetch(SAMPLE_GAMES_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to fetch games manifest: ' + res.status);
    const json = await res.json();
    return parseGamesManifest(json);
}

function normalizeFilterValue(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function filterTracks(tracks, filters) {
    const gameFilter = normalizeFilterValue(filters && filters.game);
    const platformFilter = normalizeFilterValue(filters && filters.platform);

    if (!gameFilter && !platformFilter) {
        return tracks;
    }

    return tracks.filter((track) => {
        const gameValue = normalizeFilterValue(track.game);
        const platformValue = normalizeFilterValue(track.platform || typeOf(track.file));

        if (gameFilter && gameValue !== gameFilter) return false;
        if (platformFilter && platformValue !== platformFilter) return false;
        return true;
    });
}

function filterGames(entries, filters) {
    const gameFilter = normalizeFilterValue(filters && filters.game);
    const platformFilter = normalizeFilterValue(filters && filters.platform);

    if (!gameFilter && !platformFilter) {
        return entries;
    }

    return entries.filter((entry) => {
        const gameValue = normalizeFilterValue(entry.title);
        const platformValue = normalizeFilterValue(entry.platform || typeOf(entry.coverArt));

        if (gameFilter && gameValue !== gameFilter) return false;
        if (platformFilter && platformValue !== platformFilter) return false;
        return true;
    });
}

function makeIndexPayload(tracks, errorMessage = '') {
    return {
        playlistId: 'sample-files-index',
        source: SAMPLE_INDEX_URL,
        selectedIndex: tracks.length > 0 ? 0 : -1,
        tracks,
        error: errorMessage,
    };
}

function makeGamesPayload(entries, errorMessage = '') {
    return {
        gamesId: 'sample-files-games',
        source: SAMPLE_GAMES_URL,
        selectedIndex: entries.length > 0 ? 0 : -1,
        games: entries,
        error: errorMessage,
    };
}

function ensureIndexLoaded() {
    if (indexLoadPromise) {
        return indexLoadPromise;
    }

    indexLoadPromise = loadTracks()
        .then((tracks) => {
            indexTracks = tracks;
            indexLoadError = '';
        })
        .catch((error) => {
            console.error('Failed to load tracks', error);
            indexTracks = [];
            indexLoadError = INDEX_LOAD_ERROR_MESSAGE;
        });

    return indexLoadPromise;
}

function ensureGamesLoaded() {
    if (gamesLoadPromise) {
        return gamesLoadPromise;
    }

    gamesLoadPromise = loadGames()
        .then((loadedGames) => {
            games = loadedGames;
            gamesLoadError = '';
        })
        .catch((error) => {
            console.error('Failed to load games', error);
            games = [];
            gamesLoadError = GAMES_LOAD_ERROR_MESSAGE;
        });

    return gamesLoadPromise;
}

function initBroker() {
    shellBroker.handleRequest('shell.queryIndex', async ({ payload }) => {
        await ensureIndexLoaded();

        const filteredTracks = filterTracks(indexTracks, payload || {});
        return makeIndexPayload(filteredTracks, indexLoadError);
    });
    shellBroker.handleRequest('shell.queryGames', async ({ payload }) => {
        await ensureGamesLoaded();

        const filteredGames = filterGames(games, payload || {});
        return makeGamesPayload(filteredGames, gamesLoadError);
    });
    shellBroker.start();
}

function init() {
    ensureIndexLoaded();
    ensureGamesLoaded();
    initBroker();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
