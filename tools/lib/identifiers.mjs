import path from 'node:path';

export function toPosixPath(value) {
	return value.split(path.sep).join('/');
}

export function stripExtension(fileRelPath) {
	const base = path.basename(fileRelPath);
	const ext = path.extname(base);
	return ext ? base.slice(0, -ext.length) : base;
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

export function normalizeRequestName(name) {
	return String(name).replace(/\\/g, '/').replace(/^\/+/, '');
}

export function getPathParts(fileRelPath) {
	const normalized = normalizeRequestName(fileRelPath);
	const segments = normalized.split('/').filter(Boolean);
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

export function normalizeFolderGameName(trackDir) {
	if (!trackDir || trackDir === '.') return 'Unknown Game';

	const folder = path.posix.basename(trackDir).replace(/-/g, ' ').trim();
	if (!folder) return 'Unknown Game';

	return folder
		.split(/\s+/)
		.map((word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : ''))
		.join(' ')
		.trim();
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
