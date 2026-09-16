/*
 * Browser port of the CLI's WASM probing helpers
 * (tools/lib/wasm-vfs.mjs decode/VFS halves + tools/lib/metadata-readers.mjs).
 *
 * Pure functions over an Emscripten module namespace — no node:path, no DOM.
 */
import { cleanTextDeep } from '../../../shared/catalog-identifiers.mjs';

export const SAMPLE_RATE = 48000;
export const BACKEND_READY_TIMEOUT_MS = 30000;
export const CSTRING_MAX_BYTES = 256;
export const NEZ_BUFFER_SIZE = 1024;
export const DEFAULT_INTERLEAVE = -999;

// The cores' emu_get_track_info returns an int array of string pointers, one
// per schema field. Decoders mirror tools/lib/metadata-readers.mjs.
export const PLATFORM_SCHEMAS = {
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
    const parts = virtualDir.split('/').filter(Boolean);
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

export function stageFileInVirtualFs(module, virtualRoot, relPath, data) {
    const virtualPath = `${virtualRoot}/${relPath}`;
    const slash = virtualPath.lastIndexOf('/');
    const virtualDir = slash === -1 ? '.' : virtualPath.slice(0, slash);
    const virtualName = slash === -1 ? virtualPath : virtualPath.slice(slash + 1);

    ensureVirtualDirectory(module, virtualDir);

    try {
        module.FS_unlink(virtualPath);
    } catch {
        // File not present yet.
    }

    module.FS_createDataFile(virtualDir, virtualName, data, true, false, true);
    return virtualPath;
}

export function toTrackLength(maxPosition) {
    const numeric = Number(maxPosition);
    if (!Number.isFinite(numeric)) return -1;
    const rounded = Math.trunc(numeric);
    return rounded >= 0 ? rounded : -1;
}

export function readTrackInfo(module, platform, fallbackTitle) {
    const ptr = module.ccall('emu_get_track_info', 'number');
    const schema = PLATFORM_SCHEMAS[platform];

    if (!schema) {
        return {
            title: fallbackTitle,
            artist: '',
            game: '',
            length: -1,
            metadata: cleanTextDeep({
                title: fallbackTitle,
                artist: '',
                game: '',
            }),
        };
    }

    const attrs = module.HEAP32.subarray(ptr >> 2, (ptr >> 2) + schema.fields.length);
    const metadata = {};
    for (let i = 0; i < schema.fields.length; i += 1) {
        const fieldDecoder = Array.isArray(schema.decoders) ? schema.decoders[i] : schema.decoder;
        metadata[schema.fields[i]] = decodeCString(module, attrs[i], fieldDecoder);
    }

    const title = metadata.title || fallbackTitle;
    const artist = metadata.artist || '';
    const game = metadata.game || '';
    const length = toTrackLength(module.ccall('emu_get_max_position', 'number'));

    metadata.title = title;
    if (!Object.prototype.hasOwnProperty.call(metadata, 'artist')) metadata.artist = artist;
    if (!Object.prototype.hasOwnProperty.call(metadata, 'game')) metadata.game = game;

    return { title, artist, game, length, metadata: cleanTextDeep(metadata) };
}

// Ported from tools/lib/games-index.mjs (pure).
export function extractYearFromText(value) {
    if (typeof value !== 'string') return '';
    const match = value.match(/\b(\d{4})\b/);
    return match ? match[1] : '';
}

export function extractCompaniesFromCopyright(copyright) {
    if (typeof copyright !== 'string' || !copyright.trim()) return [];
    const parts = copyright.split(',');
    const companies = [];
    for (const part of parts) {
        const normalized = part.replace(/\b\d{4}\b/g, ' ').replace(/\s+/g, ' ').trim();
        if (normalized) companies.push(normalized);
    }
    return [...new Set(companies)];
}
