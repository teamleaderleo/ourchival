# Page screenshots and preserved page artifacts

Ourchival can attach a screenshot of the currently visible browser tab to an explicitly saved page reference. Screenshots are owned artifacts with their own lifecycle, while source URLs and captured page metadata remain separate provenance records.

## Available in this slice

- **Save page** from the Clipper context menu captures the visible tab as a compressed JPEG.
- **Save current tab** from the Clipper popup captures the visible tab before the reference batch begins.
- Selected-tab, whole-window, URL-list, OneTab, and bookmark imports remain lightweight and do not activate background tabs for screenshots.
- Protected browser pages and unsupported URL schemes fall back to normal metadata capture.
- Screenshot capture and upload failures do not fail the saved reference.

## Upload flow

Browser screenshots use Convex file upload URLs:

1. The paired Clipper requests a short-lived upload URL for a specific page-like reference.
2. The JPEG is uploaded directly to Convex Storage.
3. The Clipper commits the returned storage ID with dimensions, byte size, SHA-256 hash, capture time, and MIME type.

Both the upload grant and metadata commit verify the revocable Clipper device token.

## Artifact records

A screenshot is stored as a `referenceArtifacts` record with:

- `referenceId`
- `kind: page_screenshot`
- `captureMethod: browser`
- provider and version
- storage ID and MIME type
- dimensions and byte size
- SHA-256 content hash
- processing status
- retention mode
- captured, created, and updated timestamps

The current screenshot storage ID is also mirrored into the reference asset preview fields so existing gallery and capture-session cards can display it immediately.

## Idempotency and replacement

- Recapturing identical screenshot bytes updates the capture time and deletes the redundant upload.
- Recapturing changed bytes replaces the current screenshot and deletes the superseded owned blob.
- Screenshot data is removed from extension batch state after the upload attempt.
- Existing image originals and source URLs remain separate from screenshot ownership.

## Retention

Artifact retention supports:

- `review` — disposable review preview
- `pinned` — user-selected preservation
- `archival` — long-term preserved artifact

Owner-only queries and mutations can inspect artifacts and change retention. Automated expiry and purge jobs remain future work.

## Next work

1. Add visible pin/unpin controls in the reference inspector and session review card.
2. Generate dedicated WebP preview and thumbnail derivatives.
3. Add an observable public-page rendering adapter for links without browser captures.
4. Preserve sanitized readable text separately from disposable screenshots.
5. Add Reddit-specific visible comment and hierarchy capture.
6. Implement expiry and purge jobs for unpinned review artifacts.

Tracking issue: #43

Stacked implementation: #47 on #46
