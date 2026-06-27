'use strict';

import PocketBase from 'pocketbase';

const TRACKS_COLLECTION = 'tracks_view';
const GAMES_COLLECTION = 'games';
const PLAYLISTS_COLLECTION = 'playlists';
const PLAYLIST_TRACKS_VIEW_COLLECTION = 'playlist_tracks_view';
const PLAYLIST_TRACKS_COLLECTION = 'playlist_tracks';
const ARTISTS_VIEW_COLLECTION = 'artists_view';

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

        this.artists = [];
        this.artistsLoadError = '';
        this.artistsLoadPromise = null;

        this.indexLoadErrorMessage = 'Error loading tracks collection (see console)';
        this.gamesLoadErrorMessage = 'Error loading games collection (see console)';
        this.artistsLoadErrorMessage = 'Error loading artists collection (see console)';
        this.playlistsLoadErrorMessage = 'Error loading playlists collection (see console)';
        this.playlistLoadErrorMessage = 'Error loading playlist (see console)';
        this.playlistNotFoundMessage = 'Playlist not found';
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

    async createPlaylist(title) {
        if (!this.pb.authStore.isValid) {
            throw new Error('User is not authenticated');
        }
        const userId = this.pb.authStore.record.id;
        const resolvedTitle = (typeof title === 'string' && title.trim())
            ? title.trim()
            : 'New Playlist';
        const record = await this.pb.collection(PLAYLISTS_COLLECTION).create({
            title: resolvedTitle,
            type: 'private',
            user: userId,
        });
        return this.parsePlaylistsManifest([record])[0];
    }

    async updatePlaylist(id, updates) {
        if (typeof id !== 'string' || !id.trim()) {
            throw new Error('Missing playlist id');
        }
        if (!this.pb.authStore.isValid) {
            throw new Error('User is not authenticated');
        }
        if (!updates || typeof updates !== 'object') {
            throw new Error('Missing playlist updates');
        }

        const payload = {};
        if (Object.prototype.hasOwnProperty.call(updates, 'title')) {
            if (typeof updates.title !== 'string') {
                throw new Error('Invalid playlist title');
            }
            const trimmedTitle = updates.title.trim();
            if (!trimmedTitle) {
                throw new Error('Title cannot be empty');
            }
            if (trimmedTitle === '__fav__') {
                throw new Error('Title is reserved');
            }
            payload.title = trimmedTitle;
        }

        if (!Object.keys(payload).length) {
            throw new Error('No supported playlist updates provided');
        }

        try {
            const record = await this.pb.collection(PLAYLISTS_COLLECTION).update(id.trim(), payload);
            return this.parsePlaylistsManifest([record])[0];
        } catch (error) {
            console.error('Failed to update playlist', id, error);
            const isNotFound = error && (error.status === 404 || error.code === 404);
            const message = isNotFound ? 'Playlist not found' : 'Failed to update playlist';
            throw new Error(message);
        }
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

    async addTrackToPlaylist(trackId, playlistId) {
        if (typeof trackId !== 'string' || !trackId.trim()) {
            throw new Error('Missing track id');
        }
        if (typeof playlistId !== 'string' || !playlistId.trim()) {
            throw new Error('Missing playlist id');
        }
        if (!this.pb.authStore.isValid) {
            throw new Error('User is not authenticated');
        }

        try {
            return await this.pb.collection(PLAYLIST_TRACKS_COLLECTION).create({
                track: trackId.trim(),
                playlist: playlistId.trim(),
            });
        } catch (error) {
            console.error('Failed to add track to playlist', trackId, playlistId, error);
            throw new Error('Failed to add track to playlist');
        }
    }

    async removeTrackFromPlaylist(trackId, playlistId) {
        if (typeof trackId !== 'string' || !trackId.trim()) {
            throw new Error('Missing track id');
        }
        if (typeof playlistId !== 'string' || !playlistId.trim()) {
            throw new Error('Missing playlist id');
        }
        if (!this.pb.authStore.isValid) {
            throw new Error('User is not authenticated');
        }

        try {
            const filter = `track="${trackId.trim()}" && playlist="${playlistId.trim()}"`;
            const records = await this.pb.collection(PLAYLIST_TRACKS_COLLECTION).getFullList({ filter });
            for (const record of records) {
                if (record && typeof record.id === 'string') {
                    await this.pb.collection(PLAYLIST_TRACKS_COLLECTION).delete(record.id);
                }
            }
        } catch (error) {
            console.error('Failed to remove track from playlist', trackId, playlistId, error);
            throw new Error('Failed to remove track from playlist');
        }
    }

    async queryPlaylistsForTrack(trackId) {
        if (typeof trackId !== 'string' || !trackId.trim()) {
            throw new Error('Missing track id');
        }
        if (!this.pb.authStore.isValid) {
            throw new Error('User is not authenticated');
        }

        const userId = this.pb.authStore.record.id;
        const trimmedTrackId = trackId.trim();

        try {
            const filter = `track="${trimmedTrackId}" && playlist.user.id="${userId}"`;
            const records = await this.pb.collection(PLAYLIST_TRACKS_COLLECTION).getFullList({ filter });
            const playlistIds = records
                .map((record) => record && typeof record.playlist === 'string' ? record.playlist : '')
                .filter((id) => typeof id === 'string' && id.trim());
            return Array.from(new Set(playlistIds));
        } catch (error) {
            console.error('Failed to load playlists for track', trimmedTrackId, error);
            throw new Error('Failed to load playlists for track');
        }
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

    async queryArtists(filters) {
        await this.ensureArtistsLoaded();
        const filteredArtists = this.filterArtists(this.artists, filters || {});
        return this.makeArtistsPayload(filteredArtists, this.artistsLoadError);
    }

    async queryPlaylists(filters) {
        const typeFilter = (typeof filters.type === 'string' && filters.type.trim())
            ? filters.type.trim().toLowerCase()
            : 'public';

        if (typeFilter === 'own') {
            if (!this.pb.authStore.isValid) {
                throw new Error('User is not authenticated');
            }
        }

        try {
            let filter;
            if (typeFilter === 'own') {
                const userId = this.pb.authStore.record.id;
                filter = `user="${userId}"`;
            } else {
                filter = `type="${typeFilter}"`;
            }
            const records = await this.pb.collection(PLAYLISTS_COLLECTION).getFullList({ filter });
            const playlists = this.parsePlaylistsManifest(records);
            return this.makePlaylistsPayload(playlists);
        } catch (error) {
            console.error('Failed to load playlists', error);
            return this.makePlaylistsPayload([], this.playlistsLoadErrorMessage);
        }
    }

    async queryPlaylist(id) {
        if (typeof id !== 'string' || !id.trim()) {
            return this.makePlaylistPayload([], null, 'Missing playlist id');
        }
        const playlistId = id.trim();

        try {
            const record = await this.pb.collection(PLAYLISTS_COLLECTION).getOne(playlistId);
            const playlist = this.parsePlaylistsManifest([record])[0];
            if (!playlist || !playlist.id) {
                return this.makePlaylistPayload([], null, this.playlistNotFoundMessage);
            }
            const response = await this.pb.collection(PLAYLIST_TRACKS_VIEW_COLLECTION).getList(1, 1000, { filter: `playlistId="${playlistId}"` });
            const tracks = this.parseTracksManifest(response.items);
            return this.makePlaylistPayload(tracks, playlist, '');
        } catch (error) {
            console.error('Failed to load playlist', playlistId, error);
            const isNotFound = error && (error.status === 404 || error.code === 404);
            const message = isNotFound ? this.playlistNotFoundMessage : this.playlistLoadErrorMessage;
            return this.makePlaylistPayload([], null, message);
        }
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

    async ensureArtistsLoaded() {
        if (this.artistsLoadPromise) {
            return this.artistsLoadPromise;
        }

        this.artistsLoadPromise = this.loadArtists()
            .then((loadedArtists) => {
                this.artists = loadedArtists;
                this.artistsLoadError = '';
            })
            .catch((error) => {
                console.error('Failed to load artists', error);
                this.artists = [];
                this.artistsLoadError = this.artistsLoadErrorMessage;
            });

        return this.artistsLoadPromise;
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

    async loadArtists() {
        const records = await this.pb.collection(ARTISTS_VIEW_COLLECTION).getFullList();
        return this.parseArtistsManifest(records);
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
                coverArt: this.resolveFilename(entry, 'coverArt'),
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

    parseArtistsManifest(data) {
        const entries = Array.isArray(data) ? data : null;
        if (!entries) throw new Error('Invalid artists collection format');

        return entries
            .filter((entry) => entry && typeof entry.title === 'string')
            .map((entry) => ({
                id: typeof entry.id === 'string' ? entry.id : '',
                name: entry.title.trim(),
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

    filterArtists(entries, filters) {
        const artistFilter = this.normalizeFilterValue(filters && filters.artist);

        if (!artistFilter) {
            return entries;
        }

        return entries.filter((entry) => {
            const nameValue = this.normalizeFilterValue(entry.name);
            return nameValue.includes(artistFilter);
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

    makeArtistsPayload(entries, errorMessage = '') {
        return {
            artists: entries,
            error: errorMessage,
        };
    }

    makePlaylistsPayload(entries, errorMessage = '') {
        return {
            playlists: entries,
            error: errorMessage,
        };
    }

    makePlaylistPayload(tracks, playlist, errorMessage = '') {
        return {
            tracks: Array.isArray(tracks) ? tracks : [],
            playlist: playlist && typeof playlist === 'object' ? playlist : null,
            error: errorMessage,
        };
    }

    parsePlaylistsManifest(data) {
        const entries = Array.isArray(data) ? data : null;
        if (!entries) throw new Error('Invalid playlists collection format');

        return entries.map((entry) => ({
            id: typeof entry.id === 'string' ? entry.id : '',
            title: typeof entry.title === 'string' ? entry.title.trim() : '',
            type: typeof entry.type === 'string' ? entry.type : '',
            userId: typeof entry.user === 'string' ? entry.user : '',
        }));
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