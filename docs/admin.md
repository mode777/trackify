# Admin upload page

Reference for the standalone superuser page (`/admin.html`) that
populates the catalog: game + track creation, audio file uploads, cover
art, and WASM metadata probing — the browser equivalent of the CLI chain
(`tools/generate-sample-index.mjs` + `tools/upload-index.mjs`). For the
build wiring (fifth Vite entry) see [`docs/frontend.md`](frontend.md);
the schema it writes is unchanged and lives in
[`docs/database.md`](database.md).

## 1. Why standalone

`admin.html` is intentionally **outside the shell/iframe topology**: no
broker topics, no service id, no shell route. The shell owns the single
visitor `PocketBase` client bound to the `pb_auth` storage key; a
superuser login there would evict the visitor's OAuth session. The
admin page instead constructs its own client
(`web/admin/auth.js`) with an isolated store key:

```
new PocketBase(baseUrl, new LocalAuthStore('pb_admin_auth'))
```

Because the keys differ, an admin tab and player tabs can be open
simultaneously without interference. The build-time
`TRACKIFY_PB_TOKEN` seeding pattern used by the visitor app
([`docs/database.md` §14](database.md#14-client-auth-lifecycle)) is
deliberately **not** used here — a superuser credential must never be
inlined into a public bundle.

Deployment note: `admin.html` ships in `build/dist` and is publicly
reachable like the rest of the static site. Unauthenticated visitors
see only the login form; every write stays protected by the existing
superuser-only (`null`) API rules, so the page adds no unauthenticated
capability. If a public instance should not expose the login form at
all, simply exclude `admin.html` from the deploy.

## 2. Auth model

- Login: `pb.collection('_superusers').authWithPassword(email, password)`
  (PocketBase built-in superuser auth; create superusers with
  `bin/pocketbase superuser upsert EMAIL PASS`).
- Failed logins (HTTP 400) show an error; no session is stored.
- Any 401 during catalog work clears the stored session and returns the
  page to the login form; staged state is kept so the batch can resume
  after re-authentication.
- Logout clears only `pb_admin_auth`.

## 3. Pipeline

The page mirrors the CLI's semantics end to end:

1. **Select** — folder picker (`webkitdirectory`) or multi-file picker.
   `webkitRelativePath` minus the selected folder's own name is used
   exactly like the CLI's `fileRelPath`.
2. **Stage** (offline, zero network writes) — files are grouped into
   games by the `<platform>/<game>/` convention (same as
   `sample-files/`):
   - platform = first path segment, game = second (both normalized via
     the shared identifier rules),
   - playable files (known audio extension) become track rows,
   - non-playable, non-image files (`.psflib` / `.usflib` sidecars,
     `VGMPlay.ini`-style resources) are attached to the game's file
     bundle WITHOUT producing track rows,
   - images are cover-art candidates only; the first image inside the
     game's own directory is proposed (sorted by name), replaceable or
     clearable manually,
   - files outside the convention are surfaced as *ungrouped* for
     manual assignment — never dropped.
3. **Probe** (offline) — for each playable file the matching WASM core
   (the same `backend_*.js` runtimes the player uses, loaded via
   `web/player/backend_loader.js`) is loaded and the file is loaded via
   `emu_load_file` after staging the game folder into the core's
   virtual filesystem (sidecar resolution goes through the same
   `ScriptNodePlayer` callback surface the CLI shims — see
   `tools/lib/player-shims.mjs`). Title / artist / length prefill the
   editable fields; game title / year / company prefill from the tags
   and copyright. Failures and types without a core probe
   (`mp3` / `xa` / `genh`) fall back to a filename-derived title and
   length `-1`, exactly like the CLI.
4. **Review & edit** — every derived value (game id / title / platform
   / year / company / cover; track id / title / artist / length) is
   editable before upload. Nothing is written until the upload starts.
5. **Upload** — serial item queue in dependency order per game:
   game create → cover upload → `files+` bundle uploads → track
   creates, each item showing `pending / active / completed / skipped /
   failed` with per-item retry. See §4.

## 4. Upload semantics (CLI parity)

- **Deterministic ids**: game and track ids derive from the staged
  paths via `shared/catalog-identifiers.mjs` — the same functions the
  CLI imports. Uploading the same folder twice produces the same ids;
  the admin page and `tools/upload-index.mjs` produce identical records
  for identical input.
- **Create-or-skip**: games match by id (fallback `platform::title`
  key), tracks by id (fallback lowercased filename), bundle files by
  basename inside the game's `files[]`. Existing records are never
  modified — re-upload of a partially-failed batch completes only the
  missing pieces. (The CLI's field-patching sync is intentionally not
  carried over; "editing" is out of scope for the admin page.)
- **Cover art**: uploaded via `games.update({ coverArt })` after game
  creation when a cover is staged; skipped entirely if the game already
  exists.
- **Track filenames**: always the uploaded file's basename — the
  `keep_names.pb.js` hook preserves original names so the player can
  resolve `/api/files/games/<gameId>/<filename>` (see
  [`docs/database.md` §11](database.md#11-hooks)).
- **Failure isolation**: one item's failure never aborts the batch;
  create-conflicts are treated as `skipped`; a 401 pauses the queue and
  raises the login form (resume continues where it left off).

## 5. Module map

| File                        | Responsibility                                                            |
| --------------------------- | ------------------------------------------------------------------------- |
| `web/admin.html`            | Page markup (login view + admin view)                                     |
| `web/admin.js`              | Entry: gate wiring, inputs, probe/upload orchestration                    |
| `web/admin.css`             | Page styling (same palette as the app)                                    |
| `web/admin/auth.js`         | Isolated superuser client (`pb_admin_auth`), login/logout/401 handling    |
| `web/admin/stage.js`        | Staging model: grouping, ids, cover candidates, validation                |
| `web/admin/probe.js`        | WASM probing orchestration + `ScriptNodePlayer` dependency shim           |
| `web/admin/lib/wasm-probe.js` | Decode/VFS/track-info helpers (browser port of the CLI's probe libs)    |
| `web/admin/lib/shims.js`    | `stripExtension` / `normalizeFolderGameName` browser shims                |
| `web/admin/upload.js`       | Skip-set computation, serial queue, per-item state machine, retry/resume  |
| `web/admin/ui.js`           | Rendering for ungrouped files, staging grid, upload progress              |
| `shared/catalog-identifiers.mjs` | Shared path/identifier rules (also imported by `tools/lib/*`)        |

## 6. Known limitations

- No WASM probe for `mp3` / `xa` / `genh` (length stays `-1`; CLI
  parity).
- `VGMPlay.ini` (needed by some `vgm` files for full metadata) is not
  available in the browser, so those tracks fall back like any other
  probe failure.
- Byte-level upload progress is not implemented (per-item states only).
- Safari's `webkitdirectory` support is the weakest; the multi-file
  picker is the fallback (files then stage as ungrouped for manual
  assignment).
- Cover-art *download* (the `fetch-missing-cover-art.mjs` flow) is out
  of scope; covers are picked manually or auto-discovered from the
  folder.

## 7. Rollback

Pure static-site addition with no schema/migration impact. Rollback =
redeploy a build without the `admin.html` entry; a stale `admin.html`
is harmless (login-gated, and writes stay superuser-only via rules).
