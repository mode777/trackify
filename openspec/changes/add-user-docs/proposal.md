# Proposal: add-user-docs

## Why

Trackify's self-hosting and catalog workflow (Docker image, PocketBase
superuser, cover-art tooling) is documented only in developer-facing
references (`README.md`, `docs/*.md`). Non-developer operators need task-
oriented user documentation. This is the second half of the phased PSflix
replication agreed during exploration: it builds on the `add-landing-page`
change (landing + Pages workflow already deployed) and adds a VitePress docs
site at `/trackify/docs/`, wired into the landing page.

## What Changes

- Add a new top-level `user-docs/` VitePress site with an isolated
  `package.json` (vitepress + Inter font; its own committed lockfile):
  - Content set (~10 short pages), sidebar: Start → Getting Started; Using
    Trackify → Browsing Collections, Playlists & Favorites, The Player &
    Formats; Adding Your Music → catalog import + cover-art tooling;
    Self-Hosting → Hosting & Running, Administration; Help →
    Troubleshooting, FAQ; plus the docs landing index.
  - VitePress config with base path from `DOCS_BASE_PATH` env, default
    `/trackify/docs/`; local search; dark appearance; theme CSS matching the
    app palette; footer crediting the cores/engine and PocketBase.
  - Hosting page carries the "image lives in a private registry — build it
    yourself" warning and must not name the registry host.
- Extend `.github/workflows/docs.yml` (from `add-landing-page`):
  - Node.js setup with npm cache keyed on `user-docs/package-lock.json`.
  - `npm ci` + `npm run build` for the docs in the build job.
  - Compose step additionally copies the VitePress build output to
    `_pages/docs/` (landing stays at the site root).
  - Hostname leak scan extended to `user-docs/` source (small hardening
    beyond PSflix, which scans `landing/` only).
- Update `landing/index.html`: add the Docs button to the nav, a "Read the
  Docs" hero CTA, docs links in the self-host section, and a docs column in
  the footer — all relative `docs/…` paths that resolve inside the composed
  Pages artifact (the existing link checker then covers them).
- Docs content is audience-specific prose for operators/listeners; developer
  references under the repo's `docs/` stay the source of truth for
  architecture and are linked, not duplicated.

Recorded assumptions (recommendations adopted per user instruction):
- Docs are written fresh for Trackify's feature set (collections, playlists,
  favorites, five WASM backends, PocketBase admin) rather than translated
  from PSflix page-by-page; PSflix supplies structure and tone only.
- Deployment order dependency: `add-landing-page` merges and its capability
  is archived before this change is applied, since it edits `landing/` and
  extends the workflow created there.

## Capabilities

### New Capabilities

- `user-docs`: A VitePress-built documentation site published under the
  `/docs/` path of the project Pages URL, covering getting started, daily
  use, catalog management, and self-hosting, built and deployed by the same
  workflow as the landing page.

### Modified Capabilities

- `landing-page`: Adds a requirement that the landing page links to the
  published docs site (nav Docs button, hero CTA, self-host and footer
  links), with all docs links resolving inside the deployed Pages artifact.
  Delta is an ADDED requirement (new concern; existing requirements are
  unchanged) and assumes the `landing-page` capability created by
  `add-landing-page`.

## Impact

- New files: `user-docs/` tree (markdown pages, `.vitepress/config.mts`,
  theme CSS, `package.json` + `package-lock.json`).
- Modified: `.github/workflows/docs.yml` (docs build, compose, cache, scan
  paths), `landing/index.html` (docs links only; no CSS/JS changes expected).
- New dev dependency isolated to `user-docs/` — root `package.json` and the
  app build are untouched; `npm ci` in the workflow root still installs only
  app deps.
- Site grows: `https://mode777.github.io/trackify/docs/` (VitePress, base
  `/trackify/docs/`).
