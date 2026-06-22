#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import PocketBase from 'pocketbase';

const cwdRootDir = process.cwd();
const DEFAULT_SAMPLE_DIR = 'sample-files';
const sampleDirArg = process.argv[2];
const sampleFilesDirName = sampleDirArg && sampleDirArg.trim() ? sampleDirArg.trim() : DEFAULT_SAMPLE_DIR;
const sampleFilesDir = path.resolve(cwdRootDir, sampleFilesDirName);

const indexPath = path.join(sampleFilesDir, 'index.json');
const gamesPath = path.join(sampleFilesDir, 'games.json');

const pbUrl = process.env.TRACKIFY_PB_URL || 'http://127.0.0.1:8090';
const pbToken = process.env.TRACKIFY_PB_TOKEN || '';
const dryRun = process.env.TRACKIFY_PB_UPLOAD_DRY_RUN === '1';

function normalizeString(value) {
  return String(value ?? '').trim();
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
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

function getFileFieldValues(existingRecord, fieldName) {
  const value = existingRecord?.[fieldName];

  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string' && entry.length > 0);
  }

  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }

  return [];
}

async function buildSampleFile(relativePath, options = {}) {
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
    const fileName = normalizeString(options.fileName) || path.basename(normalizedRelativePath);
    if (options.type) {
      return new File([fileBuffer], fileName, { type: options.type });
    }
    return new File([fileBuffer], fileName);
  } catch (error) {
    process.stdout.write(
      `WARN: sample file missing for ${normalizedRelativePath}: ${String(error.message || error)}\n`
    );
    return null;
  }
}

async function buildCoverFile(relativePath) {
  return buildSampleFile(relativePath);
}

async function collectRelativeFiles(baseDir) {
  const out = [];
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|tiff)$/i;

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (!imageExtensions.test(entry.name)) {
          out.push(toPosixPath(path.relative(baseDir, fullPath)));
        }
      }
    }
  }

  await walk(baseDir);
  return out;
}

async function collectGameDirectoryFiles(gameDirectory, excludedRelativePath) {
  const normalizedDirectory = normalizeString(gameDirectory);
  if (!normalizedDirectory) {
    return [];
  }

  const absoluteDirectory = path.join(sampleFilesDir, normalizedDirectory);
  const normalizedExcludedPath = normalizeString(excludedRelativePath);

  try {
    const relativePathsInDirectory = await collectRelativeFiles(absoluteDirectory);
    return relativePathsInDirectory
      .map((relativePath) => toPosixPath(path.posix.join(normalizedDirectory, relativePath)))
      .filter((relativePath) => relativePath !== normalizedExcludedPath);
  } catch (error) {
    process.stdout.write(
      `WARN: game directory missing for ${normalizedDirectory}: ${String(error.message || error)}\n`
    );
    return [];
  }
}

function valuesDiffer(a, b) {
  return stableStringify(a) !== stableStringify(b);
}

function stableStringify(value) {
  return JSON.stringify(sortObjectKeysDeep(value));
}

function sortObjectKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeysDeep(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sortedEntries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  const out = {};

  for (const [key, entryValue] of sortedEntries) {
    out[key] = sortObjectKeysDeep(entryValue);
  }

  return out;
}

function formatValueForLog(value) {
  if (value == null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function formatChangeDetails(changes) {
  return changes
    .map(({ field, oldValue, newValue }) => {
      return `${field}:${formatValueForLog(oldValue)}->${formatValueForLog(newValue)}`;
    })
    .join(' | ');
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
  const stats = {
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    coverUploaded: 0,
    filesUploaded: 0,
    filesSkipped: 0,
    filesDeleted: 0,
    filesFailed: 0,
  };
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
      directory: normalizeString(game.directory),
      coverArt: normalizeString(game.coverArt),
    };

    const context = `${normalizedGame.platform} / ${normalizedGame.title}`;
    let createdThisGame = false;
    let updatedThisGame = false;
    const fileStatsThisGame = {
      coverUploaded: 0,
      filesUploaded: 0,
      filesSkipped: 0,
      filesDeleted: 0,
      filesFailed: 0,
    };

    try {
      const expectedCoverFileName = normalizedGame.coverArt
        ? path.basename(normalizedGame.coverArt)
        : '';
      const expectedGameFilePaths = await collectGameDirectoryFiles(
        normalizedGame.directory,
        normalizedGame.coverArt
      );
      const expectedFileNameSet = new Set(
        expectedGameFilePaths
          .map((relativePath) => path.basename(relativePath))
          .filter((fileName) => fileName.length > 0)
      );

      const existing =
        (normalizedGame.sourceId ? existingById.get(normalizedGame.sourceId) : null) ||
        existingByKey.get(getGameKey(normalizedGame));

      if (!existing) {
        if (!normalizedGame.sourceId) {
          stats.failed += 1;
          process.stderr.write(
            `ERROR: failed sync for game ${context}: missing required source id\n`
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

        let createdId;
        if (dryRun) {
          createdGames.set(normalizedGame.sourceId, normalizedGame.sourceId);
          process.stdout.write(`[dry-run] create game ${context}\n`);
          stats.created += 1;
          createdThisGame = true;
          createdId = normalizedGame.sourceId;
        } else {
          const created = await pb.collection('games').create(createBody);
          createdId = created.id;
          createdGames.set(normalizedGame.sourceId, createdId);
          stats.created += 1;
          createdThisGame = true;
          process.stdout.write(`Created game ${context}\n`);
        }

        if (expectedCoverFileName) {
          const createCoverFile = await buildCoverFile(normalizedGame.coverArt);
          if (createCoverFile) {
            if (dryRun) {
              process.stdout.write(`[dry-run] upload cover ${expectedCoverFileName} for game ${context}\n`);
              fileStatsThisGame.coverUploaded += 1;
            } else {
              process.stdout.write(`Uploading cover ${expectedCoverFileName} for game ${context}\n`);
              try {
                await pb.collection('games').update(createdId, { coverArt: createCoverFile });
                fileStatsThisGame.coverUploaded += 1;
              } catch (error) {
                fileStatsThisGame.filesFailed += 1;
                process.stderr.write(
                  `ERROR: failed to upload cover ${expectedCoverFileName} for game ${context}: ${formatPocketBaseError(error)}\n`
                );
              }
            }
          }
        }

        for (const relativePath of expectedGameFilePaths) {
          const fileName = path.basename(relativePath);
          const file = await buildSampleFile(relativePath, { fileName });
          if (!file) {
            continue;
          }
          if (dryRun) {
            process.stdout.write(`[dry-run] upload file ${fileName} for game ${context}\n`);
            fileStatsThisGame.filesUploaded += 1;
          } else {
            process.stdout.write(`Uploading file ${fileName} for game ${context}\n`);
            try {
              await pb.collection('games').update(createdId, { 'files+': file });
              fileStatsThisGame.filesUploaded += 1;
            } catch (error) {
              fileStatsThisGame.filesFailed += 1;
              process.stderr.write(
                `ERROR: failed to upload file ${fileName} for game ${context}: ${formatPocketBaseError(error)}\n`
              );
            }
          }
        }
      } else {
        const existingCoverFileName = getCoverFilename(existing);
        const existingFileNames = getFileFieldValues(existing, 'files').filter(
          (fileName) => fileName.length > 0
        );
        const existingFileSet = new Set(existingFileNames);

        const patchBody = {};
        const patchChanges = [];

        const existingTitle = normalizeString(existing.title);
        if (existingTitle !== normalizedGame.title) {
          patchBody.title = normalizedGame.title;
          patchChanges.push({ field: 'title', oldValue: existingTitle, newValue: normalizedGame.title });
        }

        const existingYear = normalizeString(existing.year);
        if (existingYear !== normalizedGame.year && normalizedGame.year.length > 0) {
          patchBody.year = normalizedGame.year;
          patchChanges.push({ field: 'year', oldValue: existingYear, newValue: normalizedGame.year });
        }

        const existingPlatform = normalizeString(existing.platform);
        if (existingPlatform !== normalizedGame.platform) {
          patchBody.platform = normalizedGame.platform;
          patchChanges.push({ field: 'platform', oldValue: existingPlatform, newValue: normalizedGame.platform });
        }

        const existingCompany = normalizeCompany(existing.company);
        if (normalizedGame.company.length > 0 && valuesDiffer(existingCompany, normalizedGame.company)) {
          patchBody.company = normalizedGame.company;
          patchChanges.push({ field: 'company', oldValue: existingCompany, newValue: normalizedGame.company });
        }

        if (expectedCoverFileName && expectedCoverFileName !== existingCoverFileName) {
          const patchCoverFile = await buildCoverFile(normalizedGame.coverArt);
          if (patchCoverFile) {
            patchBody.coverArt = patchCoverFile;
            patchChanges.push({
              field: 'coverArt',
              oldValue: existingCoverFileName,
              newValue: expectedCoverFileName,
            });
          }
        } else if (!expectedCoverFileName && existingCoverFileName) {
          patchBody.coverArt = '';
          patchChanges.push({
            field: 'coverArt',
            oldValue: existingCoverFileName,
            newValue: '',
          });
        }

        if (Object.keys(patchBody).length > 0) {
          const changedFields = Object.keys(patchBody).join(',');
          const changeDetails = formatChangeDetails(patchChanges);

          if (dryRun) {
            process.stdout.write(
              `[dry-run] patch game ${context} fields=${changedFields} changes=${changeDetails}\n`
            );
            updatedThisGame = true;
          } else {
            await pb.collection('games').update(existing.id, patchBody);
            updatedThisGame = true;
            process.stdout.write(
              `Patched game ${context} fields=${changedFields} changes=${changeDetails}\n`
            );
          }
        }

        for (const relativePath of expectedGameFilePaths) {
          const fileName = path.basename(relativePath);
          if (existingFileSet.has(fileName)) {
            fileStatsThisGame.filesSkipped += 1;
            continue;
          }
          const file = await buildSampleFile(relativePath, { fileName });
          if (!file) {
            continue;
          }
          if (dryRun) {
            process.stdout.write(`[dry-run] upload file ${fileName} for game ${context}\n`);
            fileStatsThisGame.filesUploaded += 1;
          } else {
            process.stdout.write(`Uploading file ${fileName} for game ${context}\n`);
            try {
              await pb.collection('games').update(existing.id, { 'files+': file });
              fileStatsThisGame.filesUploaded += 1;
            } catch (error) {
              fileStatsThisGame.filesFailed += 1;
              process.stderr.write(
                `ERROR: failed to upload file ${fileName} for game ${context}: ${formatPocketBaseError(error)}\n`
              );
            }
          }
        }

        for (const existingBaseName of existingFileNames) {
          if (expectedFileNameSet.has(existingBaseName)) {
            continue;
          }
          if (dryRun) {
            process.stdout.write(`[dry-run] delete file ${existingBaseName} from game ${context}\n`);
            fileStatsThisGame.filesDeleted += 1;
          } else {
            process.stdout.write(`Deleting file ${existingBaseName} from game ${context}\n`);
            try {
              await pb.collection('games').update(existing.id, { 'files-': [existingBaseName] });
              fileStatsThisGame.filesDeleted += 1;
            } catch (error) {
              fileStatsThisGame.filesFailed += 1;
              process.stderr.write(
                `ERROR: failed to delete file ${existingBaseName} from game ${context}: ${formatPocketBaseError(error)}\n`
              );
            }
          }
        }
      }

      if (!createdThisGame) {
        if (
          updatedThisGame ||
          fileStatsThisGame.coverUploaded > 0 ||
          fileStatsThisGame.filesUploaded > 0 ||
          fileStatsThisGame.filesDeleted > 0
        ) {
          stats.updated += 1;
        } else {
          stats.unchanged += 1;
        }
      }
      stats.coverUploaded += fileStatsThisGame.coverUploaded;
      stats.filesUploaded += fileStatsThisGame.filesUploaded;
      stats.filesSkipped += fileStatsThisGame.filesSkipped;
      stats.filesDeleted += fileStatsThisGame.filesDeleted;
      stats.filesFailed += fileStatsThisGame.filesFailed;
    } catch (error) {
      stats.failed += 1;
      process.stderr.write(
        `ERROR: failed sync for game ${context}: ${formatPocketBaseError(error)}\n`
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
      fields: 'id,title,filename,length,artist,metadata,gameId',
    });
  } catch (error) {
    process.stdout.write(`Note: could not fetch existing tracks (collection may be empty): ${error.message}\n`);
  }

  for (const track of existingTracks) {
    if (typeof track.id === 'string' && track.id.length > 0) {
      existingById.set(track.id, track);
    }
    const key = `${normalizeString(track.filename).toLowerCase()}`;
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
      filename: normalizeString(track.filename),
      length: typeof track.length === 'number' ? track.length : -1,
      artist: Array.isArray(track.artist) ? track.artist.map(normalizeString).filter(a => a.length > 0) : [],
      metadata: track.metadata && typeof track.metadata === 'object' ? track.metadata : {},
      gameIdSource: normalizeString(track.gameId),
    };

    if (!normalizedTrack.title || !normalizedTrack.filename) {
      process.stdout.write(
        `SKIP: track missing required fields (title=${normalizedTrack.title}, filename=${normalizedTrack.filename})\n`
      );
      continue;
    }

    const fileKey = normalizedTrack.filename.toLowerCase();
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

        const createBody = {
          id: normalizedTrack.sourceId,
          title: normalizedTrack.title,
          filename: normalizedTrack.filename,
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

      if (normalizeString(existing.filename) !== normalizedTrack.filename) {
        patchBody.filename = normalizedTrack.filename;
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

  process.stdout.write(`Using sample directory: ${sampleFilesDir} (arg: ${sampleFilesDirName})\n`);

  if (pbToken) {
    pb.authStore.save(pbToken, null);
    process.stdout.write('Authenticated with TRACKIFY_PB_TOKEN.\n');
  } else {
    process.stdout.write(
      'No TRACKIFY_PB_TOKEN provided. Continuing without auth token.\n'
    );
  }

  const [indexItems, gameItems, existingGames] = await Promise.all([
    readJsonArray(indexPath, `${sampleFilesDirName}/index.json`),
    readJsonArray(gamesPath, `${sampleFilesDirName}/games.json`),
    pb.collection('games').getFullList({
      fields: 'id,title,year,platform,company,coverArt,files',
    }),
  ]);

  process.stdout.write(`Loaded ${indexItems.length} index entries.\n`);
  process.stdout.write(`Loaded ${gameItems.length} game entries.\n\n`);

  process.stdout.write('=== Syncing Games ===\n');
  const { stats: gameStats, createdGames } = await syncGames(pb, gameItems, existingGames);
  process.stdout.write(
    `Games done. created=${gameStats.created} updated=${gameStats.updated} unchanged=${gameStats.unchanged} failed=${gameStats.failed} covers=${gameStats.coverUploaded} filesUploaded=${gameStats.filesUploaded} filesSkipped=${gameStats.filesSkipped} filesDeleted=${gameStats.filesDeleted} filesFailed=${gameStats.filesFailed}\n\n`
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
