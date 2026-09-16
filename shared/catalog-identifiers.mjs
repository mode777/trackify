/*
 * Shared catalog path/identifier helpers — used by both the Node tooling
 * (tools/*) and the browser admin page (web/admin/*).
 *
 * This module MUST stay dependency-free and path-library-free: it is loaded
 * by Vite bundles and plain Node ESM alike. The identifier rules here are
 * the single source of truth for catalog record ids — changing them changes
 * ids produced by tools/upload-index.mjs AND the admin page simultaneously.
 */

// Extension -> backend/platform classification (mirrors the player's
// typeOf() switch and the CLI's platforms.mjs).
export const EXT_PLATFORM = {
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
	genh: 'genh',
	mp3: 'mp3',
};

// Image extensions considered cover-art candidates.
export const COVER_ART_EXTENSIONS = new Set(['png', 'jpg', 'gif', 'webp']);

const POSIX_SEP = '/';

export function normalizeRequestName(name) {
	return String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

export function getExtension(fileRelPath) {
	const base = normalizeRequestName(fileRelPath).split(POSIX_SEP).pop() || '';
	const dot = base.lastIndexOf('.');
	if (dot <= 0) return '';
	return base.slice(dot + 1).toLowerCase();
}

export function getPlatform(fileRelPath) {
	return EXT_PLATFORM[getExtension(fileRelPath)] || null;
}

export function normalizeIdentifier(value) {
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

export function getPathParts(fileRelPath) {
	const normalized = normalizeRequestName(fileRelPath);
	const segments = normalized.split(POSIX_SEP).filter(Boolean);
	const platform = normalizeIdentifier(segments[0] || '');
	const gameSlug = normalizeIdentifier(segments[1] || '');
	const gameDir = platform && gameSlug ? `${platform}/${gameSlug}` : '';

	return { platform, gameSlug, gameDir };
}

export function buildTrackId(fileRelPath) {
	const normalizedPath = normalizeRequestName(fileRelPath);
	return normalizeIdentifier(normalizedPath.replace(/[\\/]+/g, '.'));
}

export function buildGameId(platform, gameName) {
	const normalizedPlatform = normalizeIdentifier(platform);
	const normalizedGame = normalizeIdentifier(gameName);
	if (!normalizedPlatform || !normalizedGame) return '';
	return normalizeIdentifier(`${normalizedPlatform}.${normalizedGame}`);
}

export function splitArtists(artist) {
	if (typeof artist !== 'string' || !artist.trim()) return [];
	const names = artist
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	return [...new Set(names)];
}

export function isUnknownGameName(value) {
	const normalized = String(value || '').trim().toLowerCase();
	return !normalized || normalized === 'unknown game';
}

export function cleanTextDeep(value) {
	const clean = (v) => String(v || '').replace(/[\r\n\t]+/g, ' ').trim();
	if (Array.isArray(value)) return value.map((item) => cleanTextDeep(item));
	if (value && typeof value === 'object') {
		const out = {};
		for (const [key, nested] of Object.entries(value)) {
			out[key] = cleanTextDeep(nested);
		}
		return out;
	}
	if (typeof value === 'string') return clean(value);
	return value;
}
