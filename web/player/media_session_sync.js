/*
 * Trackify player Media Session sync.
 *
 * Bridges the Web Audio pipeline to the browser's navigator.mediaSession API
 * (and through it, OS-level media controls + lock-screen art). Mirrors the
 * state back to the shell via `player.mediaSessionSync` so the shell can
 * reflect the same metadata when it has its own binding.
 */
'use strict';

import { getPlayer } from './player_host.js';
import { getSeekMaxMs } from './seek_ui.js';

const DEFAULT_MEDIA_SEEK_OFFSET_SEC = 10;

const mediaSessionState = {
    handlersBound: false,
    metadataKey: '',
    playbackState: 'none',
    positionStateKey: '',
};

let broker = null;
let getTracks = () => [];
let getCurrentIndex = () => -1;
let getLastPlaybackState = () => 'none';
let playCurrentOrSelectedFn = () => {};
let pausePlaybackFn = () => {};
let selectNextTrackFn = () => {};
let selectPreviousTrackFn = () => {};
let seekRelativeBySecondsFn = () => {};
let seekToSecondsFn = () => {};

export function initMediaSessionSync(deps) {
    broker = deps.broker;
    getTracks = deps.getTracks || (() => []);
    getCurrentIndex = deps.getCurrentIndex || (() => -1);
    getLastPlaybackState = deps.getLastPlaybackState || (() => 'none');
    playCurrentOrSelectedFn = deps.playCurrentOrSelected || (() => {});
    pausePlaybackFn = deps.pausePlayback || (() => {});
    selectNextTrackFn = deps.selectNextTrack || (() => {});
    selectPreviousTrackFn = deps.selectPreviousTrack || (() => {});
    seekRelativeBySecondsFn = deps.seekRelativeBySeconds || (() => {});
    seekToSecondsFn = deps.seekToSeconds || (() => {});
}

function supportsMediaSession() {
    return typeof navigator !== 'undefined' && !!navigator.mediaSession;
}

function safeSetMediaActionHandler(action, handler) {
    if (!supportsMediaSession()) return;
    try {
        navigator.mediaSession.setActionHandler(action, handler);
    } catch (_error) {
        // Unsupported action on this browser/OS combination.
    }
}

function getPreferredTrackArtist(track) {
    if (track && typeof track.artist === 'string' && track.artist.trim()) {
        return track.artist.trim();
    }
    return '';
}

function createMediaArtworkList(track) {
    const coverArt = track && typeof track.coverArt === 'string' ? track.coverArt.trim() : '';
    if (!coverArt) return [];

    let src = coverArt;
    try {
        src = new URL(coverArt, window.location.href).toString();
    } catch (_error) {
        // Keep original value.
    }

    return [{ src }];
}

function buildMediaMetadataPayload(track) {
    const title = track ? track.title : 'Trackify';
    const album = track ? (track.game || '') : '';
    const artist = getPreferredTrackArtist(track);
    const artwork = createMediaArtworkList(track);

    return {
        title,
        artist,
        album,
        artwork,
    };
}

function getCurrentTrack() {
    const tracksSnapshot = getTracks();
    const index = getCurrentIndex();
    return tracksSnapshot[index] || null;
}

export function publishMediaSessionSync(partialPayload = {}) {
    const track = getCurrentTrack();
    const metadata = buildMediaMetadataPayload(track);
    const player = getPlayer();
    let playbackState = 'none';
    if (player) {
        playbackState = player.isPaused() ? 'paused' : 'playing';
    } else if (track) {
        // Some backends briefly drop player instance visibility while paused.
        // Preserve a stable session state so OS media controls don't disappear.
        playbackState = getLastPlaybackState() === 'playing' ? 'playing' : 'paused';
    }

    const seekMaxMs = getSeekMaxMs();
    const supportsSeek = !!(player && Number.isFinite(seekMaxMs) && seekMaxMs > 0);

    if (!broker) return;

    broker.publish('player.mediaSessionSync', {
        metadata,
        playbackState,
        positionState: getPositionStatePayload(),
        capabilities: {
            hasTracks: getTracks().length > 0,
            hasCurrentTrack: !!track,
            supportsSeekTo: supportsSeek,
            supportsSeekStep: supportsSeek,
            canGoNext: getTracks().length > 1,
            canGoPrevious: getTracks().length > 1,
        },
        ...partialPayload,
    }, { target: 'shell' });
}

export function syncMediaSessionMetadata(track) {
    const metadata = buildMediaMetadataPayload(track);
    const metadataKey = JSON.stringify(metadata);

    if (supportsMediaSession() && mediaSessionState.metadataKey !== metadataKey) {
        try {
            navigator.mediaSession.metadata = new MediaMetadata(metadata);
            mediaSessionState.metadataKey = metadataKey;
        } catch (_error) {
            // Ignore metadata assignment failures.
        }
    }

    publishMediaSessionSync({ metadata });
}

function getPositionStatePayload() {
    const player = getPlayer();
    const seekMaxMs = getSeekMaxMs();
    if (!player || !Number.isFinite(seekMaxMs) || seekMaxMs <= 0) {
        return null;
    }

    let position = 0;
    try {
        position = player.getPlaybackPosition();
    } catch (_error) {
        return null;
    }
    if (!Number.isFinite(position)) {
        return null;
    }

    return {
        duration: Math.max(0, seekMaxMs) / 1000,
        playbackRate: 1,
        position: Math.max(0, Math.min(seekMaxMs, position)) / 1000,
    };
}

export function syncMediaSessionPlaybackState(forcedState) {
    const player = getPlayer();
    const playbackState = typeof forcedState === 'string'
        ? forcedState
        : (player ? (player.isPaused() ? 'paused' : 'playing') : 'none');

    if (supportsMediaSession() && mediaSessionState.playbackState !== playbackState) {
        try {
            navigator.mediaSession.playbackState = playbackState;
            mediaSessionState.playbackState = playbackState;
        } catch (_error) {
            // Ignore playback state assignment failures.
        }
    }

    publishMediaSessionSync({ playbackState });
}

export function syncMediaSessionPositionState() {
    const positionState = getPositionStatePayload();
    const key = JSON.stringify(positionState);

    if (supportsMediaSession() && positionState && mediaSessionState.positionStateKey !== key) {
        try {
            navigator.mediaSession.setPositionState(positionState);
            mediaSessionState.positionStateKey = key;
        } catch (_error) {
            // Ignore unsupported position state updates.
        }
    }

    publishMediaSessionSync({ positionState });
}

export function bindMediaSessionHandlers() {
    if (!supportsMediaSession() || mediaSessionState.handlersBound) {
        return;
    }

    safeSetMediaActionHandler('play', () => {
        playCurrentOrSelectedFn();
    });
    safeSetMediaActionHandler('pause', () => {
        pausePlaybackFn();
    });
    safeSetMediaActionHandler('previoustrack', () => {
        if (!getTracks().length) return;
        selectPreviousTrackFn(true);
    });
    safeSetMediaActionHandler('nexttrack', () => {
        if (!getTracks().length) return;
        selectNextTrackFn(true);
    });
    safeSetMediaActionHandler('seekbackward', (details) => {
        const step = Number(details && details.seekOffset);
        seekRelativeBySecondsFn(-(Number.isFinite(step) && step > 0 ? step : DEFAULT_MEDIA_SEEK_OFFSET_SEC));
    });
    safeSetMediaActionHandler('seekforward', (details) => {
        const step = Number(details && details.seekOffset);
        seekRelativeBySecondsFn(Number.isFinite(step) && step > 0 ? step : DEFAULT_MEDIA_SEEK_OFFSET_SEC);
    });
    safeSetMediaActionHandler('seekto', (details) => {
        const target = Number(details && details.seekTime);
        seekToSecondsFn(target);
    });
    safeSetMediaActionHandler('stop', () => {
        pausePlaybackFn();
    });

    mediaSessionState.handlersBound = true;
}
