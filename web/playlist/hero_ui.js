/*
 * Trackify playlist hero UI.
 *
 * Owns the hero strip (art + eyebrow + title + company + year + meta
 * dot) and the three hero modes (game, favorites, playlist).
 *
 * The body classes `is-favorites`, `is-playlist`, and `is-owner` are
 * state markers. `is-favorites` has CSS rules in playlist.css;
 * `is-playlist` and `is-owner` are JS-only today.
 *
 * `initHeroUi({ setCurrentPlaylist, reevaluateEditState })` wires the
 * two side effects every mode transition needs: push the normalized
 * playlist into playlist_state and re-run the title edit evaluator.
 */
'use strict';

import { els } from './dom.js';

let setCurrentPlaylistFn = () => {};
let reevaluateEditStateFn = () => {};

export function initHeroUi({ setCurrentPlaylist, reevaluateEditState } = {}) {
    setCurrentPlaylistFn = typeof setCurrentPlaylist === 'function' ? setCurrentPlaylist : () => {};
    reevaluateEditStateFn = typeof reevaluateEditState === 'function' ? reevaluateEditState : () => {};
}

export function updateHeroArt(coverArt) {
    if (!els.heroArt) return;

    els.heroArt.style.backgroundImage = '';
    els.heroArt.style.removeProperty('--playlist-accent');

    if (els.heroArtIcon) {
        els.heroArtIcon.textContent = '';
        els.heroArtIcon.style.color = '';
        els.heroArtIcon.style.opacity = '';
    }

    if (typeof coverArt !== 'string' || !coverArt.trim()) {
        return;
    }

    let resolvedCoverArt = coverArt;
    try {
        resolvedCoverArt = new URL(coverArt, window.location.href).toString();
    } catch {
        resolvedCoverArt = coverArt;
    }

    els.heroArt.style.backgroundImage = 'linear-gradient(rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.2)), url("' + resolvedCoverArt.replace(/"/g, '\\"') + '")';
    els.heroArt.style.backgroundSize = 'cover';
    els.heroArt.style.backgroundPosition = 'center';
}

function applyPlaylistHeroArt(playlist) {
    if (!els.heroArt) return;

    const accent = playlist && typeof playlist.color === 'string' && playlist.color ? playlist.color : '';
    const icon = playlist && typeof playlist.icon === 'string' && playlist.icon ? playlist.icon : '';

    if (accent) {
        els.heroArt.style.setProperty('--playlist-accent', accent);
        els.heroArt.style.backgroundImage =
            'linear-gradient(135deg, ' +
            'color-mix(in srgb, ' + accent + ' 38%, #2a3354) 0%, ' +
            'color-mix(in srgb, ' + accent + ' 18%, #1a2143) 55%, ' +
            '#131a36 100%)';
    } else {
        els.heroArt.style.removeProperty('--playlist-accent');
        els.heroArt.style.backgroundImage = '';
    }

    if (els.heroArtIcon) {
        els.heroArtIcon.textContent = icon;
        if (accent) {
            els.heroArtIcon.style.color = accent;
            els.heroArtIcon.style.opacity = '0.4';
        } else {
            els.heroArtIcon.style.color = '';
            els.heroArtIcon.style.opacity = '';
        }
    }
}

export function setHeroMetadata(gameEntry) {
    if (!gameEntry || typeof gameEntry !== 'object') return;

    const title = typeof gameEntry.title === 'string' ? gameEntry.title.trim() : '';
    const company = Array.isArray(gameEntry.company)
        ? gameEntry.company.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean).join(', ')
        : '';

    let year = '';
    if (typeof gameEntry.year === 'number' && Number.isFinite(gameEntry.year)) {
        year = String(Math.trunc(gameEntry.year));
    } else if (typeof gameEntry.year === 'string') {
        year = gameEntry.year.trim();
    }

    if (els.heroTitle && title) {
        els.heroTitle.textContent = title;
    }

    if (els.heroCompany) {
        els.heroCompany.textContent = company || 'Unknown company';
    }

    if (els.heroYear) {
        els.heroYear.textContent = year || 'Unknown year';
    }

    if (els.heroMetaDot) {
        const showDot = Boolean(company && year);
        els.heroMetaDot.style.display = showDot ? '' : 'none';
    }

    updateHeroArt(gameEntry.coverArt);
}

export function applyFavoritesHeroState() {
    document.body.classList.add('is-favorites');
    document.body.classList.remove('is-playlist');
    applyPlaylistHeroArt(null);
    if (els.heroEyebrow) els.heroEyebrow.textContent = 'Playlist';
    if (els.heroTitle) els.heroTitle.textContent = 'Liked Tracks';
    if (els.heroCompany) els.heroCompany.textContent = 'Your favorite tracks';
    if (els.heroYear) els.heroYear.textContent = '';
    if (els.heroMetaDot) els.heroMetaDot.style.display = 'none';
    setCurrentPlaylistFn(null);
    reevaluateEditStateFn();
}

export function applyPlaylistHeroState(playlist) {
    document.body.classList.add('is-playlist');
    document.body.classList.remove('is-favorites');

    const normalized = playlist && typeof playlist === 'object' && typeof playlist.id === 'string' && playlist.id
        ? {
            id: playlist.id,
            title: typeof playlist.title === 'string' ? playlist.title.trim() : '',
            type: typeof playlist.type === 'string' ? playlist.type : '',
            userId: typeof playlist.userId === 'string' ? playlist.userId : '',
            color: typeof playlist.color === 'string' ? playlist.color : '',
            icon: typeof playlist.icon === 'string' ? playlist.icon : '',
        }
        : null;

    setCurrentPlaylistFn(normalized);
    applyPlaylistHeroArt(normalized);

    const title = normalized && normalized.title ? normalized.title : 'Playlist';
    if (els.heroEyebrow) els.heroEyebrow.textContent = 'Playlist';
    if (els.heroTitle) els.heroTitle.textContent = title;
    if (els.heroCompany) els.heroCompany.textContent = normalized && normalized.type === 'public' ? 'Public playlist' : 'Curated tracks';
    if (els.heroYear) els.heroYear.textContent = '';
    if (els.heroMetaDot) els.heroMetaDot.style.display = 'none';
    reevaluateEditStateFn();
}

export function clearFavoritesHeroState() {
    document.body.classList.remove('is-favorites');
    document.body.classList.remove('is-playlist');
    applyPlaylistHeroArt(null);
    if (els.heroEyebrow) els.heroEyebrow.textContent = 'Game';
    setCurrentPlaylistFn(null);
    reevaluateEditStateFn();
}
