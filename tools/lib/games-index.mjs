import path from 'node:path';
import { COVER_ART_EXTENSIONS } from './constants.mjs';
import { getExtension } from './platforms.mjs';
import {
	getPathParts,
	normalizeFolderGameName,
} from './identifiers.mjs';

export function buildCoverArtByDirectory(relativeFiles) {
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

export function extractYearFromText(value) {
	if (typeof value !== 'string') return '';
	const match = value.match(/\b(\d{4})\b/);
	return match ? match[1] : '';
}

function extractCompaniesFromCopyright(copyright) {
	if (typeof copyright !== 'string' || !copyright.trim()) return [];
	const parts = copyright.split(',');
	const companies = [];
	for (const part of parts) {
		const normalized = part.replace(/\b\d{4}\b/g, ' ').replace(/\s+/g, ' ').trim();
		if (normalized) companies.push(normalized);
	}
	return [...new Set(companies)];
}

export function buildGamesIndex(indexItems, coverArtByDirectory) {
	const byId = new Map();

	for (const item of indexItems) {
		const gameId = String(item?.gameId || '').trim();
		if (!gameId) continue;

		const pathParts = getPathParts(String(item.file || ''));
		const title =
			String(item?.metadata?.game || '').trim() || normalizeFolderGameName(pathParts.gameDir);
		const platform = pathParts.platform;
		if (!platform) continue;

		const metadata = item && typeof item.metadata === 'object' && item.metadata ? item.metadata : {};
		const metadataYear = extractYearFromText(metadata.year);
		const copyright = typeof metadata.copyright === 'string' ? metadata.copyright : '';
		const fallbackYear = extractYearFromText(copyright);
		const year = metadataYear || fallbackYear;
		const company = extractCompaniesFromCopyright(copyright);
		const directory = path.posix.dirname(String(item.file || ''));
		const folderImages = coverArtByDirectory.get(pathParts.gameDir) || [];
		const coverArt = folderImages[0] || '';

		if (!byId.has(gameId)) {
			byId.set(gameId, {
				id: gameId,
				title,
				platform,
				year,
				company,
				directory,
				coverArt,
			});
			continue;
		}

		const existing = byId.get(gameId);
		if (!existing.title && title) existing.title = title;
		if (!existing.year && year) existing.year = year;
		if (company.length) {
			existing.company = [...new Set([...existing.company, ...company])];
		}
		if (!existing.directory && directory) existing.directory = directory;
		if (!existing.coverArt && coverArt) existing.coverArt = coverArt;
	}

	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
