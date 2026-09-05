# Air Blue visual tagging run

Started September 5, 2026 after the owner's request to analyze the saved archive.
The eight-image pilot published eight analyses with zero failures. The subsequent
full eligible-image pass uses the canonical `workers/visual/worker.py` at low CPU
priority and publishes model suggestions, not owner tags or filing decisions.

The active private state is `.models/archive-backfill/`: `progress.json`,
`results.sqlite`, `worker.log`, `pid`, `wd.json`, and `run.py`. The driver holds an
exclusive lock, writes progress atomically, and reads the existing local owner
key in memory. No browser credentials are involved. Private state is ignored by
Git; do not commit its cached titles, URLs or image annotations.

The runtime and existing model weights are reused from the preserved search-first
worktree. No weights or virtual environment were copied. WD ConvNeXt v3 revision
`d39e46de298d27340111b64965e20b8185c407e6` passed artifact checks. Pipeline fingerprint:
`2092e712aa538db576da7c056526741c9984dc3022650eb63da9be19711c064d`.

The run performs one traversal, not perpetual ingestion. Cache entries preserve
completed inference across interruption. A later pass can pick up newly captured
images. Before restarting, check the recorded process and lock; do not launch a
second worker. The current driver restarts enumeration and reuses the cache; it
does not persist the server cursor. Progress counts describe the current pass,
while the cache retains prior successful computations.

## Coverage and limits

The current API lists owned stored previews, falling back to stored originals.
Drive-only assets without derivatives, missing/deleted references and non-image
assets count as skipped. The final skipped count is not a claim that the archive
is fully analyzed. Animated, oversized and undecodable inputs can fail; failures
remain counted and require another reviewed pass. The worker currently aggregates
these failures rather than keeping a per-failure reason ledger.

Preview inference is valid model input provenance, not proof that an original was
downloaded. It does not replace or alter the image's original-storage receipt.
No OCR, caption model, embedding pass, community-tag lookup or personal-concept
training is enabled by this run. Models do not change sealed access or placement.

## Gallery behavior audited alongside the run

`Masonry.tsx` distributes cards by index modulo column count. Appending a page
keeps earlier cards in their columns; width changes can redistribute them. It is
not a shortest-column packing algorithm. Known dimensions reserve aspect ratio;
unknown dimensions can still shift layout after image load.

`useReferenceVault.ts` loads 48 references per request using continuation cursors
and appends deduplicated results. Its small in-memory view cache restores scroll
when switching views, but does not survive reload or restart. The DOM is not
virtualized. Lazy image loading reduces image work, not mounted-card count.
New references are not continuously streamed into the visible grid.

Next acceptance criteria:

- Keep current browsing stable during imports; offer an explicit new-items refresh.
- Persist a resume marker with collection/filter/sort, anchor reference ID and
  within-card offset. Reconcile missing/moved anchors visibly; do not treat an old
  absolute pixel offset or page number as durable identity.
- Virtualize by visible column ranges with overscan and measured/reserved heights;
  preserve keyboard focus, selected cards and accessibility when cards unmount.
- Keep review progress independent of browsing position: existing Inbox, Keep,
  Later and Archive decisions remain durable, with undo. Model analysis alone
  does not mean a reference was reviewed or organized.
- Benchmark sustained scrolling on a representative large gallery before claiming
  archive-scale performance. Test resize, new imports, filter changes, restart,
  missing anchors and multi-image reference cards.

These gallery improvements are outstanding; this audit does not claim they were
implemented during the tagging launch.
