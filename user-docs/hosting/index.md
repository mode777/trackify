# Hosting & Running

Trackify is designed to be run by individuals on their own hardware. This
chapter explains what an instance is made of and how to run one.

::: tip Credit where due
Trackify is a single [PocketBase](https://pocketbase.io) application serving
a multi-page web app whose audio is decoded by emulator cores (Highly
Experimental, Game Music Emu, NEZplug++, LazyUSF2, VGMPlay) compiled to
WebAssembly. Everything runs on one machine in one process.
:::

## What an instance is made of

A deployment is one PocketBase binary with three things layered on top — all
of them live in the repository:

| Piece              | Where                        | What it does                                                                     |
| ------------------ | ---------------------------- | -------------------------------------------------------------------------------- |
| **API + database** | PocketBase core              | REST API, auth, file storage, SQLite under the hood                              |
| **Web app**        | `build/dist/` (built) → `public/` | The collections, playlist, and player pages — plus the `wasm/` runtime tree |
| **Hooks**          | `pb_hooks/`                  | Server-side behaviour (keeps original filenames on uploaded files)               |
| **Migrations**     | `pb_migrations/`             | Create the full schema on first boot — the database starts **empty**             |

Because the web app is served by the same PocketBase that provides the API,
everything is same-origin — no CORS setup.

## Variant 1: Docker image (recommended)

The release pipeline builds a self-contained image: PocketBase with the web
app, hooks, and migrations baked in.

::: warning Not yet publicly published
The image is currently pushed to a **private registry** and is not on Docker
Hub. Until it is published, build it yourself from the repository root:

```sh
npm install && npm run build   # produces build/dist/ (needs the emsdk — see README)
docker build -t trackify .
```

:::

Run it:

```sh
docker run -d --name trackify \
  -p 8090:8090 \
  -v trackify-data:/pocketbase/pb_data \
  trackify
```

- **`-v trackify-data:/pocketbase/pb_data`** — the only state that matters
  lives in `pb_data` (SQLite + uploaded audio + cover art). Mount a volume or
  you lose everything when the container is replaced.
- The container listens on **8090**; map whatever host port you like.

Create the superuser account in the container:

```sh
docker exec -it trackify /pocketbase/pocketbase superuser upsert you@example.com 'a-long-password'
```

## Variant 2: from source, no Docker

For development or when you prefer a bare process:

```sh
git submodule update --init --recursive
source ./submodules/emsdk/emsdk_env.sh
npm install
npm run build                # → build/dist/
npm run pocketbase:download  # → bin/pocketbase
npm run pocketbase:serve     # serves build/dist on http://127.0.0.1:8090
```

`pocketbase:serve` passes `--publicDir ./build/dist --dir ./pb_data
--hooksDir ./pb_hooks`, so this variant behaves identically to the image.

## Operations notes

- **Reverse proxy** — the image binds `0.0.0.0:8090` and does not handle
  TLS. Put it behind your reverse proxy for HTTPS termination.
- **Resource sizing** — the N64 backend is CPU-hungry (no dynamic
  recompilation) and allocates 128 MB of WASM memory. Size container limits
  accordingly if you expect N64 playback.
- **Updates** — pull the new revision, `npm run build`, rebuild the image,
  replace the container. Migrations are idempotent and re-apply safely on
  the existing data volume.
- **Backups** — everything lives in the `pb_data` volume; snapshot it and
  you have a full backup of catalog, users, favorites, and playlists.
