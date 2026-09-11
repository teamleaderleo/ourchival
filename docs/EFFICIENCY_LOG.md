# Local efficiency log

Running notes for the Ourchival efficiency series. Benched against the Air Blue
local vault (18k refs, 2.3 GB sqlite) while warm. Goal: fit comfortably in
Convex Starter usage (or hard-cap Free) with Drive holding the originals.

## Baseline (2026-09-11, pre-passes)

- `GET /references?limit=12` (gallery page): warm 70–190 ms, **51,040 bytes**
  (~4.2 KB/ref). First hit after deploy ~2.5 s.
- Byte split per 12-ref page: assets 58% (28.7 KB), sourceSnapshot 25%
  (12.5 KB), rest IDs/URLs/cursors.
- Heaviest single field: asset `fetchReceipt`, 10.1 KB/page (46% of assets).
- Gallery fetches on demand with in-flight dedup + 10-view cache
  (`useReferenceVault.ts`); no blind polling found (LOCAL_DEV's
  "refreshes every few seconds" is stale).
- Per-minute crons (`queueMissingMedia` limit 4, `previewMigration.advance`)
  are already early-exit when idle: ~2 indexed reads each, but each costs a
  **write transaction + function call** (86k calls/mo ≈ 9% of Free's 1M).

## Pass 1 — feed maintenance gating (done)

`/references` ran `initializeReferenceStats` + `ensureExportRequested` as
mutations on **every** page hit. Both are one-time bootstraps (no-op when
warm) but each still cost a write transaction.

- Added `hasReferenceStats()` (`lib/referenceCatalog.ts`) and
  `feedMaintenanceStatus` query (`httpDb.ts`).
- Handler resolves readiness with two parallel indexed reads, mutates only
  when rows are missing (`convex/http.ts`).
- Warm hits: 2 write-txns → 2 indexed reads. Cold guarantee unchanged.
- Tests: `convex/httpReferences.test.ts` (bootstrap-once, warm read-only,
  auth). Suites green: http, httpDb, ownedFeed, archiveSearch,
  archiveDiscovery. `tsc -p convex/tsconfig.json` clean.

## Pass 2 — compact feed payload (done)

`hydrateReference` spread full asset + snapshot docs. Grep over
`apps/web`, `apps/extension`, `packages` showed zero reads of: asset
`fetchReceipt` / `promotionReceipt` / `jsonMetadata` / `fetchedUrl` /
`qualityReason`, snapshot `fieldSources` / `sourceMetadata`.

- New opt-in `?compact=true`: strips exactly those fields, data stays stored.
  Default (no param) is byte-identical full payload.
- Gallery sends `compact=true` (`useReferenceVault.ts`). Detail surfaces
  (quick look, decks, inspector) read only kept fields — verified per-field.
- Live bench: 51,040 → 32,666 bytes (**−36%**), same latency class
  (warm ~100–300 ms both). Titles/refs identical across modes.
- Tests: compact strips + preserves card fields; full mode keeps receipts.

## Pass 3 — event-driven derivatives, crons to backstop (done)

Captures never queued derivative jobs; the 1-min `queueMissing` cron was the
only automatic path besides viewing. Global-scale rule: events, not polling.

- New `queueForAsset` internal mutation (`mediaDerivatives.ts`): exact,
  idempotent per-asset enqueue (dedups via active-job check, marks
  link-only/ready without jobs).
- `/capture` schedules it on both fresh captures and duplicate saves with a
  new stored asset (`http.ts` + `scheduleDerivativeQueue`).
- Crons demoted to strays-recovery: `queueMissing` 1 min/limit 4 → 2 min /
  limit 8 (same hourly throughput, 3× fewer calls); `previewMigration.advance`
  1 min → 5 min (active migrations self-chain at 10 s; cron only revives
  interrupted scheduling).
- Cron call savings: ~86k → ~36k calls/mo for the pair.
- Tests: `convex/captureDerivatives.test.ts` (targeted queue, idempotence,
  link-only failed-marking, asset-less capture schedules nothing, captured
  asset queueable, drive-file ETag/304/401).

## Pass 4 — entity tags on the byte proxy (done)

`/drive-file` streamed full originals with `max-age=3600` and no validator,
so every hourly repeat view re-streamed megabytes. Drive originals are
write-once (new bytes mint new IDs), making per-ID ETags correct.

- `ETag: "drive-{fileId}"` + `If-None-Match` → 304; `Cache-Control:
  private, max-age=86400`.
- Live bench (2.6 MB original): first 0.91 s / 2,639,708 bytes → revalidate
  **304 in 10 ms / 0 bytes**.
- Correctness preserved: any client revalidates instead of trusting stale
  bytes; auth still enforced before the 304.

## Pass 5 — index diet (done)

`references` carried 8 indexes + a title search index; each bills as a table
copy and is maintained on every write. Repo-wide audit of every
`withIndex`/`withSearchIndex` call site:

- `by_triage_state`: **zero references** anywhere. Dropped.
- `search_references` (title): defined in schema, never queried — server
  search uses `search_text`, clients filter in memory. Dropped (also frees
  separately-billed search storage).
- Kept: `by_source_url`, `by_canonical_url` (capture dedup),
  `by_capture_session` (session views), `by_captured_at` (default order),
  both `by_browse_lane_*` + `by_published_at` (gallery sorts via
  `archiveOrder`), all asset storage-id indexes (live-media guard
  `storageIsReferenced` — correctness-critical).
- Gallery "prefetch": already exists (`LoadMore` 2-viewport lookahead via
  IntersectionObserver + scroll rAF). No change; verified, not duplicated.

Verification: full suite **392/392 across 101 files**, convex typecheck
clean. Live: one-time 8.4 s schema migration on the 2.3 GB local DB, then
warm feed **7 ms** (fastest recorded), same 32,666 compact bytes.

## Next targets (ranked)

1. ~~Cron cadence~~ (Pass 3). ~~Prefetch~~ (already built). ~~Index diet~~
   (Pass 5).
2. Retention on unbounded tables: `captureObservations`, `enrichmentJobs`,
   `exports` grow forever (storage + index copies).
3. Derivatives → Drive (the big one for file storage): track under
   `BOUNDED_LOCAL_MEDIA.md` step 3.
4. If usage still pinches: self-host Convex (open source) on Big Red —
   same code, own compute, zero metering.

## Housekeeping flags

- `scripts/local-vault.mjs` 3600s wait stays UNCOMMITTED (Big Red owns it).
- Efficiency edits above are normal uncommitted work, safe to commit review.
