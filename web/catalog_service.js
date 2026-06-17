'use strict';

import PocketBase from 'pocketbase';

const TRACKS_COLLECTION = 'tracks_view';
const GAMES_COLLECTION = 'games';
const PLAYLISTS_COLLECTION = 'playlists';
const PLAYLIST_TRACKS_VIEW_COLLECTION = 'playlist_tracks_view';
const PLAYLIST_TRACKS_COLLECTION = 'playlist_tracks';

const EXTENSIONS = {
    psx: ['psf', 'minipsf', 'psf2', 'minipsf2', 'psflib'],
    snes: ['spc', 'rsn'],
    nez: ['bgm', 'opx', 'nsf', 'sng', 'kss'],
    n64: ['usf', 'miniusf', 'usflib'],
    vgm: ['vgm', 'vgz', 'cmf', 'dro'],
};

export class ShellCatalogService {
    constructor() {
        this.pb = new PocketBase();
        this.extensions = EXTENSIONS;

        this.indexTracks = [];
        this.indexLoadError = '';
        this.indexLoadPromise = null;

        this.games = [];
        this.gamesLoadError = '';
        this.gamesLoadPromise = null;

        this.favoritesPlaylistCache = null;
        this.favoritesTracksCache = null;
        this.favoritesTracksCacheUser = null;

        this.indexLoadErrorMessage = 'Error loading tracks collection (see console)';
        this.gamesLoadErrorMessage = 'Error loading games collection (see console)';
    }

    async queryFavorites() {
        const userId = this.pb.authStore.isValid ? this.pb.authStore.record.id : null;
        if (this.favoritesTracksCache && this.favoritesTracksCacheUser === userId) {
            return this.favoritesTracksCache;
        }
        const playlist = await this.getOrCreateFavoritesPlaylist();
        const response = await this.pb.collection(PLAYLIST_TRACKS_VIEW_COLLECTION).getList(1, 1000, { filter: `playlistId="${playlist.id}"` });
        this.favoritesTracksCache = this.parseTracksManifest(response.items);
        this.favoritesTracksCacheUser = userId;
        return this.favoritesTracksCache;
    }

    async addFavorite(trackId) {
        const playlist = await this.getOrCreateFavoritesPlaylist();
        const record = await this.pb.collection(PLAYLIST_TRACKS_COLLECTION).create({ track: trackId, playlist: playlist.id });
        const userId = this.pb.authStore.record.id;
        if (this.favoritesTracksCache && this.favoritesTracksCacheUser === userId) {
            const response = await this.pb.collection(TRACKS_COLLECTION).getList(1, 1, { filter: `id="${trackId}"` });
            const parsed = this.parseTracksManifest(response.items)[0];
            if (parsed) {
                this.favoritesTracksCache = [...this.favoritesTracksCache, parsed];
            }
        }
        return record;
    }

    async removeFavorite(trackId) {
        const userId = this.pb.authStore.isValid ? this.pb.authStore.record.id : null;
        if (!userId || !this.favoritesTracksCache || this.favoritesTracksCacheUser !== userId) {
            return;
        }
        const cached = this.favoritesTracksCache.find((track) => track && track.id === trackId);
        if (!cached || typeof cached.playlistTrackId !== 'string' || !cached.playlistTrackId) {
            return;
        }
        await this.pb.collection(PLAYLIST_TRACKS_COLLECTION).delete(cached.playlistTrackId);
        this.favoritesTracksCache = this.favoritesTracksCache.filter((track) => track.id !== trackId);
    }

    async getOrCreateFavoritesPlaylist() {
        if (!this.pb.authStore.isValid) {
            throw new Error('User is not authenticated');
        }
        const userId = this.pb.authStore.record.id;
        if (this.favoritesPlaylistCache && this.favoritesPlaylistCache.user === userId) {
            return this.favoritesPlaylistCache;
        }
        const filter = `user="${userId}" && type="favorites"`;
        const response = await this.pb.collection(PLAYLISTS_COLLECTION).getList(1, 1, { filter });
        let playlist;
        if (response.items.length > 0) {
            playlist = response.items[0];
        } else {
            playlist = await this.pb.collection(PLAYLISTS_COLLECTION).create({
                title: '__fav__',
                type: 'favorites',
                user: userId,
            });
        }
        this.favoritesPlaylistCache = playlist;
        return playlist;
    }

    async queryIndex(filters) {
        let tracks = [];
        if (filters.game){
            tracks = await this.loadTracksForGame(filters.game);
        } else {
            tracks = await this.loadTracks();
        }
        return this.makeIndexPayload(tracks, this.indexLoadError);
    }

    async queryGames(filters) {
        await this.ensureGamesLoaded();
        const filteredGames = this.filterGames(this.games, filters || {});
        return this.makeGamesPayload(filteredGames, this.gamesLoadError);
    }

    preload() {
        this.ensureGamesLoaded();
    }

    async ensureGamesLoaded() {
        if (this.gamesLoadPromise) {
            return this.gamesLoadPromise;
        }

        this.gamesLoadPromise = this.loadGames()
            .then((loadedGames) => {
                this.games = loadedGames;
                this.gamesLoadError = '';
            })
            .catch((error) => {
                console.error('Failed to load games', error);
                this.games = [];
                this.gamesLoadError = this.gamesLoadErrorMessage;
            });

        return this.gamesLoadPromise;
    }

    async loadTracks() {
        const records = await this.pb.collection(TRACKS_COLLECTION).getList(1, 100, { sort: 'title' });
        return this.parseTracksManifest(records.items);
    }

    async loadTracksForGame(gameId) {
        const records = await this.pb.collection(TRACKS_COLLECTION).getList(1, 1000, { filter: `gameId="${gameId}"` });
        return this.parseTracksManifest(records.items);
    }

    async loadGames() {
        const records = await this.pb.collection(GAMES_COLLECTION).getFullList();
        return this.parseGamesManifest(records);
    }

    parseTracksManifest(data) {
        const entries = Array.isArray(data) ? data : null;
        if (!entries) throw new Error('Invalid tracks collection format');

        return entries
            .filter((entry) => entry && typeof entry.title === 'string')
            .map((entry) => ({
                ...entry,
                title: entry.title.trim(),
                platform: typeof entry.platform === 'string' ? entry.platform.trim() : '',
                artist: this.normalizeArtist(entry.artist),
                file: this.resolveFilename(entry, 'filename'),
                gameId: typeof entry.gameId === 'string' ? entry.gameId.trim() : '',
                coverArt: this.resolveFileField(entry, 'coverArt'),
            }));
    }

    parseGamesManifest(data) {
        const entries = Array.isArray(data) ? data : null;
        if (!entries) throw new Error('Invalid games collection format');

        return entries
            .filter((entry) => entry && typeof entry.title === 'string')
            .map((entry) => ({
                ...entry,
                title: entry.title.trim(),
                platform: typeof entry.platform === 'string' ? entry.platform.trim() : '',
                year: typeof entry.year === 'string' ? entry.year.trim() : '',
                company: Array.isArray(entry.company)
                    ? entry.company.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
                    : [],
                coverArt: this.resolveFileField(entry, 'coverArt'),
            }));
    }

    filterGames(entries, filters) {
        const gameFilter = this.normalizeFilterValue(filters && filters.game);
        const platformFilter = this.normalizeFilterValue(filters && filters.platform);

        if (!gameFilter && !platformFilter) {
            return entries;
        }

        return entries.filter((entry) => {
            const gameValue = this.normalizeFilterValue(entry.id);
            const platformValue = this.normalizeFilterValue(entry.platform || this.typeOf(entry.coverArt));

            if (gameFilter && gameValue !== gameFilter) return false;
            if (platformFilter && platformValue !== platformFilter) return false;
            return true;
        });
    }

    makeIndexPayload(tracks, errorMessage = '') {
        return {
            selectedIndex: tracks.length > 0 ? 0 : -1,
            tracks,
            error: errorMessage,
        };
    }

    makeGamesPayload(entries, errorMessage = '') {
        return {
            selectedIndex: entries.length > 0 ? 0 : -1,
            games: entries,
            error: errorMessage,
        };
    }

    normalizeFilterValue(value) {
        if (typeof value !== 'string') return '';
        return value.trim().toLowerCase();
    }

    typeOf(file) {
        const ext = this.extOf(file);
        if (this.extensions.vgm.includes(ext)) return 'vgm';
        if (this.extensions.n64.includes(ext)) return 'n64';
        if (this.extensions.nez.includes(ext)) return 'nez';
        if (this.extensions.snes.includes(ext)) return 'snes';
        if (this.extensions.psx.includes(ext)) return 'psx';
        return null;
    }

    extOf(file) {
        if (typeof file !== 'string' || file.length === 0) return '';
        return file.slice(file.lastIndexOf('.') + 1).toLowerCase();
    }

    normalizeArtist(artist) {
        if (typeof artist === 'string') {
            return artist.trim();
        }
        if (Array.isArray(artist)) {
            return artist
                .filter((value) => typeof value === 'string')
                .map((value) => value.trim())
                .filter(Boolean)
                .join(', ');
        }
        return '';
    }

    resolveFileField(record, fieldName) {
        const value = record && typeof record[fieldName] === 'string' ? record[fieldName].trim() : '';
        if (!value) return '';
        if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) {
            return value;
        }

        return this.pb.files.getURL(record, value);
    }

    resolveFilename(record, fieldName) {
        const value = record && typeof record[fieldName] === 'string' ? record[fieldName].trim() : '';
        if (!value) return '';
        if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) {
            return value;
        }

        const url = window.location.protocol + '//' + window.location.host + '/api/files/games/' + encodeURIComponent(record.gameId) + '/' + encodeURIComponent(value);
        return url;
    }
}