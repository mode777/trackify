/*
 * Trackify player transport.
 *
 * Owns the playlist state (currentIndex, busy, tracks) and exposes the
 * transport operations: selectTrack, play/pause/toggle, next/prev, seek,
 * shuffle. Select-track is the heart of the module: it drives backend
 * loading, ScriptNodePlayer initialization, UI updates, and media-session
 * sync in the same order as the original monolithic player.js.
 *
 * Shuffle uses a Fisher-Yates order over the current playlist indices.
 * `shuffleOrder` is the playback sequence and `shufflePosition` is the
 * cursor inside it. When the cursor reaches the end it regenerates a new
 * shuffled order so the playlist keeps looping with variety. Toggling
 * shuffle off clears the order; the existing repeat-when-end behavior is
 * preserved in both modes.
 */
'use strict';

import { typeOf } from './backend_catalog.js';
import { getPlayer, initialize, loadMusicFromURL } from './player_host.js';
import { ensureBackendLoaded, isBackendReady, makeAdapter } from './backend_loader.js';
import { startSilenceAnchor, pauseSilenceAnchor } from './media_session_anchor.js';
import {
    updatePlayButton,
    updateNowPlayingMeta,
    updateNowPlayingThumb,
    setStatus,
} from './now_playing_ui.js';
import { refreshSeekUi, resetSeekUi, getSeekMaxMs } from './seek_ui.js';
import { syncVolumeUiFromPlayer } from './volume_ui.js';
import {
    syncMediaSessionPlaybackState,
    syncMediaSessionPositionState,
} from './media_session_sync.js';

let currentIndex = -1;
let busy = false;
let tracks = [];
let currentSource = '';
let lastPlaybackState = 'none';

let shuffleEnabled = false;
let shuffleOrder = [];
let shufflePosition = -1;

let broker = null;

export function getTracks() {
    return tracks;
}

export function getCurrentIndex() {
    return currentIndex;
}

export function isBusy() {
    return busy;
}

export function getLastPlaybackState() {
    return lastPlaybackState;
}

export function getCurrentPlaylist() {
    const currentTrack = tracks[currentIndex] && typeof tracks[currentIndex].id === 'string'
        ? tracks[currentIndex].id
        : null;
    return {
        source: currentSource,
        tracks: tracks.slice(),
        selectedIndex: currentIndex,
        currentTrack,
    };
}

export function isShuffleEnabled() {
    return shuffleEnabled;
}

export function initTransport(deps) {
    broker = deps.broker;
}

function fisherYatesShuffle(n) {
    const arr = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}

function generateShuffleOrder() {
    shuffleOrder = fisherYatesShuffle(tracks.length);
}

function findShufflePosition(trackIndex) {
    if (!shuffleOrder.length) return -1;
    return shuffleOrder.indexOf(trackIndex);
}

function syncShufflePositionToCurrent() {
    if (!shuffleEnabled) return;
    if (!tracks.length) {
        shuffleOrder = [];
        shufflePosition = -1;
        return;
    }
    if (!shuffleOrder.length || shuffleOrder.length !== tracks.length) {
        generateShuffleOrder();
    }
    if (currentIndex < 0 || currentIndex >= tracks.length) {
        shufflePosition = -1;
        return;
    }
    const pos = findShufflePosition(currentIndex);
    shufflePosition = pos >= 0 ? pos : 0;
}

export function setShuffleEnabled(enabled) {
    shuffleEnabled = !!enabled;
    if (shuffleEnabled) {
        syncShufflePositionToCurrent();
    } else {
        shuffleOrder = [];
        shufflePosition = -1;
    }
}

export function toggleShuffle() {
    setShuffleEnabled(!shuffleEnabled);
    return shuffleEnabled;
}

function advanceShufflePosition(direction) {
    if (!tracks.length) return -1;
    if (!shuffleOrder.length || shuffleOrder.length !== tracks.length) {
        generateShuffleOrder();
    }

    if (shufflePosition < 0) {
        if (currentIndex >= 0) {
            shufflePosition = findShufflePosition(currentIndex);
        }
        if (shufflePosition < 0) {
            shufflePosition = 0;
        }
        return shuffleOrder[shufflePosition];
    }

    if (direction > 0) {
        if (shufflePosition + 1 >= shuffleOrder.length) {
            generateShuffleOrder();
            shufflePosition = 0;
        } else {
            shufflePosition += 1;
        }
    } else {
        if (shufflePosition === 0) {
            shufflePosition = shuffleOrder.length - 1;
        } else {
            shufflePosition -= 1;
        }
    }

    return shuffleOrder[shufflePosition];
}

export function selectNextTrack(autoplay = true) {
    if (!tracks.length) return;
    if (busy) return;
    if (shuffleEnabled) {
        const nextIndex = advanceShufflePosition(1);
        selectTrack(nextIndex, autoplay);
        return;
    }
    selectTrack((currentIndex + 1 + tracks.length) % tracks.length, autoplay);
}

export function selectPreviousTrack(autoplay = true) {
    if (!tracks.length) return;
    if (busy) return;
    if (shuffleEnabled) {
        const prevIndex = advanceShufflePosition(-1);
        selectTrack(prevIndex, autoplay);
        return;
    }
    selectTrack((currentIndex - 1 + tracks.length) % tracks.length, autoplay);
}

function publishTrackChanged() {
    if (!broker) return;
    broker.publish('player.trackChanged', {
        index: currentIndex,
        track: tracks[currentIndex] || null,
    }, { target: 'shell' });
}

export async function selectTrack(index, autoplay) {
    if (busy) return;
    const track = tracks[index];
    if (!track) return;

    const type = typeOf(track.file);
    if (!type) {
        setStatus('Unsupported file type: ' + track.file);
        return;
    }

    busy = true;
    currentIndex = index;
    if (shuffleEnabled) {
        if (!shuffleOrder.length || shuffleOrder.length !== tracks.length) {
            generateShuffleOrder();
        }
        const pos = findShufflePosition(index);
        if (pos >= 0) {
            shufflePosition = pos;
        } else {
            generateShuffleOrder();
            shufflePosition = findShufflePosition(index);
            if (shufflePosition < 0) shufflePosition = 0;
        }
    }
    publishTrackChanged();

    if (!isBackendReady(type)) {
        setStatus('Loading ' + type.toUpperCase() + ' backend...');
    } else {
        setStatus('Loading "' + track.title + '"...');
    }
    updateNowPlayingMeta(track);
    updateNowPlayingThumb(track);
    resetSeekUi();

    try {
        await ensureBackendLoaded(type);

        setStatus('Loading "' + track.title + '"...');

        // A fresh adapter is created per selection; ScriptNodePlayer.initialize()
        // tears down the previous backend pipeline before wiring up the new one.
        const adapter = makeAdapter(type);
        await initialize(adapter, onTrackEnd, [], false);
        await loadMusicFromURL(track.file, {});

        syncVolumeUiFromPlayer();
        refreshSeekUi();

        const player = getPlayer();
        if (autoplay && player) {
            player.play();
            startSilenceAnchor();
            lastPlaybackState = 'playing';
        } else if (player) {
            lastPlaybackState = player.isPaused() ? 'paused' : 'playing';
        } else {
            lastPlaybackState = 'none';
        }

        updatePlayButton();
        setStatus(autoplay ? 'Playing' : 'Ready');
        syncMediaSessionPlaybackState();
        syncMediaSessionPositionState();
    } catch (error) {
        console.error('Failed to load track', error);
        setStatus('Error loading "' + track.title + '" (see console)');
        syncMediaSessionPlaybackState();
    } finally {
        busy = false;
    }
}

function onTrackEnd() {
    if (!tracks.length) return;
    selectNextTrack(true);
}

export function playCurrentOrSelected() {
    const player = getPlayer();
    if (!player) {
        if (currentIndex >= 0) {
            selectTrack(currentIndex, true);
        } else if (tracks.length > 0) {
            selectTrack(0, true);
        }
        return;
    }

    player.play();
    startSilenceAnchor();
    lastPlaybackState = 'playing';
    updatePlayButton();
    refreshSeekUi();
    setStatus('Playing');
    syncMediaSessionPlaybackState('playing');
}

export function pausePlayback() {
    const player = getPlayer();
    if (!player) return;

    player.pause();
    pauseSilenceAnchor();
    lastPlaybackState = 'paused';
    updatePlayButton();
    refreshSeekUi();
    setStatus('Paused');
    syncMediaSessionPlaybackState('paused');
}

export function togglePlay() {
    const player = getPlayer();
    if (!player) {
        if (currentIndex >= 0) {
            selectTrack(currentIndex, true);
        }
        return;
    }

    if (player.isPaused()) {
        player.play();
        startSilenceAnchor();
        lastPlaybackState = 'playing';
    } else {
        player.pause();
        pauseSilenceAnchor();
        lastPlaybackState = 'paused';
    }

    updatePlayButton();
    refreshSeekUi();
    setStatus(player.isPaused() ? 'Paused' : 'Playing');
    syncMediaSessionPlaybackState();
}

export function seekRelativeBySeconds(deltaSeconds) {
    const player = getPlayer();
    if (!player || !Number.isFinite(deltaSeconds)) return;

    let currentMs = 0;
    try {
        currentMs = player.getPlaybackPosition();
    } catch (_error) {
        return;
    }
    if (!Number.isFinite(currentMs)) return;

    const seekMax = getSeekMaxMs();
    const maxMs = Number.isFinite(seekMax) && seekMax > 0
        ? seekMax
        : Number.POSITIVE_INFINITY;
    const targetMs = Math.max(0, Math.min(maxMs, currentMs + deltaSeconds * 1000));

    try {
        player.seekPlaybackPosition(targetMs);
    } catch (_error) {
        return;
    }

    refreshSeekUi();
    syncMediaSessionPositionState();
}

export function seekToSeconds(seconds) {
    const player = getPlayer();
    if (!player || !Number.isFinite(seconds)) return;

    const seekMax = getSeekMaxMs();
    const maxSec = Number.isFinite(seekMax) && seekMax > 0
        ? seekMax / 1000
        : Number.POSITIVE_INFINITY;
    const targetMs = Math.max(0, Math.min(maxSec, seconds)) * 1000;

    try {
        player.seekPlaybackPosition(targetMs);
    } catch (_error) {
        return;
    }

    refreshSeekUi();
    syncMediaSessionPositionState();
}

export function handlePlaylistSelected(payload, autoplay) {
    if (!payload || !Array.isArray(payload.tracks)) return;

    currentSource = typeof payload.source === 'string' ? payload.source : '';

    tracks = payload.tracks
        .filter((track) => track && typeof track.title === 'string' && typeof track.file === 'string')
        .map((track) => ({
            id: track.id,
            title: track.title,
            file: track.file,
            platform: typeof track.platform === 'string' ? track.platform : '',
            game: typeof track.game === 'string' ? track.game : '',
            gameId: typeof track.gameId === 'string' ? track.gameId : '',
            artist: typeof track.artist === 'string' ? track.artist : '',
            coverArt: typeof track.coverArt === 'string' ? track.coverArt : '',
        }));

    if (!tracks.length) {
        currentIndex = -1;
        shuffleOrder = [];
        shufflePosition = -1;
        updateNowPlayingMeta(null);
        updateNowPlayingThumb(null);
        setStatus('Playlist is empty');
        return;
    }

    const preferredIndex = Number.isInteger(payload.selectedIndex) ? payload.selectedIndex : 0;
    const boundedIndex = Math.max(0, Math.min(tracks.length - 1, preferredIndex));
    currentIndex = boundedIndex;
    if (shuffleEnabled) {
        shuffleOrder = [];
        shufflePosition = -1;
        syncShufflePositionToCurrent();
    }
    updateNowPlayingMeta(tracks[currentIndex]);
    updateNowPlayingThumb(tracks[currentIndex]);
    setStatus('Playlist loaded');
    if (autoplay) {
        selectTrack(currentIndex, true);
    }
}
