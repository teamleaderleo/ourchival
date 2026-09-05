# Compact catalog access

## Priority and ownership

Inspected main `99a1e01` and open PR #101 at `4cb2332` on Air Blue.
PR #101 owns the local-first X pipeline. The existing **Design Ourchival link
intake** task owns bulk links/OneTab and `ARCHIVE_INTAKE_AND_AGENT_ACCESS.md`.
The backfill task owns the running Edge import. This complementary slice is
read-only and based on PR #101; it neither deploys nor changes those runtimes.

1. **Immediate intake/inbox:** finish the existing common bulk intake lane.
   Preserve canonical references separately from `(import identity, ordinal)`
   occurrences, original submitted metadata, ordered gallery assets and receipt
   checkpoints. Capture first; tags and destinations are optional. Pinterest
   saved boards and Pixiv bookmarks are confirmed next adapters. “Pixabay” was
   speech recognition, not another source.
2. **Medium-term organization:** build batch triage over existing Inbox, Later,
   Library, Archive, boards/projects and saved searches. Keep original source
   groups separate from user collections. Use actual previews, face-conscious
   crops and fast masonry; keep tools secondary to the archive canvas.
3. **Durable archive:** retain source snapshots/occurrences and all assets;
   append versioned enrichment suggestions with evidence and acceptance state.
   Add immutable snapshots and explicit replica synchronization after intake
   replay and recovery are verified. Agent queries are disposable projections.

## What this slice exposes

Here, the user is trying to select a small catalog slice to give an agent.
Open **Capture sessions → Export catalog for an agent**, or `/catalog-export`.
Choose collection/source, preview, download a page, then check the next page.
The advanced section scopes an import or accepts a saved continuation cursor.
The user must download each wanted page; pages are not accumulated in memory.

`catalog:find` is an owner-authenticated Convex query with:

- `limit`: 1–50 scanned references; web UI uses 25;
- optional `sessionKey`, `platform`, `collection` (inbox/library/later/archive);
- optional allowlisted `fields`, with mandatory reference `id`;
- optional opaque `cursor`, bound to the normalized filters and projection.

It returns `rows`, `scanned`, `returned`, `hasMore`, `nextCursor`, `fields` and
`filters`. Trash is excluded. Exact import scope uses `by_capture_session`;
otherwise traversal uses `by_captured_at`. Other filters apply to one bounded
scan page, so **zero returned rows does not mean the end**. Continue until
`hasMore` is false. There is no implicit whole-archive scan or total count.

Default fields: title, submitted source URL, platform, capture time and triage
state. Optional fields add canonical URL, kind, publication time, author,
capture-session identity, favorite and archived state. This reads a reference's
current catalog fields, not every original source snapshot or repeated save.
The legacy capture-session field cannot enumerate later duplicate occurrences;
occurrence-aware import exports must integrate with the intake lane separately.

Integration target: PR #102 (`fadbf79`) now preserves each accepted occurrence
in `sourceSnapshots.jsonMetadata` with `intakeVersion: 1`, session key, source,
zero-based ordinal and original URL/title. Its import key is
`saved-links-v1:<manifest SHA-256>`. Do not reinterpret `catalog:find.sessionKey`
as a complete occurrence filter: #102 deliberately retains a reference's first
capture session. Add an indexed session/ordinal provenance view before exposing
all import occurrences; avoid scanning snapshot JSON across the archive.

Text is limited to 1,024 Unicode code points per field and marked in
`truncatedFields`. The 13-field allowlist and 50-row ceiling bound output size
even if source titles are huge. Original documents are never changed. Credentials,
notes, raw provider metadata and media payloads are not part of the projection.
Exported source URLs remain private archive content; downloads are local until
the owner chooses to share them.

Each download is one JSON envelope with `manifest` and `ndjson`. The manifest
contains selected fields/filters, UTF-8 byte count, SHA-256 of the exact NDJSON,
row/scan counts and both continuation boundaries. Repeating an unchanged page
produces identical bytes and digest. The digest checks content integrity; it
does not authenticate the file. No credentials are included in continuation
receipts. To resume, restore the same filters and paste `nextCursor`.

## Explicit limits and next boundary

This is a **live catalog projection, not an immutable snapshot or backup**.
Concurrent edits/deletions can change later pages and replayed pages. Cursors
belong to one deployment/index layout and should be restarted after migrations.
The first slice deliberately omits full-text search, arbitrary joins, `get`,
occurrence exports, media manifests, and an MCP wrapper. Those should share this
bounded contract, rather than multiply provider-specific tools.

Proposed synchronization contract, not implemented here:

- Local Ourchival remains the sole write authority for the active archive.
  Assign a stable archive ID and stable entity IDs independent of Convex IDs.
- Append a transactional outbox event with each local change. Identify it by
  `(archiveId, sequence)` and include entity ID, revision, schema version and a
  payload digest. Replica apply and receipt advancement must be atomic.
- Retry identical events safely; reject changed payloads at the same identity.
  Advance only the contiguous acknowledged sequence. Persist tombstones and
  separately verify asset digests before marking media replicated.
- Keep user edits, source snapshots and enrichment suggestions distinct.
  Cloud edits become commands sent to the authority; a cloud replica must not
  silently become an independent writer. A role change requires an explicit
  handover and reconciliation checkpoint.
- Transfer credentials separately from archive data. Never replicate environment
  files, device tokens or owner keys in events or export manifests.

Open product decisions: whether cloud editing is required while the authority
is offline; original-media backup targets and retention; immutable snapshot
cadence; and whether agents need full source text or short projections by default.
The next highest-leverage slice is integrating and verifying the already-owned
OneTab importer, then adding occurrence-aware import exports to this reader.
