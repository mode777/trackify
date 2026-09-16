# admin-catalog-upload

## Purpose

Provides a batch, CLI-parity flow for populating the Trackify catalog:
select a folder of audio files, review and edit the derived game and track
metadata, then upload everything with per-item progress and idempotent
create-or-skip semantics identical to the existing upload tooling.

## ADDED Requirements

### Requirement: Folder and multi-file selection
The admin page SHALL accept a folder selection (including nested files and
their relative paths within the selected folder) and multi-file selections.
Every accepted audio, image, and sidecar file SHALL enter the staging area
with its path relative to the selection root preserved.

#### Scenario: Selecting a game folder
- **WHEN** the user selects a folder containing audio files, an image, and a
  sidecar library file
- **THEN** all of them are staged with their relative paths intact

#### Scenario: Selecting individual files
- **WHEN** the user selects multiple individual files instead of a folder
- **THEN** all selected files are staged without a platform/game path prefix

### Requirement: Staging groups files into games by path convention
Staging SHALL group playable files into games using the same path-derived
rules as the CLI tooling: the platform is taken from the first path segment
under the selection root, the game from the second segment, and a file is
playable when its extension maps to a known platform. Only playable files
SHALL produce track rows. Non-playable, non-image files (sidecar libraries,
resource files) SHALL be attached to their game's file bundle without
producing track rows. Files outside the `<platform>/<game>/` convention
SHALL be surfaced to the user as ungrouped rather than silently dropped.

#### Scenario: Conventional layout is grouped
- **WHEN** the selection contains `psx/my-game/a.psf` and `psx/my-game/b.psf`
- **THEN** one game (platform `psx`) is staged containing both files as tracks

#### Scenario: Sidecars upload but produce no tracks
- **WHEN** a game folder contains a playable file plus a sidecar library file
- **THEN** the sidecar is included in the game's file bundle and no track row
  is created for it

#### Scenario: Images are never tracks
- **WHEN** a game folder contains image files
- **THEN** no track rows are created for them

### Requirement: Cover art selection
For each staged game the admin page SHALL propose the first image file found
in the game's folder (sorted by name) as cover art, and SHALL allow the user
to replace it with a manually chosen image file or clear it. Games without
cover art SHALL be uploadable.

#### Scenario: Cover art auto-discovered
- **WHEN** a staged game folder contains one or more image files
- **THEN** the first image (sorted by name) is proposed as that game's cover art

#### Scenario: Manual cover override
- **WHEN** the user replaces or clears the proposed cover art before upload
- **THEN** the uploaded game uses the user's selection (or none)

### Requirement: Metadata probing via the audio cores
Before upload, the admin page SHALL attempt to derive each playable file's
title, artist, and length by loading it into the WASM core matching its
platform, staging the game folder's files in the core's virtual filesystem so
sidecar libraries resolve. Probing results SHALL prefill the staged track's
editable fields. When probing fails or the file type has no core-based probe,
the track SHALL fall back to a filename-derived title and length `-1`,
matching the CLI's fallback behavior. Probing SHALL run entirely client-side
before any upload starts.

#### Scenario: Successful probe prefills metadata
- **WHEN** a playable file is staged and its platform core loads it successfully
- **THEN** title, artist, and length fields are prefilled from the core metadata

#### Scenario: Probe failure falls back gracefully
- **WHEN** a file cannot be probed (load error or unsupported type)
- **THEN** the track keeps a filename-derived title and length `-1`
- **AND** staging and upload continue for the remaining files

### Requirement: Everything is editable before upload
All staged values — per-game title, platform, year, company, and cover art;
per-track title, artist, and length; and the derived record identifiers —
SHALL be editable before the upload starts. No network write SHALL occur
before the user explicitly starts the upload.

#### Scenario: Editing before upload
- **WHEN** the user edits a game's title or a track's artist in the staging view
- **THEN** the edited values are used when the upload runs

#### Scenario: No writes before starting upload
- **WHEN** the user has staged and edited files but not started the upload
- **THEN** no create or update requests have been sent to PocketBase

### Requirement: Deterministic CLI-parity record identifiers
Record identifiers for created games and tracks SHALL be derived
deterministically from the staged paths using the same normalization rules
as the CLI tooling, so uploading the same folder twice produces the same
identifiers and identical records to what the CLI would create.

#### Scenario: Same input yields same identifiers
- **WHEN** the same folder is staged twice (in separate sessions)
- **THEN** the derived game and track identifiers are identical

#### Scenario: Admin page matches CLI output
- **WHEN** the same folder is uploaded once via the admin page and once via
  the CLI tooling
- **THEN** the resulting game and track record identifiers match

### Requirement: Create-or-skip upload semantics
The upload SHALL be idempotent. For each staged game: if a game with the
derived identifier already exists, it SHALL NOT be recreated and its existing
metadata SHALL be left unchanged; otherwise it SHALL be created. For each
file: if the game's file bundle already contains a file with the same name it
SHALL be skipped; otherwise it SHALL be uploaded into the game's bundle. For
each track: if a track with the derived identifier or filename already exists
it SHALL be skipped; otherwise it SHALL be created with `filename` equal to
the uploaded file's stored name so the player can resolve the audio. Existing
records SHALL NOT be modified by re-upload (the CLI's field-patching sync
behavior is out of scope for the admin page).

#### Scenario: Re-uploading the same folder
- **WHEN** a folder is uploaded successfully and uploaded again unchanged
- **THEN** no duplicate games, files, or tracks are created and existing
  records are unchanged

#### Scenario: Partial prior upload is completed idempotently
- **WHEN** a previous upload created a game but failed partway through its
  files and tracks, and the same folder is uploaded again
- **THEN** the missing files and tracks are created while already-present
  files and tracks are skipped

#### Scenario: Track filename matches stored file
- **WHEN** a track is created from an uploaded file
- **THEN** the track's filename equals the basename under which the file was
  stored in the game's bundle

### Requirement: Per-item upload progress
During upload, the admin page SHALL display a progress state for every staged
item (games, files, tracks): pending before its turn, active while its
request is in flight, and one of completed / skipped / failed afterwards.
An item's failure SHALL NOT abort the remaining batch. Each failed item
SHALL be individually retryable after the batch pass completes. Upload order
SHALL satisfy dependencies: a game and its files before the tracks that
reference them.

#### Scenario: Per-item status is visible
- **WHEN** an upload is running
- **THEN** each staged item shows its current state
  (pending / active / completed / skipped / failed)

#### Scenario: One failure does not stop the batch
- **WHEN** one file upload fails during a batch
- **THEN** the remaining files and tracks still upload
- **AND** the failed item is marked failed and can be retried

#### Scenario: Retry after a failed pass
- **WHEN** the user retries failed items after a batch pass
- **THEN** only the failed items are attempted, and items already completed
  are not re-sent
