/*
 * Trackify playlist frame app.
 *
 * Pure orchestrator: instantiates the broker, wires the playlist
 * modules together, binds DOM controls and broker subscriptions,
 * then kicks off navigation. Mirrors web/player.js.
 */
'use strict';

import { createFrameBroker } from './broker.js';
import { createNavClient, CONTENT_RERENDER_TOPIC } from './nav_client.js';

import { els } from './playlist/dom.js';
import { setStatus } from './playlist/status_ui.js';
import { createShellClient } from './playlist/shell_client.js';
import {
    initPlaylistState,
    getTracks,
    getCurrentIndex,
    getCurrentPlaylist,
    publishSelected,
    playCurrentSelection,
    applyIndexPayload,
    setCurrentPlaylist,
    setPlayerReady,
    flushPendingSelection,
    handlePlayerTrackChanged,
} from './playlist/playlist_state.js';
import { initAuthState, applyAuthUser, getCurrentUser } from './playlist/auth_state.js';
import {
    initFavoritesService,
    queryFavorites,
    getFavoriteTrackIds,
    applyUserToggle,
} from './playlist/favorites_service.js';
import {
    initHeroUi,
    updateHeroArt,
    applyFavoritesHeroState,
    applyPlaylistHeroState,
    clearFavoritesHeroState,
    setHeroMetadata,
} from './playlist/hero_ui.js';
import {
    initTitleEditUi,
    bindTitleEditUi,
    reevaluate as reevaluateEditState,
} from './playlist/title_edit_ui.js';
import {
    initArtEditUi,
    bindArtEditUi,
    reevaluate as reevaluateArtEditState,
} from './playlist/art_edit_ui.js';
import {
    initPublicToggleUi,
    bindPublicToggleUi,
    reevaluate as reevaluatePublicToggleState,
} from './playlist/public_toggle_ui.js';
import { bindTrackListUi, renderTracks, refreshFavoriteIcons } from './playlist/track_list_ui.js';
import { initAddToPlaylistPopup, openAddToPlaylistPopup } from './playlist/add_to_playlist_popup.js';
import { initNavigation, evaluateFragmentParameters } from './playlist/navigation.js';

const broker = createFrameBroker({
    serviceId: 'playlist',
    targetOrigin: window.location.origin,
    requestTimeoutMs: 4000,
    allowedOrigins: [window.location.origin],
});

const navClient = createNavClient({ broker });

function handleUserToggleFavorite(trackId, wasFavorite) {
    applyUserToggle(trackId, wasFavorite);
    refreshFavoriteIcons();
}

function bindPlayUi() {
    if (els.playButton) {
        els.playButton.addEventListener('click', playCurrentSelection);
    }
    if (els.heroArt) {
        els.heroArt.addEventListener('click', playCurrentSelection);
    }
}

function bindBrokerHandlers() {
    broker.subscribe('player.ready', () => {
        setPlayerReady(true);
        flushPendingSelection();
    });

    broker.subscribe('player.stateChanged', ({ payload }) => {
        if (!payload) return;
        setPlayerReady(true);
        if (typeof payload.status === 'string') {
            setStatus(payload.status);
        }
        if (payload.currentTrack !== undefined) {
            handlePlayerTrackChanged(payload.currentTrack);
        }
    });

    broker.subscribe('shell.user.login', ({ payload }) => {
        applyAuthUser(payload);
    });

    broker.subscribe('shell.user.logout', ({ payload }) => {
        applyAuthUser(payload);
    });

    broker.subscribe(CONTENT_RERENDER_TOPIC, () => {
        evaluateFragmentParameters();
    });
}

async function queryAuthUser(shellClient) {
    try {
        const payload = await shellClient.queryUser();
        applyAuthUser(payload);
    } catch (_error) {
        applyAuthUser(null);
    }
}

function init() {
    const shellClient = createShellClient({ broker });

    initPlaylistState({
        broker,
        onSelectionChanged: renderTracks,
    });

    initAuthState({
        onUserChanged: () => {
            reevaluateEditState();
            reevaluateArtEditState();
            reevaluatePublicToggleState();
        },
    });

    initFavoritesService({ broker });

    initHeroUi({
        setCurrentPlaylist,
        reevaluateEditState: () => {
            reevaluateEditState();
            reevaluateArtEditState();
            reevaluatePublicToggleState();
        },
    });

    initTitleEditUi({
        getCurrentPlaylist,
        getCurrentUser,
        setCurrentPlaylist,
    });

    initArtEditUi({
        getCurrentPlaylist,
        setCurrentPlaylist,
        onPlaylistUpdated: applyPlaylistHeroState,
    });

    initPublicToggleUi({
        getCurrentPlaylist,
        setCurrentPlaylist,
        onPlaylistUpdated: applyPlaylistHeroState,
    });

    initAddToPlaylistPopup({
        shellClient,
        applyUserToggle: handleUserToggleFavorite,
        refreshFavoriteIcons,
    });

    bindTitleEditUi({ shellClient });
    bindArtEditUi({ shellClient });
    bindPublicToggleUi({ shellClient });

    bindTrackListUi({
        getTracks,
        getCurrentIndex,
        getFavoriteTrackIds,
        publishSelected,
        openAddToPlaylistPopup,
        applyUserToggle: handleUserToggleFavorite,
    });

    bindBrokerHandlers();
    bindPlayUi();

    broker.start();
    navClient.bindLinks();

    initNavigation({
        shellClient,
        heroUi: { updateHeroArt, applyFavoritesHeroState, applyPlaylistHeroState, clearFavoritesHeroState, setHeroMetadata },
        playlistState: { applyIndexPayload },
        favoritesService: { queryFavorites },
        setStatus,
    });

    setStatus('Waiting for library...');
    queryAuthUser(shellClient);

    console.info('[trace][iframe:playlist] init', {
        href: window.location.href,
        historyLength: window.history.length,
        historyState: window.history.state,
    });

    window.addEventListener('hashchange', () => {
        console.info('[trace][iframe:playlist] hashchange fired', {
            href: window.location.href,
            historyLength: window.history.length,
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
