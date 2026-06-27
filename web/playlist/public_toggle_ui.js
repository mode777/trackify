/*
 * Trackify playlist public-visibility toggle.
 *
 * Owner-only switch under the playlist title. Mirrors the title-edit /
 * art-edit owner pattern:
 *  - `canEditPlaylist` is imported from title_edit_ui — single source
 *    of truth for the editability predicate (also covers the
 *    favorites-playlist exclusion).
 *  - `reevaluate()` is the public re-entry point invoked by hero_ui,
 *    auth_state, and playlist_state whenever any of those change.
 *  - Toggle commits immediately on `change` (one PocketBase round
 *    trip per intent — no separate Save button). The checkbox is
 *    disabled while a save is in flight to avoid double-submits;
 *    failures revert the checkbox to the previous value.
 *  - On success the resolved playlist snapshot is merged back via
 *    `applyResolvedPlaylist`, and the `onPlaylistUpdated` callback
 *    re-runs the hero render so the gradient/eyebrow/company line
 *    (the latter reads `playlist.type`) all reflect the new state.
 */
'use strict';

import { els } from './dom.js';
import { setStatus } from './status_ui.js';
import {
    canEditPlaylist,
    applyResolvedPlaylist,
} from './title_edit_ui.js';

let getCurrentPlaylist = () => null;
let setCurrentPlaylistFn = () => {};
let onPlaylistUpdatedFn = () => {};
let shellClient = null;
let bound = false;
let saveInFlight = false;
let suppressChange = false;

export function initPublicToggleUi({
    getCurrentPlaylist: gP,
    setCurrentPlaylist,
    onPlaylistUpdated,
} = {}) {
    getCurrentPlaylist = typeof gP === 'function' ? gP : () => null;
    setCurrentPlaylistFn = typeof setCurrentPlaylist === 'function' ? setCurrentPlaylist : () => {};
    onPlaylistUpdatedFn = typeof onPlaylistUpdated === 'function' ? onPlaylistUpdated : () => {};
}

export function bindPublicToggleUi({ shellClient: sc } = {}) {
    shellClient = sc || null;
    if (bound) return;
    bound = true;

    if (els.publicToggle) {
        els.publicToggle.addEventListener('change', () => {
            if (suppressChange) return;
            const nextIsPublic = els.publicToggle.checked;
            commitPublicToggle(nextIsPublic);
        });
    }
}

export function reevaluate() {
    applyToggleVisibility();
}

export function applyToggleVisibility() {
    if (!els.publicToggleLabel || !els.publicToggle) return;
    const editable = canEditPlaylist();
    els.publicToggleLabel.hidden = !editable;
    syncToggleFromPlaylist();
    if (!editable) {
        els.publicToggle.disabled = true;
    } else if (!saveInFlight) {
        els.publicToggle.disabled = false;
    }
}

function syncToggleFromPlaylist() {
    if (!els.publicToggle) return;
    const playlist = getCurrentPlaylist();
    const isPublic = Boolean(playlist && playlist.type === 'public');
    suppressChange = true;
    els.publicToggle.checked = isPublic;
    suppressChange = false;
}

async function commitPublicToggle(nextIsPublic) {
    if (!canEditPlaylist() || saveInFlight) {
        syncToggleFromPlaylist();
        return;
    }

    const playlist = getCurrentPlaylist();
    const playlistId = playlist && typeof playlist.id === 'string' ? playlist.id : '';
    if (!playlistId) {
        syncToggleFromPlaylist();
        return;
    }

    const previousType = playlist && typeof playlist.type === 'string' ? playlist.type : '';
    const nextType = nextIsPublic ? 'public' : 'private';
    if (previousType === nextType) {
        return;
    }

    saveInFlight = true;
    if (els.publicToggle) els.publicToggle.disabled = true;
    if (els.publicToggleLabel) els.publicToggleLabel.classList.add('is-busy');
    setStatus(nextIsPublic ? 'Publishing playlist...' : 'Making playlist private...');
    try {
        const updated = shellClient
            ? await shellClient.updatePlaylist(playlistId, { type: nextType })
            : null;
        const resolved = updated && typeof updated === 'object' ? updated : null;
        applyResolvedPlaylist(
            {
                title: playlist && typeof playlist.title === 'string' ? playlist.title : '',
                type: resolved && typeof resolved.type === 'string' ? resolved.type : nextType,
                userId: playlist && typeof playlist.userId === 'string' ? playlist.userId : '',
                color: playlist && typeof playlist.color === 'string' ? playlist.color : '',
                icon: playlist && typeof playlist.icon === 'string' ? playlist.icon : '',
            },
            playlist && typeof playlist.title === 'string' ? playlist.title : ''
        );
        const refreshed = getCurrentPlaylist();
        if (refreshed && refreshed.id === playlistId) {
            onPlaylistUpdatedFn(refreshed);
        }
        setStatus(nextIsPublic ? 'Playlist is now public' : 'Playlist is now private');
    } catch (error) {
        console.error('Failed to update playlist visibility', error);
        syncToggleFromPlaylist();
        const message = error && error.message ? error.message : 'Failed to update playlist visibility';
        setStatus(message);
    } finally {
        saveInFlight = false;
        if (els.publicToggle && canEditPlaylist()) {
            els.publicToggle.disabled = false;
        }
        if (els.publicToggleLabel) {
            els.publicToggleLabel.classList.remove('is-busy');
        }
    }
}