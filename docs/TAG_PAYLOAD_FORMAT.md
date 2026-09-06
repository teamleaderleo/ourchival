# Compact scored tags

The archive uses a shared vocabulary and recipe records. An image stores numeric
term IDs and scores, not repeated tag names or model descriptions. These IDs are
not bitmasks: a uint32 ID can name billions of terms; a uint32 mask holds only 32
independent flags. A large, sparse vocabulary does not justify allocating a full
mask per image.

Both wire formats begin with ASCII `OTG`, one version byte, and a big-endian
uint32 assertion count (maximum 4,096). Term IDs are unique, strictly increasing
uint32 values greater than zero. Scores are finite float64 values in [0, 1],
big endian; their precision and signed zero survive encoding.

| Version | Each assertion |
| --- | --- |
| 1 | Four-byte term ID, eight-byte score |
| 2 | Positive ID difference from the preceding ID (initially zero), encoded as unsigned LEB128 in 1–5 bytes, then eight-byte score |

Writers use v2 only when its total size is smaller. Empty and widely separated
sets can remain v1. Readers reject unknown versions, overlong or zero deltas,
uint32 overflow, duplicate/unsorted IDs, invalid scores, truncated input and
trailing bytes. Python and TypeScript share wire fixtures and boundary tests.

This is lossless packing, not score quantization or model retraining. It changes
neither thresholds nor ranking, adds no model calls, and requires no search
reindex. The database stores bytes directly; JSON transport adds base64 framing.
Payload byte savings are not physical disk or Convex billing savings.

## Keeping metadata useful

Saved owner tags, source-provided terms and model predictions remain different
claims. Missing terms do not mean negative labels. The existing image inspector
shows a few reference-oriented model terms per group; the complete list and model
provenance stay behind disclosure. Packing is not a reason to display more tags.

Danbooru source candidates and artist-profile candidates remain lookup receipts;
they do not become confirmed labels through this migration. Exact source tag
publication is a separate integration. Community membership has no model score
and should use a shared source receipt plus an unscored sparse set when that
integration is implemented, rather than inventing confidence values or copying
the lookup graph onto every image.
