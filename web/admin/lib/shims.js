/*
 * Browser-side shims around the shared catalog identifier helpers.
 *
 * The CLI implementations of these two helpers depend on node:path; the
 * browser equivalents reimplement only the posix-path bits they need.
 * The identifier/id rules themselves come from the shared module so the
 * admin page and the CLI cannot drift.
 */import {
	getExtension as sharedGetExtension,
	normalizeRequestName,
} from '../../../shared/catalog-identifiers.mjs';

export function basename(fileRelPath) {
	const parts = normalizeRequestName(fileRelPath).replace(/\/+$/, '').split('/');
	return parts[parts.length - 1] || '';
}

export function dirname(fileRelPath) {
	const normalized = normalizeRequestName(fileRelPath);
	const slash = normalized.lastIndexOf('/');
	if (slash === -1) return '.';
	return normalized.slice(0, slash) || '/';
}

export function stripExtension(fileRelPath) {
	const base = basename(fileRelPath);
	const ext = sharedGetExtension(fileRelPath);
	return ext ? base.slice(0, base.length - ext.length - 1) : base;
}

export function normalizeFolderGameName(trackDir) {
	if (!trackDir || trackDir === '.') return 'Unknown Game';

	const folder = basename(trackDir).replace(/-/g, ' ').trim();
	if (!folder) return 'Unknown Game';

	return folder
		.split(/\s+/)
		.map((word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : ''))
		.join(' ')
		.trim();
}
