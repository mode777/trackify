/*
 * Trackify AudioWorklet feature flag.
 *
 * `?wp=0` in the URL flips the entire audio stack to the legacy
 * ScriptProcessor pipeline. `?wp=1` (or no flag) uses the new
 * AudioWorklet pipeline. A `localStorage` key
 * (`trackify.wpPlayerOverride`) takes precedence over the URL value
 * for ops-driven overrides.
 *
 * Exposes `wpUseWorkletPlayer()` on `globalThis` so a synchronous
 * `<script>` in `web/player.html` can pick the right player bundle
 * before it is appended to the document.
 */
'use strict';

(function () {
    const QUERY_KEY = 'wp';
    const STORAGE_KEY = 'trackify.wpPlayerOverride';

    function readQueryOverride(search) {
        if (typeof search !== 'string' || !search.length) return null;
        const cleaned = search.charAt(0) === '?' ? search.substring(1) : search;
        if (!cleaned.length) return null;
        const parts = cleaned.split('&');
        for (let i = 0; i < parts.length; i++) {
            const pair = parts[i].split('=');
            if (pair.length >= 1 && decodeURIComponent(pair[0]) === QUERY_KEY) {
                if (pair.length === 1) return true;
                const raw = decodeURIComponent(pair.slice(1).join('='));
                if (raw === '0' || /^false$/i.test(raw)) return false;
                return true;
            }
        }
        return null;
    }

    function readStorageOverride() {
        try {
            if (typeof localStorage === 'undefined') return null;
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw === null) return null;
            if (raw === '0' || /^false$/i.test(raw)) return false;
            return true;
        } catch (_error) {
            return null;
        }
    }

    function workletSupported() {
        return typeof AudioWorkletNode !== 'undefined' &&
            typeof AudioContext !== 'undefined' &&
            typeof AudioWorkletGlobalScope !== 'undefined';
    }

    function useWorkletPlayer() {
        const storage = readStorageOverride();
        if (storage !== null) {
            if (!storage) return false;
            return workletSupported();
        }
        const search = (typeof window !== 'undefined' && window.location && window.location.search) || '';
        const query = readQueryOverride(search);
        if (query !== null) {
            if (!query) return false;
            return workletSupported();
        }
        return workletSupported();
    }

    if (typeof globalThis !== 'undefined') {
        globalThis.wpUseWorkletPlayer = useWorkletPlayer;
    }
    if (typeof window !== 'undefined') {
        window.wpUseWorkletPlayer = useWorkletPlayer;
    }
})();
