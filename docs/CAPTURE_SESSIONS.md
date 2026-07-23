# Capture sessions and intake pipeline

Capture sessions keep references from one browser action together after the Clipper popup closes. Durable session records use the existing `captureSessionId`, which is also the extension batch job ID.

## Available in this release

- Multi-image captures from one source appear as creative bundles.
- Tab, bookmark, OneTab, and URL batches appear as import sessions.
- Ourchival Clipper reports session start, bounded progress, completion, interruption, saved, existing, skipped, and failed counts directly to Convex.
- Session reports are idempotent across service-worker restarts and retries.
- Recent session records can still be backfilled from stored references.
- The private web vault lists recent sessions and their references.
- Import sessions open into a one-reference-at-a-time review conveyor.
- Review supports Keep, Later, Archive, Trash, Favorite, direct source opening, automatic advancement, and Undo.
- Keyboard review supports arrows, `K`, `L`, `A`, `F`, `O`, Delete/Backspace, and Command/Control-Z.
- Session progress updates as references leave Inbox, and a cleared session becomes completed automatically.
- Sessions can also be marked unreviewed, reviewing, deferred, or completed explicitly.

## Decision model

Capture-session review reuses the normal reference lifecycle:

- **Keep** sets `triageState: kept` and returns the reference to Library.
- **Later** sets `triageState: later`.
- **Archive** keeps the reference in cold storage with `archived: true`.
- **Trash** is reversible and sets both `deleted: true` and `archived: true`.
- **Favorite** is an independent emphasis signal and can accompany any retained destination.
- Closing successfully captured browser tabs remains a separate explicit Clipper action.

## Reporting behavior

The extension calls the documented Convex Functions HTTP API at `/api/mutation` and invokes `captureSessions:reportFromClipper`. The paired device token is hashed and checked against the existing revocable Clipper device record before any session update.

Progress reports are throttled during large imports and forced at start, completion, and interruption. A reporting failure never stops reference capture; stored references and the idempotent backfill remain the fallback.

## Next bounded capture work

1. Add session-wide and selected-subset tagging, boards, projects, and triage actions.
2. Keep bounded failed-entry details and retry controls attached to the web session.
3. Add clipboard image paste, drag-and-drop files, and a multiline URL dump.
4. Add browser-side adapters for Pixiv, Pinterest, Danbooru, and authenticated X bookmark/like imports.
5. Add page snapshots and preserved readable text under issue #43.
6. Add versioned conversation capture under issue #44.

## Processing architecture

Automated organization should use a deterministic queue before optional model calls:

1. normalize URLs and remove tracking parameters
2. validate media and reject unsafe or tiny assets
3. detect exact and visual duplicates
4. preserve source, creator, publication, and capture context
5. store originals and generated derivatives
6. run optional OCR, captions, embeddings, summaries, and tag suggestions
7. present every consequential Keep, Later, Archive, merge, or Trash decision in the review UI

Models may suggest organization and summarize notes. Human decisions remain authoritative, and automated processors should be idempotent, observable, retryable, and versioned.

Tracking issue: #40

Product roadmap: #37
