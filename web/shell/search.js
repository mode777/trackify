/*
 * Trackify shell search popover.
 *
 * Lives in the shell (not in an iframe frame): binds the top-bar search
 * input, debounces typing, queries `shell.queryIndex({ title })` through
 * the broker, and renders a popover with three-column rows (cover art +
 * title/meta + heart). Hover/focus on the cover tile reveals a play
 * overlay that publishes `playlist.selected` for the single matching
 * track; clicking the heart toggles the favorite through
 * `catalogService.addFavorite` / `removeFavorite` and broadcasts
 * `shell.favorites.changed` so the playlist frame's local Set stays
 * live.
 *
 * `bindSearchUi({ shellBroker, catalogService, navClient })` is the only
 * export — it wires the input keyup, owns the popover DOM, and exposes
 * `closeSearchPopover` for the orchestrator to call on navigation.
 */
'use strict';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 500;
const RESULT_LIMIT = 50;
const PLACEHOLDER_GAME = 'Unknown game';

let shellBroker = null;
let catalogService = null;
let navClient = null;

let searchInput = null;
let popover = null;
let popoverList = null;
let popoverStatus = null;

let debounceTimerId = null;
let currentRequestId = 0;
let favoriteIds = new Set();
let favoritesLoadPromise = null;

function ensureFavoritesLoaded() {
    if (favoritesLoadPromise) return favoritesLoadPromise;
    favoritesLoadPromise = catalogService.queryFavorites()
        .then((favorites) => {
            const ids = new Set();
            if (Array.isArray(favorites)) {
                for (const track of favorites) {
                    if (track && typeof track.id === 'string' && track.id) {
                        ids.add(track.id);
                    }
                }
            }
            favoriteIds = ids;
            return favorites;
        })
        .catch(() => {
            favoriteIds = new Set();
            return [];
        });
    return favoritesLoadPromise;
}

function refreshFavoriteIdsFromCache() {
    const cache = catalogService && catalogService.favoritesTracksCache;
    if (!Array.isArray(cache)) return;
    const ids = new Set();
    for (const track of cache) {
        if (track && typeof track.id === 'string' && track.id) {
            ids.add(track.id);
        }
    }
    favoriteIds = ids;
}

export function bindSearchUi({ shellBroker: broker, catalogService: catalog, navClient: nav } = {}) {
    if (!broker) throw new Error('bindSearchUi requires { shellBroker }');
    if (!catalog) throw new Error('bindSearchUi requires { catalogService }');
    if (!nav) throw new Error('bindSearchUi requires { navClient }');

    shellBroker = broker;
    catalogService = catalog;
    navClient = nav;

    searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    searchInput.addEventListener('keyup', handleSearchKeyup);
    searchInput.addEventListener('keydown', handleSearchKeydown);
    searchInput.addEventListener('focus', handleSearchFocus);
    searchInput.addEventListener('input', handleSearchInput);

    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    document.addEventListener('keydown', handleDocumentKeydown, true);
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('blur', closeSearchPopover);

    ensureFavoritesLoaded();
}

export function closeSearchPopover() {
    if (debounceTimerId !== null) {
        clearTimeout(debounceTimerId);
        debounceTimerId = null;
    }
    currentRequestId += 1;
    if (popover && popover.parentNode) {
        popover.parentNode.removeChild(popover);
    }
    popover = null;
    popoverList = null;
    popoverStatus = null;
}

function handleSearchKeydown(event) {
    if (!event) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeSearchPopover();
        if (searchInput) searchInput.blur();
    }
}

function handleSearchInput() {
    const value = searchInput && typeof searchInput.value === 'string' ? searchInput.value.trim() : '';
    if (value.length <= MIN_QUERY_LENGTH) {
        closeSearchPopover();
    }
}

function handleSearchKeyup(event) {
    if (!event) return;
    if (event.key === 'Escape') return;
    const value = searchInput.value.trim();
    if (value.length <= MIN_QUERY_LENGTH) {
        closeSearchPopover();
        return;
    }
    scheduleSearch(value);
}

function handleSearchFocus() {
    const value = searchInput && typeof searchInput.value === 'string' ? searchInput.value.trim() : '';
    if (value.length > MIN_QUERY_LENGTH && popover) {
        positionSearchPopover();
    }
}

function scheduleSearch(query) {
    if (debounceTimerId !== null) {
        clearTimeout(debounceTimerId);
    }
    debounceTimerId = setTimeout(() => {
        debounceTimerId = null;
        runSearch(query).catch((error) => {
            console.error('Search query failed', error);
            renderStatus('Search failed (see console)');
        });
    }, DEBOUNCE_MS);
}

async function runSearch(query) {
    const requestId = ++currentRequestId;
    ensurePopover();
    renderLoading();

    let payload;
    try {
        payload = await catalogService.queryIndex({ q: query });
    } catch (error) {
        if (requestId !== currentRequestId) return;
        console.error('Search request failed', error);
        renderStatus('Search failed (see console)');
        return;
    }
    if (requestId !== currentRequestId) return;

    refreshFavoriteIdsFromCache();
    ensureFavoritesLoaded();

    const tracks = payload && Array.isArray(payload.tracks) ? payload.tracks : [];
    if (!tracks.length) {
        renderStatus('No matches');
        return;
    }
    const capped = tracks.slice(0, RESULT_LIMIT);
    renderResults(capped);
}

function ensurePopover() {
    if (popover && popover.parentNode) {
        positionSearchPopover();
        return;
    }
    popover = document.createElement('div');
    popover.className = 'search-popover';
    popover.setAttribute('role', 'listbox');
    popover.setAttribute('aria-label', 'Search results');

    popoverList = document.createElement('div');
    popoverList.className = 'search-popover-list';
    popover.appendChild(popoverList);

    document.body.appendChild(popover);
    navClient.bindLinks(popover);
    positionSearchPopover();
}

function positionSearchPopover() {
    if (!popover || !searchInput) return;
    const margin = 6;
    const anchorRect = searchInput.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const fitsBelow = anchorRect.bottom + popoverRect.height + margin <= viewportHeight;
    let top;
    if (fitsBelow) {
        top = anchorRect.bottom + margin;
    } else if (anchorRect.top - popoverRect.height - margin >= 0) {
        top = anchorRect.top - popoverRect.height - margin;
    } else {
        top = Math.max(margin, viewportHeight - popoverRect.height - margin);
    }
    top = Math.max(margin, Math.min(top, viewportHeight - popoverRect.height - margin));

    let left = anchorRect.left;
    if (left + popoverRect.width + margin > viewportWidth) {
        left = Math.max(margin, viewportWidth - popoverRect.width - margin);
    }
    if (left < margin) left = margin;

    const width = Math.min(anchorRect.width, viewportWidth - margin * 2);
    popover.style.width = width + 'px';
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
}

function renderLoading() {
    if (!popoverList) return;
    popoverList.innerHTML = '';
    popoverStatus = document.createElement('div');
    popoverStatus.className = 'search-popover-status';
    popoverStatus.textContent = 'Searching…';
    popoverList.appendChild(popoverStatus);
}

function renderStatus(message) {
    if (!popoverList) return;
    popoverList.innerHTML = '';
    popoverStatus = document.createElement('div');
    popoverStatus.className = 'search-popover-status';
    popoverStatus.textContent = message;
    popoverList.appendChild(popoverStatus);
}

function renderResults(tracks) {
    if (!popoverList) return;
    popoverList.innerHTML = '';
    for (const track of tracks) {
        popoverList.appendChild(renderRow(track));
    }
}

function renderRow(track) {
    const li = document.createElement('div');
    li.className = 'search-row';
    li.setAttribute('role', 'option');

    const coverWrap = document.createElement('button');
    coverWrap.type = 'button';
    coverWrap.className = 'search-row-cover';
    coverWrap.setAttribute('aria-label', 'Play ' + track.title);

    const coverArt = typeof track.coverArt === 'string' ? track.coverArt : '';
    if (coverArt) {
        const img = document.createElement('img');
        img.className = 'search-row-cover-img';
        img.src = coverArt;
        img.alt = '';
        img.loading = 'lazy';
        coverWrap.appendChild(img);
    } else {
        const fallback = document.createElement('span');
        fallback.className = 'search-row-cover-fallback material-symbols-outlined';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.textContent = 'music_note';
        coverWrap.appendChild(fallback);
    }

    const overlay = document.createElement('span');
    overlay.className = 'search-row-cover-play material-symbols-outlined filled';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.textContent = 'play_arrow';
    coverWrap.appendChild(overlay);

    coverWrap.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        publishSingleTrack(track);
    });

    const meta = document.createElement('div');
    meta.className = 'search-row-meta';

    const title = document.createElement('span');
    title.className = 'search-row-title';
    title.textContent = typeof track.title === 'string' ? track.title : '';

    const sub = document.createElement('span');
    sub.className = 'search-row-sub';

    const gameLabel = typeof track.game === 'string' && track.game.trim() ? track.game.trim() : PLACEHOLDER_GAME;
    const gameId = typeof track.gameId === 'string' ? track.gameId.trim() : '';

    if (gameId) {
        const gameLink = document.createElement('a');
        gameLink.href = '/games/' + encodeURIComponent(gameId);
        gameLink.setAttribute('data-router-link', '');
        gameLink.className = 'search-row-game';
        gameLink.textContent = gameLabel;
        sub.appendChild(gameLink);
    } else {
        sub.appendChild(document.createTextNode(gameLabel));
    }

    const artistNames = Array.isArray(track.artists) && track.artists.length > 0
        ? track.artists.filter((value) => typeof value === 'string' && value.trim())
        : (typeof track.artist === 'string' && track.artist.trim()
            ? track.artist.split(',').map((value) => value.trim()).filter(Boolean)
            : []);

    if (artistNames.length > 0) {
        sub.appendChild(document.createTextNode(' \u00b7 '));
        artistNames.forEach((name, index) => {
            if (index > 0) {
                sub.appendChild(document.createTextNode(', '));
            }
            const artistLink = document.createElement('a');
            artistLink.href = '/artists/' + encodeURIComponent(name);
            artistLink.setAttribute('data-router-link', '');
            artistLink.className = 'search-row-artist';
            artistLink.textContent = name;
            sub.appendChild(artistLink);
        });
    }

    meta.append(title, sub);

    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'search-row-favorite';
    const favoriteIcon = document.createElement('span');
    favoriteIcon.className = 'material-symbols-outlined';
    favoriteIcon.setAttribute('aria-hidden', 'true');
    favorite.append(favoriteIcon);
    applyFavoriteState(favorite, favoriteIcon, track, favoriteIds.has(track.id));
    favorite.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const wasFavorite = favoriteIds.has(track.id);
        handleFavoriteToggle(track, !wasFavorite).then(() => {
            applyFavoriteState(favorite, favoriteIcon, track, favoriteIds.has(track.id));
        });
    });

    li.append(coverWrap, meta, favorite);
    return li;
}

function applyFavoriteState(button, icon, track, isFavorite) {
    button.classList.toggle('is-favorite', isFavorite);
    if (icon) {
        icon.textContent = isFavorite ? 'favorite' : 'favorite_border';
        icon.classList.toggle('filled', isFavorite);
    }
    button.setAttribute('aria-label', isFavorite
        ? 'Remove ' + track.title + ' from favorites'
        : 'Add ' + track.title + ' to favorites');
    button.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
}

async function handleFavoriteToggle(track, makeFavorite) {
    const trackId = typeof track.id === 'string' ? track.id : '';
    if (!trackId) return;
    try {
        if (makeFavorite) {
            await catalogService.addFavorite(trackId);
        } else {
            await catalogService.removeFavorite(trackId);
        }
        refreshFavoriteIdsFromCache();
        try {
            shellBroker.publish('shell.favorites.changed', {
                trackId,
                isFavorite: makeFavorite,
            }, { target: '*' });
        } catch (publishError) {
            console.error('Failed to publish shell.favorites.changed', publishError);
        }
    } catch (error) {
        console.error('Failed to toggle favorite', trackId, error);
    }
}

function publishSingleTrack(track) {
    try {
        shellBroker.publish('playlist.selected', {
            source: 'search',
            selectedIndex: 0,
            tracks: [track],
            autoplay: true,
        }, { target: 'player' });
    } catch (error) {
        console.error('Failed to publish playlist.selected', error);
    }
}

function handleDocumentMouseDown(event) {
    if (!popover) return;
    if (popover.contains(event.target)) return;
    if (searchInput && searchInput.contains(event.target)) return;
    closeSearchPopover();
}

function handleDocumentKeydown(event) {
    if (!popover) return;
    if (!event || event.key !== 'Escape') return;
    closeSearchPopover();
}

function handleWindowResize() {
    if (popover) positionSearchPopover();
}