# Troubleshooting

Quick fixes for the most common rough edges. If your problem isn't here,
check the [FAQ](/faq/).

## The first track of a format takes a long time to start

That is the lazy-loaded backend: the player fetches and compiles the WASM
core for a format the first time it is used. Later tracks of the same format
start instantly. If *every* track is slow, see "Backend load failures"
below.

## No sound

1. Check the volume slider in the player bar.
2. Browsers block audio until you interact with the page — press play in the
   UI once (autoplay of *unmuted* audio after a click is then allowed).
3. Check the tab isn't muted (right-click the browser tab).
4. Media keys not working? They only work after playback has started at
   least once in the session.

## Backend load failures (track never starts)

- Open the browser devtools network tab and look for a failing
  `/wasm/backend_*.js` or `*.wasm` request.
- **404** — the deployed instance's `public/` tree is incomplete; the static
  build must include the full `wasm/` directory. Re-run `npm run build` and
  redeploy ([Hosting](/hosting/)).
- **Blocked request** — some ad blockers filter URLs that look like
  executables. Whitelist your instance.
- N64 tracks in particular need a capable machine; try a different format to
  confirm the instance itself is healthy.

## Cover art is missing

Cover art is uploaded per game. If a game has none:

- Re-run the [admin upload](/adding-music/) with an image in the game folder
  (the first image, sorted by name, is proposed as the cover), or
- set one directly on the `games` record in the PocketBase admin dashboard,
  or
- use the CLI cover-art fetcher (`npm run samples:coverart`), which looks up
  candidates on Wikipedia.

## Google sign-in fails

- The instance owner must configure the Google auth provider in the
  PocketBase admin dashboard (Settings → Authentication) and register the
  instance's redirect URL in the Google Cloud console.
- After changing provider settings, reload the page — the client caches the
  OAuth configuration per session.

## Favorites or playlists disappeared

They are bound to the Google account you signed in with. Signing in with a
different account shows a different (possibly empty) set. Check the account
shown in the topbar.

## The whole catalog is gone after a container replacement

The catalog lives entirely in the `pb_data` volume. If the container was
replaced **without** that volume mounted, the data is lost. Always run with
`-v trackify-data:/pocketbase/pb_data` ([Hosting](/hosting/)), and back the
volume up.
