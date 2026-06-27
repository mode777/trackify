/*
 * Trackify playlist auth state.
 *
 * Owns the currentUser snapshot mirrored from the shell. Notifies an
 * injected callback whenever the user changes so the title edit UI can
 * re-evaluate editability.
 *
 * Does NOT subscribe to the broker directly — the orchestrator
 * subscribes to `shell.user.login` / `shell.user.logout` and calls
 * applyAuthUser(). Mirrors the player rule that only the orchestrator
 * touches the broker.
 */
'use strict';

let currentUser = null;
let onUserChangedFn = () => {};

export function initAuthState({ onUserChanged } = {}) {
    currentUser = null;
    onUserChangedFn = typeof onUserChanged === 'function' ? onUserChanged : () => {};
}

export function getCurrentUser() {
    return currentUser;
}

export function applyAuthUser(payload) {
    if (!payload || typeof payload !== 'object') {
        currentUser = null;
    } else {
        const isAuthenticated = payload.isAuthenticated === true;
        const user = isAuthenticated && payload.user && typeof payload.user === 'object' ? payload.user : null;
        currentUser = {
            isAuthenticated,
            user: user && typeof user.id === 'string' && user.id ? user : null,
        };
    }
    onUserChangedFn();
}
