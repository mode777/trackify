/*
 * Trackify admin upload engine.
 *
 * Mirrors tools/upload-index.mjs semantics:
 * - deterministic ids (staging already derives them from paths)
 * - game matching by id, fallback `platform::title` key
 * - track matching by id, fallback lowercased filename
 * - file matching by basename inside the game's files[] bundle
 * - existing records are never modified (create-or-skip)
 * - one serial queue, per-item state, dependency order per game
 */
'use strict';

import { gameCompanyArray, coverFileFor } from './stage.js';

export const ITEM_STATE = {
    PENDING: 'pending',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    SKIPPED: 'skipped',
    FAILED: 'failed',
};

function cliGameKey(game) {
    return `${String(game.platform || '').toLowerCase()}::${String(game.title || '').toLowerCase()}`;
}

function errorMessage(error) {
    if (!error || typeof error !== 'object') return String(error);
    if (error.response && error.response.data) {
        try {
            return `${error.status || ''} ${JSON.stringify(error.response.data)}`;
        } catch {
            // fall through
        }
    }
    return String(error.message || error);
}

function isUniqueViolation(error) {
    return Boolean(error)
        && typeof error === 'object'
        && error.status === 400
        && error.response
        && error.response.data
        && Object.values(error.response.data).some(
            (fieldError) => fieldError && fieldError.code === 'validation_not_unique'
        );
}

export function createUploader({ pb, staging, onItemsChanged, onAuthRequired, onDone }) {
    let items = [];
    let running = false;
    let paused = false;

    function notify() {
        if (onItemsChanged) onItemsChanged();
    }

    function findGameItem(gameKey) {
        return items.find((item) => item.kind === 'game' && item.gameKey === gameKey);
    }

    function resolvedGameId(gameKey) {
        const gameItem = findGameItem(gameKey);
        return gameItem ? gameItem.resolvedGameId : null;
    }

    async function fetchExisting() {
        const existingGames = await pb.collection('games').getFullList({
            fields: 'id,title,platform,coverArt,files',
        });
        const existingTracks = await pb.collection('tracks').getFullList({
            fields: 'id,title,filename,gameId',
        });
        return { existingGames, existingTracks };
    }

    function buildSkipSets(existingGames, existingTracks) {
        const gameById = new Map();
        const gameKeyToGame = new Map();
        for (const game of existingGames) {
            gameById.set(game.id, game);
            const key = `${String(game.platform || '').toLowerCase()}::${String(game.title || '').toLowerCase()}`;
            if (!gameKeyToGame.has(key)) gameKeyToGame.set(key, game);
        }
        const filesByGame = new Map();
        for (const game of existingGames) {
            const names = (Array.isArray(game.files) ? game.files : [])
                .filter((name) => typeof name === 'string' && name.length > 0);
            filesByGame.set(game.id, new Set(names));
        }
        const trackById = new Set();
        const trackByFilename = new Set();
        for (const track of existingTracks) {
            if (track.id) trackById.add(track.id);
            if (track.filename) trackByFilename.add(track.filename.toLowerCase());
        }
        return { gameById, gameKeyToGame, filesByGame, trackById, trackByFilename };
    }

    function plan() {
        items = [];
        let counter = 0;
        const nextItem = (props) => {
            counter += 1;
            items.push({
                key: `item-${counter}`,
                state: ITEM_STATE.PENDING,
                note: '',
                error: '',
                ...props,
            });
        };
        for (const game of staging.games) {
            nextItem({
                kind: 'game',
                gameKey: game.key,
                label: game.title || game.id,
                game,
                resolvedGameId: null,
            });
            if (coverFileFor(game)) {
                nextItem({
                    kind: 'cover',
                    gameKey: game.key,
                    label: 'cover art',
                    game,
                });
            }
            const bundled = new Set();
            const addFileItem = (file, name) => {
                if (!file || bundled.has(name)) return;
                bundled.add(name);
                nextItem({
                    kind: 'file',
                    gameKey: game.key,
                    label: name,
                    file,
                    game,
                });
            };
            for (const sidecar of game.sidecars) {
                addFileItem(sidecar.file, sidecar.name);
            }
            for (const track of game.tracks) {
                addFileItem(track.file, track.filename);
            }
            for (const track of game.tracks) {
                nextItem({
                    kind: 'track',
                    gameKey: game.key,
                    label: track.title || track.filename,
                    track,
                    game,
                });
            }
        }
        notify();
    }

    async function execItem(item, skipSets) {
        const { gameById, gameKeyToGame, filesByGame, trackById, trackByFilename } = skipSets;
        const game = item.game;

        if (item.kind === 'game') {
            const existing = gameById.get(game.id) || gameKeyToGame.get(cliGameKey(game));
            if (existing) {
                item.resolvedGameId = existing.id;
                item.state = ITEM_STATE.SKIPPED;
                item.note = 'game exists';
                return;
            }
            await pb.collection('games').create({
                id: game.id,
                title: game.title,
                platform: game.platform,
                year: game.year || '',
                company: gameCompanyArray(game),
            });
            item.resolvedGameId = game.id;
            item.state = ITEM_STATE.COMPLETED;
            return;
        }

        if (item.kind === 'cover') {
            const gameId = resolvedGameId(item.gameKey);
            if (!gameId) {
                item.state = ITEM_STATE.FAILED;
                item.error = 'game unavailable';
                return;
            }
            if (gameById.has(gameId)) {
                item.state = ITEM_STATE.SKIPPED;
                item.note = 'game exists';
                return;
            }
            await pb.collection('games').update(gameId, { coverArt: coverFileFor(game) });
            item.state = ITEM_STATE.COMPLETED;
            return;
        }

        if (item.kind === 'file') {
            const gameId = resolvedGameId(item.gameKey);
            if (!gameId) {
                item.state = ITEM_STATE.FAILED;
                item.error = 'game unavailable';
                return;
            }
            const existingNames = filesByGame.get(gameId);
            if (existingNames && existingNames.has(item.label)) {
                item.state = ITEM_STATE.SKIPPED;
                item.note = 'file exists';
                return;
            }
            await pb.collection('games').update(gameId, { 'files+': item.file });
            item.state = ITEM_STATE.COMPLETED;
            return;
        }

        // kind === 'track'
        const track = item.track;
        if (trackById.has(track.id) || trackByFilename.has(track.filename.toLowerCase())) {
            item.state = ITEM_STATE.SKIPPED;
            item.note = 'track exists';
            return;
        }
        const gameId = resolvedGameId(item.gameKey);
        if (!gameId) {
            item.state = ITEM_STATE.FAILED;
            item.error = 'game unavailable';
            return;
        }
        const body = {
            id: track.id,
            title: track.title,
            filename: track.filename,
            length: Number.isFinite(track.length) ? Math.trunc(track.length) : -1,
            gameId,
        };
        const artists = track.artistText
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
        if (artists.length > 0) {
            body.artist = artists;
        }
        if (track.metadata && Object.keys(track.metadata).length > 0) {
            body.metadata = track.metadata;
        }
        await pb.collection('tracks').create(body);
        item.state = ITEM_STATE.COMPLETED;
    }

    async function run() {
        running = true;
        paused = false;
        notify();

        let skipSets = null;
        try {
            const { existingGames, existingTracks } = await fetchExisting();
            skipSets = buildSkipSets(existingGames, existingTracks);
        } catch (error) {
            running = false;
            if (onAuthRequired && isAuthError(error)) {
                onAuthRequired();
            } else {
                onDone(new Error(`Could not load existing catalog: ${errorMessage(error)}`));
            }
            notify();
            return;
        }

        for (const item of items) {
            if (paused) break;
            if (item.state === ITEM_STATE.COMPLETED || item.state === ITEM_STATE.SKIPPED) {
                continue;
            }
            item.state = ITEM_STATE.ACTIVE;
            item.note = '';
            item.error = '';
            notify();
            try {
                await execItem(item, skipSets);
            } catch (error) {
                if (isAuthError(error)) {
                    item.state = ITEM_STATE.PENDING;
                    paused = true;
                    notify();
                    if (onAuthRequired) onAuthRequired();
                    break;
                }
                if (item.kind === 'game' && isUniqueViolation(error)) {
                    item.state = ITEM_STATE.SKIPPED;
                    item.note = 'already exists';
                } else if (item.kind === 'track' && isUniqueViolation(error)) {
                    item.state = ITEM_STATE.SKIPPED;
                    item.note = 'already exists';
                } else {
                    item.state = ITEM_STATE.FAILED;
                    item.error = errorMessage(error);
                }
            }
            notify();
        }

        running = false;
        notify();
        if (onDone) onDone();
    }

    function start() {
        if (running) return;
        plan();
        run();
    }

    function retryFailed() {
        if (running) return;
        let hasFailed = false;
        for (const item of items) {
            if (item.state === ITEM_STATE.FAILED) {
                item.state = ITEM_STATE.PENDING;
                item.error = '';
                hasFailed = true;
            }
        }
        if (hasFailed) {
            run();
        }
    }

    function resume() {
        if (running) return;
        run();
    }

    function summary() {
        const counts = { pending: 0, active: 0, completed: 0, skipped: 0, failed: 0 };
        for (const item of items) {
            counts[item.state] = (counts[item.state] || 0) + 1;
        }
        return counts;
    }

    return {
        get items() {
            return items;
        },
        get running() {
            return running;
        },
        get paused() {
            return paused;
        },
        start,
        retryFailed,
        resume,
        summary,
    };
}

function isAuthError(error) {
    return Boolean(error) && typeof error === 'object' && error.status === 401;
}
