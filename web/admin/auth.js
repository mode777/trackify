/*
 * Trackify admin authentication.
 *
 * The admin page uses its own PocketBase client with a dedicated
 * LocalAuthStore key so a superuser session can never touch (or be touched
 * by) the visitor app's `pb_auth` session — see docs/database.md §14 and
 * the admin-auth spec. The build-time TRACKIFY_PB_TOKEN seeding pattern is
 * deliberately NOT used here: a superuser credential must never be inlined
 * into a public bundle.
 */
'use strict';

import PocketBase, { LocalAuthStore } from 'pocketbase';

export const AUTH_STORE_KEY = 'pb_admin_auth';
const SUPERUSER_COLLECTION = '_superusers';

export function createAdminAuth(options = {}) {
    // Optional dev override (VITE_-prefixed, never TRACKIFY_PB_TOKEN).
    // In a browser, an unset base defaults to the page origin (same-origin
    // deployment: PocketBase serves build/dist — see docs/deploy.md).
    let baseUrl = options.baseUrl;
    if (!baseUrl && typeof import.meta.env === 'object' && import.meta.env) {
        baseUrl = import.meta.env.VITE_TRACKIFY_PB_URL || undefined;
    }
    const pb = new PocketBase(baseUrl, new LocalAuthStore(AUTH_STORE_KEY));

    function isValid() {
        return pb.authStore.isValid;
    }

    function identity() {
        return pb.authStore.record && pb.authStore.record.email
            ? pb.authStore.record.email
            : '';
    }

    async function login(email, password) {
        await pb.collection(SUPERUSER_COLLECTION).authWithPassword(email, password);
    }

    function logout() {
        pb.authStore.clear();
    }

    function onChange(callback) {
        return pb.authStore.onChange(callback);
    }

    function isAuthError(error) {
        return Boolean(error) && typeof error === 'object' && error.status === 401;
    }

    // Returns true when the error was an expired/invalid session and the
    // store has been cleared as a result.
    function handleAuthError(error) {
        if (!isAuthError(error)) {
            return false;
        }
        pb.authStore.clear();
        return true;
    }

    return { pb, isValid, identity, login, logout, onChange, isAuthError, handleAuthError };
}
