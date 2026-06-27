/*
 * Trackify playlist art-edit UI.
 *
 * Owner-only popover that lets the playlist owner change the color
 * (HTML color picker) and icon (dropdown over PLAYLIST_MUSIC_ICONS)
 * used by the gradient hero art and the collection card. Mirrors the
 * title edit flow:
 *  - `canEditPlaylist` is imported from title_edit_ui — the single
 *    source of truth for the editability predicate.
 *  - `reevaluate()` is the public re-entry point invoked by hero_ui,
 *    auth_state, and playlist_state whenever any of those change.
 *  - Save routes through `shellClient.updatePlaylist(id, { color,
 *    icon })` and merges the response back into the local playlist
 *    snapshot via `applyResolvedPlaylist` from title_edit_ui.
 *  - Cancel / hashchange / outside-click all close the popover
 *    without writing.
 */
'use strict';

import { els } from './dom.js';
import { setStatus } from './status_ui.js';
import {
    canEditPlaylist,
    applyResolvedPlaylist,
} from './title_edit_ui.js';
import { PLAYLIST_MUSIC_ICONS } from '../playlist_meta.js';

let getCurrentPlaylist = () => null;
let setCurrentPlaylistFn = () => {};
let onPlaylistUpdatedFn = () => {};
let shellClient = null;
let popoverOpen = false;
let saveInFlight = false;
let popoverBound = false;

function defaultColor() {
    return '#d2bbff';
}

function defaultIcon() {
    return PLAYLIST_MUSIC_ICONS.length > 0 ? PLAYLIST_MUSIC_ICONS[0] : 'music_note';
}

export function initArtEditUi({
    getCurrentPlaylist: gP,
    setCurrentPlaylist,
    onPlaylistUpdated,
} = {}) {
    getCurrentPlaylist = typeof gP === 'function' ? gP : () => null;
    setCurrentPlaylistFn = typeof setCurrentPlaylist === 'function' ? setCurrentPlaylist : () => {};
    onPlaylistUpdatedFn = typeof onPlaylistUpdated === 'function' ? onPlaylistUpdated : () => {};
}

export function bindArtEditUi({ shellClient: sc } = {}) {
    shellClient = sc || null;

    if (popoverBound) return;
    popoverBound = true;

    populateIconOptions();

    if (els.heroArtEditButton) {
        els.heroArtEditButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (popoverOpen) {
                closeArtEditPopover();
            } else {
                openArtEditPopover();
            }
        });
    }

    if (els.heroArtEditCancel) {
        els.heroArtEditCancel.addEventListener('click', (event) => {
            event.preventDefault();
            closeArtEditPopover();
        });
    }

    if (els.heroArtEditSave) {
        els.heroArtEditSave.addEventListener('click', (event) => {
            event.preventDefault();
            commitArtEdit();
        });
    }

    if (els.heroArtEditColor) {
        els.heroArtEditColor.addEventListener('input', () => {
            syncColorSwatch(els.heroArtEditColor.value);
        });
        els.heroArtEditColor.addEventListener('change', () => {
            syncColorSwatch(els.heroArtEditColor.value);
        });
    }

    document.addEventListener('keydown', (event) => {
        if (!popoverOpen || !event) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeArtEditPopover();
        }
    });

    document.addEventListener('mousedown', (event) => {
        if (!popoverOpen) return;
        const target = event.target;
        if (!target || typeof target !== 'node') return;
        if (els.heroArtEditPopover && els.heroArtEditPopover.contains(target)) return;
        if (els.heroArtEditButton && els.heroArtEditButton.contains(target)) return;
        closeArtEditPopover();
    });

    window.addEventListener('hashchange', () => {
        if (popoverOpen) closeArtEditPopover();
    });
}

function populateIconOptions() {
    if (!els.heroArtEditIcon) return;
    els.heroArtEditIcon.innerHTML = '';
    for (const iconName of PLAYLIST_MUSIC_ICONS) {
        const option = document.createElement('option');
        option.value = iconName;
        option.textContent = iconName;
        els.heroArtEditIcon.appendChild(option);
    }
}

export function reevaluate() {
    applyArtEditButtonVisibility();
    if (!canEditPlaylist() && popoverOpen) {
        closeArtEditPopover();
    }
}

export function applyArtEditButtonVisibility() {
    if (!els.heroArtEditButton) return;
    const editable = canEditPlaylist();
    els.heroArtEditButton.hidden = !editable;
    if (!editable && popoverOpen) {
        closeArtEditPopover();
    }
}

function openArtEditPopover() {
    if (!els.heroArtEditPopover || !canEditPlaylist()) return;

    const playlist = getCurrentPlaylist();
    const color = playlist && typeof playlist.color === 'string' && playlist.color ? playlist.color : defaultColor();
    const icon = playlist && typeof playlist.icon === 'string' && playlist.icon ? playlist.icon : defaultIcon();

    if (els.heroArtEditColor) {
        els.heroArtEditColor.value = color;
    }
    syncColorSwatch(color);

    if (els.heroArtEditIcon) {
        const hasMatch = Array.from(els.heroArtEditIcon.options || []).some((option) => option.value === icon);
        if (!hasMatch) {
            const option = document.createElement('option');
            option.value = icon;
            option.textContent = icon;
            els.heroArtEditIcon.appendChild(option);
        }
        els.heroArtEditIcon.value = icon;
    }

    els.heroArtEditPopover.hidden = false;
    popoverOpen = true;
    if (els.heroArtEditButton) {
        els.heroArtEditButton.setAttribute('aria-expanded', 'true');
    }
}

function closeArtEditPopover() {
    if (!els.heroArtEditPopover) return;
    els.heroArtEditPopover.hidden = true;
    popoverOpen = false;
    if (els.heroArtEditButton) {
        els.heroArtEditButton.setAttribute('aria-expanded', 'false');
    }
}

function syncColorSwatch(value) {
    if (!els.heroArtEditColorSwatch) return;
    els.heroArtEditColorSwatch.style.background = value || 'transparent';
}

async function commitArtEdit() {
    if (!canEditPlaylist() || saveInFlight) return;

    const playlist = getCurrentPlaylist();
    const playlistId = playlist && typeof playlist.id === 'string' ? playlist.id : '';
    if (!playlistId) {
        closeArtEditPopover();
        return;
    }

    const nextColorRaw = els.heroArtEditColor ? els.heroArtEditColor.value : '';
    const nextIcon = els.heroArtEditIcon ? els.heroArtEditIcon.value : '';
    const nextColor = typeof nextColorRaw === 'string' ? nextColorRaw.trim().toLowerCase() : '';
    const originalColor = playlist && typeof playlist.color === 'string' ? playlist.color : '';
    const originalIcon = playlist && typeof playlist.icon === 'string' ? playlist.icon : '';

    if (nextColor === originalColor && nextIcon === originalIcon) {
        closeArtEditPopover();
        return;
    }

    saveInFlight = true;
    setStatus('Saving playlist art...');
    try {
        const updated = shellClient
            ? await shellClient.updatePlaylist(playlistId, { color: nextColor, icon: nextIcon })
            : null;
        const resolved = updated && typeof updated === 'object' ? updated : null;
        applyResolvedPlaylist(
            {
                title: playlist && typeof playlist.title === 'string' ? playlist.title : '',
                type: playlist && typeof playlist.type === 'string' ? playlist.type : '',
                userId: playlist && typeof playlist.userId === 'string' ? playlist.userId : '',
                color: resolved && typeof resolved.color === 'string' ? resolved.color : nextColor,
                icon: resolved && typeof resolved.icon === 'string' ? resolved.icon : nextIcon,
            },
            playlist && typeof playlist.title === 'string' ? playlist.title : ''
        );
        const refreshed = getCurrentPlaylist();
        if (refreshed && refreshed.id === playlistId) {
            onPlaylistUpdatedFn(refreshed);
        }
        closeArtEditPopover();
        setStatus('Playlist art updated');
    } catch (error) {
        console.error('Failed to update playlist art', error);
        const message = error && error.message ? error.message : 'Failed to update playlist art';
        setStatus(message);
    } finally {
        saveInFlight = false;
    }
}