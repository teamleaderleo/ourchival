# Working through the archive

Here, the user is trying to find useful material, inspect it, decide whether to
keep it, and connect it to work they can revisit.

The default gallery shows entries with actual saved image assets. View & tools → Include text posts restores other captures in the current
collection. This is a display filter, not deletion. Empty image pages advance
through the existing chronological cursor. Collection totals still describe
all saved entries, including those hidden by the image filter.

Click a picture to open it. Left/right browse references; multi-image captures
have separate image controls. Keep (K), Later (L), and Trash (Delete) advance
to the adjacent reference after a successful move. Failure leaves the current
reference open. Organize opens the inspector for notes, tags, boards and project
use. Closing the viewer restores keyboard focus without opening a sidebar or
resizing the underlying gallery. The card's ellipsis opens details directly;
its checkbox is reserved for batch selection.

The header carries search (`/` to focus), projects, capture and undo. Project
filters operate within the current collection. A useful project workflow is:
keep references, record their project use and reason in the inspector, then
return to Library and select the project. Batch organization can associate
selected references with the next project while preserving their earlier use
records. Project editing and deletion confirmation happen inline. Personal
tags can express learning, entertainment, style or another owner-defined purpose.

Trash retains a reference as a recapture block by source URL, canonical URL or
existing asset URL. It neither deletes original media nor downloads replacement
media when that rejection is encountered again. Restore/undo lifts the rejection.
Capture snapshots preserve the source context already collected; they do not
promise recovery of material deleted before capture or complete web-page backups.

## Loading behavior

Natural image proportions are preserved in separate masonry columns. Images are
not fitted into square frames. Appending older pages keeps existing cards in their
columns. Stored dimensions reserve space when available; otherwise the browser
learns and remembers natural dimensions after decoding, for subsequent visits.
The dimension cache contains only asset IDs and dimensions, with at most 2,048
entries. A previously unseen image with no catalog dimensions can still settle
once on its first load; this does not rebalance all the masonry columns.

Older pages append through a near-bottom sentinel, with a More button as a
keyboard/failure fallback. Overlapping pages are deduplicated without changing
existing order. Ten recent view/query combinations retain their loaded references
and scroll position; mutations invalidate this cache. Refresh archive explicitly
fetches fresh data. The first visit to an uncached collection can still require
a fetch, but revisiting cached views does not clear and reload the canvas.

Saved searches, projects and View & tools are floating popovers with outside-click
and Escape dismissal. Browser pairing is under Settings → Connect a browser
extension. Main action buttons have square edges.

Only the first four cards request priority image loads. Other cards activate
within 500px of the viewport; this also delays authenticated Drive fetches.
Private originals stay in Drive, and preview storage remains unchanged. This
pass does not claim a measured cold-network latency improvement.

The gallery canvas omits the repeated collection heading and total. New is the navigation label for unreviewed saves (the stored collection ID remains inbox). Image-card titles and source links appear on hover or keyboard focus as selectable overlays, without occupying grid space; the viewer remains the touch route to details. Desktop gutters are 8px, mobile gutters 6px.

In the viewer, left/right moves between references and up/down moves between images in a post. Modified browser shortcuts pass through; held triage/favorite keys do not repeat changes. Copy link reports success without resizing its button. Closing restores keyboard focus without scrolling the gallery.

Viewer inspection: Z, the 100%/Fit button, or double-click toggles actual preview pixels with scrolling. Escape returns to fit before closing; changing images resets to fit. This inspects the loaded preview, not an automatic original-resolution download.
