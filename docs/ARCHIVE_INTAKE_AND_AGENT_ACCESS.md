# Archive intake and agent access

## Decision

Keep the live Ourchival catalog in Convex only as the current complete adapter.
Do not let Convex own Ourchival login or remain the sole availability path.
Keep Google Drive as the portable home for originals. Add the local-first vault
from [LOCAL_FIRST_VAULT.md](./LOCAL_FIRST_VAULT.md), then move the web app and
Clipper behind the provider-neutral archive contract before selecting another
cloud catalog.

Build two provider-neutral seams first:

1. a resumable import protocol for large source dumps such as OneTab,
   bookmarks, and X Likes;
2. a bounded query and snapshot surface for ChatGPT, Codex, and offline tools.

This separates three jobs that should not be forced into one storage product:

| Job                                         | Current owner        | Direction                                               |
| ------------------------------------------- | -------------------- | ------------------------------------------------------- |
| Mutable catalog, review state, sessions     | Convex               | Keep until measured limits justify a catalog migration  |
| User-owned original media                   | Google Drive         | Keep as the portable default                            |
| Generated derivatives                       | Convex Storage       | Keep; make the provider replaceable                     |
| Raw import payloads and immutable snapshots | None                 | Add an object-store adapter when persistence is needed  |
| Agent filtering and retrieval               | Preference JSON only | Add compact query tools plus portable catalog snapshots |

The archive source of truth remains Ourchival. Agent-facing files and search
indexes are projections that can be rebuilt.

## Workload and invariants

The design target is tens of thousands of links and posts, with much larger
media bytes attached to only some records.

- Intake must be chunked, resumable, and idempotent.
- Replaying an import must not create another reference or another session.
- Exact duplicates may collapse to one reference, but every source occurrence
  keeps provenance: source, import identity, ordinal, and capture time.
- Canonicalization is reversible. Keep the submitted URL even when a normalized
  or fetched canonical URL becomes the deduplication key.
- A failed enrichment fetch must not make the reference disappear.
- Archive, Later, Keep, Trash, and Favorite remain user decisions. An importer
  must not infer destructive outcomes.
- Agent reads are field-selective, cursor-paginated, and bounded by default.
- Files, cookies, device credentials, and owner credentials never enter agent
  exports or operational logs.

## Current gaps

### Saved-link intake slice

[Saved-link intake](SAVED_LINK_INTAKE.md) defines the three archive horizons,
record boundaries, adapter plans, implementation limits and production sync
boundary. Pasted/OneTab and bookmark imports now reuse capture sessions through
atomic batches of at most 50 occurrences and bounded receipts. Re-submitting
the same manifest resumes from the server cursor; the popup retains input only
in memory. Generic tab capture still uses `BatchCaptureState` in extension
storage. The X Likes runtime is unchanged.

### Search is not archive-wide

The current reference search checks a bounded chronological page and joins
related fields in application code. The schema's full-text index covers only
`title`. Convex search indexes support exactly one search field and scan at most
1,024 index results, so a denormalized searchable document would improve the
current implementation, but it would still be a product-specific search
surface rather than a general archive query engine.

### The agent bridge exports only review preferences

`ourchival-preferences.json` is useful taste evidence, not a catalog. It cannot
answer such questions as "show unreviewed HoYoLAB links from the last import",
"group duplicate domains", or "export the 300 links matching this project."

## Resumable import protocol

Treat the source dump as immutable input and the capture session as its durable
receipt.

### Identity

Compute an `importDigest` from the parser version plus the normalized ordered
input records. The session key is derived from the source kind and digest. The
same file therefore resumes the same import; it does not create another job.

Each submitted record carries:

```txt
sessionKey
source                 onetab | bookmarks | x_likes | url_list
parserVersion
ordinal
submittedUrl
submittedTitle?
sourceGroup?
```

### Processing

1. Parse incrementally and send small batches, initially 50 records.
2. A batch request is idempotent on `(sessionKey, ordinal)`.
3. Normalize the URL and check source URL, canonical URL, source-native ID, and
   asset/hash evidence in that order.
4. Create or reconcile the reference immediately. Defer metadata fetching and
   media work to the existing enrichment path.
5. Return one bounded batch receipt with saved, duplicate, skipped, and failed
   counts plus failed ordinals only.
6. Persist aggregate counts and the highest contiguous acknowledged ordinal in
   the capture session.
7. A retry resubmits the same batch. The receipt distinguishes a replay from
   new work.

For the first slice, the import page may require the user to select the same
file again after a browser restart. The digest and server checkpoint make that
safe. Do not keep tens of thousands of source records in extension local
storage merely to avoid reselecting a file.

If unattended server-side continuation becomes necessary, store the immutable
raw input as an object and process it by byte range. That object can live in
Drive or any S3-compatible store without changing the import semantics.

### OneTab acquisition

Support OneTab's exported `URL | title` text first. It is explicit, portable,
and avoids reading another extension's private IndexedDB. Preserve group names
when an export format supplies them. Direct browser-profile extraction should
be a recovery tool, not the ordinary product path.

## Agent access

Provide both an interactive path and a bulk artifact path.

### Compact query tools

An Ourchival MCP/ChatGPT app should start with four semantically dense tools:

| Tool      | Purpose                                                           |
| --------- | ----------------------------------------------------------------- |
| `find`    | Search and filter references; returns projected rows and a cursor |
| `get`     | Fetch selected fields for exact reference IDs                     |
| `imports` | List import sessions and aggregate receipts                       |
| `export`  | Materialize a filtered immutable snapshot and return its manifest |

`find` defaults to 25 rows and caps at 100. Callers choose fields. Results omit
empty fields and repeated prose. Filters cover triage state, import session,
source/domain, platform, kind, creator, tags, project, date, favorite, archived,
deleted, metadata state, and duplicate/reuse state.

The app authenticates as the owner. It exposes Ourchival data, not the Google
Drive refresh token or Clipper device credential.

### Portable snapshots

Generate snapshots on demand or after a large import, not after every tap:

```txt
ourchival-export-<generation>/
  manifest.json
  catalog.sqlite
  references-000001.ndjson
  references-000002.ndjson
  relationships.ndjson
```

- `catalog.sqlite` is the compact analysis artifact. It contains normalized
  tables and an FTS5 index, so a data-analysis chat or local tool can execute
  real filters without loading the whole archive into model context.
- NDJSON shards are the transparent, streamable fallback. Shards should stay
  below a configured item and byte ceiling.
- The manifest records schema version, generation, filters, row counts, content
  digests, and shard names.
- Media bytes are never copied into the catalog snapshot. Records contain owned
  asset IDs and source links; a separate explicit export may include media.

Drive is a good delivery location because it is already connected and private.
For deterministic analysis, downloading or attaching `catalog.sqlite` is more
reliable than expecting Drive search to reason across thousands of JSON rows.
The MCP query surface remains the best normal ChatGPT experience.

## Provider comparison

### Current Convex + Drive

Best near-term fit. It preserves the working owner UI, pairing, sessions,
realtime updates, and portable originals. Its weak point is flexible
archive-wide search and bulk analytical access. Convex free deployments also
have hard storage and usage caps, so import receipts must expose capacity
failures clearly rather than silently stalling.

References:

- <https://docs.convex.dev/production/state/limits>
- <https://docs.convex.dev/search/text-search>

### Supabase

Best single-provider replacement if Ourchival later wants Postgres, auth,
object storage, full-text search, and `pgvector` together. PostgreSQL generated
search columns and GIN indexes are a much stronger general catalog query layer
than the current page-local search. The cost is a full data/auth/storage
migration and a new RLS security boundary. The free tier currently includes a
500 MB database and 1 GB of object storage and pauses inactive projects, so it
does not remove capacity planning.

References:

- <https://supabase.com/pricing>
- <https://supabase.com/docs/guides/database/full-text-search>
- <https://supabase.com/docs/guides/ai/semantic-search>

### Neon Postgres + an object store

Best modular Postgres option. Neon supplies scale-to-zero PostgreSQL, branching,
and extensions such as `pgvector`; Drive or R2 still owns files. This gives the
strongest conventional SQL/query story but adds another service and does not
replace the app/auth layer on its own. The current free storage allowance is
0.5 GB per project.

Reference: <https://neon.com/pricing>

### Cloudflare D1 + R2

Best compact Cloudflare-native alternative. D1 provides SQLite semantics,
JSON, and FTS5; R2 provides S3-compatible objects with free egress. R2's current
standard free tier includes 10 GB-month of storage. D1's current free database
limit is 500 MB, while paid databases cap at 10 GB each. D1 export has a known
FTS virtual-table caveat, so portable snapshot generation should remain an
application feature.

References:

- <https://developers.cloudflare.com/d1/platform/limits/>
- <https://developers.cloudflare.com/d1/sql-api/sql-statements/>
- <https://developers.cloudflare.com/d1/best-practices/import-export-data/>
- <https://developers.cloudflare.com/r2/pricing/>

### R2 alone

Useful for raw import payloads, generated exports, and possibly derivatives.
It is not a catalog or review database. Adding it now is justified only if
Drive latency, API behavior, or Convex Storage cost becomes measurable pain.

### Google Drive alone

Keep it as the owner-controlled file layer and export delivery path. It is not
a transactional database or a deterministic tens-of-thousands-row query
surface.

## Migration triggers

Re-evaluate the catalog provider when one of these becomes true:

- a representative 50,000-reference import cannot complete within the defined
  capacity and recovery envelope;
- archive-wide filtered search cannot meet its latency target without scanning
  chronological pages;
- the catalog or indexes approach the provider's paid storage/capacity boundary;
- export generation or enrichment contends materially with interactive review;
- the MCP query surface needs joins/ranking that require increasingly complex
  denormalized Convex projections;
- monthly hard-cap incidents prevent owner reads or writes.

At that point, compare Supabase with Neon + R2 using a replay of the same
provider-neutral import corpus and query suite. Do not compare marketing demos.

## Verification corpus

Before any provider migration, build one sanitized deterministic corpus with:

- 50,000 OneTab-style links;
- exact and normalized URL duplicates;
- redirects and canonical-URL collisions;
- X posts with multiple assets;
- failed, slow, and blocked metadata fetches;
- Keep, Later, Archive, Trash, Favorite, tags, boards, and project relations;
- at least ten representative agent filters and full-text queries.

Measure ingest throughput, replay behavior, saved/duplicate/failed receipts,
interactive query latency, snapshot size/time, restore correctness, and monthly
cost. A provider change is accepted only if the same import digest produces the
same semantic archive and the same bounded receipts.
