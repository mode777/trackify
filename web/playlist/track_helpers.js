/*
 * Trackify playlist pure helpers.
 *
 * Extension parsing, backend-type inference, and the magic strings
 * shared between the playlist frame and the rest of the catalog. No
 * DOM, no broker, no side effects.
 */
'use strict';

export const PLACEHOLDER_GAME = 'Unknown game';
export const FAVORITES_PLAYLIST_TITLE = '__fav__';

export function extOf(file) {
    return file.slice(file.lastIndexOf('.') + 1).toLowerCase();
}

export function typeOf(file) {
    const ext = extOf(file);
    return ext.toString().toUpperCase().replace('MINI', '') || null;
}
