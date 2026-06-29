/*
 * Trackify collections frame app.
 *
 * Responsibilities:
 * - Render browsable grids for games, playlists, platforms, and artists.
 * - Switch content type via `?type=<type>` hash parameter.
 * - Delegate play/browse actions according to type.
 *
 * Data fetching is not implemented yet — stores start empty.
 */

import { createFrameBroker } from './broker.js';
import { createNavClient, CONTENT_RERENDER_TOPIC } from './nav_client.js';
import { ARTIST_ICON, paletteColorForArtist } from './playlist_meta.js';

const VALID_COLLECTION_TYPES = new Set(['games', 'playlists', 'platforms', 'artists']);
const DEFAULT_TYPE = 'games';

const els = {
    grid: document.getElementById('collectionsGrid'),
    gridSection: document.getElementById('collectionsGridSection'),
    status: document.getElementById('collectionsStatus'),
    headerSection: document.querySelector('.collections-header'),
    eyebrow: document.querySelector('.eyebrow'),
    heading: document.querySelector('.collections-header h2'),
    hero: document.getElementById('collectionsHero'),
    filterInput: document.getElementById('collectionsFilterInput'),
    filterClear: document.getElementById('collectionsFilterClear'),
};

const broker = createFrameBroker({
    serviceId: 'games',
    targetOrigin: window.location.origin,
    requestTimeoutMs: 4000,
    allowedOrigins: [window.location.origin],
});

const navClient = createNavClient({ broker });

const stores = {
    games: [],
    playlists: [],
    platforms: [],
    artists: [],
};

let activeType = DEFAULT_TYPE;
let activePlaylistType = '';
let filterText = '';

function setStatus(message) {
    if (!els.status) return;
    els.status.textContent = message;
}

function paramsFromFragment() {
    const hash = window.location.hash || '';
    const fragment = hash.startsWith('#') ? hash.slice(1) : hash;

    if (!fragment) return {};

    const queryString = fragment.startsWith('?')
        ? fragment.slice(1)
        : fragment.includes('?')
            ? fragment.slice(fragment.indexOf('?') + 1)
            : '';

    if (!queryString) return {};

    return Object.fromEntries(new URLSearchParams(queryString).entries());
}

function resolveType(params) {
    const raw = typeof params.type === 'string' ? params.type.trim().toLowerCase() : '';
    return VALID_COLLECTION_TYPES.has(raw) ? raw : DEFAULT_TYPE;
}

function resolvePlaylistType(params) {
    const raw = typeof params.playlistType === 'string' ? params.playlistType.trim().toLowerCase() : '';
    return raw || '';
}

function isMyLibraryView() {
    return activeType === 'playlists' && activePlaylistType === 'private';
}

function safeCoverArtUrl(coverArt) {
    if (typeof coverArt !== 'string' || !coverArt.trim()) return '';

    try {
        return new URL(coverArt, window.location.href).toString();
    } catch {
        return coverArt;
    }
}

function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    switch (activeType) {

    case 'games':
        return {
            id: typeof raw.id === 'string' ? raw.id : '',
            title: typeof raw.title === 'string' ? raw.title.trim() : '',
            company: Array.isArray(raw.company) ? raw.company : [],
            year: typeof raw.year === 'string' ? raw.year : '',
            coverArt: typeof raw.coverArt === 'string' ? raw.coverArt : '',
        };

    case 'playlists':
        return {
            id: typeof raw.id === 'string' ? raw.id : '',
            title: typeof raw.title === 'string' ? raw.title.trim() : '',
            description: typeof raw.description === 'string' ? raw.description : '',
            trackCount: typeof raw.trackCount === 'number' ? raw.trackCount : 0,
            coverArt: typeof raw.coverArt === 'string' ? raw.coverArt : '',
            color: typeof raw.color === 'string' ? raw.color : '',
            icon: typeof raw.icon === 'string' ? raw.icon : '',
        };

    case 'platforms':
        return {
            id: typeof raw.id === 'string' ? raw.id : '',
            name: typeof raw.name === 'string' ? raw.name.trim() : '',
            gameCount: typeof raw.gameCount === 'number' ? raw.gameCount : 0,
            logoUrl: typeof raw.logoUrl === 'string' ? raw.logoUrl : '',
        };

    case 'artists':
        return {
            id: typeof raw.id === 'string' ? raw.id : '',
            name: typeof raw.name === 'string' ? raw.name.trim() : '',
            trackCount: typeof raw.trackCount === 'number' ? raw.trackCount : 0,
            photoUrl: typeof raw.photoUrl === 'string' ? raw.photoUrl : '',
        };

    default:
        return null;
    }
}

function buildMetaLine(item) {
    switch (activeType) {

    case 'games': {
        const company = Array.isArray(item.company)
            ? item.company.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean).join(', ')
            : '';

        const year = typeof item.year === 'string' ? item.year.trim() : '';
        return { company, year };
    }

    case 'playlists': {
        const count = typeof item.trackCount === 'number' && item.trackCount > 0
            ? item.trackCount + ' track' + (item.trackCount !== 1 ? 's' : '')
            : '';
        return { line: count };
    }

    case 'platforms': {
        const count = typeof item.gameCount === 'number' && item.gameCount > 0
            ? item.gameCount + ' game' + (item.gameCount !== 1 ? 's' : '')
            : '';
        return { line: count };
    }

    case 'artists': {
        const count = typeof item.trackCount === 'number' && item.trackCount > 0
            ? item.trackCount + ' track' + (item.trackCount !== 1 ? 's' : '')
            : '';
        return { line: count };
    }

    default:
        return {};
    }
}

function metaText(meta) {
    switch (activeType) {

    case 'games': {
        const companyText = meta.company || 'Unknown company';
        const yearText = meta.year || 'Unknown year';
        return meta.company && meta.year
            ? companyText + ' \u00b7 ' + yearText
            : companyText + ' ' + yearText;
    }

    default:
        return meta.line || '';
    }
}

function itemTitle(item) {
    switch (activeType) {
    case 'platforms':
        return item.name || '';
    case 'artists':
        return item.name || '';
    default:
        return item.title || '';
    }
}

function itemCoverUrl(item) {
    switch (activeType) {
    case 'games':
    case 'playlists':
        return safeCoverArtUrl(item.coverArt);
    case 'platforms':
        return safeCoverArtUrl(item.logoUrl);
    case 'artists':
        return safeCoverArtUrl(item.photoUrl);
    default:
        return '';
    }
}

function itemAriaLabel(item) {
    const title = itemTitle(item);
    switch (activeType) {
    case 'games':
        return 'Open playlist for ' + title;
    case 'playlists':
        return 'Play playlist ' + title;
    case 'platforms':
        return 'Browse ' + title + ' games';
    case 'artists':
        return 'Browse ' + title + ' tracks';
    default:
        return title;
    }
}

function handlePrimaryAction(item) {
    switch (activeType) {
    case 'games':
        return openPlaylist(item.id);
    case 'playlists':
        return openPlaylistView(item.id);
    case 'platforms':
        return browsePlatformGames(item);
    case 'artists':
        return browseArtistTracks(item);
    }
}

function handlePlayAction(event, item) {
    event.stopPropagation();

    switch (activeType) {
    case 'games':
        return playGame(item);
    case 'playlists':
        return playPlaylist(item);
    default:
        return;
    }
}

/* ── Games-specific actions ── */

function openPlaylist(gameId) {
    navClient.navigate('/games/' + encodeURIComponent(gameId));
}

async function playGame(game) {
    if (!game || typeof game.id !== 'string' || !game.id.trim()) return;

    const gameId = game.id.trim();
    const gameName = itemTitle(game);

    setStatus('Loading tracks for ' + gameName + '...');

    try {
        const payload = await broker.request('shell.queryIndex', { game: gameId }, {
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
            setStatus('No tracks found for ' + gameName);
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

        setStatus('Now playing ' + gameName);
    } catch (error) {
        console.error('Failed to query shell index for game playback', error);
        setStatus('Error loading sample-files/index.json (see console)');
    }
}

async function playPlaylist(playlist) {
    if (!playlist || typeof playlist.id !== 'string' || !playlist.id.trim()) return;

    const playlistId = playlist.id.trim();
    const playlistTitle = itemTitle(playlist);

    setStatus('Loading tracks for ' + playlistTitle + '...');

    try {
        const payload = await broker.request('shell.queryPlaylist', { id: playlistId }, {
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
            setStatus('No tracks found in ' + playlistTitle);
            return;
        }

        broker.publish('playlist.selected', {
            source: 'playlist:' + playlistId,
            selectedIndex: 0,
            tracks,
            autoplay: true,
        }, { target: 'player' });

        setStatus('Now playing ' + playlistTitle);
    } catch (error) {
        console.error('Failed to query playlist for playback', error);
        setStatus('Error loading playlist (see console)');
    }
}

/* ── Stubbed type actions (no data fetching yet) ── */

function openPlaylistView(playlistId) {
    if (typeof playlistId !== 'string' || !playlistId.trim()) return;
    navClient.navigate('/playlists/' + encodeURIComponent(playlistId.trim()));
}

function browsePlatformGames(item) {
    const name = itemTitle(item);
    navClient.navigate('/platforms/' + encodeURIComponent(name));
}

function browseArtistTracks(item) {
    const name = itemTitle(item);
    navClient.navigate('/artists/' + encodeURIComponent(name));
}

/* ── Header update ── */

const HEADER_BY_TYPE = {
    games: { eyebrow: 'Browse By Game', heading: 'Games Library' },
    playlists: { eyebrow: 'Browse By Playlist', heading: 'Playlists' },
    platforms: { eyebrow: 'Browse By Platform', heading: 'Platforms' },
    artists: { eyebrow: 'Browse By Artist', heading: 'Artists' },
};

function updateHeader() {
    const labels = isMyLibraryView()
        ? { eyebrow: 'Your Library', heading: 'My Library' }
        : (HEADER_BY_TYPE[activeType] || HEADER_BY_TYPE[DEFAULT_TYPE]);

    if (els.eyebrow) {
        els.eyebrow.textContent = labels.eyebrow;
    }
    if (els.heading) {
        els.heading.textContent = labels.heading;
    }
    if (els.headerSection) {
        els.headerSection.setAttribute('aria-label', labels.eyebrow + ' \u2014 ' + labels.heading);
    }
    if (els.gridSection) {
        els.gridSection.setAttribute('aria-label', labels.eyebrow + ' grid');
    }
}

function updateHero() {
    if (!els.hero) return;
    els.hero.hidden = !isMyLibraryView();
}

/* ── Rendering ── */

function renderCard(item) {
    const li = document.createElement('li');
    li.className = 'collection-card';

    const card = document.createElement('div');
    card.className = 'collection-link';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', itemAriaLabel(item));

    const cover = document.createElement('div');
    cover.className = 'collection-cover';
    const isPlaylistArt = activeType === 'playlists';
    const isArtistArt = activeType === 'artists';
    if (isPlaylistArt) {
        cover.classList.add('is-playlist-art');
        if (typeof item.color === 'string' && item.color) {
            cover.style.setProperty('--playlist-accent', item.color);
        }
        if (typeof item.icon === 'string' && item.icon) {
            const icon = document.createElement('span');
            icon.className = 'collection-art-icon material-symbols-outlined';
            icon.textContent = item.icon;
            icon.setAttribute('aria-hidden', 'true');
            cover.appendChild(icon);
        }
    } else if (isArtistArt) {
        cover.classList.add('is-playlist-art');
        const accent = paletteColorForArtist(itemTitle(item));
        if (accent) {
            cover.style.setProperty('--playlist-accent', accent);
        }
        const icon = document.createElement('span');
        icon.className = 'collection-art-icon material-symbols-outlined filled';
        icon.textContent = ARTIST_ICON;
        icon.setAttribute('aria-hidden', 'true');
        cover.appendChild(icon);
    } else {
        const coverUrl = itemCoverUrl(item);
        if (coverUrl) {
            cover.classList.add('has-art');
            cover.style.setProperty('--cover-url', 'url("' + coverUrl.replace(/"/g, '\\"') + '")');
        }
    }

    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'collection-play-button material-symbols-outlined filled';
    playButton.textContent = 'play_arrow';
    playButton.setAttribute('aria-label', 'Play ' + itemTitle(item));
    cover.appendChild(playButton);

    const body = document.createElement('div');
    body.className = 'collection-body';

    const titleEl = document.createElement('h3');
    titleEl.className = 'collection-title';
    titleEl.textContent = itemTitle(item);

    const meta = buildMetaLine(item);
    const metaRow = document.createElement('p');
    metaRow.className = 'collection-meta';

    metaRow.textContent = metaText(meta);

    body.append(titleEl, metaRow);
    card.append(cover, body);
    li.appendChild(card);

    card.addEventListener('click', () => {
        handlePrimaryAction(item);
    });

    card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handlePrimaryAction(item);
    });

    if (activeType === 'games' || activeType === 'playlists') {
        playButton.addEventListener('click', (event) => {
            handlePlayAction(event, item);
        });
    }

    return li;
}

function visibleItems() {
    const items = stores[activeType] || [];
    const needle = filterText.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => itemTitle(item).toLowerCase().includes(needle));
}

function renderEmptyState(message) {
    const li = document.createElement('li');
    li.className = 'collections-empty';
    li.textContent = message;
    return li;
}

function renderItems() {
    if (!els.grid) return;

    els.grid.innerHTML = '';

    const items = visibleItems();
    if (items.length) {
        for (const item of items) {
            els.grid.appendChild(renderCard(item));
        }
        return;
    }

    const total = (stores[activeType] || []).length;
    const needle = filterText.trim();
    els.grid.appendChild(renderEmptyState(
        total && needle
            ? 'No ' + activeType + ' match "' + needle + '"'
            : 'No ' + activeType + ' found'
    ));
}

/* ── Data handling ── */

function loadItems(payload) {
    if (!payload) return;

    if (typeof payload.error === 'string' && payload.error) {
        stores[activeType] = [];
        renderItems();
        setStatus(payload.error);
        return;
    }

    const keyMap = { games: 'games', playlists: 'playlists', platforms: 'platforms', artists: 'artists' };
    const key = keyMap[activeType] || 'games';
    const raw = Array.isArray(payload[key]) ? payload[key] : [];
    stores[activeType] = raw
        .map((entry) => normalizeItem(entry))
        .filter((item) => item && itemTitle(item));

    renderItems();

    const total = stores[activeType].length;
    if (!total) {
        setStatus('No ' + activeType + ' found');
        return;
    }

    const visible = visibleItems().length;
    const needle = filterText.trim();
    if (needle) {
        setStatus('Showing ' + visible + ' of ' + total + ' ' + activeType + ' matching "' + needle + '"');
        return;
    }

    setStatus('Loaded ' + total + ' ' + activeType);
}

/* ── Query dispatch ── */

function topicForType() {
    switch (activeType) {
    case 'games':
        return 'shell.queryGames';
    case 'playlists':
        return 'shell.queryPlaylists';
    case 'platforms':
        return 'shell.queryPlatforms';
    case 'artists':
        return 'shell.queryArtists';
    default:
        return null;
    }
}

async function fetchItems() {
    const topic = topicForType();
    if (!topic) {
        setStatus('Unknown collection type: ' + activeType);
        return;
    }

    const { type: _routeType, ...filters } = paramsFromFragment();
    if (activeType === 'playlists' && typeof filters.playlistType === 'string' && filters.playlistType.trim()) {
        const playlistView = filters.playlistType.trim().toLowerCase();
        if (playlistView === 'private') {
            filters.type = 'own';
        } else {
            filters.type = playlistView;
        }
        delete filters.playlistType;
    }

    try {
        const payload = await broker.request(topic, filters, {
            target: 'shell',
            timeoutMs: 15000,
        });
        loadItems(payload);
    } catch (error) {
        console.error('Failed to fetch ' + activeType, error);
        stores[activeType] = [];
        renderItems();
        setStatus('Error loading ' + activeType + ' (see console)');
    }
}

/* ── Init ── */

function applyRoute() {
    const params = paramsFromFragment();
    const nextType = resolveType(params);
    const nextPlaylistType = resolvePlaylistType(params);

    if (nextType !== activeType || nextPlaylistType !== activePlaylistType) {
        activeType = nextType;
        activePlaylistType = nextPlaylistType;
        updateHeader();
        updateHero();
        renderItems();
    }

    fetchItems();
}

function setFilter(nextValue) {
    const next = typeof nextValue === 'string' ? nextValue : '';
    if (next === filterText) {
        updateFilterUi();
        return;
    }
    filterText = next;
    updateFilterUi();
    renderItems();
    const total = (stores[activeType] || []).length;
    if (!total) return;
    const visible = visibleItems().length;
    const needle = filterText.trim();
    if (!needle) {
        setStatus('Loaded ' + total + ' ' + activeType);
    } else {
        setStatus('Showing ' + visible + ' of ' + total + ' ' + activeType + ' matching "' + needle + '"');
    }
}

function updateFilterUi() {
    if (!els.filterClear) return;
    els.filterClear.hidden = !filterText.trim();
}

function clearFilter() {
    if (!els.filterInput) return;
    els.filterInput.value = '';
    setFilter('');
    els.filterInput.focus();
}

function bindFilter() {
    if (!els.filterInput) return;

    els.filterInput.addEventListener('input', (event) => {
        setFilter(event.target.value || '');
    });

    els.filterInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && filterText) {
            event.preventDefault();
            clearFilter();
        }
    });

    if (els.filterClear) {
        els.filterClear.addEventListener('click', () => {
            clearFilter();
        });
    }

    updateFilterUi();
}

function init() {
    broker.start();
    navClient.bindLinks();
    bindFilter();
    updateHeader();
    updateHero();
    setStatus('Waiting for library...');

    broker.subscribe(CONTENT_RERENDER_TOPIC, () => {
        applyRoute();
    });

    console.info('[trace][iframe:games] init', {
        href: window.location.href,
        historyLength: window.history.length,
        historyState: window.history.state,
    });

    window.addEventListener('hashchange', () => {
        console.info('[trace][iframe:games] hashchange fired', {
            href: window.location.href,
            historyLength: window.history.length,
        });
    });

    window.addEventListener('hashchange', applyRoute);
    applyRoute();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
