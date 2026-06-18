/*
 * Trackify player host.
 *
 * Thin wrapper around the globalThis.ScriptNodePlayer singleton and the
 * per-core backend_* IIFE namespaces. All other player modules depend on
 * this instead of touching globalThis directly (DIP).
 */
'use strict';

const runtime = globalThis;

export { runtime };

export function getPlayer() {
    return runtime.ScriptNodePlayer.getInstance();
}

export function initialize(adapter, onTrackEnd, args, flag) {
    return runtime.ScriptNodePlayer.initialize(adapter, onTrackEnd, args, flag);
}

export function loadMusicFromURL(url, options) {
    return runtime.ScriptNodePlayer.loadMusicFromURL(url, options);
}

// Modern Emscripten dropped Module.Pointer_stringify, but some legacy adapters
// still call it. Install a lazy shim that resolves UTF8ToString at call time.
export function installPointerStringifyShim(moduleNamespace) {
    if (moduleNamespace && moduleNamespace.Module && !moduleNamespace.Module.Pointer_stringify) {
        const moduleRef = moduleNamespace.Module;
        moduleRef.Pointer_stringify = function (ptr) { return moduleRef.UTF8ToString(ptr); };
    }
}
