# Getting Started

Trackify is a self-hosted web player for video game music. An **instance** is
one [PocketBase](https://pocketbase.io) application that serves the player UI,
the catalog API, and your audio files — all from the same origin, on your own
hardware.

This page gets you from zero to listening. If an instance is already running,
skip straight to [step 3](#3-sign-in-and-press-play).

## 1. Run an instance

The fastest path is the Docker image. From a fresh clone of the
[repository](https://github.com/mode777/trackify):

```sh
# Build the static site (needs Node 20+, CMake, Ninja and the bundled Emscripten SDK)
git submodule update --init --recursive
source ./submodules/emsdk/emsdk_env.sh
npm install
npm run build

# Build and run the image
docker build -t trackify .
docker run -d --name trackify \
  -p 8090:8090 \
  -v trackify-data:/pocketbase/pb_data \
  trackify
```

Open `http://localhost:8090/` — the player UI loads straight from the
container. The full walkthrough (base image, TLS, resource sizing) lives in
[Hosting & Running](/hosting/).

::: warning Fresh instances are empty
The catalog database starts with **no games and no tracks**. Head to
[Adding Music](/adding-music/) to populate it.
:::

## 2. Create a superuser

The superuser manages the catalog and the instance settings:

```sh
docker exec -it trackify /pocketbase/pocketbase superuser upsert you@example.com 'a-long-password'
```

Details and the non-Docker variant are in
[Administration](/admin/).

## 3. Sign in and press play

1. Open the instance URL in any modern browser (Web Audio + WebAssembly).
2. Click **Sign in** and authenticate with Google — your favorites and
   playlists are tied to that account.
3. Pick a game from the collections grid and click a track. The first track
   of a format loads its emulator core on demand, so give it a moment —
   subsequent tracks start instantly.

Listeners who never sign in can still browse and play; an account is only
needed for favorites and playlists. See
[Playlists & Favorites](/playlists/).
