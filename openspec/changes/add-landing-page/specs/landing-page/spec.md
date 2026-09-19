# landing-page delta

## Purpose

Give the project a public home: a static landing page published to GitHub
Pages that introduces Trackify, lists supported formats, and shows how to
self-host it — independent of any running Trackify instance.

## ADDED Requirements

### Requirement: Landing page published at the project Pages URL
The system SHALL publish the landing page at the repository's GitHub Pages
URL (`https://mode777.github.io/trackify/`) with the landing page at the
site root, so that visiting the site root renders the landing page directly
without redirects.

#### Scenario: Visitor opens the site root
- **WHEN** a visitor opens `https://mode777.github.io/trackify/`
- **THEN** the landing page renders with hero, feature, supported-formats,
  self-host, and footer sections

#### Scenario: Deep link stays stable
- **WHEN** a visitor reloads or shares the site root URL
- **THEN** the same landing page content is served (static hosting, no
  server-side state)

### Requirement: Landing page is self-contained static content
The landing page SHALL be fully static and dependency-free: every asset
reference SHALL be relative within the deployed artifact, and the page SHALL
render correctly with JavaScript disabled (JS is progressive enhancement
only).

#### Scenario: Renders offline from the artifact
- **WHEN** the composed Pages artifact is served from any static file server
- **THEN** all styles, scripts, and images load from relative paths within
  the artifact and no request targets the Trackify application or a
  PocketBase instance

#### Scenario: Works without JavaScript
- **WHEN** a visitor loads the page with JavaScript disabled
- **THEN** all content sections remain visible and readable

### Requirement: Landing content reflects the actual project
The landing page SHALL present Trackify's supported formats consistent with
the backend table in `README.md` (psx, snes, nez, n64, vgm cores and their
extensions), and the self-host section SHALL show how to build and run the
Docker image. Landing content MUST NOT reference the privately hosted
instance or the private registry hostname.

#### Scenario: Formats section matches supported backends
- **WHEN** a visitor reads the supported-formats section
- **THEN** each listed format maps to a backend that exists in the project
  build

#### Scenario: Self-host instructions work standalone
- **WHEN** a reader follows the self-host section's Docker commands from a
  fresh clone
- **THEN** the commands match the repository's actual Dockerfile usage
  (build the static site, build the image, run it with a data volume)

### Requirement: Pages deployment workflow
A GitHub Actions workflow SHALL build and deploy the landing page to GitHub
Pages on every push to `main` that modifies `landing/` or the workflow file,
SHALL support manual dispatch, and SHALL cancel in-progress deployments when
a newer run starts.

#### Scenario: Push to main touches the landing
- **WHEN** a commit is pushed to `main` changing `landing/**` or the
  workflow file
- **THEN** the workflow builds the Pages artifact and deploys it

#### Scenario: Irrelevant push does not deploy
- **WHEN** a commit is pushed to `main` touching only `web/` or other app
  code
- **THEN** the Pages workflow is not triggered

#### Scenario: Manual run
- **WHEN** a maintainer triggers the workflow via `workflow_dispatch`
- **THEN** the artifact is built and deployed

#### Scenario: Concurrent runs do not interleave
- **WHEN** a second deployment starts while another is in progress
- **THEN** the older run is cancelled

### Requirement: Pull requests validate the landing without deploying
Pull requests that touch `landing/` SHALL run the same build and checks but
MUST NOT deploy to GitHub Pages.

#### Scenario: PR build check
- **WHEN** a pull request modifies `landing/**`
- **THEN** the workflow builds the artifact and runs the checks, and no
  deployment occurs

### Requirement: Landing link integrity check
The workflow SHALL verify that every local `href`/`src` reference in the
landing page resolves to a file inside the composed Pages artifact, and
SHALL fail the run when any local link is broken.

#### Scenario: Broken local link fails CI
- **WHEN** the landing page references a local asset that is missing from
  the artifact
- **THEN** the workflow run fails and reports the broken reference

#### Scenario: External links are out of scope
- **WHEN** the landing page links to `https://` or `mailto:` targets
- **THEN** the link check passes them through without resolution attempts

### Requirement: Private hostname leak scan
The workflow SHALL fail when landing content references the privately
hosted instance's hostname, whenever the `PRIVATE_INSTANCE_HOSTNAME`
repository variable is set; when the variable is unset the scan SHALL be a
no-op that does not fail the run.

#### Scenario: Hostname leaked
- **WHEN** `PRIVATE_INSTANCE_HOSTNAME` is set and any file under `landing/`
  contains that hostname
- **THEN** the workflow run fails with an error identifying the file

#### Scenario: Variable not configured
- **WHEN** `PRIVATE_INSTANCE_HOSTNAME` is unset
- **THEN** the scan step is skipped with an informational message and the
  run proceeds
