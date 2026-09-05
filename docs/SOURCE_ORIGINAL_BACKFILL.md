# Original-image backfill

The Pinterest importer resolves `images.orig.url` from the requested pin's
authenticated first-party page. Changing a thumbnail path to `/originals/`
does not preserve the original file extension: a JPEG thumbnail can come from
a PNG original. Cookies remain inside the existing browser profile.

The board-grid selector, per-board IDs, scroll recovery limits, and chunk
acknowledgements remain in place. Metadata requests use three concurrent
requests, each with a 15-second timeout. If metadata cannot be resolved, the
existing URL candidates remain available; their failures do not establish that
an original is nonexistent.

## Quality and receipts

Assets retain their deduplication URL in `originalUrl`. `fetchedUrl` describes
the actual response, with `quality`, `qualityReason`, intrinsic dimensions,
file size, and a bounded `fetchReceipt`. The receipt distinguishes attempted
candidates from candidates not requested after an earlier success. HTTP 206 is
accepted only with a complete `Content-Range`; truncated responses never count
as originals.

Drive storage alone does not prove original quality. Existing durable assets
with an instrumented original URL count as secured; resized URLs are degraded;
rows without `fetchedUrl` remain unknown. Old browser receipts are explicitly
marked as needing a rendition audit. New source receipts deduplicate canonical
reference and asset IDs across board memberships and separate new bytes written
from existing durable bytes.

The browser checkpoint keeps known page counts and unresolved identities.
`captureSessions.receiptJson` stores aggregate artwork, reference, expected-page,
original, degraded, unknown, link-only, failure, and gap counts. Artwork metadata
and asset fetch receipts retain the underlying evidence in the local vault.

## Targeted Pinterest promotion

For an existing degraded or uninstrumented asset, obtain the requested pin's
`images.orig.url` in the authenticated browser, then run:

```sh
node scripts/promote-pinterest.mjs \
  --source-url 'https://ca.pinterest.com/pin/PIN_ID/' \
  --asset-url 'EXISTING_LEDGER_ORIGINAL_URL' \
  --original-url 'FIRST_PARTY_IMAGES_ORIG_URL'
```

This operates only on the canonical local vault. It reads its local vault key
in memory, never accesses browser credentials, and prints a bounded receipt.
The existing reference/asset identity is preserved. A failed original request
leaves the old durable fallback intact; a successful replacement retains the
previous storage receipt and invalidates old derivatives. Repeating a successful
promotion returns the existing original with zero new bytes written.

A new Pinterest board import also requests promotion for non-original assets.
Already-proven originals are reused without another image download.

## Pixiv implementation and validation boundary

The implementation requests the signed-in owner's public or private artwork
bookmark listing in deterministic 44-item pages from offset zero. It requests
artwork details and the `/pages` manifest, verifies the expected page count,
and submits one capture per full-resolution `img-original` page with a common
artwork identity and `sourceIndex`/`sourceCount`. The vault supplies the Pixiv
Referer when retrieving image bytes and requires Google Drive storage for Pixiv
originals. It does not substitute previews.

Original title, artist, tags, dates, description, restrictions, bookmark
visibility, page, and ordinal are retained in source metadata. Structured
provenance identifies the public/private bookmark container. Private and explicit
captures are sealed; ordinary hydrated archive responses omit their media URLs.

An unavailable work is saved as an unresolved reference with its known metadata.
A bookmark placeholder without an artwork ID remains an explicit gap with its
bookmark identity, page URL, and ordinal. Inconsistent page counts, missing
sensitivity, previews, and unsupported ugoira frame archives remain gaps.
Replaying a page after interruption is idempotent. A new completed-source import
revisits unresolved works and reuses durable originals. A dedicated gaps-only
Pixiv retry command and ugoira frame preservation are not implemented.

Live Pixiv access was rejected by browser security policy during this work.
No alternative browser, direct-network workaround, or live Pixiv backfill was
attempted. API response contracts are fixture-tested, not live-verified. The
existing 3,853-work catalog still has zero Pixiv assets; full archive execution,
interruption testing in Edge, and final reconciliation remain required before
merging this work. Rebuild and reload the existing unpacked extension when
performing that authorized validation.

## Verified Pinterest sample — 2026-09-05

For pin `595812225752625670`, the guessed JPEG original returned HTTP 403 in
both a plain fetch and the authenticated Pinterest page context. The authenticated
pin metadata declared a PNG original. A fetch of that PNG without cookies returned
HTTP 200; adding cookies was unnecessary. A separate working JPEG original
returned 200 with credentials omitted, while credentials-included JavaScript
fetch was rejected by the CDN's CORS credentials policy.

The known fallback was promoted in place to Drive: 832 × 1472 pixels,
1,484,992 bytes. Reading it back from Drive matched the original bytes:
SHA-256 `ad2ace3439d06645aa1a050fefc94ef30383709c7cc0d0ad26a695a57ef16f4c`.
The repeat promotion reused that asset with zero new bytes.

This explains the tested extension mismatch, not every historical 403. The
46 unresolved Pinterest membership slots were not resolved by this sample.
