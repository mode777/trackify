import path from 'node:path';
import { CSTRING_MAX_BYTES } from './constants.mjs';
import { normalizeRequestName } from './identifiers.mjs';

export function decodeUtf8(module, ptr) {
	if (!ptr) return '';
	return module.UTF8ToString(ptr);
}

export function decodeUtf32(module, ptr, maxLen = CSTRING_MAX_BYTES) {
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

export function decodePointerString(module, ptr) {
	if (!ptr) return '';
	if (typeof module.Pointer_stringify === 'function') {
		return module.Pointer_stringify(ptr);
	}
	return decodeUtf8(module, ptr);
}

export function decodeTextFromHeap(module, ptr, decoderLabel, maxLen = CSTRING_MAX_BYTES) {
	if (!ptr) return '';

	const bytes = [];
	for (let i = 0; i < maxLen; i += 1) {
		const value = module.HEAPU8[ptr + i];
		if (value === 0) break;
		bytes.push(value);
	}

	if (bytes.length === 0) return '';

	try {
		return new TextDecoder(decoderLabel).decode(new Uint8Array(bytes)).replace(/\uFFFD/g, '');
	} catch {
		return module.UTF8ToString(ptr);
	}
}

export function decodeCString(module, ptr, encoding) {
	if (!ptr) return '';
	if (encoding === 'pointer') return decodePointerString(module, ptr);
	if (encoding === 'utf8') return decodeUtf8(module, ptr);
	if (encoding === 'utf32') return decodeUtf32(module, ptr);
	return decodeTextFromHeap(module, ptr, encoding || 'utf-8');
}

export function ensureVirtualDirectory(module, virtualDir) {
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

export function ensureFileInVirtualFs(module, sampleVirtualRoot, sampleRelPath, data) {
	const normalizedRel = normalizeRequestName(sampleRelPath);
	const virtualPath = `${sampleVirtualRoot}/${normalizedRel}`;
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

export function resolveSampleDependency(ctx, requestedName) {
	const normalized = normalizeRequestName(requestedName);
	if (!normalized) return null;

	const currentDir = path.posix.dirname(ctx.currentTrackRel || '');
	let withoutSamplePrefix = normalized;
	const removablePrefixes = [
		`${ctx.sampleVirtualPrefix}/`,
		`${ctx.defaultSampleDir}/`,
	];
	for (const prefix of removablePrefixes) {
		if (withoutSamplePrefix.startsWith(prefix)) {
			withoutSamplePrefix = withoutSamplePrefix.slice(prefix.length);
			break;
		}
	}

	const candidates = [normalized, withoutSamplePrefix];

	if (currentDir && currentDir !== '.') {
		candidates.push(path.posix.normalize(path.posix.join(currentDir, normalized)));
	}

	for (const candidate of candidates) {
		const key = candidate.toLowerCase();
		const match = ctx.files.get(key);
		if (match) return match;
	}

	return null;
}
