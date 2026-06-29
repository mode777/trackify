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
| `build.sourcemap`   | `true` only when `--watch` is passed   | Emit source maps during watch builds to aid debugging.         |

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

The content-frame slot is reused — only one of `collections.html` or
`playlist.html` is loaded at a time. The shell owns the browser's
history; the iframe holds a single history entry and is driven
in-place via `frame.contentWindow.location.replace(...)`. See
[`docs/router.md` §6](router.md#6-iframe-navigation-sync--the-shell-only-history-model)
for the full model.

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

The same frame also hosts the **now-playing view** (route
`/now-playing` → `playlist.html#?now-playing`): it mirrors the
player's current queue by issuing `player.getCurrentPlaylist` on init
(see [`docs/ui.md`](ui.md#75-playergetcurrentplaylist-payload)) and
applies a dedicated hero state (eyebrow `PLAYER`, title `Now Playing`,
gold accent `#f7c948`, play icon in front of the hero background).
The hash parser routes the view in `evaluateFragmentParameters()`.

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
- **Iframe history** — the shell owns the browser's back/forward
  stack; the content iframe is driven in-place via
  `frame.contentWindow.location.replace(...)` so it never grows
  past a single history entry. See
  [`docs/router.md` §6](router.md#6-iframe-navigation-sync--the-shell-only-history-model).
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

## 7. Router and `data-router-link`

The shell runs a small in-house `Router` (`web/router.js`) that owns the
top-level URL (`window.location.pathname` + `window.location.search`).
Content frames never call `window.location.assign` or set
`window.location.hash` directly — every navigation in the app goes
through the router, including in-iframe clicks.

This section is the overview; the full reference (public API, pattern
syntax, event surface, iframe sync, and known pitfalls) lives in
[`docs/router.md`](router.md).

The shape of a request:

1. A click on `<a data-router-link href="/playlists/abc123">` (anywhere
   in the DOM — shell sidebar, content frame, anywhere) is intercepted
   by the frame-side `createNavClient({ broker })` helper
   (`web/nav_client.js`). The helper publishes
   `shell.navigation.requested` to the broker with the href.
2. The shell's `Router` resolves the URL against its registered route
   table. A route's `target` describes the iframe `src` it maps to
   (e.g. `/playlist.html` + `hash: '?type=playlist&id=<id>'`).
3. On match, the router `history.pushState`s the URL into the shell's
   history and emits `navigated`. The shell's `navigated` subscriber
   calls `applyRouteToContentFrame(to)`:
   - If the iframe is still at `about:blank` (first paint), sets
     `#playlistFrame.src = next` — the iframe loads normally and
     creates its single history entry.
   - Otherwise calls
     `frame.contentWindow.location.replace(nextHref)` — the iframe's
     history entry is replaced, no new entry is added. The shell URL
     remains the only anchor the browser back/forward stack cares
     about.
   - For same-document navigations (pathname unchanged, only
     `?…` differs), the `location.replace` updates the URL but
     fires neither `hashchange` nor `popstate`. The shell publishes
     `shell.content.rerender` to the iframe's service id so its
     existing handler re-runs `applyRoute()` /
     `evaluateFragmentParameters()` against the new URL.
4. The iframe's hash parser
   (`web/playlist/navigation.js`, `collections.js#applyRoute`)
   runs once on first load and again whenever the shell publishes
   `shell.content.rerender`.

The router emits three events: `navigationStart` (before
`pushState`), `navigated` (after, with the `RouteMatch`), and
`navigationError` (no match). Unmatched paths currently `console.error`
only — there is no fallback route in iteration 1.

### Route template syntax

- `/playlists` — static path.
- `/playlists/<id>` — bracket params; matched positionally and passed
  to `target.hash` substitutions (e.g. `hash: '?type=playlist&id=<id>'`).
- The query string is preserved on the match but not part of the pattern.

### Broker topic

| Topic                          | Direction | Payload                                                  |
| ------------------------------ | --------- | -------------------------------------------------------- |
| `shell.navigation.requested`   | frame → shell | `{ request: string \| NavigationToken; options?: { replace?, meta? } }` |
| `shell.content.rerender`       | shell → content | `{ href: string }` — see [`docs/ui.md` §7.4](ui.md#74-shellcontentrerender-payload) |

Where `NavigationToken` is `{ token: 'back' \| 'forward' \| 'go', delta? }`.
Documented in [`docs/ui.md`](ui.md) §6.

### Wiring at a glance

- Shell (`web/app.js`): construct the router, subscribe to
  `shell.navigation.requested`, set `#playlistFrame.src` from
  `navigated`, and call `navClient.bindLinks(document.querySelector('.sidebar'))`.
- Content frames (`web/playlist.js`, `web/collections.js`):
  `createNavClient({ broker }).bindLinks()` next to the broker
  setup.
- Sidebar links in `web/index.html` carry `data-router-link` and
  `data-route`. The `data-route` value is matched exactly against
  `RouteMatch.pattern` by `syncSidebarActiveState` to drive the
  `.active` class.

## 8. Adding a new page or service

### Adding a new shell-side route

1. Pick a path and a target. The target's `html` is the iframe
   `src` (e.g. `/playlist.html`); the optional `hash` is appended as
   `html + '#' + hash` and supports `<param>` substitution. Full pattern
   syntax is in [`docs/router.md` §3](router.md#3-pattern-syntax).
2. Register the route in `web/app.js#registerRoutes()`:
   ```js
   router.register('/playlists/<id>', {
       target: { html: '/playlist.html', hash: '?type=playlist&id=<id>' },
   });
   ```
3. Add a sidebar link (or any link) with
   `href="/playlists/<id>" data-router-link data-route="/playlists/<id>"`.
4. Add a row for the iframe hash to the frame's internal hash
   parser (`web/playlist/navigation.js` or
   `collections.js#applyRoute`) if it is not already covered.
5. The frame's existing `CONTENT_RERENDER_TOPIC` subscriber picks the
   new route up automatically — no additional router-side wiring is
   needed (see [`docs/router.md` §6](router.md#6-iframe-navigation-sync--the-shell-only-history-model)).

### Adding a new iframe service

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