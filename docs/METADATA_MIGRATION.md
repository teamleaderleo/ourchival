# Compact visual metadata rollout

The catalog now stores machine tag definitions in `visualTerms`, model lists in
`visualRecipes`, and scored per-image tag IDs in an OTG-v1 binary payload. Scores
remain float64. Machine vocabulary stays separate from the owner-visible saved
tag list. Both dictionaries allocate immutable codes from the same sequence.

`visualEnrichment:submit` accepts the existing readable worker payload and
normalizes it on write. `inspect` and the search projection expand the compact
representation, so the worker protocol, review UI and keyword search retain
their existing behavior. OCR, captions, original input identities, ratings,
timestamps and owner corrections retain their existing storage and meaning.
The compatibility reader also accepts old inline tag/model records during
migration. No original media bytes are written.

## Migration

Export the deployment metadata before rollout. Deploy from a checkout that also
contains the deployment's current Drive and capture behavior. In particular, the
Air Blue local-vault deployment must not be replaced with the main-only archive
branch without integrating its local-vault changes.

Call the owner-authenticated `metadataMigration:start` mutation, then read
`metadataMigration:status`. The scheduler assigns missing saved-tag codes in
32-tag pages and compacts legacy results in two-result pages. Each result is
expanded and compared before repeated fields are removed in the same transaction.
The committed cursor and phase are resumable; calling start again fences older
scheduled work with a new generation and resumes the committed cursor. A
completed migration is a no-op on repeated start.

Existing IDs, saved-tag assignments and correction records remain unchanged.
The search projection does not need rebuilding solely for representation changes.
A first deployment of archive-wide search still needs its separate search
backfill. Missing derivatives remain eligible for the existing media pipeline.

If a page fails, its data changes and cursor update roll back together. Inspect
the private function error and fix its cause before calling start to resume.
Conflicting model provenance under the same pipeline fingerprint is rejected.
For rollback, retain the compatibility reader. Reverting to a release that only
understands inline results requires expanding compact records first or restoring
the affected tables from the pre-migration export while accounting for newer
writes; do not simply remove the new shared tables.

## Ergonomics

The teaching panel now lets the owner create or edit a definition in place,
remembers the selected tag while navigating images, and shows one asset at a
time in multi-image references. Positive examples can explicitly also assign
the tag to that image. Clearing an example does not remove independently saved
tags. The tag catalog supports filtering by current and previous names.
Opening the teaching panel brings it into view; shorter viewports use a smaller
preview so the image and decisions remain together.

Validation includes legacy-to-compact reconstruction, shared dictionary and
recipe reuse, stale migration generation fencing, uint32 boundary handling,
malformed payload rejection, preservation of corrections/assignments, and the
separate semantics of clearing an example versus removing a saved tag.

## Air Blue rollout, September 5, 2026

The integrated local-vault build passed 144 Vitest tests, three launcher tests,
full typechecking and production build. The local backend was deployed and the
metadata migration completed, assigning one existing saved tag a stable code.
The archive had no visual-enrichment rows to convert; future submissions use
the compact representation. A private pre-migration export is retained.

Before/after exports preserve all 18,398 reference records and 20,759 source
snapshots exactly. The asset count remains 16,582. The existing media pipeline
completed derivatives for 128 assets during the rollout, adding preview/thumb
IDs, dimensions and hashes without changing original storage or source locations.
The local UI is served at http://127.0.0.1:3000 from the integrated production
build. Cloud deployment is unchanged.

The typography pass changes the archive heading tracking from -0.06em to
-0.018em and uses a shared 12/13/14px scale for captions, controls and body text,
with less dense card titles and navigation.
