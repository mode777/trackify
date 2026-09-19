# Tasks: add-landing-page

## 1. Landing page content

- [x] 1.1 Create `landing/` with `index.html`: nav (brand mark, section links, GitHub), hero with pitch + CTAs (`#features`, `#self-host`, GitHub), features grid, supported-formats table (psx, snes, nez, n64, vgm + extensions, sourced from README "Backends at a glance"), self-host section with Docker build/run snippet + private-registry note, footer with core/engine/PocketBase credits and fan-project disclaimer. Verify: file opens in a browser and all five sections render.
- [x] 1.2 Create `landing/styles.css` using the app palette (`#0b1326`, `#4cd7f6`, `#7c3aed`), responsive layout, and scroll-reveal styles gated on an `html.js` class. Verify: page styled correctly at desktop and mobile widths.
- [x] 1.3 Create `landing/main.js` with the scroll-reveal enhancement only. Verify: with JS disabled all content is visible; with JS enabled reveal animations play.
- [x] 1.4 Create `landing/assets/favicon.svg` and the inline SVG brand mark (cyan→violet gradient, unique gradient ids per instance). Verify: favicon renders in a browser tab; brand mark renders in nav and footer.
- [x] 1.5 Add meta/OG/Twitter tags: relative resource paths, absolute `https://mode777.github.io/trackify/` OG URLs, no `og:image` yet, theme-color `#0b1326`. Verify: no reference in `landing/` contains a private instance or registry hostname.
- [x] 1.6 Local smoke test: serve `landing/` with any static server and click every internal link. Verify: no 404s, no requests to the app or PocketBase.

## 2. Pages workflow

- [x] 2.1 Create `.github/workflows/docs.yml`: triggers (push `main` with paths `landing/**` + workflow file, pull_request same paths, `workflow_dispatch`), `contents: read` permission, `pages` concurrency with `cancel-in-progress`. Verify: `actionlint`-clean or YAML parse check passes.
- [x] 2.2 Implement build job: checkout → hostname leak scan (grep `-rF` for `$PRIVATE_INSTANCE_HOSTNAME` over `landing/`, no-op with message when unset) → compose `_pages/` by copying `landing/.` → link check (grep `href|src` from `_pages/index.html`, resolve local refs against `_pages/`, fail on missing) → `upload-pages-artifact` with path `_pages`. Verify: run the scan + link-check shell snippets locally against a composed `_pages/` and against a deliberately broken copy.
- [x] 2.3 Implement deploy job: `needs: build`, gated to `github.ref == 'refs/heads/main'` and push/dispatch events, `pages: write` + `id-token: write`, `configure-pages` → `deploy-pages`. Verify: workflow YAML shows the gate conditions; a PR run builds without deploying.

## 3. Enablement and verification

- [ ] 3.1 Enable GitHub Pages with Source: "GitHub Actions" in repository settings (one-time manual step). Verify: setting visible in repo Settings → Pages.
- [ ] 3.2 Open a PR touching `landing/` and confirm the checks job passes (build + scan + link check) with no deploy attempt. Verify: green PR run.
- [ ] 3.3 Merge to `main` and confirm the site is live at `https://mode777.github.io/trackify/` with all sections, favicon, and working anchor links. Verify: manual visit + link check green in the deploy run.
- [x] 3.4 Content accuracy pass: compare the formats table against README "Backends at a glance" (extensions and core names). Verify: each listed format maps to a real backend in `backends/<core>/CMakeLists.txt`.
