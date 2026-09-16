import path from 'node:path';

// Path-free identifier helpers live in the shared module, which is also
// consumed by the browser admin page (web/admin). Keep Node-only helpers
// (those that need node:path) here and re-export the shared ones so
// existing `from './identifiers.mjs'` imports keep working.
export {
	normalizeIdentifier,
	normalizeRequestName,
	getPathParts,
	buildTrackId,
	buildGameId,
	splitArtists,
	isUnknownGameName,
	cleanTextDeep,
} from '../../shared/catalog-identifiers.mjs';

export function toPosixPath(value) {
	return value.split(path.sep).join('/');
}

export function stripExtension(fileRelPath) {
	const base = path.basename(fileRelPath);
	const ext = path.extname(base);
	return ext ? base.slice(0, -ext.length) : base;
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
