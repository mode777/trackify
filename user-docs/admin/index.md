# Administration

This chapter covers the day-to-day operation of a Trackify instance:
superuser accounts, catalog management, and visitor authentication.

## Superuser accounts

The superuser manages the catalog and instance settings. Create one inside
the container:

```sh
docker exec -it trackify /pocketbase/pocketbase superuser upsert you@example.com 'a-long-password'
```

(`upsert` creates the account or updates its password if it already exists.
Without Docker, run the same `superuser upsert` command against your
`bin/pocketbase` binary.)

The superuser can:

- Open the **PocketBase admin dashboard** at `/_/` on your instance — full
  control over collections, records, and settings.
- Sign in to the **admin upload page** at `/admin.html` to populate the
  catalog — see [Adding Music](/adding-music/).

## Catalog management

- **Add games & tracks** — via the admin upload page or the CLI tooling
  ([Adding Music](/adding-music/)). Both are create-or-skip: re-running an
  import never duplicates or overwrites existing records.
- **Fix metadata** — the upload page lets you edit every field before
  upload; for after-the-fact corrections use the PocketBase admin dashboard
  (`/_/`) and edit the `games` / `tracks` records directly.
- **Remove content** — deleting a game in the dashboard cascades to its
  tracks. Playlists referencing deleted tracks drop the dead rows.

## Visitor authentication

Visitors sign in with **Google OAuth2**; the login lives in the app's
topbar. Favorites and playlists are attached to that account.

- Anonymous visitors can browse and play everything — catalog reads are
  public, writes are superuser-only.
- To enable sign-in, configure the **Google** auth provider in the
  PocketBase admin dashboard (Settings → Authentication → Google) with your
  OAuth client id and secret, and add your instance's redirect URL to the
  authorized redirect URIs in the Google Cloud console.
- Visitors never see superuser credentials; the admin page keeps a separate
  login so an admin tab and player tabs can coexist without evicting each
  other's sessions.

## Health checks

- `GET /` should return the app's `index.html`.
- `GET /api/health` should return `200`.
- `GET /wasm/backend_psx.js` (and friends) should return the WASM runtime
  loaders — if these 404, the deployed `public/` tree is incomplete.
