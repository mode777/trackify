import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scriptRootDir = path.resolve(scriptDir, '..');
const cwdRootDir = process.cwd();
const sampleDir = path.join(cwdRootDir, 'sample-files');
const indexPath = path.join(sampleDir, 'index.json');
const gamesPath = path.join(sampleDir, 'games.json');
const wasmDir = path.join(scriptRootDir, 'build', 'wasm');
const vgmIniPath = path.join(scriptRootDir, 'submodules', 'vgmplay-0.40.9', 'src', 'VGMPlay.ini');

const EXT_PLATFORM = {
	psf: 'psx',
	minipsf: 'psx',
	psf2: 'psx',
	minipsf2: 'psx',
	spc: 'snes',
	bgm: 'nez',
	opx: 'nez',
	nsf: 'nez',
	sng: 'nez',
	kss: 'nez',
	usf: 'n64',
	miniusf: 'n64',
	vgm: 'vgm',
	vgz: 'vgm',
	cmf: 'vgm',
	dro: 'vgm',
	xa: 'xa',
};

const COVER_ART_EXTENSIONS = new Set(['png', 'jpg', 'gif', 'webp']);

const backendCache = new Map();
const sampleFileDataByPath = new Map();

const runtimeState = {
	module: null,
	currentTrackRel: '',
};
const debug = process.env.TRACKIFY_INDEX_DEBUG === '1';

function logInfo(message) {
	process.stdout.write(`[trackify-index] ${message}\n`);
}

function toPosixPath(value) {
	return value.split(path.sep).join('/');
}

function getExtension(fileRelPath) {
	const ext = path.extname(fileRelPath).toLowerCase();
	return ext.startsWith('.') ? ext.slice(1) : ext;
}

function getPlatform(fileRelPath) {
	return EXT_PLATFORM[getExtension(fileRelPath)] || null;
}

function stripExtension(fileRelPath) {
	const base = path.basename(fileRelPath);
	const ext = path.extname(base);
	return ext ? base.slice(0, -ext.length) : base;
}

function buildTrackId(fileRelPath) {
	const normalizedPath = normalizeRequestName(fileRelPath);
	return normalizeIdentifier(normalizedPath.replace(/[\\/]+/g, '.'));
}

function normalizeIdentifier(value) {
	const lowered = String(value || '').toLowerCase();
	const dashed = lowered.replace(/\s+/g, '-');
	const sanitized = dashed.replace(/[^a-z0-9.-]/g, '');

	return sanitized
		.replace(/\.{2,}/g, '.')
		.replace(/-{2,}/g, '-')
		.replace(/^\.+|\.+$/g, '')
		.replace(/^-+|-+$/g, '')
		.replace(/\./g, '@')
		.replace(/@{2,}/g, '@')
		.replace(/^@+|@+$/g, '');
}

function getPathParts(fileRelPath) {
	const normalized = normalizeRequestName(fileRelPath);
	const segments = normalized.split('/').filter(Boolean);
	const platform = normalizeIdentifier(segments[0] || '');
	const gameSlug = normalizeIdentifier(segments[1] || '');
	const gameDir = platform && gameSlug ? `${platform}/${gameSlug}` : '';

	return {
		platform,
		gameSlug,
		gameDir,
	};
}

function buildGameId(platform, gameName) {
	const normalizedPlatform = normalizeIdentifier(platform);
	const normalizedGame = normalizeIdentifier(gameName);
	if (!normalizedPlatform || !normalizedGame) return '';
	return normalizeIdentifier(`${normalizedPlatform}.${normalizedGame}`);
}

function splitArtists(artist) {
	if (typeof artist !== 'string' || !artist.trim()) return [];
	const names = artist
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	return [...new Set(names)];
}

async function collectRelativeFiles(baseDir) {
	const out = [];
	async function walk(currentDir) {
		const entries = await fs.readdir(currentDir, { withFileTypes: true });
		entries.sort((a, b) => a.name.localeCompare(b.name));

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
			} else if (entry.isFile()) {
				out.push(toPosixPath(path.relative(baseDir, fullPath)));
			}
		}
	}

	await walk(baseDir);
	return out;
}

function decodeTextFromHeap(module, ptr, decoderLabel, maxLen = 256) {
	if (!ptr) return '';

	const bytes = [];
	for (let i = 0; i < maxLen; i += 1) {
		const value = module.HEAPU8[ptr + i];
		if (value === 0) break;
		bytes.push(value);
	}

	if (bytes.length === 0) return '';

	try {
		return new TextDecoder(decoderLabel).decode(new Uint8Array(bytes)).replace(/[\uFFFD]/g, '');
	} catch {
		return module.UTF8ToString(ptr);
	}
}

function decodeUtf8(module, ptr) {
	if (!ptr) return '';
	return module.UTF8ToString(ptr);
}

function decodeUtf32(module, ptr, maxLen = 256) {
	if (!ptr) return '';

	const chars = [];
	const base = ptr >> 2;
	for (let i = 0; i < maxLen; i += 1) {
		const codePoint = module.HEAP32[base + i];
		if (!codePoint) break;
		chars.push(String.fromCodePoint(codePoint));
	}

	return chars.join('');
}

function decodePointerString(module, ptr) {
	if (!ptr) return '';
	if (typeof module.Pointer_stringify === 'function') {
		return module.Pointer_stringify(ptr);
	}
	return decodeUtf8(module, ptr);
}

function decodeTrackField(module, ptr, encoding) {
	if (!ptr) return '';
	if (encoding === 'pointer') return decodePointerString(module, ptr);
	if (encoding === 'utf8') return decodeUtf8(module, ptr);
	if (encoding === 'utf32') return decodeUtf32(module, ptr);
	return decodeTextFromHeap(module, ptr, encoding || 'utf-8');
}

function toTrackLength(maxPosition) {
	const numeric = Number(maxPosition);
	if (!Number.isFinite(numeric)) return -1;
	const rounded = Math.trunc(numeric);
	return rounded >= 0 ? rounded : -1;
}

function normalizeRequestName(name) {
	return String(name).replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveSampleDependency(requestedName) {
	const normalized = normalizeRequestName(requestedName);
	if (!normalized) return null;

	const currentDir = path.posix.dirname(runtimeState.currentTrackRel || '');
	const withoutSamplePrefix = normalized.startsWith('sample-files/')
		? normalized.slice('sample-files/'.length)
		: normalized;

	const candidates = [normalized, withoutSamplePrefix];

	if (currentDir && currentDir !== '.') {
		candidates.push(path.posix.normalize(path.posix.join(currentDir, normalized)));
	}

	for (const candidate of candidates) {
		const key = candidate.toLowerCase();
		const match = sampleFileDataByPath.get(key);
		if (match) return match;
	}

	return null;
}

function ensureVirtualDirectory(module, virtualDir) {
	const parts = normalizeRequestName(virtualDir).split('/').filter(Boolean);
	let current = '';

	for (const part of parts) {
		const parent = current ? `/${current}` : '/';
		try {
			module.FS_createPath(parent, part, true, true);
		} catch {
			// Directory already exists.
		}
		current = current ? `${current}/${part}` : part;
	}
}

function ensureFileInVirtualFs(module, sampleRelPath, data) {
	const normalizedRel = normalizeRequestName(sampleRelPath);
	const virtualPath = `/sample-files/${normalizedRel}`;
	const virtualDir = path.posix.dirname(virtualPath);
	const virtualName = path.posix.basename(virtualPath);

	ensureVirtualDirectory(module, virtualDir);

	try {
		module.FS_unlink(virtualPath);
	} catch {
		// File not present yet.
	}

	module.FS_createDataFile(virtualDir, virtualName, data, true, false, true);
	return virtualPath;
}

function installGlobalShims() {
	globalThis.window = globalThis;
	globalThis.window.WASM_SEARCH_PATH = `${toPosixPath(wasmDir)}/`;

	if (typeof globalThis.EmsHEAP16BackendAdapter === 'undefined') {
		globalThis.EmsHEAP16BackendAdapter = class EmsHEAP16BackendAdapter {};
	}

	if (typeof globalThis.SimpleFileMapper === 'undefined') {
		globalThis.SimpleFileMapper = class SimpleFileMapper {
			mapCacheFileName(name) {
				return name;
			}

			mapUrl(filename) {
				return filename;
			}

			registerFileData(pathFilenameArray) {
				return pathFilenameArray;
			}
		};
	}

	globalThis.ScriptNodePlayer = {
		getInstance() {
			return {
				isReady() {
					return true;
				},

				_fileRequestCallback(namePtr) {
					const module = runtimeState.module;
					if (!module) return 0;

					const requested = module.UTF8ToString(namePtr);
					const resolved = resolveSampleDependency(requested);
					if (!resolved) {
						if (debug) {
							process.stderr.write(`Missing dependency request: ${requested} (from ${runtimeState.currentTrackRel})\n`);
						}
						return 0;
					}

					if (debug) {
						process.stderr.write(`Resolved dependency: ${requested} -> ${resolved.relPath}\n`);
					}

					ensureFileInVirtualFs(module, resolved.relPath, resolved.data);
					return 1;
				},

				_fileDataRequestCallback(namePtr) {
					const module = runtimeState.module;
					if (!module) return new Uint8Array(0);

					const requested = module.UTF8ToString(namePtr);
					const resolved = resolveSampleDependency(requested);
					if (debug && !resolved) {
						process.stderr.write(`Missing dependency data: ${requested} (from ${runtimeState.currentTrackRel})\n`);
					}
					return resolved ? new Uint8Array(resolved.data) : new Uint8Array(0);
				},
			};
		},

		getWebAudioSampleRate() {
			return 48000;
		},
	};
}

function waitForBackendReady(module, backendName) {
	if (!module.notReady) return Promise.resolve();

	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error(`Timed out waiting for backend ${backendName} runtime initialization.`));
		}, 30000);

		const previousAdapterCallback = module.adapterCallback;
		module.adapterCallback = () => {
			if (typeof previousAdapterCallback === 'function') {
				try {
					previousAdapterCallback();
				} catch {
					// Ignore callback errors from previous hook.
				}
			}
			clearTimeout(timeoutId);
			resolve();
		};
	});
}

async function loadBackend(platform) {
	const cached = backendCache.get(platform);
	if (cached) return cached;

	const backendFile = path.join(wasmDir, `backend_${platform}.js`);
	try {
		await fs.access(backendFile);
	} catch {
		throw new Error(
			`Missing backend runtime: ${backendFile}. Run \"npm run wasm\" first.`
		);
	}

	installGlobalShims();
	const module = require(backendFile);
	await waitForBackendReady(module, platform);

	if (!module.Pointer_stringify) {
		module.Pointer_stringify = (ptr) => module.UTF8ToString(ptr);
	}

	backendCache.set(platform, module);
	return module;
}

function readTrackInfo(module, platform, fallbackTitle) {
	const ptr = module.ccall('emu_get_track_info', 'number');

	const schemaByPlatform = {
		psx: {
			fields: ['title', 'artist', 'game', 'year', 'genre', 'copyright', 'psfby'],
			decoder: 'shift_jis',
		},
		n64: {
			fields: ['title', 'artist', 'game', 'year', 'genre', 'copyright', 'psfby'],
			decoder: 'utf8',
		},
		snes: {
			fields: ['title', 'artist', 'game', 'comment', 'copyright', 'dumper', 'system', 'tracks'],
			decoder: 'pointer',
		},
		nez: {
			fields: ['title', 'artist', 'copyright', 'track', 'tracks', 'detail'],
			decoder: 'shift_jis',
		},
		vgm: {
			fields: ['title', 'artist', 'game', 'notes', 'system', 'chips', 'tracks'],
			decoders: ['utf32', 'utf32', 'utf32', 'utf32', 'utf32', 'utf8', 'utf8'],
			decoder: 'utf8',
		},
	};

	const schema = schemaByPlatform[platform];
	if (!schema) {
		const title = fallbackTitle;
		return {
			title,
			artist: '',
			game: '',
			length: -1,
			metadata: {
				title,
				artist: '',
				game: '',
			},
		};
	}

	const attrs = module.HEAP32.subarray(ptr >> 2, (ptr >> 2) + schema.fields.length);
	const metadata = {};
	for (let i = 0; i < schema.fields.length; i += 1) {
		const fieldDecoder = Array.isArray(schema.decoders) ? schema.decoders[i] : schema.decoder;
		metadata[schema.fields[i]] = decodeTrackField(module, attrs[i], fieldDecoder);
	}

	const title = metadata.title || fallbackTitle;
	const artist = metadata.artist || '';
	const game = metadata.game || '';
	const length = toTrackLength(module.ccall('emu_get_max_position', 'number'));

	metadata.title = title;
	if (!Object.prototype.hasOwnProperty.call(metadata, 'artist')) metadata.artist = artist;
	if (!Object.prototype.hasOwnProperty.call(metadata, 'game')) metadata.game = game;

	return {
		title,
		artist,
		game,
		length,
		metadata,
	};
}

function buildEntry(fileRelPath, metadata) {
	const clean = (value) => String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
	const cleanObjectStrings = (value) => {
		if (Array.isArray(value)) {
			return value.map((item) => cleanObjectStrings(item));
		}
		if (value && typeof value === 'object') {
			const out = {};
			for (const [key, nested] of Object.entries(value)) {
				out[key] = cleanObjectStrings(nested);
			}
			return out;
		}
		if (typeof value === 'string') {
			return clean(value);
		}
		return value;
	};

	const pathParts = getPathParts(fileRelPath);
	const fallbackGame = normalizeFolderGameName(pathParts.gameDir || path.posix.dirname(fileRelPath));
	const gameId = buildGameId(pathParts.platform, pathParts.gameSlug) || buildGameId(pathParts.platform, fallbackGame);
	const cleanedMetadata = cleanObjectStrings(metadata.metadata || {});
	const game = clean(metadata.game) || fallbackGame;

	if (!clean(cleanedMetadata.game)) {
		cleanedMetadata.game = game;
	}

	return {
		id: buildTrackId(fileRelPath),
		title: clean(metadata.title) || stripExtension(fileRelPath),
		file: fileRelPath,
		length: Number.isFinite(metadata.length) ? Math.trunc(metadata.length) : -1,
		gameId,
		artist: splitArtists(clean(metadata.artist)),
		metadata: cleanedMetadata,
	};
}

function extractYearFromText(value) {
	if (typeof value !== 'string') return '';
	const match = value.match(/\b(\d{4})\b/);
	return match ? match[1] : '';
}

function normalizeCompanyName(value) {
	if (typeof value !== 'string') return '';
	let normalized = value.replace(/\b\d{4}\b/g, ' ');
	normalized = normalized.replace(/\s+/g, ' ').trim();
	return normalized;
}

function extractCompaniesFromCopyright(copyright) {
	if (typeof copyright !== 'string' || !copyright.trim()) return [];
	const parts = copyright.split(',');
	const companies = [];
	for (const part of parts) {
		const company = normalizeCompanyName(part);
		if (company) companies.push(company);
	}
	return [...new Set(companies)];
}

function buildCoverArtByDirectory(relativeFiles) {
	const byDirectory = new Map();

	for (const relPath of relativeFiles) {
		const ext = getExtension(relPath);
		if (!COVER_ART_EXTENSIONS.has(ext)) continue;

		const dir = path.posix.dirname(relPath);
		if (!byDirectory.has(dir)) {
			byDirectory.set(dir, []);
		}
		byDirectory.get(dir).push(relPath);
	}

	for (const files of byDirectory.values()) {
		files.sort((a, b) => a.localeCompare(b));
	}

	return byDirectory;
}

function isUnknownGameName(value) {
	const normalized = String(value || '').trim().toLowerCase();
	return !normalized || normalized === 'unknown game';
}

function normalizeFolderGameName(trackDir) {
	if (!trackDir || trackDir === '.') return 'Unknown Game';

	const folder = path.posix.basename(trackDir).replace(/-/g, ' ').trim();
	if (!folder) return 'Unknown Game';

	return folder
		.split(/\s+/)
		.map((word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : ''))
		.join(' ')
		.trim();
}

function resolveUnknownGameNames(indexItems) {
	const knownNamesByGameId = new Map();

	for (const item of indexItems) {
		const gameId = String(item.gameId || '').trim();
		if (!gameId) continue;

		const metadata = item && typeof item.metadata === 'object' && item.metadata ? item.metadata : {};
		const game = String(metadata.game || '').trim();
		if (isUnknownGameName(game)) continue;

		if (!knownNamesByGameId.has(gameId)) {
			knownNamesByGameId.set(gameId, new Map());
		}

		const gameNames = knownNamesByGameId.get(gameId);
		gameNames.set(game, (gameNames.get(game) || 0) + 1);
	}

	for (const item of indexItems) {
		const gameId = String(item.gameId || '').trim();
		if (!gameId) continue;

		const metadata = item && typeof item.metadata === 'object' && item.metadata ? item.metadata : {};
		if (!isUnknownGameName(metadata.game)) continue;

		const pathParts = getPathParts(String(item.file || ''));
		const fallbackGame = normalizeFolderGameName(pathParts.gameDir || path.posix.dirname(String(item.file || '')));
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

function buildGamesIndex(indexItems, coverArtByDirectory) {
	const byId = new Map();

	for (const item of indexItems) {
		const gameId = String(item?.gameId || '').trim();
		if (!gameId) continue;

		const pathParts = getPathParts(String(item.file || ''));
		const title = String(item?.metadata?.game || '').trim() || normalizeFolderGameName(pathParts.gameDir);
		const platform = pathParts.platform;
		if (!platform) continue;

		const metadata = item && typeof item.metadata === 'object' && item.metadata ? item.metadata : {};
		const metadataYear = extractYearFromText(metadata.year);
		const copyright = typeof metadata.copyright === 'string' ? metadata.copyright : '';
		const fallbackYear = extractYearFromText(copyright);
		const year = metadataYear || fallbackYear;
		const company = extractCompaniesFromCopyright(copyright);
		const folderImages = coverArtByDirectory.get(pathParts.gameDir) || [];
		const coverArt = folderImages[0] || '';

		if (!byId.has(gameId)) {
			byId.set(gameId, {
				id: gameId,
				title,
				platform,
				year,
				company,
				coverArt,
			});
			continue;
		}

		const existing = byId.get(gameId);
		if (!existing.title && title) {
			existing.title = title;
		}
		if (!existing.year && year) {
			existing.year = year;
		}
		if (company.length) {
			existing.company = [...new Set([...existing.company, ...company])];
		}
		if (!existing.coverArt && coverArt) {
			existing.coverArt = coverArt;
		}
	}

	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function extractTrackMetadata(fileRelPath) {
	const platform = getPlatform(fileRelPath);
	if (!platform) return null;

	if (platform === 'xa') {
		const title = stripExtension(fileRelPath);
		return buildEntry(
			fileRelPath,
			{
				title,
				artist: '',
				game: '',
				length: -1,
				metadata: {
					title,
					artist: '',
					game: '',
					detail: 'XA ADPCM',
				},
			}
		);
	}

	const module = await loadBackend(platform);
	const data = sampleFileDataByPath.get(fileRelPath.toLowerCase())?.data;

	if (!data) {
		throw new Error(`Missing file data for ${fileRelPath}`);
	}

	const virtualPath = ensureFileInVirtualFs(module, fileRelPath, data);
	runtimeState.module = module;
	runtimeState.currentTrackRel = fileRelPath;

	if (platform === 'vgm') {
		try {
			module.ccall('emu_set_resource_path', null, ['string'], ['/sample-files/']);
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
		[virtualPath, inputPtr, data.length, 48000, platform === 'nez' || platform === 'vgm' ? 1024 : -999, false]
	);
	module._free(inputPtr);

	if (ret !== 0) {
		throw new Error(`emu_load_file failed (${ret}) for ${fileRelPath}`);
	}

	try {
		if (platform === 'snes') {
			// Game_Music_Emu-backed SNES metadata is populated by emu_set_subsong.
			const subsongRet = module.ccall('emu_set_subsong', 'number', ['number'], [-1]);
			if (subsongRet !== 0) {
				throw new Error(`emu_set_subsong failed (${subsongRet}) for ${fileRelPath}`);
			}
		}

		if (platform === 'vgm') {
			// VGMPlay initializes timing/chip state in emu_set_subsong.
			const subsongRet = module.ccall('emu_set_subsong', 'number', ['number'], [0]);
			if (subsongRet !== 0) {
				throw new Error(`emu_set_subsong failed (${subsongRet}) for ${fileRelPath}`);
			}
		}

		const metadata = readTrackInfo(module, platform, stripExtension(fileRelPath));
		return buildEntry(fileRelPath, metadata);
	} finally {
		try {
			module.ccall('emu_teardown', 'number');
		} catch {
			// Keep indexing other files even if backend teardown fails.
		}
	}
}

async function main() {
	logInfo(`Starting sample index generation from ${sampleDir}`);

	const relativeFiles = await collectRelativeFiles(sampleDir);
	logInfo(`Discovered ${relativeFiles.length} files under sample-files.`);
	logInfo('Loading sample files into memory...');

	let loadedFileCount = 0;
	for (const relPath of relativeFiles) {
		const lower = relPath.toLowerCase();
		if (lower === 'index.json' || lower === 'games.json') continue;

		const fullPath = path.join(sampleDir, relPath);
		const data = await fs.readFile(fullPath);
		sampleFileDataByPath.set(relPath.toLowerCase(), {
			relPath,
			data,
		});
		loadedFileCount += 1;
	}
	logInfo(`Loaded ${loadedFileCount} files into cache.`);

	if (!sampleFileDataByPath.has('vgmplay.ini')) {
		try {
			const vgmIniData = await fs.readFile(vgmIniPath);
			sampleFileDataByPath.set('vgmplay.ini', {
				relPath: 'VGMPlay.ini',
				data: vgmIniData,
			});
			logInfo('Loaded VGMPlay.ini fallback resource.');
		} catch {
			// Optional fallback; continue without it.
			logInfo('VGMPlay.ini fallback resource not found; continuing without it.');
		}
	}

	const playableFiles = relativeFiles
		.filter((relPath) => relPath.toLowerCase() !== 'index.json')
		.filter((relPath) => relPath.toLowerCase() !== 'games.json')
		.filter((relPath) => getPlatform(relPath));
	const coverArtByDirectory = buildCoverArtByDirectory(relativeFiles);
	logInfo(`Found ${playableFiles.length} playable files across ${coverArtByDirectory.size} cover-art directories.`);

	const indexItems = [];
	for (let i = 0; i < playableFiles.length; i += 1) {
		const relPath = playableFiles[i];
		logInfo(`Metadata [${i + 1}/${playableFiles.length}] ${relPath}`);
		try {
			const item = await extractTrackMetadata(relPath);
			if (item) indexItems.push(item);
		} catch (error) {
			process.stderr.write(`Skipping ${relPath}: ${String(error.message || error)}\n`);
		}
	}
	logInfo(`Metadata extraction complete. Indexed ${indexItems.length} tracks.`);

	logInfo('Resolving unknown game names...');
	resolveUnknownGameNames(indexItems);

	indexItems.sort((a, b) => a.file.localeCompare(b.file));
	const gamesItems = buildGamesIndex(indexItems, coverArtByDirectory);
	logInfo(`Built games index with ${gamesItems.length} unique game entries.`);

	logInfo('Writing output files...');
	await fs.writeFile(indexPath, `${JSON.stringify(indexItems, null, 2)}\n`, 'utf8');
	await fs.writeFile(gamesPath, `${JSON.stringify(gamesItems, null, 2)}\n`, 'utf8');

	process.stdout.write(
		`Generated ${indexItems.length} sample entries at ${indexPath} and ${gamesItems.length} game entries at ${gamesPath}\n`
	);
}

main().catch((error) => {
	process.stderr.write(String(error.stack || error) + '\n');
	process.exitCode = 1;
});
