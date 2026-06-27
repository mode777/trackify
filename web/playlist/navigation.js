/*
 * Trackify playlist navigation.
 *
 * Single owner of the URL fragment schemes this frame understands:
 *
 *   #?game=<name>             — game album view
 *   #?favorites               — current user's favorites
 *   #?playlist&id=<id>        — playlist by id
 *   #?artist=<name>           — (currently routes to the game view;
 *                               shell-side hero metadata isn't
 *                               populated for artists today)
 *
 * Reacts to hashchange and runs evaluateFragmentParameters() on
 * init. Each route delegates to the appropriate shell_client method
 * and pushes the result into playlist_state + hero_ui.
 *
 * `initNavigation({ shellClient, heroUi, playlistState, favoritesService, setStatus })`
 * stores every dep — navigation never imports those modules
 * directly, which keeps the dependency graph acyclic.
 */
'use strict';

let shellClient = null;
let heroUi = null;
let playlistState = null;
let favoritesService = null;
let setStatusFn = () => {};

export function initNavigation({
    shellClient: sc,
    heroUi: h,
    playlistState: ps,
    favoritesService: fs,
    setStatus,
} = {}) {
    shellClient = sc || null;
    heroUi = h || null;
    playlistState = ps || null;
    favoritesService = fs || null;
    setStatusFn = typeof setStatus === 'function' ? setStatus : () => {};

    window.addEventListener('hashchange', evaluateFragmentParameters);
    evaluateFragmentParameters();
}

export function evaluateFragmentParameters() {
    const filters = getIndexFiltersFromFragment();

    if (heroUi && typeof heroUi.updateHeroArt === 'function') {
        heroUi.updateHeroArt('');
    }

    if (filters.favorites) {
        if (heroUi && typeof heroUi.applyFavoritesHeroState === 'function') {
            heroUi.applyFavoritesHeroState();
        }
        loadFavoritesPlaylist();
        return;
    }

    if (typeof filters.playlist === 'string' && filters.playlist) {
        if (heroUi && typeof heroUi.applyPlaylistHeroState === 'function') {
            heroUi.applyPlaylistHeroState(null);
        }
        loadPlaylistById(filters.playlist);
        return;
    }

    if (heroUi && typeof heroUi.clearFavoritesHeroState === 'function') {
        heroUi.clearFavoritesHeroState();
    }
    queryIndex(filters);

    if (typeof filters.game === 'string' && filters.game) {
        queryGames({ game: filters.game });
    }
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
    const playlist = params.has('playlist');
    const playlistId = params.get('id');

    const filters = {};
    if (typeof game === 'string' && game.trim()) {
        filters.game = game.trim();
    }
    if (favorites) {
        filters.favorites = true;
    }
    if (playlist && typeof playlistId === 'string' && playlistId.trim()) {
        filters.playlist = playlistId.trim();
    }
    return filters;
}

async function loadFavoritesPlaylist() {
    if (!favoritesService || !playlistState) return;
    try {
        const favorites = await favoritesService.queryFavorites();
        const statusMessage = playlistState.applyIndexPayload({
            source: 'favorites',
            tracks: favorites,
            selectedIndex: favorites.length > 0 ? 0 : -1,
        });
        if (typeof statusMessage === 'string') setStatusFn(statusMessage);
    } catch (error) {
        console.error('Failed to load favorites playlist', error);
        playlistState.applyIndexPayload({ source: 'favorites', tracks: [], selectedIndex: -1 });
        setStatusFn('Error loading favorites (see console)');
    }
}

async function loadPlaylistById(id) {
    if (!shellClient || !playlistState || !heroUi) return;
    try {
        const [response] = await Promise.all([
            shellClient.queryPlaylist(id),
            favoritesService ? favoritesService.queryFavorites() : Promise.resolve([]),
        ]);

        const errorMessage = response && typeof response.error === 'string' ? response.error : '';
        const playlist = response && response.playlist && typeof response.playlist === 'object'
            ? response.playlist
            : null;
        const playlistTracks = Array.isArray(response && response.tracks) ? response.tracks : [];

        if (errorMessage) {
            heroUi.applyPlaylistHeroState(null);
            playlistState.applyIndexPayload({ tracks: [], selectedIndex: -1 });
            setStatusFn(errorMessage);
            return;
        }

        heroUi.applyPlaylistHeroState(playlist);
        const statusMessage = playlistState.applyIndexPayload({
            source: playlist && playlist.id ? 'playlist:' + playlist.id : 'playlist:' + id,
            tracks: playlistTracks,
            selectedIndex: playlistTracks.length > 0 ? 0 : -1,
        });
        if (typeof statusMessage === 'string') setStatusFn(statusMessage);
    } catch (error) {
        console.error('Failed to load playlist', id, error);
        heroUi.applyPlaylistHeroState(null);
        playlistState.applyIndexPayload({ tracks: [], selectedIndex: -1 });
        setStatusFn('Error loading playlist (see console)');
    }
}

async function queryIndex(filters) {
    if (!shellClient || !playlistState) return;
    try {
        const payload = await shellClient.queryIndex(filters || {});
        const statusMessage = playlistState.applyIndexPayload(payload);
        if (typeof statusMessage === 'string') setStatusFn(statusMessage);
        if (favoritesService) {
            favoritesService.queryFavorites();
        }
    } catch (error) {
        console.error('Failed to query shell index', error);
        playlistState.applyIndexPayload({ tracks: [], selectedIndex: -1 });
        setStatusFn('Error loading sample-files/index.json (see console)');
    }
}

async function queryGames(filters) {
    if (!shellClient || !heroUi) return;
    try {
        const payload = await shellClient.queryGames(filters || {});

        if (!payload || typeof payload.error !== 'string' || payload.error) {
            return;
        }

        if (!Array.isArray(payload.games) || payload.games.length === 0) {
            return;
        }

        if (typeof heroUi.setHeroMetadata === 'function') {
            heroUi.setHeroMetadata(payload.games[0]);
        }
    } catch (error) {
        console.error('Failed to query shell games index', error);
    }
}
