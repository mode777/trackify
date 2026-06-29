/*
 * Trackify playlist track-list UI.
 *
 * Owns the #trackList element: full re-render via renderTracks() and
 * an in-place refresh of just the favorite icons via
 * refreshFavoriteIcons(). Each row's click handlers are bound at
 * render time and delegate through the closures captured by
 * bindTrackListUi().
 */
'use strict';

import { els } from './dom.js';
import { PLACEHOLDER_GAME, typeOf } from './track_helpers.js';

let getTracks = () => [];
let getCurrentIndex = () => -1;
let getFavoriteTrackIds = () => new Set();
let publishSelectedFn = () => {};
let openAddToPlaylistPopupFn = () => {};
let applyUserToggleFn = () => {};

export function bindTrackListUi({
    getTracks: gT,
    getCurrentIndex: gC,
    getFavoriteTrackIds: gF,
    publishSelected,
    openAddToPlaylistPopup,
    applyUserToggle,
} = {}) {
    getTracks = typeof gT === 'function' ? gT : () => [];
    getCurrentIndex = typeof gC === 'function' ? gC : () => -1;
    getFavoriteTrackIds = typeof gF === 'function' ? gF : () => new Set();
    publishSelectedFn = typeof publishSelected === 'function' ? publishSelected : () => {};
    openAddToPlaylistPopupFn = typeof openAddToPlaylistPopup === 'function' ? openAddToPlaylistPopup : () => {};
    applyUserToggleFn = typeof applyUserToggle === 'function' ? applyUserToggle : () => {};
}

export function renderTracks() {
    if (!els.list) return;

    const tracks = getTracks();
    const currentIndex = getCurrentIndex();
    const favoriteIds = getFavoriteTrackIds();

    els.list.innerHTML = '';
    tracks.forEach((track, index) => {
        const li = document.createElement('li');
        li.dataset.index = String(index);
        if (index === currentIndex) li.classList.add('active');

        const number = document.createElement('button');
        number.type = 'button';
        number.className = 'track-number';
        number.setAttribute('aria-label', 'Play ' + track.title);

        const numberLabel = document.createElement('span');
        numberLabel.className = 'track-number-label';
        numberLabel.textContent = String(index + 1);

        const numberPlay = document.createElement('span');
        numberPlay.className = 'track-number-play material-symbols-outlined filled';
        numberPlay.setAttribute('aria-hidden', 'true');
        numberPlay.textContent = 'play_arrow';

        number.append(numberLabel, numberPlay);
        number.addEventListener('click', () => {
            publishSelectedFn(index, true);
        });

        const main = document.createElement('div');
        main.className = 'track-main';

        const meta = document.createElement('div');
        meta.className = 'track-meta';

        const name = document.createElement('span');
        name.className = 'track-name';
        name.textContent = track.title;

        const game = document.createElement('span');
        game.className = 'track-artist';
        const gameLabel = typeof track.game === 'string' && track.game.trim() ? track.game.trim() : PLACEHOLDER_GAME;
        const gameId = typeof track.gameId === 'string' ? track.gameId.trim() : '';
        const artistNames = Array.isArray(track.artists) && track.artists.length > 0
            ? track.artists.filter((value) => typeof value === 'string' && value.trim())
            : (typeof track.artist === 'string' && track.artist.trim()
                ? track.artist.split(',').map((value) => value.trim()).filter(Boolean)
                : []);

        if (gameId) {
            const gameLink = document.createElement('a');
            gameLink.href = '/games/' + encodeURIComponent(gameId);
            gameLink.setAttribute('data-router-link', '');
            gameLink.className = 'track-artist-game';
            gameLink.textContent = gameLabel;
            game.appendChild(gameLink);
        } else {
            game.appendChild(document.createTextNode(gameLabel));
        }

        if (artistNames.length > 0) {
            game.appendChild(document.createTextNode(' \u00b7 '));
            artistNames.forEach((name, index) => {
                if (index > 0) {
                    game.appendChild(document.createTextNode(', '));
                }
                const artistLink = document.createElement('a');
                artistLink.href = '/artists/' + encodeURIComponent(name);
                artistLink.setAttribute('data-router-link', '');
                artistLink.className = 'track-artist-name';
                artistLink.textContent = name;
                game.appendChild(artistLink);
            });
        }

        meta.append(name, game);

        const addToPlaylist = document.createElement('button');
        addToPlaylist.type = 'button';
        addToPlaylist.className = 'track-add';
        const addToPlaylistIcon = document.createElement('span');
        addToPlaylistIcon.className = 'material-symbols-outlined';
        addToPlaylistIcon.setAttribute('aria-hidden', 'true');
        addToPlaylistIcon.textContent = 'add_circle';
        addToPlaylist.append(addToPlaylistIcon);
        addToPlaylist.setAttribute('aria-label', 'Add ' + track.title + ' to playlist');
        addToPlaylist.addEventListener('click', (event) => {
            event.stopPropagation();
            openAddToPlaylistPopupFn(addToPlaylist, track);
        });

        const favorite = document.createElement('button');
        favorite.type = 'button';
        favorite.className = 'track-favorite';
        const favoriteIcon = document.createElement('span');
        favoriteIcon.className = 'material-symbols-outlined';
        favoriteIcon.setAttribute('aria-hidden', 'true');
        favorite.append(favoriteIcon);
        applyFavoriteState(favorite, track, favoriteIds.has(track.id));
        favorite.addEventListener('click', (event) => {
            event.stopPropagation();
            const wasFavorite = favoriteIds.has(track.id);
            applyUserToggleFn(track.id, wasFavorite);
            refreshFavoriteIcons();
        });

        main.append(meta, addToPlaylist, favorite);

        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = typeOf(track.file) || track.platform || '?';

        li.append(number, main, badge);
        els.list.appendChild(li);
    });
}

export function refreshFavoriteIcons() {
    if (!els.list) return;
    const tracks = getTracks();
    const favoriteIds = getFavoriteTrackIds();
    const items = els.list.querySelectorAll('li');
    items.forEach((li) => {
        const index = Number(li.dataset.index);
        const track = tracks[index];
        if (!track) return;
        const button = li.querySelector('.track-favorite');
        if (!button) return;
        applyFavoriteState(button, track, favoriteIds.has(track.id));
    });
}

function applyFavoriteState(button, track, isFavorite) {
    button.classList.toggle('is-favorite', isFavorite);
    const icon = button.querySelector('.material-symbols-outlined');
    if (icon) {
        icon.textContent = isFavorite ? 'favorite' : 'favorite_border';
        icon.classList.toggle('filled', isFavorite);
    }
    button.setAttribute('aria-label', isFavorite
        ? 'Remove ' + track.title + ' from favorites'
        : 'Add ' + track.title + ' to favorites');
}
