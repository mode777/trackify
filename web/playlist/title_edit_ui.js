/*
 * Trackify playlist title-edit UI.
 *
 * Owns:
 *  - The "editable?" derivation (canEditPlaylist) and its DOM
 *    projection (applyPlaylistEditState / clearPlaylistEditState).
 *  - The in-place title input flow: startTitleEdit creates a text
 *    input inside #heroTitle, commits on Enter/blur, cancels on
 *    Escape, and routes the rename through shellClient.updatePlaylist.
 *  - Cancelling an in-flight edit when the URL fragment changes
 *    (so navigation never strands an open input).
 *
 * `initTitleEditUi({ getCurrentPlaylist, getCurrentUser })` stores
 * the read-only deps. `reevaluate()` is the public re-entry point
 * invoked by hero_ui + auth_state + playlist_state whenever any of
 * those change.
 *
 * `bindTitleEditUi({ shellClient })` wires DOM clicks and the
 * hashchange listener.
 */
'use strict';

import { els } from './dom.js';
import { setStatus } from './status_ui.js';

let getCurrentPlaylist = () => null;
let getCurrentUser = () => null;
let setCurrentPlaylistFn = () => {};
let shellClient = null;
let titleEditInFlight = false;

export function initTitleEditUi({
    getCurrentPlaylist: gP,
    getCurrentUser: gU,
    setCurrentPlaylist,
} = {}) {
    getCurrentPlaylist = typeof gP === 'function' ? gP : () => null;
    getCurrentUser = typeof gU === 'function' ? gU : () => null;
    setCurrentPlaylistFn = typeof setCurrentPlaylist === 'function' ? setCurrentPlaylist : () => {};
}

export function bindTitleEditUi({ shellClient: sc } = {}) {
    shellClient = sc || null;

    if (els.heroEditButton) {
        els.heroEditButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            startTitleEdit();
        });
    }

    if (els.heroTitle) {
        els.heroTitle.addEventListener('click', () => {
            if (canEditPlaylist()) {
                startTitleEdit();
            }
        });
        els.heroTitle.addEventListener('keydown', (event) => {
            if (!event) return;
            if (event.target && event.target.closest && event.target.closest('input.hero-title-edit')) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            if (!canEditPlaylist()) return;
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

export function canEditPlaylist() {
    const playlist = getCurrentPlaylist();
    if (!playlist || typeof playlist.id !== 'string' || !playlist.id) return false;
    if (playlist.type === 'favorites') return false;
    const user = getCurrentUser();
    if (!user || !user.isAuthenticated || !user.user || typeof user.user.id !== 'string') return false;
    return playlist.userId === user.user.id;
}

export function reevaluate() {
    applyPlaylistEditState();
}

export function applyResolvedPlaylist(resolvedPlaylist, fallbackTitle) {
    const playlist = getCurrentPlaylist();
    const playlistId = playlist && typeof playlist.id === 'string' ? playlist.id : '';
    if (!playlistId) return;
    const merged = {
        ...(playlist || {}),
        ...(resolvedPlaylist || {}),
        id: playlistId,
        title: (resolvedPlaylist && typeof resolvedPlaylist.title === 'string' && resolvedPlaylist.title.trim())
            ? resolvedPlaylist.title.trim()
            : (fallbackTitle || (playlist && playlist.title) || ''),
        type: resolvedPlaylist && resolvedPlaylist.type ? resolvedPlaylist.type : (playlist && playlist.type) || '',
        userId: resolvedPlaylist && resolvedPlaylist.userId ? resolvedPlaylist.userId : (playlist && playlist.userId) || '',
    };
    setCurrentPlaylistFn(merged);
}

export function clearPlaylistEditState() {
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

export function applyPlaylistEditState() {
    const editable = canEditPlaylist();
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

export function isTitleEditing() {
    return Boolean(els.heroTitle && els.heroTitle.querySelector('input.hero-title-edit'));
}

export function cancelTitleEdit() {
    if (!els.heroTitle) return;
    const input = els.heroTitle.querySelector('input.hero-title-edit');
    if (!input) return;
    const playlist = getCurrentPlaylist();
    const original = playlist && typeof playlist.title === 'string' ? playlist.title : '';
    els.heroTitle.textContent = original || 'Playlist';
    els.heroTitle.classList.remove('is-editable');
    applyPlaylistEditState();
}

function startTitleEdit() {
    if (!canEditPlaylist() || titleEditInFlight) return;
    if (!els.heroTitle) return;
    if (isTitleEditing()) return;

    const playlist = getCurrentPlaylist();
    const originalTitle = playlist && typeof playlist.title === 'string' ? playlist.title : '';
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
            const playlistId = playlist && typeof playlist.id === 'string' ? playlist.id : '';
            const updated = shellClient
                ? await shellClient.updatePlaylist(playlistId, { title: nextTitle })
                : null;
            const resolvedPlaylist = updated && typeof updated === 'object' ? updated : null;
            const resolvedTitle = resolvedPlaylist && typeof resolvedPlaylist.title === 'string' && resolvedPlaylist.title.trim()
                ? resolvedPlaylist.title.trim()
                : nextTitle;
            applyResolvedPlaylist(resolvedPlaylist, resolvedTitle);
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
