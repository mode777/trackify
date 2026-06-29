/*
 * Trackify player now-playing UI.
 *
 * Owns rendering of the "now playing" footer (status line, title, game meta,
 * thumbnail, play/pause button icon). setStatus also fans out a
 * `player.stateChanged` event to the shell so other frames can mirror state.
 *
 * Transport/media-session accessors are passed in at init so this module
 * stays unaware of how state is owned.
 */
'use strict';

import { els } from './dom.js';
import { typeOf } from './backend_catalog.js';
import { getPlayer } from './player_host.js';

let broker = null;
let getTracks = () => [];
let getCurrentIndex = () => -1;
let isBusy = () => false;
let syncMediaSessionMetadataFn = () => {};

export function initNowPlayingUi(deps) {
    broker = deps.broker;
    getTracks = deps.getTracks || (() => []);
    getCurrentIndex = deps.getCurrentIndex || (() => -1);
    isBusy = deps.isBusy || (() => false);
    syncMediaSessionMetadataFn = deps.syncMediaSessionMetadata || (() => {});
}

export function updateNowPlayingMeta(track) {
    const title = track ? track.title : 'No track selected';
    const game = track ? (track.game || 'Unknown game') : 'Unknown game';

    if (els.trackTitle) {
        els.trackTitle.textContent = title;
    }
    if (els.trackMeta) {
        const artistLabel = track && typeof track.artist === 'string' ? track.artist.trim() : '';
        const gameId = track && typeof track.gameId === 'string' ? track.gameId.trim() : '';

        while (els.trackMeta.firstChild) {
            els.trackMeta.removeChild(els.trackMeta.firstChild);
        }

        if (gameId) {
            const gameLink = document.createElement('a');
            gameLink.href = '/games/' + encodeURIComponent(gameId);
            gameLink.setAttribute('data-router-link', '');
            gameLink.className = 'track-meta-game';
            gameLink.textContent = game;
            els.trackMeta.appendChild(gameLink);
        } else {
            els.trackMeta.appendChild(document.createTextNode(game));
        }

        if (artistLabel) {
            els.trackMeta.appendChild(document.createTextNode(' · ' + artistLabel));
        }
    }

    syncMediaSessionMetadataFn(track);
}

export function updateNowPlayingThumb(track) {
    if (!els.thumb) return;

    const coverArt = track && typeof track.coverArt === 'string' ? track.coverArt.trim() : '';
    if (!coverArt) {
        els.thumb.style.removeProperty('--thumb-bg');
        return;
    }

    let resolvedCoverArt = coverArt;
    try {
        resolvedCoverArt = new URL(coverArt, window.location.href).toString();
    } catch (_error) {
        // Keep original value; CSS will ignore malformed URLs.
    }

    els.thumb.style.setProperty('--thumb-bg', 'url("' + resolvedCoverArt.replace(/"/g, '\\"') + '")');

    // Keep media session artwork aligned when only cover art changed.
    syncMediaSessionMetadataFn(track);
}

export function setStatus(message) {
    if (els.status) {
        while (els.status.firstChild) {
            els.status.removeChild(els.status.firstChild);
        }

        const currentIndex = getCurrentIndex();
        const tracks = getTracks();
        const hasCurrentTrack = Number.isInteger(currentIndex)
            && currentIndex >= 0
            && Array.isArray(tracks)
            && currentIndex < tracks.length
            && tracks[currentIndex];

        if (hasCurrentTrack) {
            const statusLink = document.createElement('a');
            statusLink.href = '/now-playing';
            statusLink.setAttribute('data-router-link', '');
            statusLink.className = 'status-link';
            statusLink.textContent = message;
            els.status.appendChild(statusLink);
        } else if (message) {
            els.status.appendChild(document.createTextNode(message));
        }
    }

    if (!broker) return;

    const tracksSnapshot = getTracks();
    const currentIndexSnapshot = getCurrentIndex();
    const currentTrackId = tracksSnapshot[currentIndexSnapshot]
        && typeof tracksSnapshot[currentIndexSnapshot].id === 'string'
        ? tracksSnapshot[currentIndexSnapshot].id
        : null;

    broker.publish('player.stateChanged', {
        status: message,
        currentIndex: currentIndexSnapshot,
        currentTrack: currentTrackId,
        busy: isBusy(),
        hasTracks: tracksSnapshot.length > 0,
    }, { target: 'shell' });
}

export function updatePlayButton() {
    if (!els.play) return;

    const player = getPlayer();
    const paused = !player || player.isPaused();
    els.play.innerHTML = paused
        ? '<span class="material-symbols-outlined filled">play_arrow</span>'
        : '<span class="material-symbols-outlined filled">pause</span>';
}
