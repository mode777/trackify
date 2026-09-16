/*
 * Trackify admin staging model.
 *
 * Groups selected files into games using the same path-derived rules as the
 * CLI tooling (tools/generate-sample-index.mjs + tools/upload-index.mjs):
 *   <platform>/<game>/<files>
 *
 * - playable files (known audio extension) produce track rows
 * - non-playable, non-image files (sidecar libraries, resource files) are
 *   attached to the game's file bundle without producing track rows
 * - images are cover-art candidates only (never tracks, never bundled)
 * - files outside the convention are surfaced as ungrouped, never dropped
 *
 * Cover state per game:
 *   null                       no cover (auto candidate not yet applied)
 *   {kind:'candidate', path}   auto-discovered (first image in game dir)
 *   {kind:'manual', file,...}  user-chosen replacement
 *   {kind:'cleared'}           user removed it; never auto-re-proposed
 */
'use strict';

import {
    COVER_ART_EXTENSIONS,
    buildGameId,
    buildTrackId,
    getExtension,
    getPlatform,
    normalizeIdentifier,
    normalizeRequestName,
} from '../../shared/catalog-identifiers.mjs';
import { basename, dirname, normalizeFolderGameName, stripExtension } from './lib/shims.js';

// Canonical values of the `games.platform` select (docs/database.md §4).
export const PLATFORM_OPTIONS = ['psx', 'snes', 'megadrive', 'n64', 'assorted', 'ps2'];

let keyCounter = 0;
function nextKey(prefix) {
    keyCounter += 1;
    return `${prefix}-${keyCounter}`;
}

function isImage(relPath) {
    return COVER_ART_EXTENSIONS.has(getExtension(relPath));
}

// webkitRelativePath starts with the selected folder's own name; the CLI
// convention is relative to the selection root.
function relativePathFor(file) {
    if (file.webkitRelativePath) {
        const segments = normalizeRequestName(file.webkitRelativePath).split('/').filter(Boolean);
        segments.shift();
        return segments.join('/') || file.name;
    }
    return file.name;
}

function createTrack(relPath, file) {
    return {
        key: nextKey('track'),
        id: buildTrackId(relPath),
        title: stripExtension(relPath),
        artistText: '',
        length: -1,
        filename: basename(relPath),
        relPath,
        file,
        metadata: {},
        probe: { state: 'pending', error: '' },
    };
}

function createGame(platformId, gameSlug) {
    const gameDir = `${platformId}/${gameSlug}`;
    const folderTitle = normalizeFolderGameName(gameDir);
    return {
        key: nextKey('game'),
        id: buildGameId(platformId, gameSlug),
        title: folderTitle,
        platform: platformId,
        year: '',
        companyText: '',
        folderDefaultTitle: folderTitle,
        cover: null,
        _gameDir: gameDir,
        _coverCandidatePaths: [],
        _coverFiles: new Map(),
        sidecars: [],
        tracks: [],
        warnings: [],
    };
}

export function gameCompanyArray(game) {
    return game.companyText
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

// Resolves the File for a game's cover (manual file or staged candidate).
export function coverFileFor(game) {
    if (!game.cover) return null;
    if (game.cover.kind === 'manual') return game.cover.file;
    if (game.cover.kind === 'candidate') return game._coverFiles.get(game.cover.path) || null;
    return null;
}

export function coverDisplayName(game) {
    if (!game.cover) return '';
    if (game.cover.kind === 'manual') return game.cover.name;
    if (game.cover.kind === 'candidate') return basename(game.cover.path);
    return '';
}

export function createStaging() {
    const games = [];
    const ungrouped = [];
    let version = 0;

    function bump() {
        version += 1;
    }

    function findGame(platformId, gameSlug) {
        const gameDir = `${platformId}/${gameSlug}`;
        return games.find((game) => game._gameDir === gameDir) || null;
    }

    function stageIntoGame(game, relPath, file) {
        if (isImage(relPath)) {
            // Images are cover candidates only. CLI parity: only images that
            // sit directly in the game's own directory are considered.
            if (dirname(relPath) === game._gameDir) {
                game._coverCandidatePaths.push(relPath);
                game._coverFiles.set(relPath, file);
                if (!game.cover) {
                    const first = game._coverCandidatePaths
                        .slice()
                        .sort((a, b) => a.localeCompare(b))[0];
                    game.cover = { kind: 'candidate', path: first };
                }
            }
            return;
        }
        if (getPlatform(relPath)) {
            game.tracks.push(createTrack(relPath, file));
            return;
        }
        const base = basename(relPath);
        if (game.sidecars.some((sidecar) => sidecar.name === base)) {
            game.warnings.push(`Duplicate file name skipped: ${base}`);
            return;
        }
        game.sidecars.push({ file, relPath, name: base });
    }

    function addFiles(fileList) {
        for (const file of fileList) {
            const relPath = normalizeRequestName(relativePathFor(file));
            if (!relPath) {
                continue;
            }
            const segments = relPath.split('/').filter(Boolean);
            const platformId = normalizeIdentifier(segments[0] || '');
            const gameSlug = normalizeIdentifier(segments[1] || '');

            if (platformId && gameSlug) {
                let game = findGame(platformId, gameSlug);
                if (!game) {
                    game = createGame(platformId, gameSlug);
                    games.push(game);
                }
                stageIntoGame(game, relPath, file);
            } else {
                ungrouped.push({ key: nextKey('ungrouped'), file, relPath });
            }
        }
        bump();
    }

    // Assign an ungrouped file to a (possibly new) platform/game pair. The
    // file then behaves exactly as if it had been selected under that path.
    function assignUngrouped(itemKey, platformId, gameSlug) {
        const index = ungrouped.findIndex((entry) => entry.key === itemKey);
        if (index === -1) {
            return false;
        }
        const normalizedPlatform = normalizeIdentifier(platformId);
        const normalizedSlug = normalizeIdentifier(gameSlug);
        if (!normalizedPlatform || !normalizedSlug) {
            return false;
        }
        const entry = ungrouped.splice(index, 1)[0];

        let game = findGame(normalizedPlatform, normalizedSlug);
        if (!game) {
            game = createGame(normalizedPlatform, normalizedSlug);
            games.push(game);
        }
        const targetRelPath = `${normalizedPlatform}/${normalizedSlug}/${basename(entry.relPath)}`;
        stageIntoGame(game, targetRelPath, entry.file);
        bump();
        return true;
    }

    function setManualCover(gameKey, file) {
        const game = games.find((entry) => entry.key === gameKey);
        if (!game) {
            return;
        }
        if (game.cover && game.cover.kind === 'manual' && game.cover.url) {
            URL.revokeObjectURL(game.cover.url);
        }
        game.cover = {
            kind: 'manual',
            file,
            name: file.name,
            url: URL.createObjectURL(file),
        };
        bump();
    }

    function clearCover(gameKey) {
        const game = games.find((entry) => entry.key === gameKey);
        if (!game) {
            return;
        }
        if (game.cover && game.cover.kind === 'manual' && game.cover.url) {
            URL.revokeObjectURL(game.cover.url);
        }
        game.cover = { kind: 'cleared' };
        bump();
    }

    function clear() {
        for (const game of games) {
            if (game.cover && game.cover.kind === 'manual' && game.cover.url) {
                URL.revokeObjectURL(game.cover.url);
            }
        }
        games.length = 0;
        ungrouped.length = 0;
        bump();
    }

    // True when every game/track has the required fields for an upload.
    function validate() {
        const problems = [];
        const seenIds = new Set();
        for (const game of games) {
            if (!game.id || !game.title || !game.platform) {
                problems.push(`Game incomplete: ${game.title || game.id || game.key}`);
            }
            if (game.id && seenIds.has(game.id)) {
                problems.push(`Duplicate game id: ${game.id}`);
            }
            if (game.id) seenIds.add(game.id);
            for (const track of game.tracks) {
                if (!track.id || !track.title || !track.filename) {
                    problems.push(`Track incomplete in ${game.title || game.id}: ${track.filename || track.key}`);
                }
                if (track.id && seenIds.has(track.id)) {
                    problems.push(`Duplicate track id: ${track.id}`);
                }
                if (track.id) seenIds.add(track.id);
            }
        }
        return { ok: problems.length === 0, problems };
    }

    return {
        games,
        ungrouped,
        get version() {
            return version;
        },
        addFiles,
        assignUngrouped,
        setManualCover,
        clearCover,
        clear,
        validate,
    };
}
