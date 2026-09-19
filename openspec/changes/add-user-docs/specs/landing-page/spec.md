# landing-page delta (docs wiring)

## ADDED Requirements

### Requirement: Landing page links to the documentation site
The landing page SHALL link to the published docs site from the main
navigation (Docs button), the hero calls to action, the self-host section,
and the footer, using relative `docs/…` paths that resolve inside the
deployed Pages artifact.

#### Scenario: Visitor reaches the docs from the landing
- **WHEN** a visitor clicks the Docs button in the landing navigation
- **THEN** the docs site opens at the `/docs/` path of the Pages URL

#### Scenario: Self-host readers land on the hosting guide
- **WHEN** a visitor follows the self-host section or footer docs links
- **THEN** the corresponding docs pages (hosting, administration) open

#### Scenario: Docs links pass the existing link check
- **WHEN** the workflow's landing link checker runs after this change
- **THEN** every new `docs/…` reference resolves to a file in the composed
  Pages artifact
