/*
 * Trackify admin metadata probing.
 *
 * Browser port of the CLI probe flow (tools/lib/track-entries.mjs):
 *   stage file into the core's virtual FS -> emu_load_file -> optional
 *   emu_set_subsong -> emu_get_track_info / emu_get_max_position ->
 *   emu_teardown, with a filename-title / length=-1 fallback on any failure.
 *
 * The WASM backends are loaded through the player's backend_loader (same
 * scripts the player uses). Sidecar dependencies (.psflib / .usflib /
 * VGMPlay.ini-style resources) resolve through a ScriptNodePlayer shim,
 * mirroring tools/lib/player-shims.mjs — the real player runtime is never
 * loaded on this page.
 */
'use strict';

import { ensureBackendLoaded } from '../player/backend_loader.js';
import { installPointerStringifyShim, runtime } from '../player/player_host.js';
import { getPlatform, splitArtists } from '../../shared/catalog-identifiers.mjs';
import {
    DEFAULT_INTERLEAVE,
    NEZ_BUFFER_SIZE,
    SAMPLE_RATE,
    extractCompaniesFromCopyright,
    extractYearFromText,
    readTrackInfo,
    stageFileInVirtualFs,
} from './lib/wasm-probe.js';

const VIRTUAL_ROOT = '/staged';

// backend script global -> Emscripten Module namespace (see each core's
// shell-pre.js; the names are set by the concatenated runtime shells).
const BACKEND_MODULE_GLOBALS = {
    psx: 'backend_PSX',
    snes: 'backend_SNES',
    nez: 'backend_NEZ',
    n64: 'backend_N64',
    vgm: 'backend_vgmPlay',
};

async function buildFileMap(game) {
    const files = new Map();
    const add = async (relPath, file) => {
        const data = new Uint8Array(await file.arrayBuffer());
        files.set(relPath.toLowerCase(), { relPath, data });
    };
    for (const sidecar of game.sidecars) {
        await add(sidecar.relPath, sidecar.file);
    }
    for (const track of game.tracks) {
        await add(track.relPath, track.file);
    }
    return files;
}

function resolveDependency(files, currentTrackRel, requestedName) {
    const normalized = String(requestedName || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) return null;

    const withoutStagedPrefix = normalized.startsWith(`${VIRTUAL_ROOT}/`)
        ? normalized.slice(VIRTUAL_ROOT.length + 1)
        : normalized;

    const currentDir = currentTrackRel.includes('/')
        ? currentTrackRel.slice(0, currentTrackRel.lastIndexOf('/'))
        : '';

    const candidates = [normalized, withoutStagedPrefix];
    if (currentDir) {
        const joined = `${currentDir}/${normalized}`.replace(/\/{2,}/g, '/');
        candidates.push(joined);
    }

    for (const candidate of candidates) {
        const match = files.get(candidate.toLowerCase());
        if (match) return match;
    }
    return null;
}

// Mirrors tools/lib/player-shims.mjs: before the first backend script loads,
// provide the surface the cores call back into for dependency files.
function installProbeShims(ctx) {
    if (runtime.ScriptNodePlayer && runtime.ScriptNodePlayer.__trackifyProbeShim) {
        runtime.ScriptNodePlayer.__trackifyProbeShim.ctx = ctx;
        return;
    }

    runtime.ScriptNodePlayer = {
        __trackifyProbeShim: { ctx },
        getInstance() {
            const state = runtime.ScriptNodePlayer.__trackifyProbeShim;
            return {
                isReady() {
                    return true;
                },
                _fileRequestCallback(namePtr) {
                    const module = state.ctx.getModule();
                    if (!module) return 0;
                    const requested = module.UTF8ToString(namePtr);
                    const resolved = resolveDependency(
                        state.ctx.files,
                        state.ctx.currentTrackRel,
                        requested
                    );
                    if (!resolved) return 0;
                    stageFileInVirtualFs(
                        module,
                        VIRTUAL_ROOT,
                        resolved.relPath,
                        resolved.data
                    );
                    return 1;
                },
                _fileDataRequestCallback(namePtr) {
                    const module = state.ctx.getModule();
                    if (!module) return new Uint8Array(0);
                    const requested = module.UTF8ToString(namePtr);
                    const resolved = resolveDependency(
                        state.ctx.files,
                        state.ctx.currentTrackRel,
                        requested
                    );
                    return resolved ? new Uint8Array(resolved.data) : new Uint8Array(0);
                },
            };
        },
        getWebAudioSampleRate() {
            return SAMPLE_RATE;
        },
    };
}

function getModuleFor(runtime, type) {
    const globalName = BACKEND_MODULE_GLOBALS[type];
    if (!globalName) return null;
    const namespace = runtime[globalName];
    return namespace && namespace.Module ? namespace.Module : null;
}

async function probeOneTrack(module, type, track, ctx) {
    const data = ctx.files.get(track.relPath.toLowerCase()).data;
    const virtualPath = stageFileInVirtualFs(module, VIRTUAL_ROOT, track.relPath, data);
    ctx.currentTrackRel = track.relPath;

    const inputPtr = module._malloc(data.length);
    try {
        module.HEAPU8.set(data, inputPtr);
        const ret = module.ccall(
            'emu_load_file',
            'number',
            ['string', 'number', 'number', 'number', 'number', 'number'],
            [
                virtualPath,
                inputPtr,
                data.length,
                SAMPLE_RATE,
                type === 'nez' || type === 'vgm' ? NEZ_BUFFER_SIZE : DEFAULT_INTERLEAVE,
                false,
            ]
        );
        if (ret !== 0) {
            throw new Error(`emu_load_file failed (${ret})`);
        }

        if (type === 'snes') {
            if (module.ccall('emu_set_subsong', 'number', ['number'], [-1]) !== 0) {
                throw new Error('emu_set_subsong failed');
            }
        }
        if (type === 'vgm') {
            if (module.ccall('emu_set_subsong', 'number', ['number'], [0]) !== 0) {
                throw new Error('emu_set_subsong failed');
            }
        }

        return readTrackInfo(module, type, track.title);
    } finally {
        module._free(inputPtr);
    }
}

function applyProbeResult(game, track, info) {
    track.title = info.title || track.title;
    track.artistText = splitArtists(info.artist || '').join(', ');
    track.length = info.length;
    track.metadata = info.metadata || {};
    track.probe = { state: 'ok', error: '' };

    // Game-level prefill (CLI parity: metadata game name overrides the
    // folder-derived default; year/company come from tags/copyright).
    if (info.game && game.title === game.folderDefaultTitle) {
        game.title = info.game;
    }
    const year = extractYearFromText(info.metadata.year) ||
        extractYearFromText(info.metadata.copyright);
    if (year && !game.year) {
        game.year = year;
    }
    const companies = extractCompaniesFromCopyright(info.metadata.copyright);
    if (companies.length && !game.companyText) {
        game.companyText = companies.join(', ');
    }
}

/*
 * Probes every staged game's playable tracks, serially, one game at a time.
 * callbacks:
 *   onTrackState(track, state, error)  — 'active' | 'ok' | 'fail'
 *   onBatchState(text)                 — overall progress line
 * options:
 *   backendLoader(type) — override for ensureBackendLoaded (tests inject a
 *   loader when the backend namespace is already present on the runtime).
 */
export async function probeStagedGames(staging, callbacks, options = {}) {
    const { onTrackState, onBatchState } = callbacks;
    const backendLoader = options.backendLoader || ensureBackendLoaded;
    const games = staging.games.slice();

    for (let gi = 0; gi < games.length; gi += 1) {
        const game = games[gi];
        onBatchState(`Probing game ${gi + 1}/${games.length}: ${game.title || game.id}`);

        const byType = new Map();
        for (const track of game.tracks) {
            const type = getPlatform(track.relPath);
            if (!type || !BACKEND_MODULE_GLOBALS[type]) {
                // No core-based probe (mp3 / xa / genh): the staged fallback
                // (filename title, length -1) is already in effect.
                track.probe = { state: 'ok', error: '' };
                onTrackState(track, 'ok', '');
                continue;
            }
            if (!byType.has(type)) byType.set(type, []);
            byType.get(type).push(track);
        }

        const files = await buildFileMap(game);
        const ctx = { files, currentTrackRel: '', module: null, getModule: () => ctx.module };
        installProbeShims(ctx);

        for (const [type, tracks] of byType) {
            let module = null;
            try {
                await backendLoader(type);
                module = getModuleFor(runtime, type);
                if (!module) {
                    throw new Error(`backend module ${BACKEND_MODULE_GLOBALS[type]} unavailable`);
                }
                installPointerStringifyShim(runtime[BACKEND_MODULE_GLOBALS[type]]);
                ctx.module = module;
            } catch (error) {
                for (const track of tracks) {
                    track.probe = { state: 'fail', error: String(error.message || error) };
                    onTrackState(track, 'fail', String(error.message || error));
                }
                continue;
            }

            if (type === 'vgm') {
                try {
                    module.ccall('emu_set_resource_path', null, ['string'], [`${VIRTUAL_ROOT}/`]);
                } catch {
                    // Older builds may not expose resource-path support.
                }
            }

            for (const track of tracks) {
                track.probe = { state: 'active', error: '' };
                onTrackState(track, 'active', '');
                try {
                    const info = await probeOneTrack(module, type, track, ctx);
                    applyProbeResult(game, track, info);
                    onTrackState(track, 'ok', '');
                } catch (error) {
                    const message = String(error.message || error);
                    track.probe = { state: 'fail', error: message };
                    onTrackState(track, 'fail', message);
                } finally {
                    if (ctx.module) {
                        try {
                            ctx.module.ccall('emu_teardown', 'number');
                        } catch {
                            // Keep probing even if teardown fails.
                        }
                    }
                }
            }
        }
    }

    onBatchState('');
}
