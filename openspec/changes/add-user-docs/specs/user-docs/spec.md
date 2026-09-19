# user-docs delta

## Purpose

Give Trackify operators and listeners task-oriented documentation: how to
deploy an instance, manage the catalog, and use the player — published as a
searchable docs site under the project's Pages URL.

## ADDED Requirements

### Requirement: Docs site published under the docs path
The system SHALL publish the documentation site at
`https://mode777.github.io/trackify/docs/` (site-root `/docs/` path), and
all internal docs links SHALL work under that base path so deep links can be
shared and reloaded.

#### Scenario: Visitor opens the docs
- **WHEN** a visitor opens `https://mode777.github.io/trackify/docs/`
- **THEN** the docs landing page renders with navigation and search

#### Scenario: Deep link survives reload
- **WHEN** a visitor loads or reloads a nested docs page URL directly
- **THEN** the page renders correctly under the `/trackify/docs/` base path

### Requirement: Docs cover the operator journey
The docs SHALL include, at minimum: getting started (first deployment via
Docker), daily use (browsing collections, playlists and favorites, the
player and its supported formats), catalog management (importing music,
cover-art tooling), self-hosting reference (hosting and administration),
and help (troubleshooting, FAQ) — organized as a single sidebar navigation
with local search.

#### Scenario: New operator reaches a running instance
- **WHEN** a reader follows Getting Started and the hosting guide from
  nothing but a fresh clone of the repository
- **THEN** the instructions are sufficient to build the static site, build
  the Docker image, create a superuser, and reach the running app

#### Scenario: Listener finds format support info
- **WHEN** a reader looks up which file formats the player supports
- **THEN** a docs page lists the supported formats consistently with the
  project's backend set (psx, snes, nez, n64, vgm)

### Requirement: Docs do not leak private infrastructure
Docs content MUST NOT reference the privately hosted instance or the private
registry hostname, and the hosting guide SHALL instruct readers to build the
image themselves while the release image is private.

#### Scenario: Hosting guide works without private access
- **WHEN** a reader follows the hosting guide's image instructions
- **THEN** they use a self-build command and volume mapping, with no
  reference to a private registry

#### Scenario: No private hostname in docs
- **WHEN** the hostname leak scan runs over docs content
- **THEN** no configured private hostname appears in `user-docs/` source

### Requirement: Docs build is isolated from the app build
Docs dependencies SHALL be declared and installed only within the docs
directory (own package.json and lockfile), so building the docs requires no
root npm install and the app's `npm run build` remains unaffected.

#### Scenario: Docs build with app deps absent
- **WHEN** the docs are built in a checkout where the root `node_modules`
  was never installed
- **THEN** the docs build succeeds using only the docs directory
  dependencies

### Requirement: Workflow builds and deploys docs with the landing
The Pages workflow SHALL build the docs site in its build job (with npm
dependency caching keyed on the docs lockfile) whenever `user-docs/**`,
`landing/`, or the workflow changes, SHALL compose the docs output under the
`docs/` path of the Pages artifact alongside the landing page at the root,
and SHALL NOT deploy from pull requests.

#### Scenario: Push to main touches docs
- **WHEN** a commit is pushed to `main` changing `user-docs/**`
- **THEN** the workflow builds the docs, composes them under `_pages/docs/`,
  and deploys the combined artifact

#### Scenario: PR touching docs is check-only
- **WHEN** a pull request modifies `user-docs/**`
- **THEN** the workflow builds both landing and docs and runs the checks
  without deploying

#### Scenario: Cached docs dependencies
- **WHEN** the workflow runs on an unchanged docs lockfile
- **THEN** npm dependencies restore from cache instead of a cold install

### Requirement: Docs authors can preview locally
The docs directory SHALL provide dev and preview commands so an author can
edit markdown and see the rendered site locally before pushing.

#### Scenario: Author previews an edit
- **WHEN** an author runs the docs dev command inside `user-docs/`
- **THEN** the site is served locally at the configured base path and
  reflects saved edits
