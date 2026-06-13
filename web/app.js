/*
 * Trackify shell app.
 *
 * Responsibilities in this phase:
 * - Load playlist metadata in the shell.
 * - Publish shell events to embedded iframe services.
 */
'use strict';

import { createShellBroker } from './broker.js';
import { ShellCatalogService } from './catalog_service.js';

const shellBroker = createShellBroker({
    serviceId: 'shell',
    allowedServices: ['player', 'playlist', 'games'],
    allowedOrigins: [window.location.origin],
});

const catalogService = new ShellCatalogService();

const shellMediaSessionState = {
    handlersBound: false,
    metadataKey: '',
    playbackState: 'none',
    positionStateKey: '',
};

function supportsMediaSession() {
    return typeof navigator !== 'undefined' && !!navigator.mediaSession;
}

function safeSetShellMediaActionHandler(action, handler) {
    if (!supportsMediaSession()) return;

    try {
        navigator.mediaSession.setActionHandler(action, handler);
    } catch (_error) {
        // Unsupported action on this platform/browser.
    }
}

function dispatchPlayerCommand(topic, payload) {
    shellBroker.publish(topic, payload || {}, { target: 'player' });
}

function bindShellMediaSessionHandlers() {
    if (!supportsMediaSession() || shellMediaSessionState.handlersBound) {
        return;
    }

    safeSetShellMediaActionHandler('play', () => dispatchPlayerCommand('player.play'));
    safeSetShellMediaActionHandler('pause', () => dispatchPlayerCommand('player.pause'));
    safeSetShellMediaActionHandler('previoustrack', () => dispatchPlayerCommand('player.prev'));
    safeSetShellMediaActionHandler('nexttrack', () => dispatchPlayerCommand('player.next'));
    safeSetShellMediaActionHandler('seekbackward', (details) => {
        const seekOffset = Number(details && details.seekOffset);
        const seconds = Number.isFinite(seekOffset) && seekOffset > 0 ? seekOffset : 10;
        dispatchPlayerCommand('player.seek.relative', { seconds: -seconds });
    });
    safeSetShellMediaActionHandler('seekforward', (details) => {
        const seekOffset = Number(details && details.seekOffset);
        const seconds = Number.isFinite(seekOffset) && seekOffset > 0 ? seekOffset : 10;
        dispatchPlayerCommand('player.seek.relative', { seconds });
    });
    safeSetShellMediaActionHandler('seekto', (details) => {
        const seekTime = Number(details && details.seekTime);
        if (!Number.isFinite(seekTime)) return;
        dispatchPlayerCommand('player.seek.absolute', { seconds: seekTime });
    });
    safeSetShellMediaActionHandler('stop', () => dispatchPlayerCommand('player.pause'));

    shellMediaSessionState.handlersBound = true;
}

function syncShellMediaSession(payload) {
    if (!payload || typeof payload !== 'object') return;

    const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : null;
    const playbackState = typeof payload.playbackState === 'string' ? payload.playbackState : null;
    const positionState = payload.positionState && typeof payload.positionState === 'object' ? payload.positionState : null;

    if (supportsMediaSession() && metadata) {
        const metadataKey = JSON.stringify(metadata);
        if (metadataKey !== shellMediaSessionState.metadataKey) {
            try {
                navigator.mediaSession.metadata = new MediaMetadata(metadata);
                shellMediaSessionState.metadataKey = metadataKey;
            } catch (_error) {
                // Ignore invalid metadata payloads.
            }
        }
    }

    if (supportsMediaSession() && playbackState && shellMediaSessionState.playbackState !== playbackState) {
        try {
            navigator.mediaSession.playbackState = playbackState;
            shellMediaSessionState.playbackState = playbackState;
        } catch (_error) {
            // Ignore invalid state assignment.
        }
    }

    if (supportsMediaSession() && positionState) {
        const key = JSON.stringify(positionState);
        if (key !== shellMediaSessionState.positionStateKey) {
            try {
                navigator.mediaSession.setPositionState(positionState);
                shellMediaSessionState.positionStateKey = key;
            } catch (_error) {
                // Ignore unsupported position updates.
            }
        }
    }
}

function bindMediaKeyFallback() {
    window.addEventListener('keydown', (event) => {
        if (!event || typeof event.code !== 'string') return;

        if (event.code === 'MediaPlayPause') {
            event.preventDefault();
            dispatchPlayerCommand('player.toggle');
            return;
        }
        if (event.code === 'MediaTrackNext') {
            event.preventDefault();
            dispatchPlayerCommand('player.next');
            return;
        }
        if (event.code === 'MediaTrackPrevious') {
            event.preventDefault();
            dispatchPlayerCommand('player.prev');
        }
    });
}

function initBroker() {
    shellBroker.handleRequest('shell.queryIndex', async ({ payload }) => {
        return catalogService.queryIndex(payload || {});
    });
    shellBroker.handleRequest('shell.queryGames', async ({ payload }) => {
        return catalogService.queryGames(payload || {});
    });

    shellBroker.subscribe('player.mediaSessionSync', ({ payload }) => {
        syncShellMediaSession(payload);
    });

    shellBroker.start();
}

function init() {
    catalogService.preload();
    bindShellMediaSessionHandlers();
    bindMediaKeyFallback();
    initBroker();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
