/*
 * Trackify player transport.
 *
 * Owns the playlist state (currentIndex, busy, tracks) and exposes the
 * transport operations: selectTrack, play/pause/toggle, next/prev, seek.
 * Select-track is the heart of the module: it drives backend loading,
 * ScriptNodePlayer initialization, UI updates, and media-session sync in
 * the same order as the original monolithic player.js.
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
let lastPlaybackState = 'none';

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

export function initTransport(deps) {
    broker = deps.broker;
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

    const next = (currentIndex + 1) % tracks.length;
    selectTrack(next, true);
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

    tracks = payload.tracks
        .filter((track) => track && typeof track.title === 'string' && typeof track.file === 'string')
        .map((track) => ({
            id: track.id,
            title: track.title,
            file: track.file,
            platform: typeof track.platform === 'string' ? track.platform : '',
            game: typeof track.game === 'string' ? track.game : '',
            artist: typeof track.artist === 'string' ? track.artist : '',
            coverArt: typeof track.coverArt === 'string' ? track.coverArt : '',
        }));

    if (!tracks.length) {
        currentIndex = -1;
        updateNowPlayingMeta(null);
        updateNowPlayingThumb(null);
        setStatus('Playlist is empty');
        return;
    }

    const preferredIndex = Number.isInteger(payload.selectedIndex) ? payload.selectedIndex : 0;
    const boundedIndex = Math.max(0, Math.min(tracks.length - 1, preferredIndex));
    currentIndex = boundedIndex;
    updateNowPlayingMeta(tracks[currentIndex]);
    updateNowPlayingThumb(tracks[currentIndex]);
    setStatus('Playlist loaded');
    if (autoplay) {
        selectTrack(currentIndex, true);
    }
}
