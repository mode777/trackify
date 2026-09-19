# Tasks: add-user-docs

## 1. Docs site scaffold

- [x] 1.1 Create `user-docs/` with `package.json` (scripts: `dev`, `build`, `preview` via vitepress; deps: pinned vitepress + `@fontsource/inter`) and generate the committed `package-lock.json`. Verify: `npm install` inside `user-docs/` succeeds without touching root `package.json`/lockfile (`git status` shows only `user-docs/` changes).
- [x] 1.2 Create `user-docs/.vitepress/config.mts`: `DOCS_BASE_PATH` env with default `/trackify/docs/`, title/description, dark appearance, local search, sidebar and nav per the content outline, social GitHub link, footer credits; include the empty-root-postcss vite guard. Verify: `npm run build` inside `user-docs/` produces `.vitepress/dist/` with `/trackify/docs/` asset paths.
- [x] 1.3 Create `.vitepress/theme/` extension overriding the palette to the app colors (navy `#0b1326`, cyan `#4cd7f6`, violet `#7c3aed`) and footer text. Verify: `npm run dev` shows branded colors and footer.

## 2. Docs content

- [x] 2.1 Write `index.md` (docs landing) and `getting-started/index.md` (first deployment: build static site, docker build/run with volume, superuser upsert, first login). Verify: `npm run build` passes (dead internal links fail the build).
- [x] 2.2 Write `browsing/index.md` (collections, hero, navigation), `playlists/index.md` (playlists + favorites), and `player/index.md` (transport, seek/volume/shuffle, supported formats + lazy-loaded backends table from README "Backends at a glance"). Verify: build passes; UI claims match `web/` behavior.
- [x] 2.3 Write `adding-music/index.md` (catalog import workflow: sample index tooling, admin upload page, cover-art fetcher per `docs/tools.md`). Verify: tool names/flags match `tools/*.mjs`.
- [x] 2.4 Write `hosting/index.md` (instance anatomy: PocketBase + public dir + hooks + migrations; Docker variant with self-build warning, no registry hostname; data persistence in `pb_data`) and `admin/index.md` (superuser, catalog management, auth/OAuth notes per `docs/database.md`). Verify: build passes; no private instance or registry hostname anywhere in `user-docs/` (`grep -rF`).
- [x] 2.5 Write `troubleshooting/index.md` and `faq/index.md` (backend load failures, audio autoplay policies, cover art misses, OAuth setup). Verify: build passes.

## 3. Workflow integration

- [x] 3.1 Extend `.github/workflows/docs.yml` build job: `setup-node` (20, `cache: npm`, `cache-dependency-path: user-docs/package-lock.json`) before the compose step; `npm ci` + `npm run build` in `user-docs/`. Verify: YAML parses; step order is install → build docs → scan → compose → link check → upload.
- [x] 3.2 Compose step gains `mkdir -p _pages/docs` + copy of `user-docs/.vitepress/dist/*` before the landing copy; extend the leak scan to include `user-docs/` in its grep target list. Verify: run scan + compose snippets locally against a built dist and confirm `_pages/docs/index.html` and `_pages/index.html` both exist.
- [x] 3.3 Confirm path filters already cover `user-docs/**` or add it to the push/PR paths. Verify: a commit touching only `user-docs/` triggers the workflow.

## 4. Landing wiring

- [x] 4.1 Update `landing/index.html`: Docs button in nav, "Read the Docs" hero CTA, self-host links to `docs/hosting/` + `docs/admin/`, footer docs column — all relative `docs/…` paths, styling unchanged. Verify: existing landing link checker passes against the composed `_pages/` (every `docs/…` ref resolves).

## 5. End-to-end verification

- [x] 5.1 PR run: open a PR touching `user-docs/` and `landing/index.html`; confirm build + checks pass and no deploy occurs. Verify: green PR run, no deployment.
- [x] 5.2 Merge to `main`; confirm `https://mode777.github.io/trackify/docs/` serves the docs with working search, sidebar navigation, deep-link reload, and that the landing Docs button reaches it. Verify: manual visit of root, `/docs/`, and one nested page.
- [x] 5.3 Operator walkthrough from the docs: follow Getting Started + Hosting on a clean checkout to a running instance. Verify: each documented command works as written; discrepancies fixed in the docs before closing.
