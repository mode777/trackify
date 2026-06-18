/*
 * Trackify player backend loader.
 *
 * Owns lazy-loading of /wasm/backend_*.js scripts and constructing the
 * matching adapter instance. The constructor look-up supports both the
 * modern runtime.* namespace (set by the Emscripten shell wrappers) and
 * the legacy globalThis fallback used by some adapters.
 */
'use strict';

import { BACKEND_SCRIPT_BY_TYPE, BACKEND_LOAD_TIMEOUT_MS } from './backend_catalog.js';
import { runtime, installPointerStringifyShim } from './player_host.js';

const backendLoadPromises = new Map();

function getAdapterCtor(type) {
    if (type === 'mp3') {
        return runtime.Mp3BackendAdapter ||
            (typeof Mp3BackendAdapter !== 'undefined' ? Mp3BackendAdapter : null);
    }
    if (type === 'genh') {
        return runtime.GenhBackendAdapter ||
            (typeof GenhBackendAdapter !== 'undefined' ? GenhBackendAdapter : null);
    }
    if (type === 'xa') {
        return runtime.XaBackendAdapter ||
            (typeof XaBackendAdapter !== 'undefined' ? XaBackendAdapter : null);
    }
    if (type === 'vgm') {
        return runtime.VgmBackendAdapter ||
            (typeof VgmBackendAdapter !== 'undefined' ? VgmBackendAdapter : null);
    }
    if (type === 'n64') {
        return runtime.N64BackendAdapter ||
            (typeof N64BackendAdapter !== 'undefined' ? N64BackendAdapter : null);
    }
    if (type === 'nez') {
        return runtime.NEZBackendAdapter ||
            (typeof NEZBackendAdapter !== 'undefined' ? NEZBackendAdapter : null);
    }
    if (type === 'snes') {
        return runtime.SNESBackendAdapter ||
            (typeof SNESBackendAdapter !== 'undefined' ? SNESBackendAdapter : null);
    }
    if (type === 'psx') {
        return runtime.PSXBackendAdapter ||
            (typeof PSXBackendAdapter !== 'undefined' ? PSXBackendAdapter : null);
    }
    return null;
}

export function isBackendReady(type) {
    const ctor = getAdapterCtor(type);
    if (!ctor) return false;

    const state = runtime['spp_backend_state_' + type.toUpperCase()];
    if (state && state.notReady) return false;
    return true;
}

function waitForBackendReady(type, timeoutMs) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;

        const poll = () => {
            if (isBackendReady(type)) {
                resolve();
                return;
            }
            if (Date.now() > deadline) {
                reject(new Error('Timed out while initializing ' + type.toUpperCase() + ' backend'));
                return;
            }
            setTimeout(poll, 25);
        };

        poll();
    });
}

function injectScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load runtime script: ' + src));
        document.head.appendChild(script);
    });
}

export async function ensureBackendLoaded(type) {
    if (isBackendReady(type)) return;

    if (backendLoadPromises.has(type)) {
        await backendLoadPromises.get(type);
        return;
    }

    const scriptSrc = BACKEND_SCRIPT_BY_TYPE[type];
    if (!scriptSrc) {
        throw new Error('Unknown backend type: ' + type);
    }

    const pending = (async () => {
        const scriptAlreadyPresent = document.querySelector('script[src="' + scriptSrc + '"]');
        if (!scriptAlreadyPresent) {
            await injectScript(scriptSrc);
        }
        await waitForBackendReady(type, BACKEND_LOAD_TIMEOUT_MS);
    })();

    backendLoadPromises.set(type, pending);
    try {
        await pending;
    } catch (err) {
        backendLoadPromises.delete(type);
        throw err;
    }
}

export function makeAdapter(type) {
    const adapterCtor = getAdapterCtor(type);

    if (!adapterCtor) {
        throw new Error(type.toUpperCase() + ' backend adapter is not available');
    }

    if (type === 'vgm') {
        installPointerStringifyShim(runtime.backend_vgmPlay);
        return new adapterCtor('/sample-files/');
    }

    if (type === 'n64') {
        installPointerStringifyShim(runtime.backend_N64);
        return new adapterCtor();
    }

    if (type === 'nez') {
        installPointerStringifyShim(runtime.backend_NEZ);
        return new adapterCtor();
    }

    if (type === 'snes') {
        installPointerStringifyShim(runtime.backend_SNES);
        return new adapterCtor();
    }

    return new adapterCtor();
}
