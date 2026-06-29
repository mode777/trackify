/*
 * Trackify playlist favorites service.
 *
 * Owns the Set of favorited track ids. Two write paths:
 *  - queryFavorites() hydrates the Set from the shell.
 *  - applyUserToggle(trackId, wasFavorite) is the user-driven toggle:
 *    mutates the Set AND publishes `playlist.liked` / `playlist.unliked`
 *    so the shell can persist the change to PocketBase.
 *
 * Read-only consumers (track_list_ui, add_to_playlist_popup) call
 * getFavoriteTrackIds(); they never touch the Set directly.
 */
'use strict';

let broker = null;
let favoriteTrackIds = new Set();

export function initFavoritesService({ broker: b } = {}) {
    broker = b;
    favoriteTrackIds = new Set();
}

export function getFavoriteTrackIds() {
    return favoriteTrackIds;
}

export function setFavoriteIds(ids) {
    const next = new Set();
    if (Array.isArray(ids)) {
        for (const id of ids) {
            if (typeof id === 'string' && id) next.add(id);
        }
    }
    favoriteTrackIds = next;
}

export async function queryFavorites() {
    let favorites = [];
    try {
        favorites = await broker.request('shell.queryFavorites', null, {
            target: 'shell',
            timeoutMs: 4000,
        });
    } catch (_error) {
        favorites = [];
    }

    const normalized = Array.isArray(favorites) ? favorites : [];
    setFavoriteIds(normalized.map((track) => track && track.id));
    return normalized;
}

export function applyUserToggle(trackId, wasFavorite) {
    if (typeof trackId !== 'string' || !trackId || !broker) return;

    if (wasFavorite) {
        favoriteTrackIds.delete(trackId);
        broker.publish('playlist.unliked', { trackId }, { target: 'shell' });
    } else {
        favoriteTrackIds.add(trackId);
        broker.publish('playlist.liked', { trackId }, { target: 'shell' });
    }
}

export function applyShellFavoriteChange(trackId, isFavorite) {
    if (typeof trackId !== 'string' || !trackId) return;

    if (isFavorite) {
        favoriteTrackIds.add(trackId);
    } else {
        favoriteTrackIds.delete(trackId);
    }
}
