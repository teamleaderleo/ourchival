# Working through the archive

Here, the user is trying to find useful material, inspect it, decide whether to
keep it, and connect it to work they can revisit.

The default gallery shows entries with actual saved image assets. “Images only”
can be switched off to include text posts and other captures in the current
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

The catalog's stored width and height reserve thumbnail space before image
decoding. Unknown dimensions use a stable square; unusually tall/wide images
use bounded frames with contain fitting. The derivative pipeline can populate
dimensions for a later visit. The current frame does not change to a newly
decoded natural size. CSS Grid replaces rebalancing newspaper columns.

Only the first four cards request priority image loads. Other cards activate
within 500px of the viewport; this also delays authenticated Drive fetches,
which native image lazy loading alone could not delay. Private originals stay
in Drive, and preview storage remains unchanged. This pass does not claim a
measured cold-network latency improvement or introduce a new media service.
