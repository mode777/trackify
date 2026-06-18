#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import { resolvePaths, DEFAULT_SAMPLE_DIR } from './lib/paths.mjs';
import { createLogger } from './lib/logger.mjs';
import { getPlatform, getExtension } from './lib/platforms.mjs';
import { COVER_ART_EXTENSIONS } from './lib/constants.mjs';
import { createIndexer } from './lib/indexer-context.mjs';
import { extractTrackMetadata, resolveUnknownGameNames } from './lib/track-entries.mjs';
import { buildGamesIndex, buildCoverArtByDirectory } from './lib/games-index.mjs';
import { toPosixPath } from './lib/identifiers.mjs';

const RESERVED_FILES = new Set(['index.json', 'games.json']);

function toPosixRel(baseDir, fullPath) {
	return toPosixPath(path.relative(baseDir, fullPath));
}

async function walkAndClassify(sampleDir) {
	const playable = [];
	const coverArtByDirectory = new Map();
	const files = new Map();

	async function walk(currentDir) {
		const entries = await fs.readdir(currentDir, { withFileTypes: true });
		entries.sort((a, b) => a.name.localeCompare(b.name));

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
			} else if (entry.isFile()) {
				const relPath = toPosixRel(sampleDir, fullPath);
				const lower = relPath.toLowerCase();
				if (RESERVED_FILES.has(lower)) continue;

				if (getPlatform(relPath)) {
					playable.push(relPath);
				}

				if (COVER_ART_EXTENSIONS.has(getExtension(relPath))) {
					const dir = path.posix.dirname(relPath);
					if (!coverArtByDirectory.has(dir)) {
						coverArtByDirectory.set(dir, []);
					}
					coverArtByDirectory.get(dir).push(relPath);
				}

				const data = await fs.readFile(fullPath);
				files.set(lower, { relPath, data });
			}
		}
	}

	await walk(sampleDir);

	for (const list of coverArtByDirectory.values()) {
		list.sort((a, b) => a.localeCompare(b));
	}

	return { playable, coverArtByDirectory, files };
}

async function loadVgmIniIfAvailable({ vgmIniPath, files, logger }) {
	if (files.has('vgmplay.ini')) return;
	try {
		const data = await fs.readFile(vgmIniPath);
		files.set('vgmplay.ini', { relPath: 'VGMPlay.ini', data });
		logger.info('Loaded VGMPlay.ini fallback resource.');
	} catch {
		logger.info('VGMPlay.ini fallback resource not found; continuing without it.');
	}
}

function buildOutputIndexItems(indexItems) {
	return indexItems
		.sort((a, b) => a.file.localeCompare(b.file))
		.map((item) => {
			const { file, ...rest } = item;
			return {
				...rest,
				filename: path.posix.basename(String(file || '')),
			};
		});
}

async function main() {
	const debug = process.env.TRACKIFY_INDEX_DEBUG === '1';
	const paths = resolvePaths({
		argv: process.argv,
		cwd: process.cwd(),
		scriptUrl: import.meta.url,
	});
	const logger = createLogger({ debug });

	logger.info(`Starting sample index generation from ${paths.sampleDir} (arg: ${paths.sampleDirName})`);

	const { playable, coverArtByDirectory, files } = await walkAndClassify(paths.sampleDir);
	logger.info(`Discovered ${files.size} files under ${paths.sampleDirName}.`);

	await loadVgmIniIfAvailable({ vgmIniPath: paths.vgmIniPath, files, logger });

	logger.info(`Found ${playable.length} playable files across ${coverArtByDirectory.size} cover-art directories.`);

	const ctx = createIndexer({
		logger,
		wasmDir: paths.wasmDir,
		sampleVirtualPrefix: paths.sampleVirtualPrefix,
		files,
	});

	const indexItems = [];
	for (let i = 0; i < playable.length; i += 1) {
		const relPath = playable[i];
		logger.info(`Metadata [${i + 1}/${playable.length}] ${relPath}`);
		try {
			const item = await extractTrackMetadata(ctx, relPath);
			if (item) indexItems.push(item);
		} catch (error) {
			logger.warn(`Skipping ${relPath}: ${String(error.message || error)}`);
		}
	}
	logger.info(`Metadata extraction complete. Indexed ${indexItems.length} tracks.`);

	logger.info('Resolving unknown game names...');
	resolveUnknownGameNames(indexItems);

	const outputIndexItems = buildOutputIndexItems(indexItems);
	const gamesItems = buildGamesIndex(indexItems, coverArtByDirectory);
	logger.info(`Built games index with ${gamesItems.length} unique game entries.`);

	logger.info('Writing output files...');
	await fs.writeFile(paths.indexPath, `${JSON.stringify(outputIndexItems, null, 2)}\n`, 'utf8');
	await fs.writeFile(paths.gamesPath, `${JSON.stringify(gamesItems, null, 2)}\n`, 'utf8');

	process.stdout.write(
		`Generated ${indexItems.length} sample entries at ${paths.indexPath} and ${gamesItems.length} game entries at ${paths.gamesPath}\n`
	);
}

main().catch((error) => {
	process.stderr.write(`${String(error.stack || error)}\n`);
	process.exitCode = 1;
});
