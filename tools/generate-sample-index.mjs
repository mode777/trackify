import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const rootDir = process.cwd();
const sampleDir = path.join(rootDir, 'sample-files');
const indexPath = path.join(sampleDir, 'index.json');
const wasmDir = path.join(rootDir, 'build', 'wasm');

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
};

const backendCache = new Map();
const sampleFileDataByPath = new Map();

const runtimeState = {
	module: null,
	currentTrackRel: '',
};
const debug = process.env.TRACKIFY_INDEX_DEBUG === '1';

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

	if (platform === 'psx') {
		const attrs = module.HEAP32.subarray(ptr >> 2, (ptr >> 2) + 7);
		const title = decodeTextFromHeap(module, attrs[0], 'shift_jis') || fallbackTitle;
		return {
			title,
			artist: decodeTextFromHeap(module, attrs[1], 'shift_jis'),
			game: decodeTextFromHeap(module, attrs[2], 'shift_jis'),
		};
	}

	if (platform === 'n64') {
		const attrs = module.HEAP32.subarray(ptr >> 2, (ptr >> 2) + 7);
		const title = decodeUtf8(module, attrs[0]) || fallbackTitle;
		return {
			title,
			artist: decodeUtf8(module, attrs[1]),
			game: decodeUtf8(module, attrs[2]),
		};
	}

	if (platform === 'snes') {
		const attrs = module.HEAP32.subarray(ptr >> 2, (ptr >> 2) + 8);
		const title = decodeUtf8(module, attrs[0]) || fallbackTitle;
		return {
			title,
			artist: decodeUtf8(module, attrs[1]),
			game: decodeUtf8(module, attrs[2]),
		};
	}

	if (platform === 'nez') {
		const attrs = module.HEAP32.subarray(ptr >> 2, (ptr >> 2) + 6);
		const title = decodeTextFromHeap(module, attrs[0], 'shift_jis') || fallbackTitle;
		const artist = decodeTextFromHeap(module, attrs[1], 'shift_jis');

		return {
			title,
			artist,
			game: '',
		};
	}

	return {
		title: fallbackTitle,
		artist: '',
		game: '',
	};
}

function buildEntry(fileRelPath, platform, metadata) {
	const clean = (value) => String(value || '').replace(/[\r\n\t]+/g, ' ').trim();

	return {
		title: clean(metadata.title) || stripExtension(fileRelPath),
		file: fileRelPath,
		platform,
		game: clean(metadata.game),
		artist: clean(metadata.artist),
	};
}

async function extractTrackMetadata(fileRelPath) {
	const platform = getPlatform(fileRelPath);
	if (!platform) return null;

	const module = await loadBackend(platform);
	const data = sampleFileDataByPath.get(fileRelPath.toLowerCase())?.data;

	if (!data) {
		throw new Error(`Missing file data for ${fileRelPath}`);
	}

	const virtualPath = ensureFileInVirtualFs(module, fileRelPath, data);
	runtimeState.module = module;
	runtimeState.currentTrackRel = fileRelPath;

	const inputPtr = module._malloc(data.length);
	module.HEAPU8.set(data, inputPtr);
	const ret = module.ccall(
		'emu_load_file',
		'number',
		['string', 'number', 'number', 'number', 'number', 'number'],
		[virtualPath, inputPtr, data.length, 48000, platform === 'nez' ? 1024 : -999, false]
	);
	module._free(inputPtr);

	if (ret !== 0) {
		throw new Error(`emu_load_file failed (${ret}) for ${fileRelPath}`);
	}

	const metadata = readTrackInfo(module, platform, stripExtension(fileRelPath));
	module.ccall('emu_teardown', 'number');

	return buildEntry(fileRelPath, platform, metadata);
}

async function main() {
	const relativeFiles = await collectRelativeFiles(sampleDir);

	for (const relPath of relativeFiles) {
		if (relPath.toLowerCase() === 'index.json') continue;

		const fullPath = path.join(sampleDir, relPath);
		const data = await fs.readFile(fullPath);
		sampleFileDataByPath.set(relPath.toLowerCase(), {
			relPath,
			data,
		});
	}

	const playableFiles = relativeFiles
		.filter((relPath) => relPath.toLowerCase() !== 'index.json')
		.filter((relPath) => getPlatform(relPath));

	const indexItems = [];
	for (const relPath of playableFiles) {
		const item = await extractTrackMetadata(relPath);
		if (item) indexItems.push(item);
	}

	indexItems.sort((a, b) => a.file.localeCompare(b.file));
	await fs.writeFile(indexPath, `${JSON.stringify(indexItems, null, 2)}\n`, 'utf8');

	process.stdout.write(
		`Generated ${indexItems.length} sample entries at ${indexPath}\n`
	);
}

main().catch((error) => {
	process.stderr.write(String(error.stack || error) + '\n');
	process.exitCode = 1;
});
