# Archive metadata

[Personal tag definitions and teaching examples](PERSONAL_TAGS.md) extend the
shared saved-tag catalog with stable numeric codes, rename aliases and versioned
meanings. Machine results now use compact payloads and shared model definitions, with a resumable [metadata migration](METADATA_MIGRATION.md). Automatic personal-tag propagation remains subsequent work.

Metadata should help you find an image and judge where a claim came from. Missing
information stays missing; model predictions are not confirmed facts.

| Information | Treatment |
| --- | --- |
| Captured page/post text, alt text, credit | Source claims; original snapshots remain unchanged |
| Titles and saved tags | Editable catalog metadata; capture-populated values are not called human-confirmed |
| Notes, boards, projects, corrections | Owner input |
| Visual tags, OCR, generated descriptions | Machine annotations with model identity, input identity, revision and scores |

Sparse page refreshes no longer discard useful captured text from the current
source view. Each field uses meaningful refreshed text when available, otherwise
preserves the preceding value and its snapshot/time origin. Existing sparse
histories recover fields from the first capture when the latest snapshot lacks
them. This does not reconstruct every intermediate historical value. Raw source
snapshots are retained unchanged.

Generated tags normalize case, whitespace and underscores, collapse duplicates,
and retain the highest score. Scores are model confidence values, not calibrated
probabilities or evidence that a label is true. Predicted artist labels are
excluded by the worker. Predictions do not become saved tags automatically.

In the reference inspector, open **Image metadata** to review each image's terms.
Select an incorrect term to exclude it from search, or select it again to restore
it. OCR and generated descriptions have separate search inclusion controls.
Changes preserve saved tags and source credit, survive model reruns, and use a
revision check to prevent overwriting another correction. Add confirmed terms
with the existing saved-tag editor.

Stale predictions are excluded from keyword search when their input no longer
matches the asset. The inspector distinguishes missing, current and stale
analysis. Ratings do not affect display, blur, ranking or access. Original image
bytes are untouched.

This is archive work based on `main`; it does not require the extension's
local-first-vault changes. [Setup](VISUAL_SEARCH.md) and
[validation evidence](VISUAL_SEARCH_VALIDATION.md) describe the implemented scope.
The representative image/query pilot is still needed to choose useful thresholds
and assess OCR and retrieval quality before archive-wide enrichment.

The [reference-oriented trial](VISUAL_METADATA_EVALUATION.md) now covers 48 images
sampled from the ongoing Air Blue/Drive archive and compares five local models.
It supports focused tag groups and semantic retrieval, while identifying why
unchecked structured captions should not populate reference fields automatically.
The [source-tag lookup trial](SOURCE_TAG_LOOKUP.md) found exact Danbooru file-hash
matches for 21 of those 48 images. Reusing attributed existing tags should be
the first enrichment route, with local predictions filling gaps.
