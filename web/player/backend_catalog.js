/*
 * Trackify player frame backend catalog.
 *
 * Owns the file-extension -> backend-type classification and the
 * backend-type -> runtime-script mapping for the player frame.
 *
 * To add a new backend, add an EXT_* array, an entry in BACKEND_SCRIPT_BY_TYPE,
 * and a case in typeOf(). See README.md "Adding another backend".
 */
'use strict';

const EXT_PSX = ['psf', 'minipsf', 'psf2', 'minipsf2', 'psflib'];
const EXT_SNES = ['spc', 'rsn'];
const EXT_NEZ = ['bgm', 'opx', 'nsf', 'sng', 'kss'];
const EXT_N64 = ['usf', 'miniusf', 'usflib'];
const EXT_VGM = ['vgm', 'vgz', 'cmf', 'dro'];
const EXT_XA = ['xa'];
const EXT_GENH = ['genh'];
const EXT_MP3 = ['mp3'];

export const BACKEND_SCRIPT_BY_TYPE = {
    psx: '/wasm/backend_psx.js',
    snes: '/wasm/backend_snes.js',
    nez: '/wasm/backend_nez.js',
    n64: '/wasm/backend_n64.js',
    vgm: '/wasm/backend_vgm.js',
    xa: '/wasm/backend_xa.js',
    genh: '/wasm/backend_genh.js',
    mp3: '/wasm/backend_mp3.js',
};

export const BACKEND_LOAD_TIMEOUT_MS = 15000;

export function extOf(file) {
    return file.slice(file.lastIndexOf('.') + 1).toLowerCase();
}

export function typeOf(file) {
    const ext = extOf(file);
    if (EXT_GENH.includes(ext)) return 'genh';
    if (EXT_XA.includes(ext)) return 'xa';
    if (EXT_VGM.includes(ext)) return 'vgm';
    if (EXT_N64.includes(ext)) return 'n64';
    if (EXT_NEZ.includes(ext)) return 'nez';
    if (EXT_SNES.includes(ext)) return 'snes';
    if (EXT_PSX.includes(ext)) return 'psx';
    if (EXT_MP3.includes(ext)) return 'mp3';
    return null;
}
