#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const sampleFilesDir = path.join(repoRoot, 'sample-files');

const indexPath = path.join(sampleFilesDir, 'index.json');
const gamesPath = path.join(sampleFilesDir, 'games.json');

const pbUrl = process.env.TRACKIFY_PB_URL || 'http://127.0.0.1:8090';
const pbToken = process.env.TRACKIFY_PB_TOKEN || '';
const dryRun = process.env.TRACKIFY_PB_UPLOAD_DRY_RUN === '1';

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizeCompany(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeString(entry))
      .filter((entry) => entry.length > 0);
  }

  if (value == null) {
    return [];
  }

  const single = normalizeString(value);
  return single.length > 0 ? [single] : [];
}

function getGameKey(game) {
  return `${normalizeString(game.platform).toLowerCase()}::${normalizeString(game.title).toLowerCase()}`;
}

function readJsonArray(filePath, label) {
  return fs.readFile(filePath, 'utf8').then((text) => {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array`);
    }
    return parsed;
  });
}

function getCoverFilename(existingRecord) {
  const value = existingRecord?.coverArt;

  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0];
  }

  if (typeof value === 'string') {
    return value;
  }

  return '';
}

async function buildCoverFile(relativePath) {
  if (!relativePath) {
    return null;
  }

  const normalizedRelativePath = normalizeString(relativePath);
  if (!normalizedRelativePath) {
    return null;
  }

  const absolutePath = path.join(sampleFilesDir, normalizedRelativePath);

  try {
    const fileBuffer = await fs.readFile(absolutePath);
    const fileName = path.basename(normalizedRelativePath);
    return new File([fileBuffer], fileName);
  } catch (error) {
    process.stdout.write(
      `WARN: coverArt file missing for ${normalizedRelativePath}: ${String(error.message || error)}\n`
    );
    return null;
  }
}

async function buildTrackFile(relativePath) {
  if (!relativePath) {
    return null;
  }

  const normalizedRelativePath = normalizeString(relativePath);
  if (!normalizedRelativePath) {
    return null;
  }

  const absolutePath = path.join(sampleFilesDir, normalizedRelativePath);

  try {
    const fileBuffer = await fs.readFile(absolutePath);
    const fileName = path.basename(normalizedRelativePath);
    return new File([fileBuffer], fileName, { type: 'audio/spc' });
  } catch (error) {
    process.stdout.write(
      `WARN: track audio file missing for ${normalizedRelativePath}: ${String(error.message || error)}\n`
    );
    return null;
  }
}

function valuesDiffer(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function formatPocketBaseError(error) {
  if (!error || typeof error !== 'object') {
    return String(error);
  }

  const lines = [];

  if (error.name) {
    lines.push(`name=${error.name}`);
  }

  if (error.message) {
    lines.push(`message=${error.message}`);
  }

  if (typeof error.status === 'number') {
    lines.push(`status=${error.status}`);
  }

  if (typeof error.url === 'string' && error.url.length > 0) {
    lines.push(`url=${error.url}`);
  }

  if (error.response != null) {
    try {
      lines.push(`response=${JSON.stringify(error.response)}`);
    } catch {
      lines.push('response=[unserializable]');
    }
  }

  if (error.originalError != null) {
    const originalMessage = String(error.originalError.message || error.originalError);
    lines.push(`originalError=${originalMessage}`);
  }

  return lines.join(' | ');
}

async function syncGames(pb, gameItems, existingGames) {
  const stats = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  const createdGames = new Map();
  const existingById = new Map();
  const existingByKey = new Map();

  for (const game of existingGames) {
    if (typeof game.id === 'string' && game.id.length > 0) {
      existingById.set(game.id, game);
    }

    const key = getGameKey(game);
    if (existingByKey.has(key)) {
      process.stdout.write(
        `WARN: duplicate existing game key ${key}; using the first record and skipping others.\n`
      );
      continue;
    }
    existingByKey.set(key, game);
  }

  for (const game of gameItems) {
    const normalizedGame = {
      sourceId: normalizeString(game.id),
      title: normalizeString(game.title),
      year: normalizeString(game.year),
      platform: normalizeString(game.platform),
      company: normalizeCompany(game.company),
      coverArt: normalizeString(game.coverArt),
    };

    const key = getGameKey(normalizedGame);
    const existing =
      (normalizedGame.sourceId ? existingById.get(normalizedGame.sourceId) : null) ||
      existingByKey.get(key);

    try {
      if (!existing) {
        if (!normalizedGame.sourceId) {
          stats.failed += 1;
          process.stderr.write(
            `ERROR: failed sync for game ${normalizedGame.platform} / ${normalizedGame.title}: missing required source id\n`
          );
          continue;
        }

        const createBody = {
          id: normalizedGame.sourceId,
          title: normalizedGame.title,
          year: normalizedGame.year,
          platform: normalizedGame.platform,
          company: normalizedGame.company,
        };

        const createCoverFile = await buildCoverFile(normalizedGame.coverArt);
        if (createCoverFile) {
          createBody.coverArt = createCoverFile;
        }

        if (dryRun) {
          process.stdout.write(`[dry-run] create game ${normalizedGame.platform} / ${normalizedGame.title}\n`);
          stats.created += 1;
        } else {
          const created = await pb.collection('games').create(createBody);
          createdGames.set(normalizedGame.sourceId, created.id);
          stats.created += 1;
          process.stdout.write(`Created game ${normalizedGame.platform} / ${normalizedGame.title}\n`);
        }

        continue;
      }

      const patchBody = {};

      if (normalizeString(existing.title) !== normalizedGame.title) {
        patchBody.title = normalizedGame.title;
      }

      if (normalizeString(existing.year) !== normalizedGame.year) {
        patchBody.year = normalizedGame.year;
      }

      if (normalizeString(existing.platform) !== normalizedGame.platform) {
        patchBody.platform = normalizedGame.platform;
      }

      const existingCompany = normalizeCompany(existing.company);
      if (valuesDiffer(existingCompany, normalizedGame.company)) {
        patchBody.company = normalizedGame.company;
      }

      const existingCoverFileName = getCoverFilename(existing);
      const expectedCoverFileName = normalizedGame.coverArt
        ? path.basename(normalizedGame.coverArt)
        : '';

      if (expectedCoverFileName && expectedCoverFileName !== existingCoverFileName) {
        const patchCoverFile = await buildCoverFile(normalizedGame.coverArt);
        if (patchCoverFile) {
          patchBody.coverArt = patchCoverFile;
        }
      }

      if (Object.keys(patchBody).length === 0) {
        stats.unchanged += 1;
        continue;
      }

      if (dryRun) {
        process.stdout.write(
          `[dry-run] patch game ${normalizedGame.platform} / ${normalizedGame.title} fields=${Object.keys(patchBody).join(',')}\n`
        );
        stats.updated += 1;
      } else {
        await pb.collection('games').update(existing.id, patchBody);
        stats.updated += 1;
        process.stdout.write(
          `Patched game ${normalizedGame.platform} / ${normalizedGame.title} fields=${Object.keys(patchBody).join(',')}\n`
        );
      }
    } catch (error) {
      stats.failed += 1;
      process.stderr.write(
        `ERROR: failed sync for game ${normalizedGame.platform} / ${normalizedGame.title}: ${formatPocketBaseError(error)}\n`
      );
    }
  }

  return { stats, createdGames };
}

async function syncTracks(pb, indexItems, existingGames, createdGameIds) {
  const stats = { created: 0, updated: 0, unchanged: 0, failed: 0 };

  // build lookup maps for games by their source id
  const gamesBySourceId = new Map();
  for (const game of existingGames) {
    gamesBySourceId.set(game.id, game.id);
  }
  // also add any newly created games
  for (const [sourceId, pbId] of createdGameIds.entries()) {
    gamesBySourceId.set(sourceId, pbId);
  }

  const existingByKey = new Map();
  const existingById = new Map();
  let existingTracks = [];
  try {
    existingTracks = await pb.collection('tracks').getFullList({
      fields: 'id,title,file,length,artist,metadata,gameId',
    });
  } catch (error) {
    process.stdout.write(`Note: could not fetch existing tracks (collection may be empty): ${error.message}\n`);
  }

  for (const track of existingTracks) {
    if (typeof track.id === 'string' && track.id.length > 0) {
      existingById.set(track.id, track);
    }
    const key = `${normalizeString(track.file).toLowerCase()}`;
    if (existingByKey.has(key)) {
      process.stdout.write(`WARN: duplicate existing track key ${key}; using first record.\n`);
      continue;
    }
    existingByKey.set(key, track);
  }

  for (const track of indexItems) {
    const normalizedTrack = {
      sourceId: normalizeString(track.id),
      title: normalizeString(track.title),
      file: normalizeString(track.file),
      length: typeof track.length === 'number' ? track.length : -1,
      artist: Array.isArray(track.artist) ? track.artist.map(normalizeString).filter(a => a.length > 0) : [],
      metadata: track.metadata && typeof track.metadata === 'object' ? track.metadata : {},
      gameIdSource: normalizeString(track.gameId),
    };

    if (!normalizedTrack.title || !normalizedTrack.file) {
      process.stdout.write(
        `SKIP: track missing required fields (title=${normalizedTrack.title}, file=${normalizedTrack.file})\n`
      );
      continue;
    }

    const fileKey = normalizedTrack.file.toLowerCase();
    const existing = (normalizedTrack.sourceId ? existingById.get(normalizedTrack.sourceId) : null) ||
      existingByKey.get(fileKey);

    const pbGameId = gamesBySourceId.get(normalizedTrack.gameIdSource);
    if (!pbGameId) {
      stats.failed += 1;
      process.stderr.write(
        `ERROR: failed sync for track ${normalizedTrack.title}: cannot find game with id ${normalizedTrack.gameIdSource}\n`
      );
      continue;
    }

    try {
      if (!existing) {
        if (!normalizedTrack.sourceId) {
          stats.failed += 1;
          process.stderr.write(
            `ERROR: failed sync for track ${normalizedTrack.title}: missing required source id\n`
          );
          continue;
        }

        const trackFile = await buildTrackFile(normalizedTrack.file);
        if (!trackFile) {
          stats.failed += 1;
          process.stderr.write(
            `ERROR: failed sync for track ${normalizedTrack.title}: could not read audio file ${normalizedTrack.file}\n`
          );
          continue;
        }

        const createBody = {
          id: normalizedTrack.sourceId,
          title: normalizedTrack.title,
          file: trackFile,
          length: normalizedTrack.length,
          gameId: pbGameId,
        };

        if (normalizedTrack.artist.length > 0) {
          createBody.artist = normalizedTrack.artist;
        }

        if (Object.keys(normalizedTrack.metadata).length > 0) {
          createBody.metadata = normalizedTrack.metadata;
        }

        if (dryRun) {
          process.stdout.write(`[dry-run] create track ${normalizedTrack.title} (game ${pbGameId})\n`);
          stats.created += 1;
        } else {
          await pb.collection('tracks').create(createBody);
          stats.created += 1;
          process.stdout.write(`Created track ${normalizedTrack.title}\n`);
        }

        continue;
      }

      const patchBody = {};

      if (normalizeString(existing.title) !== normalizedTrack.title) {
        patchBody.title = normalizedTrack.title;
      }

      if (normalizeString(existing.file) !== normalizedTrack.file) {
        const trackFile = await buildTrackFile(normalizedTrack.file);
        if (trackFile) {
          patchBody.file = trackFile;
        } else {
          stats.failed += 1;
          process.stderr.write(
            `ERROR: failed sync for track ${normalizedTrack.title}: could not read updated audio file ${normalizedTrack.file}\n`
          );
          continue;
        }
      }

      if ((existing.length ?? -1) !== normalizedTrack.length) {
        patchBody.length = normalizedTrack.length;
      }

      const existingArtist = Array.isArray(existing.artist) ? existing.artist : [];
      if (valuesDiffer(existingArtist, normalizedTrack.artist)) {
        patchBody.artist = normalizedTrack.artist.length > 0 ? normalizedTrack.artist : null;
      }

      const existingMetadata = existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
      if (valuesDiffer(existingMetadata, normalizedTrack.metadata)) {
        patchBody.metadata = Object.keys(normalizedTrack.metadata).length > 0 ? normalizedTrack.metadata : null;
      }

      const existingGameId = existing.gameId;
      if (existingGameId !== pbGameId) {
        patchBody.gameId = pbGameId;
      }

      if (Object.keys(patchBody).length === 0) {
        stats.unchanged += 1;
        continue;
      }

      if (dryRun) {
        process.stdout.write(
          `[dry-run] patch track ${normalizedTrack.title} fields=${Object.keys(patchBody).join(',')}\n`
        );
        stats.updated += 1;
      } else {
        await pb.collection('tracks').update(existing.id, patchBody);
        stats.updated += 1;
        process.stdout.write(
          `Patched track ${normalizedTrack.title} fields=${Object.keys(patchBody).join(',')}\n`
        );
      }
    } catch (error) {
      stats.failed += 1;
      process.stderr.write(
        `ERROR: failed sync for track ${normalizedTrack.title}: ${formatPocketBaseError(error)}\n`
      );
    }
  }

  return stats;
}

async function main() {
  const pb = new PocketBase(pbUrl);

  if (pbToken) {
    pb.authStore.save(pbToken, null);
    process.stdout.write('Authenticated with TRACKIFY_PB_TOKEN.\n');
  } else {
    process.stdout.write(
      'No TRACKIFY_PB_TOKEN provided. Continuing without auth token.\n'
    );
  }

  const [indexItems, gameItems, existingGames] = await Promise.all([
    readJsonArray(indexPath, 'sample-files/index.json'),
    readJsonArray(gamesPath, 'sample-files/games.json'),
    pb.collection('games').getFullList({
      fields: 'id,title,year,platform,company,coverArt',
    }),
  ]);

  process.stdout.write(`Loaded ${indexItems.length} index entries.\n`);
  process.stdout.write(`Loaded ${gameItems.length} game entries.\n\n`);

  process.stdout.write('=== Syncing Games ===\n');
  const { stats: gameStats, createdGames } = await syncGames(pb, gameItems, existingGames);
  process.stdout.write(
    `Games done. created=${gameStats.created} updated=${gameStats.updated} unchanged=${gameStats.unchanged} failed=${gameStats.failed}\n\n`
  );

  process.stdout.write('=== Syncing Tracks ===\n');
  const trackStats = await syncTracks(pb, indexItems, existingGames, createdGames);
  process.stdout.write(
    `Tracks done. created=${trackStats.created} updated=${trackStats.updated} unchanged=${trackStats.unchanged} failed=${trackStats.failed}\n\n`
  );

  const totalStats = {
    created: gameStats.created + trackStats.created,
    updated: gameStats.updated + trackStats.updated,
    unchanged: gameStats.unchanged + trackStats.unchanged,
    failed: gameStats.failed + trackStats.failed,
  };
  process.stdout.write(
    `All done. created=${totalStats.created} updated=${totalStats.updated} unchanged=${totalStats.unchanged} failed=${totalStats.failed}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`FATAL: ${formatPocketBaseError(error)}\n`);
  process.exitCode = 1;
});
