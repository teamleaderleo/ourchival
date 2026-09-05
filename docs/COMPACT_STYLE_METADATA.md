# Compact metadata and an archive-owned style vocabulary

Proposed design, September 5, 2026. This is not a deployed schema change.

## Retrieval purpose

Reuse attributed community tags for subjects, characters and existing visual
details. Add archive-owned concepts for the qualities useful in references:
line variation, broken contours, hard versus soft shading edges, flat color
regions, visible brush texture, hatching, palette relationships and shape
stylization. These are initial candidates, not a validated vocabulary.

Each concept needs a short definition, positive examples, counterexamples and
an uncertainty rule. An image can contain several treatments, so use a region
or subject scope when necessary. Do not infer an artist, production medium or
the owner's reason for saving an image from appearance. “Watercolor-like
texture” describes an appearance; “painted in watercolor” asserts a process.

## Shared definitions, sparse assertions

The current `visualEnrichments` stores tag names/categories and model records
inside every image result. Normalize repeated definitions before considering
general-purpose text compression.

| Shared record | Contents |
| --- | --- |
| Concept | Stable numeric code, namespace, label, aliases, group, versioned definition and example references |
| Analysis recipe | Model revision/digest, preprocessing, prompt/question-set version and output schema |
| Source receipt | Provider, exact post identity, matching evidence, retrieval time and source revision |
| Analysis result | Verified input identity, recipe or source receipt reference, sparse concept assertions, revision |
| Asset association | Links an archive asset to its applicable analysis result |
| Owner correction | Separate accepted/rejected concept or preference, with asset/region scope |

Group assertions from the same recipe or source under one result so provenance
is not repeated per tag. Share an analysis across exact verified inputs only
when recipe and relevant context also match. Keep reference-specific source
credit, notes and owner corrections attached to their reference/asset. A
different crop, preview, OCR resolution or contextual prompt is a different
analysis input. Never use visual similarity as a deduplication key.

Concept codes are allocated once and never reused. Aliases resolve to a stable
concept; materially changed meanings get a new definition version or concept.
Namespaces distinguish community terms from archive-defined terms. Definitions
and old recipe versions must remain resolvable by existing results.

## Binary representation

A uint32 code identifies one of 2^32 possible values. A uint32 bitmask represents
only 32 independent flags. An expanding, sparsely populated vocabulary fits a
sorted list of concept codes better than one giant fixed mask.

Illustrative payload arithmetic: 100 uint32 codes require 400 bytes. Adding
one quantized score byte per code makes 500 bytes. Across 18,000 images that is
9 MB in decimal units, excluding dictionaries, provenance, state/scope fields,
database overhead, indexes and other metadata. This is not a measurement of
Convex storage or a claim about the current archive's image count.

First normalize definitions and measure representative complete records. Compare
native arrays against a versioned binary payload before migrating. Numeric
arrays do not automatically receive uint32 packing. If worthwhile, an explicit
codec can encode sorted uint32 IDs and parallel scores, later using delta-varints
or bitmap compression where measurements justify them. Never reorder codes
based on popularity; that would change the meaning of old records.

Quantized scores are model scores, not probabilities. Validate threshold and
ranking behavior before discarding precision. Preserve absent, not evaluated,
uncertain and explicit negative as different states for targeted questions;
missing a tag is not a negative answer. Unknown scores for community assertions
must not become fabricated confidence values.

Convex supports binary `ArrayBuffer` fields, but its full-text search operates
on a string field. Keep the compact assertions authoritative and generate a
bounded, rebuildable text projection for search. That duplication serves a
query purpose. Binary blobs alone do not provide indexed tag membership; use
an appropriate derived membership index if exact facet queries require it.
Avoid blindly moving every assertion into its own database document without
measuring document/index overhead and read cost.

## Targeted vision questions

Ask a small set of well-defined questions together, returning concept codes and
bounded states such as present / absent / uncertain / not applicable. Example:
“Are the main subject's shadow boundaries predominantly hard, soft, mixed, or
not visible?” Mutually exclusive options need an explicit mixed/unknown route.
Use continuous knobs only where an anchored scale has a useful interpretation.

Evaluate a small question set on diverse current archive images, including
close counterexamples. Judge each question separately against reviewed labels;
valid JSON and a model's self-reported confidence do not establish correctness.
Store concise accepted assertions, not a generated essay for every question.
Keep raw pilot outputs privately for evaluation; decide a bounded production
retention policy before collecting them archive-wide.

Cache by exact input, recipe and question-set version. Ask only missing or stale
questions. Batch related questions to avoid repeated image processing, measure
quality and total cost per image, and reserve expensive follow-up for uncertainty
or owner-requested detail. Local models are available for this evaluation.
Any hosted trial needs an explicit destination and approved image set before
private archive images are submitted; no hosted submissions are authorized by
this design document.

## Implementation order and acceptance

1. Measure existing serialized metadata, repeated definitions, search projection
   size and candidate native/binary encodings on the private sample.
2. Introduce shared concepts and recipes with an additive migration and verify
   reconstruction of labels, scores, provenance and owner corrections.
3. Evaluate a small archive-owned style question set; enable only useful fields.
4. Pack payloads if measured savings justify decoding and query complexity.

Migration must remain resumable, preserve old records until verification and
allow the current reader during backfill. Validate search/correction parity,
codec round trips, score-threshold boundaries and interrupted migration recovery.
This design adds no model calls, deployments or live catalog writes.

References: [Convex data types](https://docs.convex.dev/database/types),
[Convex text search](https://docs.convex.dev/search/text-search).
