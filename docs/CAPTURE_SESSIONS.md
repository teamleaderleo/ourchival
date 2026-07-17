# Capture sessions and intake pipeline

Capture sessions keep references from one browser action together after the Clipper popup closes. The first release derives durable sessions from the existing `captureSessionId` stored on references.

## Available in this release

- Multi-image captures from one source can appear as a creative bundle.
- Tab, bookmark, and URL batches can appear as import sessions.
- Recent session records are created or updated idempotently from stored references.
- The private web vault lists recent sessions and their references.
- Sessions can be marked unreviewed, reviewing, deferred, or completed.
- Existing per-reference Inbox, Library, Later, Archive, and Trash behavior remains unchanged.

Counts derived from stored references are exact for saved items. Duplicate, skipped, and failed counts stay at their recorded values when available.

## Next bounded capture work

1. Let the Clipper report session start, progress, completion, duplicates, skipped items, and failures directly.
2. Add clipboard image paste, drag-and-drop files, and a multiline URL dump.
3. Add browser-side adapters for Pixiv, Pinterest, Danbooru, and authenticated X bookmark/like imports.
4. Add session-level tagging, boards, projects, and triage actions.

## Processing architecture

Future automated organization should use a deterministic queue before optional model calls:

1. normalize URLs and remove tracking parameters
2. validate media and reject unsafe or tiny assets
3. detect exact and visual duplicates
4. preserve source, creator, publication, and capture context
5. store originals and generated derivatives
6. run optional OCR, captions, embeddings, and tag suggestions
7. present every consequential keep, later, archive, merge, or trash decision in the review UI

Models may suggest organization and summarize notes. Human decisions remain authoritative, and automated processors should be idempotent, observable, retryable, and versioned.

Tracking issue: #40

Product roadmap: #37
