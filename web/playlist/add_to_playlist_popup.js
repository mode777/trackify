/*
 * Trackify playlist add-to-playlist popup.
 *
 * Self-contained popup: opens on demand, anchors itself relative to
 * the trigger button (with viewport-clamping placement), lists the
 * user's playlists, and toggles membership. The favorites playlist
 * (title sentinel __fav__) is handled specially — its checkbox
 * delegates to favorites_service.applyUserToggle rather than the
 * shell add/remove endpoints, so a single source of truth owns the
 * `playlist.liked` / `playlist.unliked` publish.
 *
 * `initAddToPlaylistPopup({ shellClient, applyUserToggle, refreshFavoriteIcons })`
 * is the only state this module accepts.
 */
'use strict';

import { FAVORITES_PLAYLIST_TITLE } from './track_helpers.js';

let shellClient = null;
let applyUserToggleFn = () => {};
let refreshFavoriteIconsFn = () => {};

let openAddPopup = null;

export function initAddToPlaylistPopup({
    shellClient: sc,
    applyUserToggle,
    refreshFavoriteIcons,
} = {}) {
    shellClient = sc || null;
    applyUserToggleFn = typeof applyUserToggle === 'function' ? applyUserToggle : () => {};
    refreshFavoriteIconsFn = typeof refreshFavoriteIcons === 'function' ? refreshFavoriteIcons : () => {};
}

export async function openAddToPlaylistPopup(anchor, track) {
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

    if (!shellClient) {
        renderStatus(list, 'Sign in to view your playlists.');
        return;
    }

    try {
        const [playlistsResponse, memberResponse] = await Promise.all([
            shellClient.queryPlaylists({ type: 'own' }),
            shellClient.queryPlaylistsForTrack(track.id),
        ]);
        if (!openAddPopup || openAddPopup.popup !== popup) return;

        const playlists = playlistsResponse && Array.isArray(playlistsResponse.playlists) ? playlistsResponse.playlists : [];
        const errorMessage = playlistsResponse && typeof playlistsResponse.error === 'string' ? playlistsResponse.error : '';
        const memberIds = Array.isArray(memberResponse) ? memberResponse : [];

        if (errorMessage) {
            renderStatus(list, 'Sign in to view your playlists.');
            return;
        }

        popupState.memberPlaylistIds = new Set(
            memberIds.filter((id) => typeof id === 'string' && id)
        );
        renderAddToPlaylistList(list, playlists, popupState);
        positionAddToPlaylistPopup(popup, anchor);
    } catch (_error) {
        if (!openAddPopup || openAddPopup.popup !== popup) return;
        renderStatus(list, 'Sign in to view your playlists.');
    }
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

function renderStatus(listEl, message) {
    listEl.innerHTML = '';
    const status = document.createElement('div');
    status.className = 'add-popup-status';
    status.textContent = message;
    listEl.appendChild(status);
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
        if (trimmedTitle === FAVORITES_PLAYLIST_TITLE) {
            name.textContent = 'Liked Tracks';
        } else {
            name.textContent = trimmedTitle || 'Untitled playlist';
        }

        item.append(checkbox, name);
        listEl.appendChild(item);
    }
}

async function handleAddToPlaylistCheckboxChange(checkbox, playlist, popupState) {
    if (!popupState || !popupState.track || !shellClient) return;
    const trackId = popupState.track.id;
    if (typeof trackId !== 'string' || !trackId) return;
    const playlistId = typeof playlist.id === 'string' ? playlist.id : '';
    if (!playlistId) return;

    const shouldBeMember = checkbox.checked;
    const isFavoritesPlaylist = typeof playlist.title === 'string' && playlist.title.trim() === FAVORITES_PLAYLIST_TITLE;

    if (shouldBeMember) {
        popupState.memberPlaylistIds.add(playlistId);
    } else {
        popupState.memberPlaylistIds.delete(playlistId);
    }

    if (isFavoritesPlaylist) {
        applyUserToggleFn(trackId, !shouldBeMember);
        refreshFavoriteIconsFn();
        return;
    }

    try {
        if (shouldBeMember) {
            await shellClient.addTrackToPlaylist(trackId, playlistId);
        } else {
            await shellClient.removeTrackFromPlaylist(trackId, playlistId);
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
            applyUserToggleFn(trackId, shouldBeMember);
            refreshFavoriteIconsFn();
        }
    }
}
