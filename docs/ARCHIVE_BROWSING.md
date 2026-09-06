# Sorting, positions and windowed cards

Here, the user is trying to browse and organize references without losing their
place. The sort control remains available while scrolling. Saved and published
dates each support ascending and descending order. Undated posts come last in
both publication-date sorts, with unknown dates identified in card details.

## Position and refresh behavior

Positions are versioned browser-local markers containing an anchor reference ID,
its viewport offset, and a replayable page boundary. Each backend origin,
collection, search/filter string, sort and image-only preference has its own
marker. The last selected view is restored after reload; up to 30 positions are
retained. No image bytes, credentials, titles or full result lists are persisted
by this feature. Search/filter strings are local browsing preferences.

Switching views or sorts restores that view's own position. It does not attempt
to locate the currently selected image under a new sort. If an anchor no longer
appears in its saved page, the UI explicitly reports this and shows nearby page
results. It does not claim an exact nearest-neighbor match. Invalid cursors or
network failures remain errors; **Refresh from beginning** discards that view's
marker and opens a fresh browsing session. Disabled/full browser storage is
reported instead of preventing browsing.

The backend orders references before pagination. Continuation cursors are bound
to the request's filters and sort, carry an insertion-time cutoff, and retain
Convex's stable index order for ties. New references are excluded from an ongoing
page chain until refresh. This is not a frozen database snapshot: metadata edits,
publication-date backfills and organization changes to existing references can
change membership/order. Client append deduplication remains in place.

Chronological text searches scan bounded date-ordered candidates and use the same
full-text index to preserve machine-tag matches. Legacy rows without a search
document retain source-text fallback. This may require more pages than relevance
search for sparse matches; there is no client-side sorting of just loaded cards.
Existing API callers that omit `sort` retain their earlier behavior.

## Rendering and accessibility

Masonry retains modulo column assignment as pages append. It renders measured
visible ranges with overscan and spacer heights, rather than mounting every
loaded card. A restore anchor or keyboard-focused card remains mounted even
outside the usual range. Image dimensions seed height estimates; cards are
remeasured as needed. Resizing may redistribute columns and change their heights.

Restoration waits briefly for measured layout, and yields immediately to wheel,
touch or keyboard input. The marker observer follows virtualized card mounts.
The logical result list and measured-height cache still occupy memory; this is
DOM windowing, not unlimited-memory browsing. Offset calculation is linear in
loaded items. No archive-wide frame-rate claim is made.

## Validation

- Database tests cover both date fields/directions, ties across pages, missing
  publication dates, cursor-scope rejection, page replay and machine-only search.
- Position tests cover independent views, reload settings, bounded retention and
  unavailable browser storage. Window tests cover 10,000 items and stable append.
- Live Edge verification restored the same image after reload within 0.125 CSS
  pixels, and restored its position exactly after switching sort away and back.
  A 68-item loaded view mounted about 21–32 cards depending on viewport/overscan.
- Keyboard focus remained on the same mounted card after scrolling. Desktop
  checks at 1280×720 and 1440×900 showed accessible sticky sort controls and no
  horizontal overflow. Private gallery screenshots were not committed.

These changes do not mark references reviewed, apply model suggestions as owner
tags, or move anything between New, Library, Later, Archive or Trash.
