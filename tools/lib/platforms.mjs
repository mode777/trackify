import path from 'node:path';

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

export function getExtension(fileRelPath) {
	const ext = path.extname(fileRelPath).toLowerCase();
	return ext.startsWith('.') ? ext.slice(1) : ext;
}

export function getPlatform(fileRelPath) {
	return EXT_PLATFORM[getExtension(fileRelPath)] || null;
}
