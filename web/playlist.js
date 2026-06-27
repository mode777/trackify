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

const els = {
    heroArt: document.querySelector('.hero-art'),
    heroEyebrow: document.getElementById('heroEyebrow'),
    heroTitle: document.getElementById('heroTitle'),
    heroEditButton: document.getElementById('heroEditButton'),
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
let currentPlaylist = null;
let currentUser = null;
let favoriteTrackIds = new Set();
let openAddPopup = null;
let titleEditInFlight = false;

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
    return ext.toString().toUpperCase().replace("MINI", "") || null;
}

function applyFavoritesHeroState() {
    document.body.classList.add('is-favorites');
    document.body.classList.remove('is-playlist');
    if (els.heroEyebrow) els.heroEyebrow.textContent = 'Playlist';
    if (els.heroTitle) els.heroTitle.textContent = 'Liked Tracks';
    if (els.heroCompany) els.heroCompany.textContent = 'Your favorite tracks';
    if (els.heroYear) els.heroYear.textContent = '';
    if (els.heroMetaDot) els.heroMetaDot.style.display = 'none';
    currentPlaylist = null;
    clearPlaylistEditState();
}

function applyPlaylistHeroState(playlist) {
    document.body.classList.add('is-playlist');
    document.body.classList.remove('is-favorites');
    currentPlaylist = playlist && typeof playlist === 'object' && typeof playlist.id === 'string' && playlist.id
        ? {
            id: playlist.id,
            title: typeof playlist.title === 'string' ? playlist.title.trim() : '',
            type: typeof playlist.type === 'string' ? playlist.type : '',
            userId: typeof playlist.userId === 'string' ? playlist.userId : '',
        }
        : null;
    const title = currentPlaylist && currentPlaylist.title ? currentPlaylist.title : 'Playlist';
    if (els.heroEyebrow) els.heroEyebrow.textContent = 'Playlist';
    if (els.heroTitle) els.heroTitle.textContent = title;
    if (els.heroCompany) els.heroCompany.textContent = currentPlaylist && currentPlaylist.type === 'public' ? 'Public playlist' : 'Curated tracks';
    if (els.heroYear) els.heroYear.textContent = '';
    if (els.heroMetaDot) els.heroMetaDot.style.display = 'none';
    applyPlaylistEditState();
}

function canEditCurrentPlaylist() {
    if (!currentPlaylist || typeof currentPlaylist.id !== 'string' || !currentPlaylist.id) return false;
    if (currentPlaylist.type === 'favorites') return false;
    if (!currentUser || !currentUser.isAuthenticated || !currentUser.user || typeof currentUser.user.id !== 'string') return false;
    return currentPlaylist.userId === currentUser.user.id;
}

function applyPlaylistEditState() {
    const editable = canEditCurrentPlaylist();
    if (document.body) {
        document.body.classList.toggle('is-owner', editable);
    }
    if (els.heroTitle) {
        els.heroTitle.classList.toggle('is-editable', editable);
        if (editable) {
            els.heroTitle.setAttribute('role', 'button');
            els.heroTitle.setAttribute('tabindex', '0');
            els.heroTitle.setAttribute('aria-label', 'Edit playlist title');
        } else {
            els.heroTitle.removeAttribute('role');
            els.heroTitle.removeAttribute('tabindex');
            els.heroTitle.removeAttribute('aria-label');
        }
    }
    if (els.heroEditButton) {
        els.heroEditButton.hidden = !editable;
    }
}

function clearPlaylistEditState() {
    if (els.heroTitle) {
        els.heroTitle.classList.remove('is-editable');
        els.heroTitle.removeAttribute('role');
        els.heroTitle.removeAttribute('tabindex');
        els.heroTitle.removeAttribute('aria-label');
    }
    if (els.heroEditButton) {
        els.heroEditButton.hidden = true;
    }
    if (document.body) {
        document.body.classList.remove('is-owner');
    }
}

function isTitleEditing() {
    return Boolean(els.heroTitle && els.heroTitle.querySelector('input.hero-title-edit'));
}

function cancelTitleEdit() {
    if (!els.heroTitle) return;
    const input = els.heroTitle.querySelector('input.hero-title-edit');
    if (!input) return;
    const original = currentPlaylist && typeof currentPlaylist.title === 'string' ? currentPlaylist.title : '';
    els.heroTitle.textContent = original || 'Playlist';
    els.heroTitle.classList.remove('is-editable');
    applyPlaylistEditState();
}

function startTitleEdit() {
    if (!canEditCurrentPlaylist() || titleEditInFlight) return;
    if (!els.heroTitle) return;
    if (isTitleEditing()) return;

    const originalTitle = currentPlaylist && typeof currentPlaylist.title === 'string' ? currentPlaylist.title : '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'hero-title-edit';
    input.value = originalTitle;
    input.setAttribute('aria-label', 'Playlist title');
    input.maxLength = 200;
    input.spellcheck = false;

    els.heroTitle.textContent = '';
    els.heroTitle.appendChild(input);
    els.heroTitle.classList.add('is-editable');
    if (els.heroEditButton) {
        els.heroEditButton.hidden = true;
    }

    input.focus();
    input.select();

    let resolved = false;

    const restoreDisplay = (nextTitle) => {
        els.heroTitle.textContent = nextTitle;
    };

    const commit = async () => {
        if (resolved) return;
        resolved = true;
        const nextTitle = input.value.trim();
        if (!nextTitle) {
            restoreDisplay(originalTitle);
            applyPlaylistEditState();
            setStatus('Playlist title cannot be empty');
            return;
        }
        if (nextTitle === originalTitle) {
            restoreDisplay(originalTitle);
            applyPlaylistEditState();
            return;
        }
        titleEditInFlight = true;
        setStatus('Saving playlist title...');
        try {
            const updated = await broker.request('shell.updatePlaylist', {
                id: currentPlaylist.id,
                updates: { title: nextTitle },
            }, { target: 'shell', timeoutMs: 8000 });
            const resolvedPlaylist = updated && typeof updated === 'object' ? updated : null;
            const resolvedTitle = resolvedPlaylist && typeof resolvedPlaylist.title === 'string' && resolvedPlaylist.title.trim()
                ? resolvedPlaylist.title.trim()
                : nextTitle;
            currentPlaylist = {
                ...(currentPlaylist || {}),
                ...(resolvedPlaylist || {}),
                id: currentPlaylist.id,
                title: resolvedTitle,
                type: resolvedPlaylist && resolvedPlaylist.type ? resolvedPlaylist.type : currentPlaylist.type,
                userId: resolvedPlaylist && resolvedPlaylist.userId ? resolvedPlaylist.userId : currentPlaylist.userId,
            };
            restoreDisplay(resolvedTitle);
            applyPlaylistEditState();
            setStatus('Playlist title updated');
        } catch (error) {
            console.error('Failed to update playlist title', error);
            restoreDisplay(originalTitle);
            applyPlaylistEditState();
            const message = error && error.message ? error.message : 'Failed to update playlist title';
            setStatus(message);
        } finally {
            titleEditInFlight = false;
        }
    };

    const onKeydown = (event) => {
        if (!event) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            input.removeEventListener('keydown', onKeydown);
            commit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            input.removeEventListener('keydown', onKeydown);
            resolved = true;
            cancelTitleEdit();
        }
    };

    const onBlur = () => {
        if (resolved) return;
        input.removeEventListener('keydown', onKeydown);
        commit();
    };

    input.addEventListener('keydown', onKeydown);
    input.addEventListener('blur', onBlur);
}

function clearFavoritesHeroState() {
    document.body.classList.remove('is-favorites');
    document.body.classList.remove('is-playlist');
    if (els.heroEyebrow) els.heroEyebrow.textContent = 'Game';
    currentPlaylist = null;
    clearPlaylistEditState();
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
        game.textContent = track.artist || track.game || PLACEHOLDER_GAME;

        meta.append(name, game);

        const addToPlaylist = document.createElement('button');
        addToPlaylist.type = 'button';
        addToPlaylist.className = 'track-add';
        const addToPlaylistIcon = document.createElement('span');
        addToPlaylistIcon.className = 'material-symbols-outlined';
        addToPlaylistIcon.setAttribute('aria-hidden', 'true');
        addToPlaylistIcon.textContent = 'add_circle';
        addToPlaylist.append(addToPlaylistIcon);
        addToPlaylist.setAttribute('aria-label', 'Add ' + track.title + ' to playlist');
        addToPlaylist.addEventListener('click', (event) => {
            event.stopPropagation();
            openAddToPlaylistPopup(addToPlaylist, track);
        });

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

        main.append(meta, addToPlaylist, favorite);

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

function closeAddToPlaylistPopup() {
    if (!openAddPopup) return;
    const { popup, onDocClick, onKeydown, onWindowResize } = openAddPopup;
    document.removeEventListener('mousedown', onDocClick, true);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', onWindowResize);
    if (popup && popup.parentNode) {
        popup.parentNode.removeChild(popup);
    }
    openAddPopup = null;
}

function positionAddToPlaylistPopup(popup, anchor) {
    const margin = 4;
    const anchorRect = anchor.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top;
    let left;
    let placement = 'bottom-right';

    const fitsBelow = anchorRect.bottom + popupRect.height + margin <= viewportHeight;
    const fitsAbove = anchorRect.top - popupRect.height - margin >= 0;
    const fitsRight = anchorRect.right + popupRect.width + margin <= viewportWidth;
    const fitsLeft = anchorRect.left - popupRect.width - margin >= 0;

    if (fitsBelow) {
        top = anchorRect.bottom + margin;
    } else if (fitsAbove) {
        top = anchorRect.top - popupRect.height - margin;
        placement = 'top-right';
    } else {
        top = Math.max(margin, viewportHeight - popupRect.height - margin);
    }

    if (fitsRight) {
        left = anchorRect.right + margin;
    } else if (fitsLeft) {
        left = anchorRect.left - popupRect.width - margin;
        if (placement === 'bottom-right') placement = 'bottom-left';
        else if (placement === 'top-right') placement = 'top-left';
    } else {
        left = Math.max(margin, viewportWidth - popupRect.width - margin);
    }

    left = Math.max(margin, Math.min(left, viewportWidth - popupRect.width - margin));
    top = Math.max(margin, Math.min(top, viewportHeight - popupRect.height - margin));

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.dataset.placement = placement;
}

function renderAddToPlaylistList(listEl, playlists, popupState) {
    listEl.innerHTML = '';
    if (!playlists.length) {
        const empty = document.createElement('div');
        empty.className = 'add-popup-empty';
        empty.textContent = 'No playlists yet. Create one to start collecting tracks.';
        listEl.appendChild(empty);
        return;
    }
    for (const playlist of playlists) {
        const item = document.createElement('label');
        item.className = 'add-popup-item';

        const playlistId = typeof playlist.id === 'string' ? playlist.id : '';
        const isMember = popupState && popupState.memberPlaylistIds
            ? popupState.memberPlaylistIds.has(playlistId)
            : false;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = playlistId;
        checkbox.checked = isMember;
        checkbox.addEventListener('change', () => {
            handleAddToPlaylistCheckboxChange(checkbox, playlist, popupState);
        });

        const name = document.createElement('span');
        name.className = 'add-popup-name';
        const trimmedTitle = typeof playlist.title === 'string' ? playlist.title.trim() : '';
        if (trimmedTitle === '__fav__') {
            name.textContent = 'Liked Tracks';
        } else {
            name.textContent = trimmedTitle || 'Untitled playlist';
        }

        item.append(checkbox, name);
        listEl.appendChild(item);
    }
}

async function handleAddToPlaylistCheckboxChange(checkbox, playlist, popupState) {
    if (!popupState || !popupState.track) return;
    const trackId = popupState.track.id;
    if (typeof trackId !== 'string' || !trackId) return;
    const playlistId = typeof playlist.id === 'string' ? playlist.id : '';
    if (!playlistId) return;

    const shouldBeMember = checkbox.checked;
    const isFavoritesPlaylist = typeof playlist.title === 'string' && playlist.title.trim() === '__fav__';

    if (shouldBeMember) {
        popupState.memberPlaylistIds.add(playlistId);
    } else {
        popupState.memberPlaylistIds.delete(playlistId);
    }

    if (isFavoritesPlaylist) {
        if (shouldBeMember) {
            favoriteTrackIds.add(trackId);
        } else {
            favoriteTrackIds.delete(trackId);
        }
        refreshFavoriteIcons();
        if (shouldBeMember) {
            broker.publish('playlist.liked', { trackId }, { target: 'shell' });
        } else {
            broker.publish('playlist.unliked', { trackId }, { target: 'shell' });
        }
        return;
    }

    try {
        if (shouldBeMember) {
            await broker.request('shell.addTrackToPlaylist', {
                trackId,
                playlistId,
            }, { target: 'shell', timeoutMs: 4000 });
        } else {
            await broker.request('shell.removeTrackFromPlaylist', {
                trackId,
                playlistId,
            }, { target: 'shell', timeoutMs: 4000 });
        }
    } catch (error) {
        console.error('Failed to update playlist membership', error);
        checkbox.checked = !shouldBeMember;
        if (shouldBeMember) {
            popupState.memberPlaylistIds.delete(playlistId);
        } else {
            popupState.memberPlaylistIds.add(playlistId);
        }
        if (isFavoritesPlaylist) {
            if (shouldBeMember) {
                favoriteTrackIds.delete(trackId);
            } else {
                favoriteTrackIds.add(trackId);
            }
            refreshFavoriteIcons();
        }
    }
}

async function openAddToPlaylistPopup(anchor, track) {
    closeAddToPlaylistPopup();

    const popup = document.createElement('div');
    popup.className = 'add-popup';
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', 'Add ' + track.title + ' to a playlist');

    const header = document.createElement('div');
    header.className = 'add-popup-header';
    header.textContent = 'Add to playlist';
    popup.appendChild(header);

    const list = document.createElement('div');
    list.className = 'add-popup-list';

    const loading = document.createElement('div');
    loading.className = 'add-popup-status';
    loading.textContent = 'Loading playlists…';
    list.appendChild(loading);
    popup.appendChild(list);

    document.body.appendChild(popup);
    positionAddToPlaylistPopup(popup, anchor);

    const onDocClick = (event) => {
        if (!openAddPopup) return;
        if (openAddPopup.popup.contains(event.target)) return;
        if (event.target === anchor || anchor.contains(event.target)) return;
        closeAddToPlaylistPopup();
    };
    const onKeydown = (event) => {
        if (!event || event.key !== 'Escape') return;
        event.preventDefault();
        closeAddToPlaylistPopup();
    };
    const onWindowResize = () => {
        if (!openAddPopup) return;
        positionAddToPlaylistPopup(openAddPopup.popup, anchor);
    };

    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', onWindowResize);

    const popupState = {
        popup,
        anchor,
        onDocClick,
        onKeydown,
        onWindowResize,
        track,
        memberPlaylistIds: new Set(),
    };
    openAddPopup = popupState;

    try {
        const [playlistsResponse, memberResponse] = await Promise.all([
            broker.request('shell.queryPlaylists', { type: 'own' }, {
                target: 'shell',
                timeoutMs: 4000,
            }),
            broker.request('shell.queryPlaylistsForTrack', { trackId: track.id }, {
                target: 'shell',
                timeoutMs: 4000,
            }),
        ]);
        if (!openAddPopup || openAddPopup.popup !== popup) return;

        const playlists = playlistsResponse && Array.isArray(playlistsResponse.playlists) ? playlistsResponse.playlists : [];
        const errorMessage = playlistsResponse && typeof playlistsResponse.error === 'string' ? playlistsResponse.error : '';
        const memberIds = Array.isArray(memberResponse) ? memberResponse : [];

        if (errorMessage) {
            const status = document.createElement('div');
            status.className = 'add-popup-status';
            status.textContent = 'Sign in to view your playlists.';
            list.innerHTML = '';
            list.appendChild(status);
            return;
        }

        popupState.memberPlaylistIds = new Set(
            memberIds.filter((id) => typeof id === 'string' && id)
        );
        renderAddToPlaylistList(list, playlists, popupState);
        positionAddToPlaylistPopup(popup, anchor);
    } catch (_error) {
        if (!openAddPopup || openAddPopup.popup !== popup) return;
        const status = document.createElement('div');
        status.className = 'add-popup-status';
        status.textContent = 'Sign in to view your playlists.';
        list.innerHTML = '';
        list.appendChild(status);
    }
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

async function loadPlaylistById(id) {
    try {
        const [response] = await Promise.all([
            broker.request('shell.queryPlaylist', { id }, {
                target: 'shell',
                timeoutMs: 15000,
            }),
            queryFavorites(),
        ]);

        const errorMessage = response && typeof response.error === 'string' ? response.error : '';
        const playlist = response && response.playlist && typeof response.playlist === 'object'
            ? response.playlist
            : null;
        const playlistTracks = Array.isArray(response && response.tracks) ? response.tracks : [];

        if (errorMessage) {
            applyPlaylistHeroState(null);
            tracks = [];
            currentIndex = -1;
            renderTracks();
            setStatus(errorMessage);
            return;
        }

        applyPlaylistHeroState(playlist);
        handleIndexLoaded({
            source: playlist && playlist.id ? 'playlist:' + playlist.id : 'playlist:' + id,
            tracks: playlistTracks,
            selectedIndex: playlistTracks.length > 0 ? 0 : -1,
        });
    } catch (error) {
        console.error('Failed to load playlist', id, error);
        applyPlaylistHeroState(null);
        tracks = [];
        currentIndex = -1;
        renderTracks();
        setStatus('Error loading playlist (see console)');
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

    if (typeof filters.playlist === 'string' && filters.playlist) {
        applyPlaylistHeroState(null);
        loadPlaylistById(filters.playlist);
        return;
    }

    clearFavoritesHeroState();
    queryIndex(filters);

    if (typeof filters.game === 'string' && filters.game) {
        queryGames({ game: filters.game });
    }
}

function applyAuthUser(payload) {
    if (!payload || typeof payload !== 'object') {
        currentUser = null;
    } else {
        const isAuthenticated = payload.isAuthenticated === true;
        const user = isAuthenticated && payload.user && typeof payload.user === 'object' ? payload.user : null;
        currentUser = {
            isAuthenticated,
            user: user && typeof user.id === 'string' && user.id ? user : null,
        };
    }
    applyPlaylistEditState();
}

async function queryAuthUser() {
    try {
        const payload = await broker.request('shell.queryUser', null, {
            target: 'shell',
            timeoutMs: 4000,
        });
        applyAuthUser(payload);
    } catch (_error) {
        applyAuthUser(null);
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

    broker.subscribe('shell.user.login', ({ payload }) => {
        applyAuthUser(payload);
    });

    broker.subscribe('shell.user.logout', ({ payload }) => {
        applyAuthUser(payload);
    });
}

function bindUiHandlers() {
    if (els.playButton) {
        els.playButton.addEventListener('click', playCurrentSelection);
    }

    if (els.heroArt) {
        els.heroArt.addEventListener('click', playCurrentSelection);
    }

    if (els.heroEditButton) {
        els.heroEditButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            startTitleEdit();
        });
    }

    if (els.heroTitle) {
        els.heroTitle.addEventListener('click', () => {
            if (canEditCurrentPlaylist()) {
                startTitleEdit();
            }
        });
        els.heroTitle.addEventListener('keydown', (event) => {
            if (!event) return;
            if (event.target && event.target.closest && event.target.closest('input.hero-title-edit')) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            if (!canEditCurrentPlaylist()) return;
            event.preventDefault();
            startTitleEdit();
        });
    }

    window.addEventListener('hashchange', () => {
        if (isTitleEditing()) {
            cancelTitleEdit();
        }
    });
}

function init() {
    bindBrokerHandlers();
    bindUiHandlers();
    broker.start();
    setStatus('Waiting for library...');
    queryAuthUser();

    window.addEventListener('hashchange', evaluateFragmentParameters);

    evaluateFragmentParameters();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}