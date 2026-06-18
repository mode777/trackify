import { parseBuffer } from 'music-metadata';
import { cleanTextDeep } from './identifiers.mjs';
import { toTrackLength } from './metadata-readers.mjs';

function firstString(...values) {
	for (const value of values) {
		if (typeof value === 'string') {
			const trimmed = value.trim();
			if (trimmed) return trimmed;
		}
	}
	return '';
}

function flattenToStrings(value) {
	if (Array.isArray(value)) {
		return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
	}
	if (typeof value === 'string' && value.trim()) {
		return [value.trim()];
	}
	return [];
}

function extractYear(common) {
	if (typeof common.year === 'number' && Number.isFinite(common.year)) {
		return String(Math.trunc(common.year));
	}
	const raw = firstString(common.year, common.date, common.originalyear, common.releaseDate);
	if (!raw) return '';
	const match = raw.match(/\b(\d{4})\b/);
	return match ? match[1] : '';
}

function buildDetail(format) {
	if (!format || typeof format !== 'object') return '';
	const parts = [];
	if (format.container) parts.push(String(format.container).toUpperCase());
	if (format.codec) parts.push(String(format.codec).toUpperCase());
	const sampleRate = Number(format.sampleRate);
	if (Number.isFinite(sampleRate) && sampleRate > 0) {
		parts.push(`${Math.round(sampleRate)} Hz`);
	}
	const bitsPerSample = Number(format.bitsPerSample);
	if (Number.isFinite(bitsPerSample) && bitsPerSample > 0) {
		parts.push(`${bitsPerSample}-bit`);
	}
	const channels = Number(format.channels);
	if (Number.isFinite(channels) && channels > 0) {
		parts.push(`${channels} ch`);
	}
	const bitrate = Number(format.bitrate);
	if (Number.isFinite(bitrate) && bitrate > 0) {
		parts.push(`${Math.round(bitrate / 1000)} kbps`);
	}
	return parts.join(' - ');
}

export async function readMp3Metadata(data, fallbackTitle) {
	const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
	const parsed = await parseBuffer(buffer, { mimeType: 'audio/mpeg', duration: true });

	const common = parsed.common || {};
	const format = parsed.format || {};

	const title = firstString(common.title, fallbackTitle);
	const artist = firstString(...flattenToStrings(common.artist), ...flattenToStrings(common.artists));
	const game = firstString(common.album);
	const year = extractYear(common);
	const genre = firstString(...flattenToStrings(common.genre));
	const comment = firstString(...flattenToStrings(common.comment));
	const copyright = firstString(common.copyright);

	const durationSec = Number(format.duration);
	const length = Number.isFinite(durationSec) && durationSec > 0
		? toTrackLength(durationSec * 1000)
		: -1;

	const detail = buildDetail(format);

	const metadata = { title, artist, game };
	if (year) metadata.year = year;
	if (genre) metadata.genre = genre;
	if (comment) metadata.comment = comment;
	if (copyright) metadata.copyright = copyright;
	if (detail) metadata.detail = detail;

	return {
		title,
		artist,
		game,
		length,
		metadata: cleanTextDeep(metadata),
	};
}