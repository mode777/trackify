# Adding Music

An instance starts with an empty catalog. There are two ways to populate it,
both superuser-only:

1. **The admin upload page** (recommended) — point it at a folder of your
   music files in the browser; it stages, probes, and uploads everything.
2. **The CLI tooling** — a scripted pipeline that indexes a local folder and
   pushes it to PocketBase.

## The folder convention

Both paths expect your files laid out as:

```
<platform>/<game>/<files…>
snes/secret-of-maniac/01 - Fear of the Heavens.spc
psx/final-fantasy-ix/101 - Title.psf
psf/final-fantasy-ix/101 - Title.minipsf      ← platform key is your choice
```

- **First path segment** = platform, **second** = game title.
- Playable files (known audio extensions) become **tracks**.
- Images inside the game folder become **cover-art candidates** — the first
  one (sorted by name) is proposed; you can replace or clear it.
- Non-playable resources (`.psflib` / `.usflib` sidecars, `VGMPlay.ini`-style
  files) are attached to the game's **file bundle** without producing tracks.
- Files that don't fit the convention are surfaced as *ungrouped* — nothing
  is silently dropped.

## Option 1: the admin upload page

Open `/admin.html` on your instance and sign in with your **superuser**
account (see [Administration](/admin/)).

The page works in five steps, all in the browser:

1. **Select** — pick a game folder (or multiple files).
2. **Stage** — files are grouped into games offline; nothing is written yet.
3. **Probe** — the same WASM cores the player uses read title, artist and
   length from each file and prefill the editable fields. Formats without a
   probing core (`.mp3`, `.xa`, `.genh`) fall back to filename-derived
   titles.
4. **Review** — every derived value (game title, platform, year, company,
   cover; track title, artist, length) is editable before anything uploads.
5. **Upload** — a serial queue uploads games → covers → file bundles →
   tracks, with per-item status and retry.

Re-uploading the same folder is safe: records are matched by deterministic
ids and existing records are never modified — only missing pieces are
completed.

::: warning Use a real superuser login
The admin page has its own login, separate from the visitor Google sign-in.
A superuser credential is never inlined into the public site — the admin
page always asks for it explicitly.
:::

## Option 2: the CLI tooling

The repository ships scripts that do the same thing from a terminal
(reference: [`docs/tools.md`](https://github.com/mode777/trackify/blob/main/docs/tools.md)):

```sh
# 0. One-time: download a PocketBase binary for local serving
npm run pocketbase:download

# 1. Grab an album (optional; you can also drop files in manually)
npm run khinsider:download -- <album-url> [folder]

# 2. Index a local folder — needs the WASM build (npm run wasm) for metadata probing
npm run samples:index

# 3. Fill in missing cover art from Wikipedia
npm run samples:coverart

# 4. Push the catalog to your instance
TRACKIFY_PB_URL=http://127.0.0.1:8090 \
TRACKIFY_PB_TOKEN=<superuser auth token> \
npm run samples:upload-index
```

Notes:

- `TRACKIFY_PB_UPLOAD_DRY_RUN=1` prints the planned changes without writing.
- The upload is **create-or-skip**: deterministic ids mean the same folder
  uploaded twice produces identical records.
- The token must be a **superuser** token — the built-in rules restrict
  catalog writes to superusers.

## After importing

Open the collections page — your games should appear with cover art and
playable track lists. Anything that looks wrong can be fixed by re-running
the import with corrected metadata, or by editing records directly in the
PocketBase admin dashboard ([Administration](/admin/)).
