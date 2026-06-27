/*
 * Trackify playlist metadata constants.
 *
 * Shared between the shell (catalog_service.js, which assigns the
 * random color/icon at create time and backfills on read) and the
 * playlist frame (art_edit_ui.js, which surfaces the same values in
 * the owner-only edit popover). Both sides MUST agree on the
 * palettes — divergence would mean a freshly created playlist uses an
 * icon the user cannot re-select later.
 */

export const PLAYLIST_PALETTE = [
    '#d2bbff',
    '#ff9bd2',
    '#ffd166',
    '#ff8e72',
    '#7ad9c2',
    '#9ad7ff',
    '#c0e57b',
    '#f5a3ff',
    '#ff6b6b',
    '#5dc3ff',
];

export const PLAYLIST_MUSIC_ICONS = [
    'album',
    'audiotrack',
    'equalizer',
    'graphic_eq',
    'headphones',
    'library_music',
    'mic',
    'music_note',
    'music_video',
    'piano',
    'queue_music',
    'radio',
    'speaker',
];

const PALETTE_SET = new Set(PLAYLIST_PALETTE.map((value) => value.toLowerCase()));
const ICON_SET = new Set(PLAYLIST_MUSIC_ICONS);

export function isPlaylistPaletteColor(value) {
    return typeof value === 'string' && PALETTE_SET.has(value.trim().toLowerCase());
}

export function isPlaylistIcon(value) {
    return typeof value === 'string' && ICON_SET.has(value.trim());
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value) {
    return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim());
}