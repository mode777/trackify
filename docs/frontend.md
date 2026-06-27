# Frontend (Vite + iframes)

Reference for the web app under `web/` — the Vite build configuration,
the three iframe slots and their service ids, the per-frame module
breakdown, and the shell's responsibilities. The `postMessage`
broker contract has its own doc ([`docs/ui.md`](ui.md)); PocketBase
schema / auth details live in [`docs/database.md`](database.md).

## 1. Vite build setup

Vite is rooted at `web/` (`vite.config.mjs:4`); the production
output is `build/dist/`. Four HTML entry points are emitted
(`vite.config.mjs:15-22`):

- `index.html` → `build/dist/index.html` (shell)
- `collections.html` → `build/dist/collections.html` (games service)
- `playlist.html` → `build/dist/playlist.html` (playlist service)
- `player.html` → `build/dist/player.html` (player service)

### Notable config flags

| Setting             | Value                                  | Why                                                             |
| ------------------- | -------------------------------------- | --------------------------------------------------------------- |
| `server.port`       | `8137`                                 | Project-wide port — `npm run dev` and `npm run preview` both bind here. |
| `server.strictPort` | `true`                                 | Don't fall back to another port — fail loudly if 8137 is taken. |
| `publicDir`         | `build/web-public`                     | Picks up the CMake runtime + pure-JS backends copied by `npm run assets:prepare` (see [`docs/tools.md`](tools.md)). |
| `build.outDir`      | `build/dist`                           | Vite's final output (also the `Dockerfile` source).             |
| `build.emptyOutDir` | `!isWatchBuild`                        | Preserve existing outputs during `vite build --watch` for stable iteration. |
| `build.watch`       | `{}` only when `--watch` is passed     | Drives `npm run build:watch` / `npm run build:watch-js`.        |

The dev server binds `127.0.0.1` only (not `0.0.0.0`) — there is no
LAN-accessible dev server.

## 2. Iframe topology

The shell page (`web/index.html`) hosts two persistent iframe slots
and three services register with the shell through the broker:

```
┌─────────────────────────── shell (index.html) ─────────────────────────┐
│                                                                        │
│  ┌── <iframe id="playlistFrame" name="content-frame"> ──────────────┐   │
│  │  swapped via target="content-frame" links:                       │   │
│  │   • collections.html  (serviceId: 'games')                       │   │
│  │   • playlist.html     (serviceId: 'playlist')                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌── <iframe id="playerFrame"> ─────────────────────────────────────┐   │
│  │  loaded once, reused for the whole session:                      │   │
│  │   • player.html  (serviceId: 'player')                           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

Inter-frame communication is always via the shell; no frame talks to
another directly. The message contract lives in [`docs/ui.md`](ui.md).

## 3. Content frame (`#playlistFrame`)

The `<iframe name="content-frame">` slot is reused — only one of
`collections.html` or `playlist.html` is loaded at a time. The shell
swaps them by following `<a target="content-frame">` navigation
links, and the shell's `createIframeHistoryTracker` records the
back/forward history for the iframe slot.

Two services live here, each with its own `serviceId`:

### `'games'` — `web/collections.js`

Games / playlists / platforms / artists grids. Mounted from
`web/collections.html`. Queries the shell with `shell.queryGames`,
`shell.queryPlaylists`, `shell.queryArtists` (see [`docs/ui.md`](ui.md#6-topics-in-use)).
Publishes `playlist.selected` to hand a track list to the player.

### `'playlist'` — `web/playlist.js`

Per-game / per-playlist track list and the add-to-playlist popup.
Mounted from `web/playlist.html`. Queries the shell with
`shell.queryPlaylist`, `shell.queryPlaylists`, `shell.queryPlaylistsForTrack`,
and writes via `shell.addTrackToPlaylist` /
`shell.removeTrackFromPlaylist`. Publishes `playlist.liked` /
`playlist.unliked` events so the shell can sync favorites.

## 4. Player frame (`#playerFrame`)

Loaded once at startup (`web/player.html`) and reused for the whole
session — the shell never navigates it. Owns `ScriptNodePlayer` and
the lazy-loaded `backend_*.js` runtimes fetched from `/wasm/`.

### `web/player/` modules

Each module is small and single-purpose:

| File                       | Responsibility                                                       |
| -------------------------- | -------------------------------------------------------------------- |
| `dom.js`                   | Cached element lookups; one place to query the player DOM            |
| `player_host.js`           | Owns the `ScriptNodePlayer` instance and the `backend_*` runtime namespace |
| `backend_loader.js`        | Lazy-loads `/wasm/backend_<core>.js` and dedupes concurrent requests |
| `backend_catalog.js`       | Maps `platform` → backend type → script-src; consulted when a track is loaded |
| `transport.js`             | Playlist state machine: play/pause/next/prev/seek/shuffle; publishes `player.trackChanged` |
| `seek_ui.js`               | Seek bar binding + ~250 ms position polling                          |
| `now_playing_ui.js`        | Footer track info + play/pause button state; publishes `player.stateChanged` |
| `media_session_sync.js`    | `navigator.mediaSession` binding; publishes `player.mediaSessionSync` |
| `media_session_anchor.js`  | Silent audio shim — keeps OS media controls alive when the player is paused |
| `shuffle_ui.js`            | Shuffle toggle button binding                                        |
| `volume_ui.js`             | Volume slider binding                                                |

The transport / seek / shuffle / volume modules all subscribe to
`playlist.selected` and the `player.*` events from the shell; the
media-session modules publish back so the shell can keep its own
`navigator.mediaSession` in sync (see §5).

## 5. Shell responsibilities (`web/app.js`)

The shell is the broker host and the only side that talks to
PocketBase from the top level. Its concerns are:

- **PocketBase SDK construction** — single `PocketBase` instance
  shared across the shell's request handlers (`web/app.js:21`).
- **Google OAuth flow** — `authWithOAuth2({ provider: 'google' })`
  on click of the sign-in button (see [`docs/database.md`](database.md#142-runtime-oauth2-round-trip)).
- **Iframe history** — `createIframeHistoryTracker` keeps
  back/forward buttons for the `#playlistFrame` slot (the player
  frame is loaded once and never navigates).
- **Favorites playlist flow** — subscribes to `playlist.liked` /
  `playlist.unliked` and writes through `pb.collection(...)`; lazily
  provisions the per-user `type='favorites'` playlist if missing.
- **Shell-side `navigator.mediaSession`** — re-publishes the
  player's `player.mediaSessionSync` event so OS-level media keys
  (lock screen, headphones) keep working even when the player
  iframe is in a different frame tree.

The shell publishes `shell.user.login` / `shell.user.logout` events
when `authStore.isValid` flips; see [`docs/database.md`](database.md#143-shell--frames-auth-lifecycle-events).

## 6. Dev workflows

| Command                   | What it does                                                                  |
| ------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`             | Full chain: WASM rebuild + asset copy + Vite dev server on `127.0.0.1:8137`.   |
| `npm run dev-js`          | Skips the WASM rebuild — first-time-only-after-`npm run wasm`. Use when iterating on web code only. |
| `npm run build`           | WASM + assets + Vite production build → `build/dist/`.                         |
| `npm run build:watch`     | Production build in watch mode (regenerates dist on save).                      |
| `npm run build:watch-js`  | Watch mode that skips the WASM rebuild.                                        |
| `npm run preview`         | Serves `build/dist/` via Vite's preview server on the same port.               |
| `npm run verify:dist`     | Asserts the required runtime files exist under `build/dist/` (CI sanity check). |

WASM rebuild cost is meaningful (a few minutes cold), so prefer
`*-js` variants after the first successful `npm run wasm`. Per-tool
reference (purpose, env vars, exit codes) is in
[`docs/tools.md`](tools.md).

## 7. Adding a new page or service

When adding a new HTML entry point or a new iframe service:

1. Add the new `.html` under `web/` (it must live next to `index.html`
   for Vite to pick it up as an entry).
2. Add a `rollupOptions.input` entry in `vite.config.mjs:15-22` so
   Vite emits the hashed asset.
3. Register the service id in `web/app.js` — either as
   `shellBroker.handleRequest(...)` for shell-local requests, or
   `shellBroker.routeRequestTopic(...)` to forward to a frame, or
   `createFrameBroker({ serviceId: '...' })` inside the frame.
4. If the new service id is new, add it to
   `shellBroker`'s `allowedServices` array in `web/app.js:16` — the
   broker drops messages from unknown service ids.
5. Document any new broker topics in [`docs/ui.md`](ui.md#6-topics-in-use).
6. If the page renders content that depends on the WASM backends,
   make sure the corresponding `backend_*.js` is in the runtime set
   (see [`docs/audio-backends.md`](audio-backends.md)).

The CI verification step (`npm run verify:dist`) does **not**
check that the set of HTML entry points matches the rollup input
map — when adding a new page, run `npm run build` + `npm run verify:dist`
locally to make sure the new asset is in `build/dist/`.