/*
 * Trackify playlist shell client.
 *
 * Thin dependency-inversion wrapper around broker.request('shell.*').
 * Every other playlist module depends on this — never on the broker
 * directly — so the shell-topic surface and request timeouts live in
 * exactly one place.
 *
 * Mirrors web/player/player_host.js (which wraps the ScriptNodePlayer
 * runtime).
 */
'use strict';

const DEFAULT_TIMEOUT_MS = 4000;
const INDEX_TIMEOUT_MS = 15000;
const UPDATE_PLAYLIST_TIMEOUT_MS = 8000;

function shellRequest(broker, topic, payload, timeoutMs) {
    return broker.request(topic, payload, {
        target: 'shell',
        timeoutMs,
    });
}

export function createShellClient({ broker }) {
    if (!broker) {
        throw new Error('createShellClient requires { broker }');
    }

    return {
        queryIndex(filters = {}) {
            return shellRequest(broker, 'shell.queryIndex', filters, INDEX_TIMEOUT_MS);
        },

        queryGames(filters = {}) {
            return shellRequest(broker, 'shell.queryGames', filters, INDEX_TIMEOUT_MS);
        },

        queryPlaylists({ type = 'own' } = {}) {
            return shellRequest(broker, 'shell.queryPlaylists', { type }, DEFAULT_TIMEOUT_MS);
        },

        queryPlaylistsForTrack(trackId) {
            return shellRequest(broker, 'shell.queryPlaylistsForTrack', { trackId }, DEFAULT_TIMEOUT_MS);
        },

        queryPlaylist(id) {
            return shellRequest(broker, 'shell.queryPlaylist', { id }, INDEX_TIMEOUT_MS);
        },

        addTrackToPlaylist(trackId, playlistId) {
            return shellRequest(broker, 'shell.addTrackToPlaylist', { trackId, playlistId }, DEFAULT_TIMEOUT_MS);
        },

        removeTrackFromPlaylist(trackId, playlistId) {
            return shellRequest(broker, 'shell.removeTrackFromPlaylist', { trackId, playlistId }, DEFAULT_TIMEOUT_MS);
        },

        updatePlaylist(id, updates, { timeoutMs = UPDATE_PLAYLIST_TIMEOUT_MS } = {}) {
            return shellRequest(broker, 'shell.updatePlaylist', { id, updates }, timeoutMs);
        },

        queryFavorites() {
            return shellRequest(broker, 'shell.queryFavorites', null, DEFAULT_TIMEOUT_MS);
        },

        queryUser() {
            return shellRequest(broker, 'shell.queryUser', null, DEFAULT_TIMEOUT_MS);
        },
    };
}
