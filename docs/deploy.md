# Docker / deploy

Reference for the release image: how the static build feeds into the
Docker image, what the base image provides, the `publish.sh` workflow,
and the runtime characteristics of the resulting container.

The high-level workflow lives in the top-level [`README.md`](../README.md);
this document covers the concrete pieces — file-level what-copies-where,
base-image assumptions, versioning, and runtime data persistence.

## 1. Release pipeline at a glance

```
npm run build                  # → build/dist/ (static site)
        │
        ▼
docker buildx build             # Dockerfile → image
        │                        # copies build/dist → /pocketbase/public/
        │                        # copies pb_migrations → /pocketbase/migrations/
        │                        # copies pb_hooks → /pocketbase/hooks/
        ▼
harbor.alexklingenbeck.de/my/trackify:<version>   # publish.sh --push
```

`build/wasm/` and `build/web-public/` are intermediate artefacts
consumed by Vite and not staged into the image. Only `build/dist/`
ships. `bin/pocketbase` is also intermediate — it's only the local
dev / CI helper that runs `bin/pocketbase serve`; production runs
the PocketBase baked into the base image.

## 2. The Dockerfile

```dockerfile
FROM adrianmusante/pocketbase

COPY build/dist/.    /pocketbase/public/
COPY pb_migrations/. /pocketbase/migrations/
COPY pb_hooks/.      /pocketbase/hooks/
```

Five lines. Everything else is up to the base image and the build
context.

### Build context

The Docker build context is the repo root. The Dockerfile depends on
three directories being present when the image is built:

| Path in context | Mounted at in image    | Sourced from                                          |
| --------------- | ---------------------- | ----------------------------------------------------- |
| `build/dist/`   | `/pocketbase/public/`  | `npm run build` (Vite output: HTML + assets + `wasm/`)|
| `pb_migrations/`| `/pocketbase/migrations/` | timestamped JS migrations, applied in order on startup |
| `pb_hooks/`     | `/pocketbase/hooks/`   | PocketBase JS server hooks (currently `keep_names.pb.js`) |

**You must run `npm run build` first.** A fresh checkout with only
`pb_migrations/` and `pb_hooks/` will build, but the resulting image
will serve a 404 / empty UI.

### Base image: `adrianmusante/pocketbase`

A pre-built image that contains:

- A `pocketbase` binary at a known path (PocketBase upstream release
  — pinned by the image tag).
- A default entrypoint that runs `pocketbase serve` with sensible
  defaults (`--dir /pocketbase/pb_data`, `--http 0.0.0.0:8090`).
- Standard PocketBase data dir layout: `/pocketbase/pb_data`.

The image tag you pick is therefore implicitly pinning PocketBase
itself. Bumping the base image is a release decision; document it in
the publish log when you do.

## 3. `publish.sh`

```bash
#!/bin/bash
set -e

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

VERSION=$1

docker buildx build --platform linux/amd64 -t harbor.alexklingenbeck.de/my/trackify:$VERSION . --push
```

Behavior:

- **One argument**: a version tag. Anything other than `$# == 1` exits
  non-zero with a usage hint.
- **`set -e`**: any failing command aborts the script — no partial
  pushes.
- **`--platform linux/amd64`**: the only platform currently built.
  There is no multi-arch manifest yet; ARM hosts pull an amd64 image
  through emulation.
- **`--push`**: the image is pushed immediately as part of the build.
  `--load` is not used. There is no local-only build path; dry-runs
  use `docker build -t ...` directly.
- **Registry**: `harbor.alexklingenbeck.de` (Harbor). Auth is taken
  from the active `docker login` session — make sure `docker login
  harbor.alexklingenbeck.de` has been run before invoking `publish.sh`.

### Naming convention

Tags are bare versions (`v1.2.3`, `0.1.0`, etc.) — no `latest`, no
date stamps, no build numbers. A new tag is the only release
artefact; rolling back means re-pushing the previous tag's image.

### CI release path

Pushing a `v*` git tag triggers [.github/workflows/release.yml](../.github/workflows/release.yml),
which builds the static site (same steps as `ci.yml`: submodules,
emsdk, ninja, `npm run build` + `verify:dist`), logs into Harbor via
`docker/login-action` using the `HARBOR_USERNAME` / `HARBOR_PASSWORD`
repo secrets, then runs `./publish.sh "${GITHUB_REF_NAME#v}"` — the
leading `v` is stripped, so git tag `v0.5.3` publishes image tag
`0.5.3`. `publish.sh` stays the single source of truth for the
`buildx` invocation.

## 4. Release checklist

```bash
# 1. Verify the source tree is clean and on the right commit
git status
git log --oneline -5

# 2. Build the static site
npm run build
npm run verify:dist           # CI sanity check — required files exist

# 3. (Optional) Inspect the artefact tree that will go into the image
ls build/dist/wasm/           # 5 .js + 3 .js backends + 5 .wasm files

# 4. Publish
./publish.sh <version>
#    … or just push the release tag and let CI do steps 2–4:
#    git tag v<version> && git push origin v<version>

# 5. Smoke-test the pushed image locally (pulls back from Harbor)
docker run --rm -p 8090:8090 harbor.alexklingenbeck.de/my/trackify:<version>
# → curl http://127.0.0.1:8090/  should return the index.html
# → curl http://127.0.0.1:8090/api/health  should be 200
```

## 5. Runtime characteristics

### What runs on startup

The base image's entrypoint runs `pocketbase serve`. PocketBase
applies every migration in `/pocketbase/migrations/` (filename order)
before opening the listener. JS hooks in `/pocketbase/hooks/` are
loaded after migrations and apply to subsequent requests.

Migrations are **idempotent on existing collections** — PocketBase
no-ops a migration whose target collection already exists. Removing
the `pb_migrations/` directory from the image once collections are
materialised is safe; PocketBase will not re-apply them on restart.

### Static content

`/pocketbase/public/` is served by PocketBase's built-in static file
handler at the URL root. The static `wasm/` tree lives there, so the
player UI can fetch `/wasm/backend_*.js` and `/wasm/*.wasm` without
any extra routing.

### Data persistence

The PocketBase data directory defaults to `/pocketbase/pb_data`.
This is **inside the container** unless the runtime mounts a volume
or bind mount at that path. For anything beyond local smoke-testing,
the container must be started with a persistent volume:

```bash
docker run --rm -p 8090:8090 \
  -v trackify-pb-data:/pocketbase/pb_data \
  harbor.alexklingenbeck.de/my/trackify:<version>
```

Losing the volume loses every collection, user, favorites, and
playlist — PocketBase stores it all in `pb_data/`.

### Network

The base image binds `0.0.0.0:8090` by default. In production you
will usually front this with a reverse proxy that does TLS
termination; the image itself does not handle HTTPS.

### Resource limits

The N64 backend is the heaviest backend (`INITIAL_MEMORY=128 MB`,
CPU-intensive without dynarec). The container's CPU and memory caps
must be sized accordingly if N64 tracks are expected to be played
concurrently. See [`docs/audio-backends.md`](audio-backends.md)
for per-backend `INITIAL_MEMORY` values.

## 6. Adding a new deploy artefact

The current artefact set is intentionally minimal — static site,
migrations, hooks. If something new needs to ship inside the
container, add it as a single `COPY` line and document the mount
point here. Keep the build context small: anything large that does
not change per-release (reference data, music files) should stay
out of the image and be loaded at runtime instead.