# Proposal: add-landing-page

## Why

Trackify has no public face: the repository README is developer-oriented, and
there is no landing page introducing the project or explaining how to run it.
The sibling project PSflix publishes a static landing page via GitHub Pages
(`landing/` + a `docs.yml` workflow); replicating that pattern gives Trackify a
shareable project home at `https://mode777.github.io/trackify/` with zero
runtime cost, without touching the app build or the Docker release pipeline.

## What Changes

- Add a new top-level `landing/` directory containing a fully static landing
  page (plain HTML + CSS + a small JS enhancement file, no build step):
  - Hero with project pitch and calls to action (GitHub, self-host section).
  - Feature grid: five lazy-loaded WASM emulator cores, PocketBase catalog,
    favorites/playlists, cover art, single-container deployment.
  - Supported-formats section generated from the backend/extension table in
    `README.md` (psx, snes, nez, n64, vgm).
  - Self-host section with a Docker build/run snippet and a note that the
    release image lives in a private registry.
  - Footer crediting the underlying cores/engine and PocketBase, plus a
    fan-project disclaimer for copyrighted game music.
- Brand mark and favicon are inline/linked SVG derived from the app palette
  (`#0b1326` navy, `#4cd7f6` cyan, `#7c3aed` violet); no binary assets.
- Add a `.github/workflows/docs.yml` workflow that composes a GitHub Pages
  artifact (landing at the site root) and deploys it:
  - Triggers: push to `main` touching `landing/**` or the workflow, pull
    requests (build/check only), and `workflow_dispatch`.
  - Optional private-hostname leak scan over `landing/` (no-op unless the
    `PRIVATE_INSTANCE_HOSTNAME` repo variable is set).
  - Landing link checker: every local `href`/`src` in the composed artifact
    must resolve to a file.
- No Docs navigation link yet; the follow-up `add-user-docs` change adds the
  docs site and wires the Docs buttons.

Recorded assumptions (per user instruction, recommendations adopted):
- Two phased changes; this one ships the landing and the Pages workflow only.
- No screenshots section at launch (no captured app screenshots exist); OG
  meta ships without an image. Adding screenshots later is a content-only
  follow-up.

## Capabilities

### New Capabilities

- `landing-page`: A static, self-contained landing page published to GitHub
  Pages from `landing/`, with a CI workflow that builds, checks (link
  resolution, hostname leak scan), and deploys it on pushes to `main`.

### Modified Capabilities

<!-- none — no specs exist yet in this project -->

## Impact

- New files: `landing/` (index.html, styles.css, main.js, assets/favicon.svg),
  `.github/workflows/docs.yml`.
- No changes to the app build (`npm run build`, `build/dist`), npm scripts,
  Docker image, or existing CI/release workflows.
- New GitHub Pages environment on the repository; site URL
  `https://mode777.github.io/trackify/`.
- New dependency-free static site; GitHub Actions runners need nothing beyond
  checkout (no Node setup required for this change).
