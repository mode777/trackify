# Design: add-landing-page

## Context

The app build (`npm run build` → `build/dist`), Docker release pipeline, and
existing CI (`ci.yml`, `release.yml`) are untouched by this change. There are
no captured screenshots, no logo files, and no `landing/` or Pages workflow
today. The visual identity to reuse lives in `web/app.css` custom properties:
`--bg: #0b1326`, `--accent: #4cd7f6`, `--accent-soft: #7c3aed`, Inter-style
dark UI. The structure being replicated is PSflix's `landing/` +
`.github/workflows/docs.yml` (verified working there, same GitHub owner).

## Goals / Non-Goals

**Goals:**
- A dependency-free static landing page that any static host can serve from a
  directory copy — no build step of its own.
- A Pages workflow with the same shape as PSflix's (build job + gated deploy
  job) so the follow-up user-docs change extends it in place.
- Keep the private instance and private registry hostnames out of published
  content, enforced by CI.

**Non-Goals:**
- The user-docs site and the `/docs/` path (separate `add-user-docs` change).
- Screenshots/OG image (no assets exist; content-only follow-up).
- Custom domain, analytics, or a bundler/framework for the landing.
- Changes to `package.json`, `vite.config.mjs`, or the app build.

## Decisions

- **Plain HTML/CSS/JS in `landing/`, no framework.** Mirrors PSflix exactly;
  zero build means the workflow just copies files, and the page renders with
  JS disabled (scroll-reveal is the only JS, gated on an `html.js` class).
  Alternatives considered: VitePress landing (heavier, wrong tool for a
  marketing page), Astro (new dependency for one page).

- **Workflow named `docs.yml` from day one.** PSflix's file is `docs.yml`;
  keeping the name now means `add-user-docs` adds steps to it instead of
  renaming a live workflow (which would retrigger path filters awkwardly).
  Alternative `pages.yml` rejected for symmetry with the reference project.

- **Single workflow, two jobs.** `build` (checkout → optional hostname scan →
  compose artifact by copying `landing/.` into `_pages/` → link check →
  upload) and `deploy` (needs build; gated on `main` push or dispatch, with
  `pages: write` + `id-token: write`). Path filters: `landing/**` + the
  workflow itself; PRs get build-only via the deploy job's `if`. Concurrency
  group `pages` with `cancel-in-progress: true`. Node setup is not needed
  for this change and is deliberately omitted; `add-user-docs` adds it.

- **Brand mark as inline SVG, favicon as `landing/assets/favicon.svg`.**
  Waveform/note motif stroked with the cyan→violet gradient from the app
  palette. Pure code, no binary assets, no design tooling. Reuses PSflix's
  inline-`<defs>` gradient trick (unique per-instance gradient ids to avoid
  collisions when the mark appears more than once).

- **All resource references relative (`./`, `assets/…`, `#anchors`); OG/Twitter
  meta uses absolute `https://mode777.github.io/trackify/...` URLs.** Relative
  resources keep the artifact host-agnostic (the link checker relies on
  resolvability); OG metadata must be absolute by spec, so it is the one
  place the Pages URL is hardcoded.

- **Formats content is hand-written from the README backend table.** A
  generated-at-build link to `README.md` would add tooling for little gain;
  drift risk is accepted and noted below.

## Risks / Trade-offs

- [Grep-based link checker misses edge cases (single quotes, template-built
  URLs)] → identical to PSflix's proven checker; content convention: only
  double-quoted `href`/`src` in `landing/`.
- [Landing content drifts from the actual backend table] → content review in
  tasks references `README.md` "Backends at a glance" as the source of truth;
  accepted residual risk, flagged for the docs change to cover in depth.
- [GitHub Pages must be enabled with "GitHub Actions" source] → one-time repo
  setting; recorded as an explicit task, deploy fails loudly if unset.
- [Project Pages under `mode777.github.io/trackify/` coexists with PSflix's
  `…/psflix/`] → per-repo paths on the same user domain; no conflict, but both
  workflows share the `pages` concurrency group name only within their own
  repos, so no cross-repo interference.

## Migration Plan

1. Merge the change; enable GitHub Pages (Source: GitHub Actions) once in repo
   settings.
2. Push to `main` (or manual dispatch) → first deployment.
3. Rollback: revert the commit; Pages keeps serving the last good artifact
   until the next successful deploy.

## Open Questions

None blocking. Screenshot capture and an OG image are deliberately deferred
as content-only follow-ups (recorded in proposal.md).
