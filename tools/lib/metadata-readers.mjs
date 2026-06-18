import { SAMPLE_RATE } from './constants.mjs';
import { decodeCString } from './wasm-vfs.mjs';
import { cleanTextDeep } from './identifiers.mjs';

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

export { SAMPLE_RATE };
