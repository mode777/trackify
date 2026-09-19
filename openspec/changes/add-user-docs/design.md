# Design: add-user-docs

## Context

Builds directly on `add-landing-page`: `landing/` and
`.github/workflows/docs.yml` (build + gated deploy, leak scan, link check)
exist and deploy to `https://mode777.github.io/trackify/`. Root tooling is
Vite-only (`vite.config.mjs`, no PostCSS/Tailwind at the root). Content
sources for the docs: `README.md`, `docs/deploy.md`, `docs/database.md`,
`docs/tools.md`, and the app UI itself. PSflix's `user-docs/` (VitePress
1.6.4, ~650 lines over 10 pages) is the verified structural reference.

## Goals / Non-Goals

**Goals:**
- A searchable, dark-themed VitePress site under `/trackify/docs/`, built in
  CI by the existing workflow and composed under `_pages/docs/`.
- Strict isolation of docs dependencies from the app toolchain.
- Landing page becomes the front door to the docs (nav, hero, self-host,
  footer links).

**Non-Goals:**
- Migrating or regenerating the developer `docs/*.md` into the user docs —
  they stay authoritative for architecture and are linked, not duplicated.
- Versioned/multi-language docs, algolia search, comments, analytics.
- Publishing the private registry image publicly (docs say "build it
  yourself").

## Decisions

- **VitePress, version-pinned, mirroring PSflix.** Markdown-only authoring,
  built-in local search and dark mode, tiny config. Alternatives (mkdocs,
  docusaurus) add tooling for no gain and break parity with the reference
  project. Pin the exact version in `user-docs/package.json` with a
  committed lockfile so CI installs are reproducible.

- **Base path from `DOCS_BASE_PATH` env with default `/trackify/docs/`.**
  Same mechanism as PSflix: keeps the site movable (custom domain later)
  without touching markdown links, and local dev/preview inherit the same
  base.

- **Isolated `user-docs/package.json`, own lockfile, no root changes.**
  Root `npm ci` / `npm run build` stay untouched; the workflow's
  `setup-node` cache keys on `user-docs/package-lock.json`. Keep PSflix's
  `vite.css.postcss.plugins: []` guard in the config even though the
  Trackify root currently has no PostCSS config — it makes the isolation
  explicit and future-proof against a root CSS toolchain appearing.

- **Workflow grows in place, order matters in the build job.** Insert
  `setup-node` (node 20, cache) + `npm ci` + `npm run build` in
  `user-docs/` before the compose step; compose becomes
  `mkdir -p _pages/docs` → copy VitePress `dist/*` → `_pages/docs/` → copy
  `landing/.` → `_pages/`. Deploy job and triggers are unchanged in shape;
  path filters already include the workflow file. The hostname scan gains
  `user-docs/` in its target list (hardening beyond PSflix, which scans
  `landing/` only — docs prose is equally leak-prone).

- **Brand via a tiny default-theme extension.** `.vitepress/theme/` with a
  small CSS file overriding the palette variables (navy `#0b1326`, cyan
  `#4cd7f6`, violet `#7c3aed`) plus footer credit text — matching landing
  and app instead of default VitePress teal.

- **Fresh content, PSflix's outline.** Pages written from Trackify's actual
  behavior (collections/playlists/favorites UI, five backends + extensions,
  PocketBase admin, `tools/*.mjs` catalog workflow, `docs/deploy.md` Docker
  details). VitePress fails the build on dead internal markdown links, which
  keeps cross-page references honest.

## Risks / Trade-offs

- [VitePress pins a Node version range; CI drift breaks builds] → Node 20 in
  workflow matches the app CI; version-pinned vitepress + lockfile.
- [Landing edits conflict if `add-landing-page` is not merged first] →
  explicit deployment-order dependency recorded in the proposal; this change
  only appends links to `landing/index.html`.
- [Docs prose drifts from app behavior] → VitePress dead-link checking
  catches structural drift; content review tasks reference README/
  `docs/*.md` as source of truth; accepted residual risk for UI prose.
- [`npm ci` in CI fails when lockfile is stale] → lockfile is committed;
  regenerate it as an explicit task step whenever deps change.

## Migration Plan

1. Land after `add-landing-page` is merged and its capability archived.
2. First docs deploy rides the existing workflow: push to `main` touching
   `user-docs/**` → build + compose + deploy.
3. Rollback: revert; the artifact reverts to landing-only on the next
   deploy, and the landing keeps working because docs links are additive.

## Open Questions

None.
