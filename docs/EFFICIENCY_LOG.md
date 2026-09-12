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

## Pass 6 — retention sweep + dead table drop (done, pushed `3442204`)

Unbounded growth audit: `captureObservations` (per-item rows per session),
`enrichmentJobs` (full history), `exports` (receipts).

- New `retention.sweep` + daily cron: deletes observations of terminal
  sessions older than 7d (session receipts stay; gap detection only serves
  in-flight sessions) and terminal jobs older than 30d (running/queued never
  touched). Capped per run (50 sessions / 500 jobs) so backlogs drain over
  days, never blowing a transaction.
- Safe for dedup: every derivative queue path checks storage IDs before
  consulting job history. Side effect: transient failures get a fresh attempt
  ~30d later instead of staying failed forever — an improvement, logged.
- `exports` table had **zero readers and zero writers** anywhere (web,
  extension, convex): dropped from the schema entirely.
- Tests: `convex/retention.test.ts` (aged terminal rows go, live/recent
  rows and all session receipts stay). Full suite **393/393 across 102
  files**, typecheck clean.

## Pass 7 — derivatives → Drive mirrors (done, pushed `49b051c`)

The file-storage play: every Convex thumb/preview gets a verified Drive twin,
so metered `_storage` bytes can later be reclaimed without losing a copy.

- `uploadBlobToDrive` gains optional explicit `fileName`, `parentFolderId`,
  `extraFields` (defaults preserve old behavior); new
  `uploadDerivativeToDrive` + `resolveDerivativeParent` (asset's Drive folder,
  else `{Provider}/Other renditions`). Names are asset-scoped
  (`{assetId}-{preview|thumb}.webp/avif`) — shared folders hold many assets.
- New `driveDerivatives` pipeline: `queueMissing` (ready assets lacking Drive
  IDs, active/terminal dedup mirroring the media pipeline), Node worker
  (`driveDerivativesNode`) fetching Convex blobs, uploading, and verifying
  **size + md5** before `complete` records `drivePreviewFileId` /
  `driveThumbFileId`. Failures stay visible; no retry loops.
- Serving: hydration prefers verified Drive IDs through the cached
  `/drive-file` proxy (ETag path from Pass 4); Convex signed URLs stay as
  fallback. Compact payload strips the raw IDs (URLs are prebuilt).
- 5-minute mirror cron (limit 4). Convex blobs are NOT deleted yet — that is
  a separate reclamation pass reusing the `storageIsReferenced` guard.
- Tests: queue/record/serve-preference (`driveDerivatives.test.ts`), pure
  verifier both outcomes (`driveDerivativesNode.test.ts`). Full suite
  **397/397 across 104 files**, convex typecheck clean.

Live validation (done 2026-09-11 ~05:00): the 5-minute cron fired,
`drive_derivatives` jobs queued/ran/succeeded on the local vault (observed
directly in job rows). Oldest-first feed now serves Drive-backed thumbs +
previews (`/drive-file?id=…`); a live derivative thumb returns 200,
`image/avif`, 8.5 KB in 0.5 s first fetch, then ETag/304 cached. The 18k
backfill drains incrementally at 4 jobs/cron — by design, no thundering
herd. Note: concurrent sqlite CLI reads can hit `database is locked`
while the backend writes; kept to two quick probes.

## Pass 8 — protected-URL preload + serving audit (done)

Serving measurements (local vault, warm): thumbs 1–30 KB avg ~13 KB
(`image/avif`, 1–4 ms), previews 52–229 KB avg ~143 KB, all AVIF except one
tiny WebP. Convex signed URLs carry `private, max-age=2592000` + ranges;
browser caching is already optimal. Recipe (1600/WebP-q82-or-AVIF-q55,
384/WebP-q76-or-AVIF-q50, lanczos3, AVIF 4:4:4, effort 4) matches the
`COMPACT_PREVIEWS.md` visual eval: lines/colors hold, AVIF slightly smooths
fine texture — softness, not grain. No recipe change without a visual study.

One real gap, caused by Pass 7's success: quick-look neighbor preload
skipped every `/drive-file` URL, so mirrored items lost prev/next prefetch
just as mirrors started landing. Fix: `primePrivateImageUrl()` warms the
shared blob cache through the same authed fetch path, so opening a primed
neighbor resolves instantly. Cards were already safe (`ThumbImage` →
`usePrivateImageUrl` with thumb→preview fallback cycling).
Tests: primer dedups + swallows failures.

## Pass 9 — stall resilience + deploys unblocked (pushed `0193c0c`)

Two user-visible complaints traced:

- "Couldn't reach your archive": reproduced live — a lone `/references`
  took 7.5 s then returned **HTTP 500** (the known "too many system
  operations" starvation signature, not a query bug). Auth-check normally
  ~10 ms took 2.2 s with just 3 concurrent requests. Single local backend
  process degrades ~100–500× under trivial concurrency while churning.
- Fixes: empty gallery views auto-retry twice (3 s/8 s) behind a
  "Reconnecting…" notice before the manual Try-again screen; loaded views
  keep their data. Access gate retries one timed-out session check.
  Derivative worker batches halved (media 8→4, drive 4→2) to calm the
  event loop. Retries are bounded and abort-aware; no loops.
- Deploy blockage found + fixed: pnpm store held a gutted sharp 0.34.1
  (592 KB, no `lib/`), failing every backend push at bundling. Restored
  `lib/` from the registry tarball (sharp has no root index.js —
  `main` is `lib/index.js`, which misled the first diagnosis). Then the
  CLI reused a stale staging tmp dir with skeleton dirs; clearing
  `.tmpzpJegx` unblocked the push. If pushes fail with "Cannot find
  package …/sharp/index.js" again, suspect store/staging, not code.

1. ~~Crons, prefetch, index diet, retention, Drive mirrors, preload,
   resilience, retina~~ (Passes 3–10).
2. Reclaim Convex derivative blobs once Drive twins verify (reuse
   `storageIsReferenced` guard; keep originals policy unchanged).
3. If usage still pinches: self-host Convex (open source) on Big Red —
   same code, own compute, zero metering.

## Pass 10 — sequential mirror batches

Backfill math forced it: 2 mirrors per 5-minute cron covers 18k assets in
~31 days, and raising burst concurrency is exactly what stalls the backend.
The global-scale answer is batch workers, not bigger bursts.

- New `claimNextUpload` mutation: the worker pulls its next asset itself
  (skipping mirrored/queued/terminal, honoring an exclusion list) instead
  of the cron fanning out N concurrent actions.
- The Node worker now loops up to 25 assets or 8 minutes per invocation,
  steady sequential I/O, then stops; any failure ends the batch (a systemic
  Drive outage must not fail-spam) while the cron seeds the next one.
- `complete` is first-wins: concurrent twins never overwrite a recorded
  verified identity.
- Throughput: ~50 assets per 5 min ≈ 600/hr → full backfill in ~30 hours,
  at *lower* peak load than before.
- Tests: claim/next-null/first-wins; full suite **400/400**, typecheck
  clean.

## Pass 11 — reclaim metered bytes

The payoff pass: metered Convex blobs now actually disappear once Drive
twins verify. `queueMissing` reclaims (not just queues) for mirrored
assets: shared blobs stay until their last referrer detaches, then delete
+ clear IDs. Regen-storm guards everywhere a derivative could be
re-requested: media `enqueue`/`queueMissingAssets`/capture-hook treat
Drive-mirrored assets as ready; `complete` is first-wins; stale jobs for
reclaimed assets succeed quietly.

- SSD vs RAM, for the record: the ~3.7 GB lives on **SSD** (local
  `convex_local_storage` + 2.3 GB sqlite). RAM pressure is the backend
  paging that data (RSS observed 0.5–4 GB) plus system-wide swap.
- Verified HEAD-standalone in a clean worktree (tsc + full suite):
  this commit carries the 6 guard indexes it needs
  (`by_preview/thumb/original_storage_id`, `by_input_storage_id` ×2,
  `by_storage_id`) and inlines the live-media guard instead of importing
  uncommitted code. One known handoff: their uncommitted `ensurePreview`
  will regenerate reclaimed assets unless it gains the same one-line
  Drive check — flagged, not touched.
- Tests: reclaim/shared/stale/first-wins/ready; full suite green.

## Pass 12 — compact preview migration (recipe v2)

Derivatives converge on one recipe module (1600px preview, 384px thumb,
AVIF/WebP by support) with `derivativeVersion` per asset. A checkpointed
`previewMigrations` sweep upgrades stale assets 4 per 10s with stall and
failure-streak guards; web surfaces render thumb/preview only and heal on
view via `ensurePreview` (Drive-mirrored assets return ready without
metered bytes). Live: ~14.7k upgraded, ~295 MB reclaimed, migration
self-resumed after an orphaned 5-day-old job (now failed loudly instead
of pausing the sweep; stale-recipe successes requeue).

## Pass 13 — Drive mirror feeder unblocked

`queueMissing` re-read the same ready-asset index head every tick: 32
mirrors total, backfill stalled. Rotating `driveMirrorCursors`
checkpoint plus cursor threading through `claimNextUpload` and the Node
batch worker. Verified live: 32 → 82 succeeded in one tick
(2 seeds × 25/batch design throughput ≈ 600/hr). Bench: 25,889 assets,
25,217 Drive originals, inventory now reports `mirrored`.

## Pass 14 — background yields to the gallery

The feed queued behind batch Sharp/Drive writes: 20s+ page loads under
pipeline contention, 9ms warm-idle. A throttled foreground heartbeat on
initial feed pages (`activityState`, one write per minute) lets the
migration sweep, Drive seeding, and worker claims stand down while the
human browses; reclaim still runs. Verified live: 12.6s → 317ms gallery
load, migration untouched for 6+ browsing minutes, 0 broken images.
Same pass: migration retry laps for transient fetch failures, and a
reclaim double-delete fix for blobs shared by both derivative sides.

## Housekeeping flags
- `scripts/local-vault.mjs` 3600s wait committed (was Big Red's; sole-dev
  tree now, vault owns the long startup window).
- Efficiency edits above are normal uncommitted work, safe to commit review.

## Pass 15 — kill the rotation storm; feed goes first

Two compounding pile-ups, one session. (1) `/auth-check` minted a fresh
session credential per call and the client saved it, so N open tabs
ping-ponged re-verifies ~16×/sec (888 auth-checks/min observed).
Sessions are stateless HMAC tokens, so valid ones now echo instead of
rotating, and the gate skips re-verify for an already-verified key.
Result: zero auth-checks over 45 idle seconds. (2) Feed + directory +
retries fired concurrently into the single backend and spiraled past the
30s timeout. The directory now waits for first feed paint (20s fallback).
Also: migration to 2 assets/min with its own yield gate (Sharp backlog
was wedging reads), media sweep gated too, dev StrictMode off (ghost
duplicate feed requests), and gallery keyboard triage (arrows/k/l/f/
Delete/Enter mirroring Quick Look, verified live with undo).
