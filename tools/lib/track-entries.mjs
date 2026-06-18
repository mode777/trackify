import path from 'node:path';
import { NEZ_BUFFER_SIZE, DEFAULT_INTERLEAVE } from './constants.mjs';
import { getPlatform } from './platforms.mjs';
import {
	buildGameId,
	buildTrackId,
	getPathParts,
	isUnknownGameName,
	normalizeFolderGameName,
	splitArtists,
	stripExtension,
} from './identifiers.mjs';
import { ensureFileInVirtualFs } from './wasm-vfs.mjs';
import { loadBackend } from './backend-loader.mjs';
import { readTrackInfo } from './metadata-readers.mjs';
import { readMp3Metadata } from './mp3-metadata-reader.mjs';

export function buildEntry(fileRelPath, metadata) {
	const pathParts = getPathParts(fileRelPath);
	const fallbackGame = normalizeFolderGameName(pathParts.gameDir || path.posix.dirname(fileRelPath));
	const gameId =
		buildGameId(pathParts.platform, pathParts.gameSlug) ||
		buildGameId(pathParts.platform, fallbackGame);
	const cleanedMetadata = metadata.metadata || {};
	const game = metadata.game || fallbackGame;

	if (!cleanedMetadata.game) {
		cleanedMetadata.game = game;
	}

	return {
		id: buildTrackId(fileRelPath),
		title: metadata.title || stripExtension(fileRelPath),
		file: fileRelPath,
		length: Number.isFinite(metadata.length) ? Math.trunc(metadata.length) : -1,
		gameId,
		artist: splitArtists(metadata.artist || ''),
		metadata: cleanedMetadata,
	};
}

export async function extractTrackMetadata(ctx, fileRelPath) {
	const platform = getPlatform(fileRelPath);
	if (!platform) return null;
	const fallbackTitle = stripExtension(fileRelPath);

	if (platform === 'xa' || platform === 'genh') {
		const detail = platform === 'genh' ? 'GENH Audio' : 'XA ADPCM';
		return buildEntry(fileRelPath, {
			title: fallbackTitle,
			artist: '',
			game: '',
			length: -1,
			metadata: { title: fallbackTitle, artist: '', game: '', detail },
		});
	}

	if (platform === 'mp3') {
		const data = ctx.files.get(fileRelPath.toLowerCase())?.data;
		if (!data) {
			throw new Error(`Missing file data for ${fileRelPath}`);
		}
		const mp3Meta = await readMp3Metadata(data, fallbackTitle);
		return buildEntry(fileRelPath, mp3Meta);
	}

	let module = null;
	let loaded = false;

	try {
		module = await loadBackend({ platform, wasmDir: ctx.wasmDir, ctx });
		const data = ctx.files.get(fileRelPath.toLowerCase())?.data;

		if (!data) {
			throw new Error(`Missing file data for ${fileRelPath}`);
		}

		const virtualPath = ensureFileInVirtualFs(module, ctx.sampleVirtualRoot, fileRelPath, data);
		ctx.setModule(module);
		ctx.currentTrackRel = fileRelPath;

		if (platform === 'vgm') {
			try {
				module.ccall('emu_set_resource_path', null, ['string'], [`${ctx.sampleVirtualRoot}/`]);
			} catch {
				// Older builds may not expose resource-path support.
			}
		}

		const inputPtr = module._malloc(data.length);
		module.HEAPU8.set(data, inputPtr);
		const ret = module.ccall(
			'emu_load_file',
			'number',
			['string', 'number', 'number', 'number', 'number', 'number'],
			[
				virtualPath,
				inputPtr,
				data.length,
				ctx.sampleRate,
				platform === 'nez' || platform === 'vgm' ? NEZ_BUFFER_SIZE : DEFAULT_INTERLEAVE,
				false,
			]
		);
		module._free(inputPtr);

		if (ret !== 0) {
			throw new Error(`emu_load_file failed (${ret}) for ${fileRelPath}`);
		}

		loaded = true;

		if (platform === 'snes') {
			const subsongRet = module.ccall('emu_set_subsong', 'number', ['number'], [-1]);
			if (subsongRet !== 0) {
				throw new Error(`emu_set_subsong failed (${subsongRet}) for ${fileRelPath}`);
			}
		}

		if (platform === 'vgm') {
			const subsongRet = module.ccall('emu_set_subsong', 'number', ['number'], [0]);
			if (subsongRet !== 0) {
				throw new Error(`emu_set_subsong failed (${subsongRet}) for ${fileRelPath}`);
			}
		}

		const metadata = readTrackInfo(module, platform, fallbackTitle);
		return buildEntry(fileRelPath, metadata);
	} catch (error) {
		ctx.logger.warn(
			`Falling back to filename for ${fileRelPath}: ${String(error.message || error)}`
		);
		return buildEntry(fileRelPath, {
			title: fallbackTitle,
			artist: '',
			game: '',
			length: -1,
			metadata: { title: fallbackTitle, artist: '', game: '' },
		});
	} finally {
		if (loaded && module) {
			try {
				module.ccall('emu_teardown', 'number');
			} catch {
				// Keep indexing other files even if backend teardown fails.
			}
		}
	}
}

export function resolveUnknownGameNames(indexItems) {
	const knownNamesByGameId = new Map();
	const pending = [];

	for (const item of indexItems) {
		const gameId = String(item.gameId || '').trim();
		if (!gameId) continue;

		const metadata =
			item && typeof item.metadata === 'object' && item.metadata ? item.metadata : {};
		const game = String(metadata.game || '').trim();

		if (isUnknownGameName(game)) {
			pending.push({ item, gameId, metadata });
			continue;
		}

		if (!knownNamesByGameId.has(gameId)) {
			knownNamesByGameId.set(gameId, new Map());
		}
		const gameNames = knownNamesByGameId.get(gameId);
		gameNames.set(game, (gameNames.get(game) || 0) + 1);
	}

	for (const { item, gameId, metadata } of pending) {
		const pathParts = getPathParts(String(item.file || ''));
		const fallbackGame = normalizeFolderGameName(
			pathParts.gameDir || path.posix.dirname(String(item.file || ''))
		);
		const knownGames = knownNamesByGameId.get(gameId);
		let resolvedGame = '';

		if (knownGames && knownGames.size > 0) {
			const ranked = [...knownGames.entries()].sort((a, b) => {
				if (b[1] !== a[1]) return b[1] - a[1];
				return a[0].localeCompare(b[0]);
			});
			resolvedGame = ranked[0]?.[0] || '';
		}

		if (!resolvedGame) {
			resolvedGame = fallbackGame;
		}

		if (item.metadata && typeof item.metadata === 'object' && item.metadata) {
			item.metadata.game = resolvedGame;
		}
	}
}
