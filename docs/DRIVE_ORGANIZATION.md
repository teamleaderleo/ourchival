# Drive organization

The vault root uses stable provenance folders: Twitter (X), Pinterest, Pixiv,
HoYoLAB, Other sources, My Art, and App data. Provider folders separate
Originals, Other renditions, and Unverified images. My Art uses provider folders
with Posted originals and separate Editable sources and Master exports.
Boards, tags, projects, and changing app classifications remain in the catalog.

Originals requires fetched-rendition evidence through `assetQuality`; a legacy
quality label or Drive file presence alone is insufficient. Files without a
catalog asset are conservatively unverified. Artwork publication links and
representations distinguish the owner's work. Moving a file changes only its
parent folder: file ID, bytes, and existing file links remain unchanged.

`node scripts/organize-drive.mjs setup` creates/reuses the folders and activates
the map on the local backend. `activate` restores the saved map without creating
folders. The CLI explicitly uses the local deployment's credentials in a
temporary mode-0600 environment file, removed after the command. It does not
read browser cookies. Root/target mismatches fail closed.

`node scripts/organize-drive.mjs run 500` drains loose root files in batches of
400, using up to four concurrent Google metadata batches of 100. Each inner response must report the
expected parent and removal of the old root before its catalog pointer changes.
Partial batches save per-file failures and HTTP status counts, back off ten
seconds, and stop after three consecutive partial batches. Transport-level
failures stop the run. Repeat after inspecting the error. The root listing is
the resume queue. Completed moves remain in their destination. No folder tree
is recursively rearranged. Unclassified non-media files go to Other sources/Files.
The preference snapshot goes to App data. Existing root subfolders are preserved.

The ignored `.convex/reconciliation/drive-organization/` directory holds the
folder map, move receipts, own-art verification, current-run status and errors.
Status counts are per run; partial failed batches may have moved files before
the failure and are not included in the successful-page receipt total.

After the root is drained, `node scripts/organize-drive.mjs audit` checks catalog
rows still naming the old root. It reads their actual Drive parents in batches
and repairs the catalog pointers without moving files. Unreadable files or files
still in the root remain listed in `pointer-audit.json` for inspection.

New asset uploads use `GOOGLE_DRIVE_FOLDER_MAP`, source URL and fetched quality.
The owner's X source prefixes route posted uploads into My Art immediately.
Other newly identified owned publications may need a later relocation once
ownership is linked; the root-only migration does not revisit provider folders.
Editable sources and master exports attached from elsewhere retain their chosen
location unless they were loose files in the vault root during migration.

Folder IDs are installation-specific and stay out of source control. The map
is persisted in the local Convex environment and the ignored local receipt.
# Following manual Drive changes

Run `node scripts/reconcile-drive.mjs` to inspect every cataloged Drive file by
its stable ID and update stale folder pointers to its actual parent. This does
not move, rename, download, delete, or change the quality classification of any
file. Renaming or moving a configured folder keeps uploads following its ID.
Recreating a folder with a new ID requires an explicit routing-map update.

The audit checkpoints in `.convex/reconciliation/drive-organization/reconcile.json`.
Re-running resumes an interrupted audit; use `--fresh` for a new audit after
another round of manual changes. Missing, trashed, inaccessible, and ambiguous
parent results remain unresolved in the receipt. They are not silently removed
from the catalog. A successful metadata audit does not verify image bytes.
