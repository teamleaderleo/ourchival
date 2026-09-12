# Fast browsing with bounded local media

Investigation: 2026-09-07. The full cache architecture below remains proposed.
Compact encoding, exact derivative byte accounting, guarded cleanup on
replacement, a resumable existing-image migration, and derivative-only automatic
viewing are implemented; see `COMPACT_PREVIEWS.md` and `PREVIEW_MIGRATION.md`.
The export-retention fix is separate and already in the local backup script.

## Outcome

The gallery should display lightweight thumbnails immediately when cached,
load a larger preview on selection, and fetch an original only for an explicit
original-quality view, edit, download, or offline pin. Drive owns the durable
original. Local media is either a bounded cache or an explicitly pinned file.
A cold, uncached item still needs a network request; do not promise instantaneous
offline access to an unlimited collection.

## What exists today

- `convex/http.ts` uploads captured originals to Drive. Some non-Pixiv captures
  fall back to Convex Storage on upload failure. Those local originals may be
  the only secured copy and cannot be treated as disposable.
- `convex/mediaDerivativesNode.ts` generates 384-pixel thumbnails and
  1600-pixel previews, stored in Convex Storage. Recipe 2 selects the smaller
  AVIF/WebP result. On the local vault that
  storage occupies this Mac's disk.
- `apps/web/app/ReferenceCards.tsx` loads near-viewport cards from stored
  thumbnails/previews only. Full-original fallback has been removed from
  automatic viewing, including the review decks and related-image previews.
- `convex/lib/referenceCatalog.ts` resolves a Drive-backed `storedUrl` to
  `/drive-file`; `convex/http.ts` streams the full Drive file from that endpoint.
- `apps/web/app/privatePreviewCache.ts` caps its session-memory cache at 64 MiB
  and 48 entries. This does not cap Convex files or browser HTTP disk caching.
- `convex/mediaDerivatives.ts` now removes superseded derivative objects when
  no catalog, artwork, or saved evidence still references them. Historical
  orphan files still need an inventory before deletion.
- The incident's dominant cost was 137 GiB of backend export scratch files,
  not the gallery: the live storage `files` directory measured about 3.7 GiB.
  Removing old exports recovered 61.9 GiB without removing live media.

## Proposed storage policy

Start with a combined 2 GiB disposable media budget, reserving up to 512 MiB
for thumbnails and allowing the remaining budget for larger previews. These
are initial product defaults to validate against measured thumbnail sizes and
gallery performance, not measured requirements. Track the catalog/database
separately; this is not a cap on all application data.

Store originals and durable derivative copies in Drive. Keep stable asset and
derivative identities in the catalog, with revision, MIME type, dimensions,
byte count, checksum, and verified remote location. Never persist an expiring
download URL as the durable identity.

Use byte-accounted least-recently-used eviction, with a low-water mark and a
bounded download queue. Include in-flight reservations and temporary writes in
the budget so concurrent downloads cannot exceed it. Pin currently displayed
objects until consumers release them. Prefer retaining thumbnails over large
previews. A separate, visible offline-pinned total is outside the disposable
cache; never evict an offline pin silently.

On gallery cache misses, request the small derivative, coalesce duplicate
requests, and prefetch only a small number of nearby cards. In quick look,
display the thumbnail while the larger preview loads. Do not retrieve a full
original just because a preview is missing or failed. Queue derivative repair
and show a retryable preview state instead.

Before evicting any existing local original, upload and verify its remote
counterpart. A Drive error leaves the original intact and marks it as awaiting
sync. Remote backup ZIPs alone are not a convenient per-image serving layer;
keep individually retrievable media objects as well as the backup chain.

## Implementation sequence

1. Add a read-only storage inventory: referenced originals, thumbnails,
   previews, unreferenced objects, unsynced bytes, pins, and temporary exports.
   Measure derivative coverage before changing gallery fallbacks.
2. Make derivative completion account for exact bytes and retire superseded
   objects only after verifying no asset references them. Handle partial job
   failures and duplicate completions without leaking or deleting active files.
3. Add verified durable Drive locations for derivatives and migrate existing
   media incrementally. Keep originals and previews until remote verification
   and an authenticated read-back succeed. Check Drive behavior against current
   official documentation during implementation.
4. Introduce the bounded media cache and derivative-serving endpoint. Enforce
   owner access, handle remote deletion/reconnection, and keep sensitive preview
   behavior consistent. Avoid unmanaged long-lived HTTP caching of originals.
5. Switch gallery and quick look to derivative-only automatic fetching once
   coverage is adequate. Add explicit original-quality and offline actions.
6. Expose a compact storage view: previews/cache, offline files, pending sync,
   and a clear-cache action that cannot delete durable or unsynced originals.

## Acceptance checks

- A long gallery scroll issues no full-original requests, including retries.
- Warm-cache gallery and quick-look latency are measured on the actual archive;
  report cold-network latency separately instead of claiming all loads instant.
- Rapid navigation, concurrent misses, reloads, and interrupted writes stay
  within the configured cache budget including temporary files.
- Eviction preserves live displayed files, offline pins, pending uploads, and
  any media lacking a verified durable copy.
- Drive unavailable or disconnected: cached previews still work and uncached
  items offer a clear retry state; the catalog remains browsable.
- Repeated derivative generation does not accumulate superseded storage.
- Restore remains valid after cache eviction, and never depends on retaining
  the temporary full export or on cache files being present.

Do not bulk-delete the current `files` directory. Its contents mix derivative
data and potentially irreplaceable fallback originals.
