/*
 * Trackify player frame app.
 *
 * Pure orchestrator: instantiates the broker, wires the player modules
 * together, binds UI controls and broker subscriptions, then kicks off
 * the seek-position polling loop.
 */
'use strict';

import { createFrameBroker } from './broker.js';
import { createNavClient } from './nav_client.js';

import { els } from './player/dom.js';
import {
    initNowPlayingUi,
    updatePlayButton,
    setStatus,
} from './player/now_playing_ui.js';
import { bindVolumeUi } from './player/volume_ui.js';
import {
    bindSeekUi,
    startSeekPolling,
    refreshSeekUi,
    resetSeekUi,
} from './player/seek_ui.js';
import { bindShuffleUi } from './player/shuffle_ui.js';
import {
    initMediaSessionSync,
    bindMediaSessionHandlers,
    syncMediaSessionMetadata,
    syncMediaSessionPlaybackState,
    syncMediaSessionPositionState,
    publishMediaSessionSync,
} from './player/media_session_sync.js';
import {
    initTransport,
    handlePlaylistSelected,
    selectNextTrack,
    selectPreviousTrack,
    playCurrentOrSelected,
    pausePlayback,
    togglePlay,
    seekRelativeBySeconds,
    seekToSeconds,
    getTracks,
    getCurrentIndex,
    isBusy,
    getLastPlaybackState,
    isShuffleEnabled,
    getCurrentPlaylist,
} from './player/transport.js';

const broker = createFrameBroker({
    serviceId: 'player',
    targetOrigin: window.location.origin,
    requestTimeoutMs: 4000,
    allowedOrigins: [window.location.origin],
});

const navClient = createNavClient({ broker });

function nextTrack() {
    selectNextTrack(true);
}

function previousTrack() {
    selectPreviousTrack(true);
}

function bindPlayPauseUi() {
    if (els.play) {
        els.play.addEventListener('click', togglePlay);
    }
    if (els.next) {
        els.next.addEventListener('click', nextTrack);
    }
    if (els.prev) {
        els.prev.addEventListener('click', previousTrack);
    }
}

function bindBrokerHandlers() {
    broker.handleRequest('player.getCurrentPlaylist', () => getCurrentPlaylist());

    broker.subscribe('playlist.selected', ({ payload }) => {
        const autoplay = payload && payload.autoplay === true;
        handlePlaylistSelected(payload, autoplay);
    });

    broker.subscribe('player.toggle', () => {
        togglePlay();
    });

    broker.subscribe('player.play', () => {
        playCurrentOrSelected();
    });

    broker.subscribe('player.pause', () => {
        pausePlayback();
    });

    broker.subscribe('player.next', () => {
        nextTrack();
    });

    broker.subscribe('player.prev', () => {
        previousTrack();
    });

    broker.subscribe('player.shuffle.toggle', () => {
        toggleShuffle();
        if (els.shuffle) {
            els.shuffle.classList.toggle('active', isShuffleEnabled());
            els.shuffle.setAttribute('aria-pressed', isShuffleEnabled() ? 'true' : 'false');
        }
    });

    broker.subscribe('player.seek.relative', ({ payload }) => {
        const seconds = Number(payload && payload.seconds);
        if (!Number.isFinite(seconds) || seconds === 0) return;
        seekRelativeBySeconds(seconds);
    });

    broker.subscribe('player.seek.absolute', ({ payload }) => {
        const seconds = Number(payload && payload.seconds);
        if (!Number.isFinite(seconds)) return;
        seekToSeconds(seconds);
    });
}

function init() {
    initNowPlayingUi({
        broker,
        getTracks,
        getCurrentIndex,
        isBusy,
        syncMediaSessionMetadata,
    });

    initMediaSessionSync({
        broker,
        getTracks,
        getCurrentIndex,
        getLastPlaybackState,
        playCurrentOrSelected,
        pausePlayback,
        selectNextTrack,
        selectPreviousTrack,
        seekRelativeBySeconds,
        seekToSeconds,
    });

    initTransport({ broker });

    bindPlayPauseUi();
    bindVolumeUi();
    bindSeekUi({ syncMediaSessionPositionState });
    bindShuffleUi();
    bindMediaSessionHandlers();

    bindBrokerHandlers();

    navClient.bindLinks(document.body);

    broker.start();
    broker.publish('player.ready', {
        message: 'Player frame initialized',
    }, { target: 'shell' });

    updatePlayButton();
    resetSeekUi();
    setStatus('Waiting for playlist...');
    syncMediaSessionMetadata(null);
    syncMediaSessionPlaybackState();
    publishMediaSessionSync();

    startSeekPolling();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
