/*
 * Trackify playlist state machine.
 *
 * Owns the playlist snapshot (tracks, currentIndex, playlistInfo),
 * the loaded currentPlaylist metadata, the player-ready flag, and the
 * pending selection that survives until the player frame signals
 * `player.ready`. Publishes `playlist.selected` (target: player).
 *
 * Mirrors web/player/transport.js — getters for read access, action
 * functions for mutations, no direct DOM knowledge.
 */
'use strict';

let broker = null;
let onSelectionChangedFn = () => {};

let tracks = [];
let currentIndex = -1;
let playlistInfo = {};
let currentPlaylist = null;
let playerReady = false;
let pendingSelection = null;

export function initPlaylistState({ broker: b, onSelectionChanged } = {}) {
    broker = b;
    onSelectionChangedFn = typeof onSelectionChanged === 'function' ? onSelectionChanged : () => {};
    tracks = [];
    currentIndex = -1;
    playlistInfo = {};
    currentPlaylist = null;
    playerReady = false;
    pendingSelection = null;
}

export function getTracks() {
    return tracks;
}

export function getCurrentIndex() {
    return currentIndex;
}

export function getPlaylistInfo() {
    return playlistInfo;
}

export function getCurrentPlaylist() {
    return currentPlaylist;
}

export function isPlayerReady() {
    return playerReady;
}

export function hasTracks() {
    return tracks.length > 0;
}

export function setCurrentPlaylist(playlist) {
    if (!playlist || typeof playlist !== 'object' || typeof playlist.id !== 'string' || !playlist.id) {
        currentPlaylist = null;
        return;
    }
    currentPlaylist = {
        id: playlist.id,
        title: typeof playlist.title === 'string' ? playlist.title.trim() : '',
        type: typeof playlist.type === 'string' ? playlist.type : '',
        userId: typeof playlist.userId === 'string' ? playlist.userId : '',
        color: typeof playlist.color === 'string' ? playlist.color : '',
        icon: typeof playlist.icon === 'string' ? playlist.icon : '',
    };
}

export function setPlayerReady(value) {
    playerReady = value === true;
}

export function applyIndexPayload(payload) {
    if (!payload || typeof payload !== 'object') return;

    playlistInfo = {
        source: typeof payload.source === 'string' ? payload.source : 'sample-files/index.json',
    };

    if (typeof payload.error === 'string' && payload.error) {
        tracks = [];
        currentIndex = -1;
        onSelectionChangedFn();
        return payload.error;
    }

    if (!Array.isArray(payload.tracks)) return null;

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
        onSelectionChangedFn();
        return 'No tracks found in sample-files/index.json';
    }

    const preferredIndex = Number.isInteger(payload.selectedIndex) ? payload.selectedIndex : 0;
    currentIndex = Math.max(0, Math.min(tracks.length - 1, preferredIndex));
    onSelectionChangedFn();
    return 'Playlist loaded';
}

export function handlePlayerTrackChanged(currentTrackId) {
    let newIndex = -1;
    if (typeof currentTrackId === 'string' && currentTrackId) {
        newIndex = tracks.findIndex((track) => track && track.id === currentTrackId);
    }
    if (newIndex !== currentIndex) {
        currentIndex = newIndex;
        onSelectionChangedFn();
    }
}

export function flushPendingSelection() {
    if (!pendingSelection || !broker) return;
    broker.publish('playlist.selected', pendingSelection, { target: 'player' });
    pendingSelection = null;
}

export function publishSelected(index, autoplay) {
    if (!tracks.length) return;

    currentIndex = Math.max(0, Math.min(tracks.length - 1, index));
    onSelectionChangedFn();

    const payload = {
        source: playlistInfo.source,
        selectedIndex: currentIndex,
        tracks,
        autoplay,
    };

    if (!playerReady) {
        pendingSelection = payload;
    } else {
        pendingSelection = null;
    }

    if (playerReady && broker) {
        broker.publish('playlist.selected', payload, { target: 'player' });
    }
}

export function playCurrentSelection() {
    if (!tracks.length) return;
    const selectedIndex = currentIndex >= 0 ? currentIndex : 0;
    publishSelected(selectedIndex, true);
}
