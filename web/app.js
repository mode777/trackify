/*
 * Trackify shell app.
 *
 * Responsibilities in this phase:
 * - Load playlist metadata in the shell.
 * - Publish shell events to embedded iframe services.
 */
'use strict';

import PocketBase from 'pocketbase';
import { createShellBroker } from './broker.js';
import { ShellCatalogService } from './catalog_service.js';

const shellBroker = createShellBroker({
    serviceId: 'shell',
    allowedServices: ['player', 'playlist', 'games'],
    allowedOrigins: [window.location.origin],
});

const catalogService = new ShellCatalogService();
const pb = new PocketBase();

const shellMediaSessionState = {
    handlersBound: false,
    metadataKey: '',
    playbackState: 'none',
    positionStateKey: '',
};

const authUiState = {
    inFlight: false,
    menuOpen: false,
    wasValid: false,
};

function createIframeHistoryTracker(contentFrame) {
    const state = {
        entries: [],
        index: -1,
    };

    function currentUrl() {
        if (!contentFrame || !contentFrame.contentWindow) return '';
        try {
            return contentFrame.contentWindow.location.href;
        } catch (_error) {
            return '';
        }
    }

    function recordCurrentEntry() {
        const url = currentUrl();
        if (!url) return;

        if (state.index < 0) {
            state.entries = [url];
            state.index = 0;
            return;
        }

        if (state.entries[state.index] === url) {
            return;
        }

        if (state.index > 0 && state.entries[state.index - 1] === url) {
            state.index -= 1;
            return;
        }

        if (state.index < state.entries.length - 1 && state.entries[state.index + 1] === url) {
            state.index += 1;
            return;
        }

        state.entries = state.entries.slice(0, state.index + 1);
        state.entries.push(url);
        state.index += 1;
    }

    function canGoBack() {
        return state.index > 0;
    }

    function canGoForward() {
        return state.index >= 0 && state.index < state.entries.length - 1;
    }

    return {
        recordCurrentEntry,
        canGoBack,
        canGoForward,
    };
}

function bindHistoryButtons() {
    const backButton = document.querySelector('[data-history-action="back"]');
    const forwardButton = document.querySelector('[data-history-action="forward"]');
    const contentFrame = document.getElementById('playlistFrame');
    if (!backButton || !forwardButton) return;

    const iframeTracker = createIframeHistoryTracker(contentFrame);

    const updateHistoryButtons = () => {
        iframeTracker.recordCurrentEntry();
        backButton.disabled = !iframeTracker.canGoBack();
        forwardButton.disabled = !iframeTracker.canGoForward();
    };

    const goBack = () => {
        if (contentFrame && contentFrame.contentWindow) {
            try {
                contentFrame.contentWindow.history.back();
                return;
            } catch (_error) {
                // Fall back to top-level history if iframe history is inaccessible.
            }
        }
        window.history.back();
    };

    const goForward = () => {
        if (contentFrame && contentFrame.contentWindow) {
            try {
                contentFrame.contentWindow.history.forward();
                return;
            } catch (_error) {
                // Fall back to top-level history if iframe history is inaccessible.
            }
        }
        window.history.forward();
    };

    backButton.addEventListener('click', goBack);
    forwardButton.addEventListener('click', goForward);

    if (contentFrame) {
        contentFrame.addEventListener('load', updateHistoryButtons);
    }

    window.addEventListener('popstate', updateHistoryButtons);
    window.addEventListener('pageshow', updateHistoryButtons);
    window.addEventListener('hashchange', updateHistoryButtons);

    updateHistoryButtons();
}

function makeAuthUserPayload() {
    const isAuthenticated = pb.authStore.isValid;
    const record = isAuthenticated && pb.authStore.record ? pb.authStore.record : null;

    if (!record) {
        return {
            isAuthenticated: false,
            user: null,
        };
    }

    return {
        isAuthenticated: true,
        user: {
            id: typeof record.id === 'string' ? record.id : '',
            email: typeof record.email === 'string' ? record.email : '',
            username: typeof record.username === 'string' ? record.username : '',
            name: typeof record.name === 'string' ? record.name : '',
        },
    };
}

function getAvatarInitial(record) {
    if (!record || typeof record !== 'object') return 'T';

    const candidate = [record.name, record.username, record.email]
        .find((value) => typeof value === 'string' && value.trim().length > 0);

    if (!candidate) return 'T';
    return candidate.trim().charAt(0).toUpperCase();
}

function getUserIdentitySummary(record) {
    if (!record || typeof record !== 'object') return 'Logged in as user';

    const preferredName = [record.name, record.username, record.email]
        .find((value) => typeof value === 'string' && value.trim().length > 0);

    const name = preferredName ? preferredName.trim() : 'user';
    return `Logged in as ${name}`;
}

function closeAuthMenu() {
    const avatarButton = document.querySelector('.avatar-btn');
    const authDropdown = document.querySelector('.auth-dropdown');

    authUiState.menuOpen = false;

    if (avatarButton) {
        avatarButton.setAttribute('aria-expanded', 'false');
    }
    if (authDropdown) {
        authDropdown.hidden = true;
    }
}

function setAuthMenuOpen(isOpen) {
    const avatarButton = document.querySelector('.avatar-btn');
    const authDropdown = document.querySelector('.auth-dropdown');
    if (!avatarButton || !authDropdown || !pb.authStore.isValid) return;

    authUiState.menuOpen = Boolean(isOpen);
    avatarButton.setAttribute('aria-expanded', authUiState.menuOpen ? 'true' : 'false');
    authDropdown.hidden = !authUiState.menuOpen;
}

function publishAuthLifecycleEvent(topic) {
    try {
        shellBroker.publish(topic, makeAuthUserPayload(), { target: '*' });
    } catch (error) {
        console.error('Failed to publish auth lifecycle event', topic, error);
    }
}

function updateAuthRequiredControls(isAuthenticated) {
    const controls = document.querySelectorAll('[data-auth-required]');
    for (const control of controls) {
        control.hidden = !isAuthenticated;
    }
}

function updateAuthUi() {
    const loginButton = document.querySelector('.login-btn');
    const authMenu = document.querySelector('.auth-menu');
    const avatarButton = document.querySelector('.avatar-btn');
    const authUserName = document.querySelector('.auth-user-name');
    if (!loginButton || !authMenu || !avatarButton || !authUserName) return;

    if (pb.authStore.isValid) {
        const record = pb.authStore.record;
        const identity = getUserIdentitySummary(record);

        loginButton.hidden = true;
        loginButton.disabled = false;
        loginButton.textContent = 'Login with Google';
        updateAuthRequiredControls(true);
        authMenu.hidden = false;
        avatarButton.textContent = getAvatarInitial(record);
        authUserName.textContent = identity;
        return;
    }

    closeAuthMenu();
    authMenu.hidden = true;
    avatarButton.textContent = 'T';
    authUserName.textContent = '';
    updateAuthRequiredControls(false);
    loginButton.hidden = false;
    loginButton.disabled = authUiState.inFlight;
    loginButton.textContent = authUiState.inFlight ? 'Signing in...' : 'Login with Google';
}

function bindAuthUi() {
    const loginButton = document.querySelector('.login-btn');
    const authMenu = document.querySelector('.auth-menu');
    const avatarButton = document.querySelector('.avatar-btn');
    const logoutButton = document.querySelector('.auth-logout-btn');
    if (!loginButton || !authMenu || !avatarButton || !logoutButton) return;

    loginButton.addEventListener('click', () => {
        if (authUiState.inFlight) return;

        authUiState.inFlight = true;
        updateAuthUi();

        pb.collection('users').authWithOAuth2({ provider: 'google' })
            .catch((error) => {
                console.error('Google sign-in failed', error);
            })
            .finally(() => {
                authUiState.inFlight = false;
                updateAuthUi();
            });
    });

    avatarButton.addEventListener('click', (event) => {
        event.preventDefault();
        setAuthMenuOpen(!authUiState.menuOpen);
    });

    logoutButton.addEventListener('click', () => {
        closeAuthMenu();
        pb.authStore.clear();
    });

    document.addEventListener('click', (event) => {
        if (!authUiState.menuOpen) return;
        if (authMenu.contains(event.target)) return;
        closeAuthMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeAuthMenu();
        }
    });

    authUiState.wasValid = pb.authStore.isValid;

    pb.authStore.onChange(() => {
        const isValid = pb.authStore.isValid;
        if (!authUiState.wasValid && isValid) {
            publishAuthLifecycleEvent('shell.user.login');
        } else if (authUiState.wasValid && !isValid) {
            publishAuthLifecycleEvent('shell.user.logout');
        }
        authUiState.wasValid = isValid;
        updateAuthUi();
    }, true);
}

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
    shellBroker.handleRequest('shell.queryArtists', async ({ payload }) => {
        return catalogService.queryArtists(payload || {});
    });
    shellBroker.handleRequest('shell.queryPlaylists', async ({ payload }) => {
        return catalogService.queryPlaylists(payload || {});
    });
    shellBroker.handleRequest('shell.createPlaylist', async ({ payload }) => {
        return catalogService.createPlaylist(payload && payload.title);
    });
    shellBroker.handleRequest('shell.queryUser', async () => {
        return makeAuthUserPayload();
    });
    shellBroker.handleRequest('shell.queryFavorites', async () => {
        return catalogService.queryFavorites();
    });

    shellBroker.subscribe('player.mediaSessionSync', ({ payload }) => {
        syncShellMediaSession(payload);
    });

    shellBroker.subscribe('playlist.liked', async ({ payload }) => {
        await catalogService.addFavorite(payload && payload.trackId);
        console.log('playlist.liked', payload && payload.trackId);
    });

    shellBroker.subscribe('playlist.unliked', async ({ payload }) => {
        await catalogService.removeFavorite(payload && payload.trackId);
        console.log('playlist.unliked', payload && payload.trackId);
    });

    shellBroker.subscribe('shell.user.login', async ({ payload }) => {
        const favorites = await catalogService.queryFavorites();
        shellBroker.publish('playlist.selected', {
            source: 'favorites',
            selectedIndex: favorites.length > 0 ? 0 : -1,
            tracks: favorites,
            autoplay: false,
        }, { target: 'player' });
    });

    shellBroker.start();
}

function bindCreatePlaylistButton() {
    const button = document.querySelector('.create-btn');
    if (!button) return;

    button.addEventListener('click', async () => {
        try {
            await catalogService.createPlaylist();
        } catch (error) {
            console.error('Failed to create playlist', error);
        }
    });
}

function init() {
    catalogService.preload();
    bindAuthUi();
    bindHistoryButtons();
    bindCreatePlaylistButton();
    bindShellMediaSessionHandlers();
    bindMediaKeyFallback();
    initBroker();
    if(pb.authStore.isValid) {
        setTimeout(() => {
            publishAuthLifecycleEvent('shell.user.login');
        }, 10);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
