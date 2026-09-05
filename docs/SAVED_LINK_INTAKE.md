# Saved links, sessions, and archive horizons

Parent contract: [Archive intake and agent access](ARCHIVE_INTAKE_AND_AGENT_ACCESS.md).
Implementation is stacked on `codex/local-first-vault` / PR #101 at `4cb2332`.
The active X Likes import remains on its existing endpoint and extension build.

## Three horizons

Here, the user is trying to save a large backlog safely and find a useful next
item without first filing everything.

| Horizon | Unit and useful actions | State owner |
| --- | --- | --- |
| Capture / Inbox | Save first; show an import receipt and a small newest/unreviewed sample. Preserve every source occurrence, even when a reference already exists. | Capture session owns transport progress; reference owns Inbox state. |
| Triage / projects / collections | Keep, Later, Archive, favorite, annotate why useful; add references to multiple collections or a project. Review one session, source, date range, or small batch at a time. | User decisions on references and explicit membership edges. A project adds purpose/status; a collection groups references. Neither is an ingest queue. |
| Durable archive / retrieval | Retrieve by source, creator, topic, project, capture date, or original text; export portable catalog generations. Restore a user's archived item only through an explicit decision. | Catalog and source evidence are authoritative; search and agent indexes are rebuildable projections. |

`captureSessions.status=completed` means intake has committed, not that the user
has reviewed the references. `reviewState` is independent. Archive is a user
visibility decision; successful byte storage, metadata fetch, import completion,
and backups are separate facts. A link can be archived with unavailable media.

## Provider-neutral record boundaries

| Entity | Preserve when available | Do not conflate |
| --- | --- | --- |
| Link/reference | Submitted URL and title, normalized identity URL, observed canonical/redirect evidence with time, kind, capture time, selected text, notes, user review state | A fetched title does not replace the original import title. Tracking cleanup is identity policy, not deletion of evidence. |
| Tab / browser session | Ordered tab occurrences, original title/URL, window/group labels, pinned/active flags, optional opener relation, capture time | Tab order is occurrence context, not ranking. A browser session is not a project. Browser tab IDs are temporary and must not become portable identity. |
| Image / asset | Owning reference, original media URL, byte hash if downloaded, MIME, dimensions, source index/count, alt text, owned storage locator, creator/license evidence | A preview URL is not ownership or proof that the original bytes are archived. Several assets can belong to one post. |
| Post | Stable provider post ID, source/author URLs, displayed creator identity, text, publication time, ordered assets; quote/reply relations only if observed | Engagement is timestamped evidence, not durable identity. A post and each of its images need not become duplicate references. |
| Board / collection | Stable external ID/URL, title/description, owner, ordered membership occurrences, source and capture time; local membership remains independently editable | Importing a saved board does not authorize following it or continuously syncing changes. Remote membership does not overwrite local filing. |
| Source occurrence | Session key, accepted-input ordinal, original URL/title, provider/native IDs when known, parser version and capture time; repairable snapshot | One reference may have many occurrences across imports. The first reference's `captureSessionId` is not the complete provenance graph. |

A normalized URL is deterministic under a versioned policy. This slice reuses
`normalizeSourceUrl`: host normalization, known tracking removal, sorted query,
fragment removal and trailing-slash normalization. Those are existing archive
semantics; fragment-sensitive documents may need a future policy version.
Provider post ID and asset byte hashes can add stronger identity evidence later.
Canonical collisions must retain occurrences and never erase user annotations.

Agent enrichment writes derived fields with source/model/version/time and
confidence, leaves the input snapshot intact, and is retryable independently of
capture. It may suggest tags, summaries, OCR and collection membership. It must
not silently change Archive, Trash, favorite, review decisions or project
membership. Agent reads should be field-selective and cursor-bounded; the
original document's first-25/max-100 query contract remains the target.

## Implemented slice

The existing popup's pasted-link and bookmarks-HTML controls now use
`POST /capture-links`. OneTab URL-first and title-first lines are supported.
There is no new queue, ledger, table, or storage provider. The implementation
reuses `captureSessions`, `references`, `sourceSnapshots`, reference insertion,
reference statistics, authentication and the archive's URL normalization.
Existing X Likes and tab capture paths retain their behavior.

1. Parse the input into an ordered manifest of HTTP(S) occurrences. Keep repeats
   and their distinct titles. Blank/non-URL lines are ignored. Ordinals are
   zero-based positions in this accepted manifest, not physical file lines.
2. SHA-256 of `[1, source, [[originalUrl, originalTitleOrNull], ...]]` becomes
   `saved-links-v1:<digest>`. Same parsed source/title/order resumes the same
   session; changed content or source format intentionally creates a new one.
3. Send an empty probe at offset zero to retrieve the authoritative cursor.
   Then send at most 50 occurrences per request. Limits: 100,000 occurrences,
   2,048 characters per URL, 1,000 per title, 750,000 request bytes. Embedded URL
   credentials are rejected. Inputs beyond a limit are not truncated silently.
4. One Convex mutation validates the batch, reconciles references, inserts one
   source snapshot per occurrence (including duplicates), updates statistics
   for new references, and advances the contiguous cursor and aggregate counts.
   It does no metadata fetch or media download. Such work is deferred.
5. Receipt: session key, next offset, total, cumulative saved/duplicates,
   replayed and complete. No URL array, unbounded failure list, or per-item
   response. A rejected batch commits nothing and leaves the cursor unchanged.
6. Replay wholly below the cursor returns the current receipt without writes.
   Gaps and partial overlaps fail. Source/count changes fail for an existing
   identity. The paired client owns manifest hashing; this is not an adversarial
   proof of the full manifest. Do not use the endpoint for mutable feeds.

Source snapshot JSON stores version, session key, source, ordinal, original
URL/title and occurrence capture time. A duplicate preserves the existing title,
first session, tags and review state, including Trash. Snapshot provenance is
retained even though the existing session UI lists only references whose first
capture belongs to that session; browsing *all occurrences* requires a later
indexed provenance view.

The popup keeps the parsed input only in memory and sends bounded messages to
the worker. Closing it pauses after any in-flight transaction. Re-submit the
same input to resume, including after a worker restart or lost response. The
backend session is the durable receipt; the extension does not persist the full
manifest or a failure list. Keep the original input file for recovery. The
popup displays counts, completion and that recovery action. A connection change
mid-run stops the next batch; a fresh submission probes that destination anew.
An active X Likes import blocks saved-link requests without pausing it.

Known bounds: the file parser still loads the file in popup memory; this is not
a streaming file reader. Invalid/non-HTTP lines are ignored as before and are
not included in the accepted total. A future preview should report rejected
line counts. No automatic background continuation, enrichment, board filing or
media transfer is included. Full-input SHA-256 and accepted-occurrence order
must remain stable for version 1 clients.

## Compatible adapters

Pinterest saved boards should emit the same stable manifest/session contract
from an explicit user export or bounded observed pages, preserving board ID,
owner, membership order, pin ID and outbound source separately. Pins may resolve
to an existing reference; their board occurrence survives. Materialize collection
membership only when requested. For mutable feeds use the X Likes-style stable
run identity plus native cursor, not a changing whole-feed digest.

### Pinterest live probe (2026-09-04)

A read-only probe against the owner's saved-board UI confirmed the following
adapter constraints:

- The profile exposed 14 boards with 3,641 reported board memberships. Board
  URLs, titles, reported pin counts and a stable numeric board ID were visible
  without opening individual pins.
- Board cards exposed stable numeric pin URLs, a display label/alt description
  when Pinterest had one, and proxied thumbnails. A representative detail page
  exposed a larger proxied image. Some cards exposed an outbound `Visit site`
  URL while others did not, so a Pinterest pin URL and an outbound source URL
  must remain separate optional facts.
- The grid is virtualized: after one ordinary scroll, none of the first eight
  rendered pin IDs remained in the DOM. A fast two-page stride reached the end
  of a 794-pin board but reconciled only 769 unique rendered pin IDs. A slower
  one-page pass raised that to 772, still leaving 22 memberships unresolved.
  The adapter must never equate “reached the bottom” with complete capture.
- A receipt therefore needs at least `reported`, `observed`, `unresolved`,
  current board/cursor position and a bounded set-reconciliation digest. A run
  may be `exhausted` while remaining `incomplete`; it should be resumable with
  smaller overlap windows or a provider cursor when one is available.
- One monolithic scroll exceeded the browser controller's 30-second operation
  bound. Keep each observation chunk comfortably below that limit, persist its
  receipt before the next scroll, and tolerate DOM replacement between chunks.

These observations support a board-at-a-time adapter with overlapping windows,
not a single account-wide mutable manifest. The reported membership count is a
reconciliation target, not proof that every membership remains renderable.

Pixiv bookmarks should preserve artwork ID, creator ID, bookmark visibility,
bookmark tags, page count and ordered page assets. Start with saved artwork
links through this endpoint; richer post/media payloads should reuse the
existing capture machinery and source snapshots with bounded provider cursors.
Do not embed account cookies or credentials in records or portable exports.

### Pixiv screenshot probe (2026-09-04)

The owner's authenticated bookmarks page confirms a stable collection route of
`/en/users/{userId}/bookmarks/artworks` and exposes these source dimensions in
the normal UI:

- artwork-kind selection (the visible selection was Illustrations)
- newest-first ordering
- public-bookmark visibility, with a separate visibility filter
- bookmark tags
- work tags and bookmark-date filters, currently marked as premium UI
- an explicit reset action and a separate bulk-edit surface

The visible grid showed five artwork cards across. At least one card displayed
a `3` overlay, confirming that a bookmark occurrence can refer to a multi-page
artwork and that page count must not be inferred as one from the grid thumbnail.
A second screenshot confirmed that each grid card visibly carries an artwork
title and creator display name, while hover status exposes a stable
`/en/artworks/{artworkId}` URL. Creator IDs still require detail-page evidence;
display names are not identity.

The same screenshot showed numbered pages `1` through `7` plus a next-page
control. This makes page number a natural bounded transport cursor, subject to
verifying its URL representation and behavior when new bookmarks arrive. A
total artwork count and final page remain unverified, so the adapter must not
infer completion merely from the first visible pagination window.

The second page URL was observed as
`/en/users/{userId}/bookmarks/artworks?p=2&rest=show&mode=all`. Persist the
integer page, visibility (`rest`) and work-mode filter as separate receipt
fields rather than treating the full query string as an opaque cursor. New
bookmarks can shift later pages, so resumable imports must overlap adjacent
pages and reconcile artwork IDs instead of resuming from page number alone.

A multi-image detail page exposed a stable `/en/artworks/{artworkId}` route,
`1/2` position/count, a `Show all` control, title, creator display name, tags,
engagement counts and publication time. These are source evidence; mutable
engagement counts must be timestamped and must not participate in identity.
Ordered assets belong to the one artwork record.

The private-bookmark surface showed an `Illustrations and Manga` count, explicit
Public/Private choices, R-18 badges, per-work page-count badges and unavailable
`Deleted or private` placeholders. Preserve an unavailable occurrence as a
tombstone with its ordinal when an artwork ID is observable; do not silently
drop it or invent metadata when it is not.

Treat filter state as part of the capture session identity and receipt. Public
and private bookmarks must be separate bounded runs, while every artwork keeps
one provider artwork identity with ordered child assets. Premium-only filters
are optional discovery aids, not intake requirements.

### Sensitive-media intake defaults

Private bookmarks, provider-marked R-18 works and adult-oriented sources should
default to a sealed intake lane. This is a presentation and review policy, not
data loss or a second archive:

- Preserve the original asset, source metadata and exact provider rating. Store
  `unknown`, `general`, `suggestive` and `explicit` as reviewable sensitivity
  states; provider assertions and classifier suggestions retain provenance.
- Generate replaceable safe-preview derivatives (blur, neutral placeholder, or
  an optional face-/composition-aware crop). Never overwrite or treat a crop as
  the archived original.
- Exclude sealed items from ordinary Inbox thumbnails, daily resurfacing,
  notifications and default search previews. Counts and text metadata may still
  appear without revealing the image.
- Give enrichment agents metadata or a safe-preview derivative by default.
  Sending an original sealed asset to an external model requires an explicit
  provider policy and user opt-in; local sensitivity detection may run earlier.
- Reveal one item, a bounded sample, or an explicit review session. Support a
  configurable daily reveal budget so some sensitive reference review is
  possible without flooding the normal workflow.
- Default unknown material from adult-oriented sources to sealed. Provider
  categories, gallery tags and page counts are evidence, not permission to
  display every thumbnail.

The same policy can cover future gallery-style providers without teaching the
core archive about a specific site. Source adapters collect evidence; the vault
owns sensitivity, preview, retrieval and review behavior.

The initial task said “Pixabay” and asked whether that meant Pixiv. Repository
platform/parser support names Pixiv, and on 2026-09-04 the coordinating task
relayed Leo's explicit clarification that Pixabay was speech recognition for
Pixiv. Treat Pixiv as the intended adapter; no separate Pixabay lane is planned.

## Production sync boundary (design only)

Production Convex remains a reasonable destination for a later idempotent local
vault sync. Restored usage is a prerequisite reported by the user, not evidence
that capacity, current data or permissions have been checked. Keep capture
local until the following boundary has been implemented and validated.

- Export a consistent local generation with schema/normalizer version, origin
  vault ID, stable logical record IDs, counts, content digests and media locators.
  Never reuse deployment-local Convex IDs as cross-vault identity. Keep an
  encrypted local backup and a production backup before the first apply.
- Upsert by `(originVaultId, logicalId)` and reconcile existing production
  references by canonical/native identity before inserting. Map local IDs to
  production IDs for assets, snapshots, sessions and membership edges. Preserve
  all source occurrences. Carry explicit revisions and tombstones; absence in
  a partial export never means deletion.
- Use bounded transactions with generation/batch digests and an acknowledged
  contiguous checkpoint inside the existing session mechanism. Each replay
  returns the same effect. A portable identity/mapping extension to the catalog
  is prerequisite work, not implemented by this saved-link endpoint.
- Production user edits win unless a field has an explicit merge policy.
  Preserve both conflicting notes/derived values for review. Never reactivate
  Trash or overwrite favorite, Archive or memberships through last-write-wins.
- Reuse verified Drive file IDs where access is valid; do not copy media merely
  because a reference moved. Transfer missing owned bytes by hash through an
  explicit storage adapter. Credentials, cookies and deployment secrets stay out
  of exports, logs and receipts.
- Dry-run against a named production deployment: show new/matched/conflicting
  counts, unresolved relations, bytes to transfer and projected resource use.
  Validate with a small disposable fixture and replay it twice; compare counts,
  identity and representative retrieval results. Then show the exact destination
  and planned writes for approval before applying real data.
- Roll out by bounded generation, reconcile counts/digests and retrieval, then
  optionally change capture routing as a separate approved action. Rollback
  removes only newly created records proven to belong to the sync generation;
  pre-existing production edits require backups/conflict records, not blanket
  deletion. Keep local capture and both backups until reconciliation succeeds.

No production sync, deployment, endpoint switch, extension reload, or browser
import action was performed to implement this lane.
