# PocketBase database

Detailed reference for the PocketBase schema and rules that back the
catalog, favorites, and playlists features. The high-level overview
(collection roles, view purposes, how the web client connects) lives in
the top-level [`README.md`](../README.md); this document covers the
current state of every collection, its fields and constraints, the API
rules in effect, and the relations between them.

Source of truth: the timestamped JS migrations in [`pb_migrations/`](../pb_migrations/),
applied in filename order by PocketBase on startup. The descriptions
below describe the **post-migration** state — the schema as it exists
once every migration has run, including collections that were created
and later deleted.

## 1. Collection summary

| Collection             | Kind       | Collection id         | Notes                                                 |
| ---------------------- | ---------- | --------------------- | ----------------------------------------------------- |
| `users`                | auth       | `_pb_users_auth_`     | PocketBase built-in; OAuth2 (Google) enabled          |
| `games`                | base       | `pbc_879072730`       | Game metadata + cover art + bundled track files       |
| `tracks`               | base       | `pbc_327047008`       | Individual track records + audio file                 |
| `playlists`            | base       | `pbc_2546747700`      | User-owned playlists (incl. auto `favorites`)         |
| `playlist_tracks`      | base       | `pbc_2773994383`      | Join rows linking `tracks` ↔ `playlists`              |
| `tracks_view`          | view       | `pbc_798425803`       | Tracks flattened with game cover-art / metadata       |
| `playlist_tracks_view` | view       | `pbc_3914548316`      | Playlist rows flattened with track + game metadata    |
| `artists_view`         | view       | `pbc_1402384472`      | Distinct artist names expanded from `tracks.artist[]` |

Deleted collections (kept here so migration history is greppable):

- `favorites` (base, `pbc_2151843437`) — deleted by
  `1781631221_deleted_favorites.js`. Replaced by `playlists` with
  `type = "favorites"`; the favorites flow now writes to
  `playlist_tracks`.
- `favorites_view` (view, `pbc_3634167119`) — deleted by
  `1781631203_deleted_favorites_view.js`. The UI now reads favorites
  via `playlist_tracks_view`.

The migrations also define an initial collection `id` of
`games_view` that was renamed to `tracks_view` — the id stayed
`pbc_798425803` across the rename.

## 2. Relations

```
users ─┬─< playlists ─< playlist_tracks >─ tracks >── games
       │                                  │
       │                                  └─ file        (audio)
       │                                  └─ gameId ──────┘
       │                                                    │
       └─< (favorites: playlists.type='favorites' per user)
                                                            │
                              games.coverArt  ◀─────────────┘
                              games.files[]   (raw bundle)
```

- `tracks.gameId` → `games.id` (`cascadeDelete: true`). Deleting a
  game removes all of its tracks.
- `playlists.user` → `users.id` (`cascadeDelete: true`). Deleting a
  user removes their playlists (and, through `playlist_tracks`, their
  favorites).
- `playlist_tracks.track` → `tracks.id` (`cascadeDelete: true`).
- `playlist_tracks.playlist` → `playlists.id` (`cascadeDelete: true`).

## 3. `users` (auth collection, `_pb_users_auth_`)

PocketBase built-in. The only Trackify migration that touches it is
`1781460111_updated_users.js`, which enables OAuth2 (Google).

OAuth client configuration (id / secret) lives in the PocketBase admin
UI — not in the repository.

The web client uses
`pb.collection('users').authWithOAuth2({ provider: 'google' })` to
sign in (see `web/app.js`); successful auth populates `pb.authStore`.

## 4. `games` (base, `pbc_879072730`)

Game metadata, cover art, and the optional raw `files[]` bundle.

| Field      | Type / shape                          | Notes                                                            |
| ---------- | ------------------------------------- | ---------------------------------------------------------------- |
| `id`       | text, primary key, system             | `autogeneratePattern: ""`, `min: 4`, `max: 64`, `pattern: .+$`   |
| `title`    | text                                  | Display name                                                     |
| `platform` | select                                | `psx` / `snes` / `megadrive` / `n64` / `assorted` / `ps2`        |
| `year`     | text                                  | Free-form (e.g. `"1997"`)                                        |
| `company`  | json                                  | Array of developer/publisher names                               |
| `coverArt` | file, `maxSelect: 1`                  | Single image                                                     |
| `files`    | file, `maxSelect: 500`, `maxSize: 500 MB` | Optional bundled archive of track files for that game         |
| `created`  | autodate (`onCreate`)                 |                                                                  |
| `updated`  | autodate (`onCreate` + `onUpdate`)     |                                                                  |

### Rules

```
listRule:  ""           // public read
viewRule:  ""           // public read
createRule: null        // superuser only (PocketBase default for null)
updateRule: null
deleteRule: null
```

Empty-string rules are PocketBase's "anyone may perform this action"
sentinel. Public reads are intentional — the catalog UI shows games
and tracks to anonymous visitors.

## 5. `tracks` (base, `pbc_327047008`)

Individual track records. Each track points at a single audio file
plus a relation back to its game.

| Field      | Type / shape                                | Notes                                          |
| ---------- | ------------------------------------------- | ---------------------------------------------- |
| `id`       | text, primary key, system                   | `min: 4`, `max: 256`, `pattern: .+$`           |
| `title`    | text                                        | Track title                                    |
| `filename` | text                                        | Original filename as known to the player      |
| `length`   | number                                      | Length in seconds                              |
| `file`     | file, `maxSize: 52,428,800` (50 MB), no mime restriction | The audio file                       |
| `gameId`   | relation → `games`, `cascadeDelete: true`   | Set to `null` if the track is orphaned        |
| `artist`   | json array                                  | Extracted artist / composer names              |
| `metadata` | json                                        | Raw core-emitted tag dump (legacy / optional)  |
| `created`  | autodate (`onCreate`)                       |                                                |
| `updated`  | autodate (`onCreate` + `onUpdate`)          |                                                |

### Rules

```
listRule:  ""           // public read
viewRule:  ""           // public read
createRule: null
updateRule: null
deleteRule: null
```

Tracks are publicly readable. Writes are superuser-only; the
`pb_hooks/keep_names.pb.js` hook rewrites `originalName` → `name` on
the parent `games` `files[]` and `coverArt` so the on-disk filename
matches what the browser uploaded.

## 6. `playlists` (base, `pbc_2546747700`)

User-owned playlists. One record per playlist. The favorites flow uses
this collection with `type = "favorites"` — there is no separate
`favorites` collection (the legacy one was deleted; see §1).

| Field         | Type / shape                                 | Notes                                            |
| ------------- | -------------------------------------------- | ------------------------------------------------ |
| `id`          | text, primary key, system                    |                                                  |
| `title`       | text                                         |                                                  |
| `type`        | select                                       | `private` / `public` / `favorites`              |
| `user`        | relation → `users`, `cascadeDelete: true`, required | Owner                                       |
| `description` | text                                         | Optional long-form description                   |
| `color`       | text                                         | Optional UI accent color (i.e. CSS color string) |
| `icon`        | text                                         | Optional UI icon identifier (i.e. a Material icon identifier)                     |
| `created`     | autodate (`onCreate`)                        |                                                  |
| `updated`     | autodate (`onCreate` + `onUpdate`)           |                                                  |

Indexes:

```
CREATE INDEX `idx_hvzxpwzelz` ON `playlists` (`user`);
```

### Rules

```
createRule: @request.auth.id != '' && @request.auth.id = user.id
deleteRule: @request.auth.id != '' && @request.auth.id = user.id
listRule:   type = 'public' || (@request.auth.id != '' && @request.auth.id = user.id)
updateRule: @request.auth.id != '' && @request.auth.id = user.id
viewRule:   type = 'public' || (@request.auth.id != '' && @request.auth.id = user.id)
```

Semantics:

- The owner can CRUD their own playlists.
- Public playlists are listable / viewable by anyone (including
  unauthenticated visitors).
- The favorites playlist of every user is stored as a `playlists` row
  with `type = "favorites"` and the same rules — other users cannot
  read it.

## 7. `playlist_tracks` (base, `pbc_2773994383`)

Join rows. One row per (track, playlist) pair.

| Field      | Type / shape                                | Notes                                |
| ---------- | ------------------------------------------- | ------------------------------------ |
| `id`       | text, primary key, system                   |                                      |
| `track`    | relation → `tracks`, `cascadeDelete: true`, required |                          |
| `playlist` | relation → `playlists`, `cascadeDelete: true`, required |                        |
| `created`  | autodate (`onCreate`)                       |                                      |
| `updated`  | autodate (`onCreate` + `onUpdate`)          |                                      |

Indexes:

```
CREATE INDEX `idx_9fqlznd1sz` ON `playlist_tracks` (`playlist`);
CREATE UNIQUE INDEX `idx_9gnrmz065w` ON `playlist_tracks` (`track`, `playlist`);
```

The unique index prevents adding the same track twice to a single
playlist.

### Rules

```
createRule: @request.auth.id != '' && playlist.user.id = @request.auth.id
deleteRule: @request.auth.id != '' && playlist.user.id = @request.auth.id
updateRule: @request.auth.id != '' && playlist.user.id = @request.auth.id
listRule:   playlist.type = 'public' || (playlist.user.id = @request.auth.id)
viewRule:   playlist.type = 'public' || (playlist.user.id = @request.auth.id)
```

Semantics:

- Adding / removing a track from a playlist requires being the
  playlist's owner (`playlist.user.id`).
- Listing and viewing rows follows the parent playlist's visibility:
  public playlists are readable by anyone; private/favorites
  playlists are readable only by the owner.
- Anonymous users can list public playlist rows but cannot write.

## 8. `tracks_view` (view, `pbc_798425803`)

Read-only flattened projection of `tracks LEFT JOIN games`. This is the
collection the web app's `ShellCatalogService` actually queries
(`web/catalog_service.js`).

View query:

```sql
SELECT tracks.id, tracks.title, games.coverArt,
       games.title as game, tracks.gameId, games.year,
       tracks.filename, tracks.length, games.platform,
       games.company, tracks.artist
FROM tracks
LEFT JOIN games ON tracks.gameId = games.id
ORDER BY tracks.id
```

Projected fields:

| Field      | Type             | Source                                |
| ---------- | ---------------- | ------------------------------------- |
| `id`       | text (PK)        | `tracks.id`                           |
| `title`    | text             | `tracks.title`                        |
| `coverArt` | file             | `games.coverArt`                      |
| `game`     | text             | `games.title` (aliased)               |
| `gameId`   | relation → games | `tracks.gameId` (`cascadeDelete: true`) |
| `year`     | text             | `games.year`                          |
| `filename` | text             | `tracks.filename`                     |
| `length`   | number           | `tracks.length`                       |
| `platform` | select           | `games.platform`                      |
| `company`  | json             | `games.company`                       |
| `artist`   | json             | `tracks.artist`                       |

### Rules

```
listRule:  ""           // public read
viewRule:  ""           // public read
createRule: null        // views are read-only
updateRule: null
deleteRule: null
```

## 9. `playlist_tracks_view` (view, `pbc_3914548316`)

Read-only flattened projection of `playlist_tracks` joined to the
playlist, the user, the track, and the track's game. Powers the
favorites and "public playlist detail" flows in the UI.

View query:

```sql
SELECT playlist_tracks.id   AS playlistTrackId,
       playlists.id         AS playlistId,
       users.id             AS userId,
       playlists.type,
       tracks.id,
       tracks.title,
       games.coverArt,
       games.title          AS game,
       tracks.gameId,
       games.year,
       tracks.filename,
       tracks.length,
       games.platform,
       games.company,
       tracks.artist
FROM playlist_tracks
LEFT JOIN playlists ON playlist_tracks.playlist = playlists.id
LEFT JOIN users     ON users.id        = playlists.user
LEFT JOIN tracks    ON playlist_tracks.track   = tracks.id
LEFT JOIN games     ON tracks.gameId   = games.id
```

Projected fields mirror the `SELECT` list (`playlistTrackId`,
`playlistId`, `userId`, `type`, `id`, `title`, `coverArt`, `game`,
`gameId`, `year`, `filename`, `length`, `platform`, `company`,
`artist`).

### Rules

```
listRule:    type = 'public' || (@request.auth.id = userId)
viewRule:    null
createRule:  null
updateRule:  null
deleteRule:  null
```

Semantics: rows for public playlists are listable by anyone; rows for
private / favorites playlists are listable only by the owner. The
client performs row-level deletes through `playlist_tracks` (write
path) — this view is read-only.

## 10. `artists_view` (view, `pbc_1402384472`)

Read-only distinct list of artist / composer names, expanded out of
`tracks.artist` (a JSON array). Useful for an "all artists" facet
without scanning the full tracks table on every page load.

View query:

```sql
SELECT
    (ROW_NUMBER() OVER (ORDER BY ua.title)) AS id,
    ua.title                                AS title
FROM (
    SELECT DISTINCT
        j.value AS title
    FROM tracks t
    JOIN json_each(t.artist) j
    WHERE json_valid(t.artist)
      AND j.type = 'text'
) ua
ORDER BY ua.title
```

The `id` column is a synthetic ROW_NUMBER — it is not stable across
inserts / deletes. Clients should key off `title` (which is also a
JSON scalar wrapping a single text value, with `maxSize: 1`).

### Rules

```
listRule:  ""           // public read
viewRule:  ""           // public read
createRule: null
updateRule: null
deleteRule: null
```

## 11. Hooks

[`pb_hooks/keep_names.pb.js`](../pb_hooks/keep_names.pb.js) registers
two hooks on the `games` collection:

- `onRecordCreate` — for every file in `files[]` (and the single
  `coverArt`), if PocketBase renamed the file on upload, restore the
  original filename by writing `file.name = file.originalName`.
- `onRecordUpdate` — same logic on update, but only if the current
  `name` already differs from `originalName`.

Net effect: the filename served by PocketBase's `/api/files/...`
endpoint matches what the user uploaded, which keeps the player
runtime's `SimpleFileMapper` happy (see [`docs/audio-backends.md`](audio-backends.md#per-core-quirks)
for the PSF / USF sidecar cases).

## 12. Working with the schema

### Adding a new collection

1. Edit the schema through the PocketBase admin UI at
   `http://127.0.0.1:8090/_/` (default for `npm run pocketbase:serve`).
2. PocketBase writes a new timestamped `*.js` migration into
   `pb_migrations/` automatically.
3. If the new collection is read by the web UI, mirror its `id`
   (PocketBase's collection-id string) into any new view definitions
   or rule expressions.
4. If the new collection stores runtime files referenced by the audio
   backends (cover art, `.psflib` / `.usflib` sidecars, etc.), confirm
   the `keep_names.pb.js` hook covers the new field, or extend it.

### Adding a field to an existing collection

Same flow as above — edit via the admin UI; PocketBase emits a
migration. The hooks file does **not** need to be touched unless the
new field is also a file field whose `name` should match `originalName`.

### Changing API rules

The admin UI's "API Rules" tab writes a `*_updated_<collection>.js`
migration. After any rule change:

- Run `npm run pocketbase:serve` and re-test both authenticated and
  anonymous flows for the affected collection.
- Update this document so the rule tables in §4–§10 stay in sync.
- The CLI tooling in `tools/*.mjs` does **not** consume the rules —
  the rules only apply to the PocketBase HTTP / JS SDK surface.

### Resetting local data

`pb_data/` is gitignored. To rebuild from scratch:

```bash
rm -rf pb_data
npm run pocketbase:serve   # PocketBase auto-runs every migration in pb_migrations/
```

The migrations are pure JS that PocketBase replays idempotently. They
are safe to leave in place across resets; do not delete them.

### Migrating between releases

When deploying a new Trackify release that ships new migrations:

1. The Docker image copies `pb_migrations/` → `/pocketbase/migrations/`
   (see [`Dockerfile`](../Dockerfile)).
2. PocketBase applies only the migrations it has not yet recorded in
   `pb_data/.pb_migrations`.
3. To apply migrations manually during local development, restart
   `npm run pocketbase:serve`. The startup log lists every applied
   migration filename.

## 13. JavaScript API

There are two distinct JavaScript surfaces in this project — make sure
you know which one a snippet is targeting before copy-pasting it:

- **Browser / Node SDK** (`pocketbase` npm package — used by
  [`web/catalog_service.js`](../web/catalog_service.js),
  [`web/app.js`](../web/app.js), etc.). Talks to the PocketBase HTTP
  API. Subject to the collection API rules in §4–§10.
- **Server-side hooks / migrations / routes** (`*.pb.js` files in
  [`pb_hooks/`](../pb_hooks/) and [`pb_migrations/`](../pb_migrations/)).
  Runs inside PocketBase's embedded [goja](https://github.com/dop251/goja)
  ES engine with `$app`, `$dbx`, `$filesystem`, `$apis`, etc. on the
  global scope. Not subject to API rules (full admin access); can read
  and write any collection directly.

The rest of this section is the browser/Node SDK view, with patterns
mirrored from `web/catalog_service.js`.

### 13.1 Constructing the client

`web/catalog_service.js:22` instantiates the SDK with the default base
URL (`window.location.origin`) and the default `LocalAuthStore`:

```js
import PocketBase from 'pocketbase';
this.pb = new PocketBase();
```

`pb.authStore` is automatically populated from `localStorage` on page
load and synced across tabs. The OAuth2 flow in
`web/app.js#authWithOAuth2({ provider: 'google' })` calls
`pb.collection('users').authWithOAuth2(...)`, which writes the new
token + record into `authStore`. From that point on, every SDK call
sends `Authorization: <jwt>`.

To detect whether the SDK is authenticated, read
`pb.authStore.isValid` and pull the user id off
`pb.authStore.record.id` — that is what
`web/catalog_service.js:50` and `web/catalog_service.js:149` do for the
favorites flow.

### 13.2 The RecordService

Every read/write call in the catalog goes through
`pb.collection('<name>')`, which returns a
[`RecordService`](https://github.com/pocketbase/js-sdk#recordservice).
Below are the methods the codebase actually uses, with the exact line
in `web/catalog_service.js` that calls each one:

| Method                                            | Where it's used                                                                | Notes                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `getList(page, perPage, options)`                 | `loadTracks` (L356), `loadTracksForGame` (L361), `queryFavorites` (L55)       | Paginated. Returns `{ items, page, perPage, ... }`.  |
| `getFullList(options)`                            | `loadGames` (L366), `loadArtists` (L371), `removeTrackFromPlaylist` (L204), `queryPlaylistsForTrack` (L229), `queryPlaylists` (L281) | Batches internally (1000/batch by default; pass `batch` to change). Returns a flat array. |
| `getOne(recordId, options)`                       | `queryPlaylist` (L297)                                                         | Throws on missing id — catch and check `error.status === 404` (L307). |
| `create(bodyParams, options)`                     | `addFavorite` (L63), `getOrCreateFavoritesPlaylist` (L159), `createPlaylist` (L96), `addTrackToPlaylist` (L181) | Body shape: keys are collection field names; relation fields take the related record id (a string), file fields take `File` / `Blob` / `FormData`. |
| `update(recordId, bodyParams, options)`           | `updatePlaylist` (L135)                                                        | Send only the fields you want to change. PocketBase rejects unknown fields. |
| `delete(recordId, options)`                       | `removeFavorite` (L84), `removeTrackFromPlaylist` (L207)                       | Cascades are honoured — see §2.                      |

`options` accepts at least:

- `filter` — PocketBase filter expression string (see §13.3).
- `sort` — e.g. `'-created'` or `'title'` (`loadTracks` uses
  `{ sort: 'title' }` at L356).
- `expand` — comma-separated relation names to inline as
  `expandedOne(...)` / `expandedAll(...)`.
- `fields` — comma-separated field whitelist (omits the rest).
- `requestKey` / `headers` / `fetch` — see §13.6 and §13.7.

### 13.3 Filter syntax

`web/catalog_service.js` writes filters inline as template strings:

```js
filter: `gameId="${gameId}"`                                       // L361
filter: `playlistId="${playlist.id}"`                              // L55, L302
filter: `user="${userId}" && type="favorites"`                     // L153
filter: `type="${typeFilter}"`                                     // L279
filter: `track="${trackId}" && playlist="${playlistId}"`           // L203
filter: `track="${trackId}" && playlist.user.id="${userId}"`      // L228
```

Conventions to mirror:

- **Quote string values with double quotes.** PocketBase treats them
  equivalently to single quotes, but the codebase uses double quotes
  consistently, and the filter compiler accepts both.
- **Traverse relations with dot notation** —
  `playlist.user.id` resolves through the `playlist` relation to the
  linked `playlists` row and then to its `user` relation (L228).
- **Use `&&` for AND**, `||` for OR, `=` for equality.
- **Bind user input with `pb.filter()`** — for any filter constructed
  from untrusted input, prefer:

  ```js
  filter: pb.filter('title ~ {:title}', { title: userInput })
  ```

  The placeholder syntax escapes string values for you and is the
  SDK-recommended defense against filter-string injection. None of the
  current call sites take raw user input, so the inline-template
  pattern is fine — flag this if you add a new query path that does.

### 13.4 Files and file URLs

`tracks` and `games` expose `file` / `files[]` / `coverArt`. PocketBase
returns those fields as the **stored filename** (a plain string), not
as a full URL. The SDK has a helper for the common case:

```js
pb.files.getURL(record, filename)   // → absolute URL on the PocketBase origin
```

`web/catalog_service.js:544` uses this for game cover art, but it
hand-rolls the URL for `tracks_view.filename` (the audio file) at
L554, because the `tracks_view` projection puts the audio file under
the parent `games` collection, not the `tracks` one. The shape is:

```
/api/files/<collection-id-or-name>/<record-id>/<stored-filename>
```

so the audio URL ends up as
`/api/files/games/<gameId>/<filename>` with both segments URI-encoded.
The same `/api/files/...` path serves everything; the PocketBase
`keep_names.pb.js` hook (§11) ensures the stored filename matches what
the browser uploaded, which is what `SimpleFileMapper` in the player
runtime relies on for `.psflib` / `.usflib` sidecar resolution.

### 13.5 Error handling

All SDK calls return a `Promise`. Rejections are normalized into a
`ClientResponseError`:

```ts
{
  url:           string,
  status:        number,    // HTTP status code
  response:      { ... },   // PocketBase's JSON error body
  isAbort:       boolean,
  originalError: Error|null,
}
```

The codebase distinguishes the 404 case explicitly — see
`web/catalog_service.js:139` and `web/catalog_service.js:307`, which
both check `error.status === 404 || error.code === 404` to flip the
user-facing message to "Playlist not found". Always guard `getOne` /
`update` paths this way; `getList` / `getFullList` resolve to `[]` on
no-match and do not throw.

Other codes worth handling:

- `401` — token expired / not authenticated. The SDK will not refresh
  on its own in this version; clear the store and re-auth
  (`pb.authStore.clear()`).
- `403` — the collection rule rejected the call (§4–§10).
- `400` — validation failed; `error.response.data` has the field-level
  errors.

### 13.6 Auto-cancellation

The SDK de-duplicates in-flight requests that share the same
`HTTP_METHOD + path` request key. Concretely, the catalog service
guards against this for long-running loads by caching the promise:

```js
async ensureGamesLoaded() {                            // L317
    if (this.gamesLoadPromise) return this.gamesLoadPromise;
    this.gamesLoadPromise = this.loadGames()...
    return this.gamesLoadPromise;
}
```

If your new code fires many identical reads in quick succession and
expects all of them to land (e.g. parallel
`loadTracks(filters)`s in different frames), pass a unique
`requestKey` to opt out, or call `pb.autoCancellation(false)` for the
duration of the run.

### 13.7 Sending custom headers / fetch options

Every service method takes an optional final `options` argument.
Trackify does not currently use it, but the typical patterns are:

```js
pb.collection('tracks').getList(1, 100, {
    headers: { 'X-Custom': 'value' },
    fetch:   (url, config) => myCustomFetch(url, config),
});
```

For global request/response hooks, set `pb.beforeSend` /
`pb.afterSend` once at app boot.

### 13.8 Pagination vs `getFullList`

- **`getList(page, perPage)`** — use when the UI paginates or when
  the data set is large. `loadTracks` and `loadTracksForGame` use
  it with `perPage: 100` and `1000` respectively (L356, L361). Watch
  the upper bound — PocketBase defaults `perPage` to 30 and rejects
  values above the configured `maxPerPage` (default 500).
- **`getFullList({ batch })`** — use when the consumer needs every
  row up front (the games grid, the artists facet, the playlists
  sidebar). It walks the pagination internally; pass `batch` if your
  collection allows more than 1000 rows.

### 13.9 Realtime

Not currently used. The SDK supports
`pb.collection(name).subscribe(topic, cb)` for SSE-based record change
notifications — useful if you want the games grid to update without
re-fetching when an admin edits a row through the dashboard.

### 13.10 Server-side JS (`pb_hooks/`, `pb_migrations/`)

For completeness — code in `pb_hooks/*.pb.js` runs inside PocketBase
and does not use the SDK. The relevant differences:

- Globals: `$app`, `$dbx`, `$apis`, `$os`, `$security`, `__hooks`.
- `record.get('field')` / `record.set('field', value)` instead of
  `.field` access.
- `record.expandedOne('relation')` / `record.expandedAll('rel[]')`
  after calling `$app.expandRecord(record, [...], null)`.
- API rules are not enforced. `record.set(...)` + `$app.save(record)`
  bypasses the rules entirely.
- Handlers are isolated per-file and **serialized**: `const x = 1`
  declared at the top of a `*.pb.js` file is **not** visible inside an
  `onRecordCreate(...)` handler. Share helpers via `require()`'d
  CommonJS modules.

The existing `pb_hooks/keep_names.pb.js` is the canonical example —
see §11 for what it does. The PocketBase docs cover the rest:
[JS Event hooks](https://pocketbase.io/docs/js-event-hooks),
[JS Record operations](https://pocketbase.io/docs/js-records),
[JS Database / `$dbx`](https://pocketbase.io/docs/js-database).

### 13.11 TypeScript hints

The browser code is plain JS. To add typing to a new file, declare a
`TypedPocketBase` interface that overloads `collection(...)` per name
— see the [`pocketbase/js-sdk`](https://github.com/pocketbase/js-sdk#specify-typescript-definitions)
README. PocketBase itself ships its own types at
`pb_data/types.d.ts` for the server-side hooks; reference them via
`/// <reference path="../pb_data/types.d.ts" />` as every migration
already does.

## 14. Client auth lifecycle

The web client authenticates with PocketBase through a two-phase
flow — a **build-time token** that pre-seeds `authStore`, and a
**runtime OAuth2 round-trip** that replaces it with a user-bound
session. The JS API surface used by both phases is covered in §13.1;
this section covers how the browser gets there.

### 14.1 Build-time seeding via `TRACKIFY_PB_TOKEN`

A PocketBase auth JWT in the project's `.env` as `TRACKIFY_PB_TOKEN`
is loaded by Vite at build time and inlined into the web bundle. The
Node tooling in `tools/*.mjs` does **not** read it — only the Vite
build consumes the variable. The client reads it at startup as the
initial `authStore` value, which lets the static build render some
authenticated views (favorites, private playlists) without an OAuth
round-trip first.

### 14.2 Runtime OAuth2 round-trip

The shell's Google sign-in handler calls

```js
pb.collection('users').authWithOAuth2({ provider: 'google' })
```

which replaces the build-time token in `authStore` with a
user-bound token + record. From that point every SDK call sends
`Authorization: <jwt>` and the favorites / private-playlist flows
become available.

### 14.3 Shell → frames auth lifecycle events

The shell publishes two events on the broker when `authStore.isValid`
flips (see [`docs/ui.md`](ui.md) for the envelope):

- `shell.user.login` — `authStore` became valid. Carries the user
  record id; frames can refresh their favorites / playlist UI without
  a page reload.
- `shell.user.logout` — `authStore` became invalid (token expired,
  cleared, or auth failed). Frames drop authenticated state.

The shell-side `web/app.js#publishAuthLifecycleEvent` is the single
producer; no frame should mutate `authStore` directly.

### 14.4 Which view the UI queries

Most read paths in the web UI go through `tracks_view` rather than
the `tracks` base collection — `tracks_view` is what
`ShellCatalogService` queries (see `web/catalog_service.js`). It
joins tracks to games and resolves cover-art / audio file URLs to
PocketBase's `/api/files/` URLs, which is exactly what the player
needs at runtime.

`playlist_tracks_view` is the second-most-used view — it replaces
the deleted `favorites_view` (see the deleted-collections note in
§1) and serves both the per-playlist page and the favorites flow.