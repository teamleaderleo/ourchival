# Metadata storage ledger

Track measured savings, costs and measurement boundaries together. Keep private
tag text and source images out of committed receipts; aggregate receipts are in
`docs/validation/tag-storage-*.json`.

## September 5, 2026 — real archive pilot

48 current archive images, using already computed local model outputs. These are
two alternative taggers evaluated independently, not additive savings.

| Tagger | Readable tag arrays | Binary tags + shared dictionary | Reduction |
| --- | ---: | ---: | ---: |
| WD ConvNeXt | 437,247 B | 166,542 B | 270,705 B / 61.91% |
| WD EVA | 446,902 B | 185,849 B | 261,053 B / 58.41% |

The comparison includes all tag names/categories/codes in the shared dictionary,
eight-byte headers on every binary payload, and lossless float64 scores. It uses
minified UTF-8 JSON as the readable baseline. Binary bytes in JSON transport need
base64 and wrappers: totals are 190,346 B and 210,145 B respectively. Neither
column estimates Convex document/index overhead or physical storage. Recipes,
OCR, captions, reference data and embeddings are outside this comparison.

This replaces the earlier rough estimate that used a smaller experimental
dictionary shape and omitted payload headers. Dictionary reuse increases as
images reuse vocabulary; do not linearly extrapolate this small sample to the
entire archive or assume every future batch will save space.

## September 5, 2026 — live migration

The live catalog contained zero visual-enrichment records, so realized machine
tag compression savings are **zero**. One saved tag gained a stable code. Its
exported JSONL record grew from 140 B to 151 B. Migration bookkeeping and the
code allocator add small records. This is infrastructure for future annotations,
not a reduction in existing archive size. All 18,398 references and 20,759 source
snapshots were preserved exactly. The separate search projection consumes space
to improve retrieval; it must not be counted as a compression saving.

## Repeat for subsequent batches

```sh
python3 workers/visual/measure_tag_storage.py /private/evaluation/results.json \
  --model convnext --output /private/evaluation/storage-convnext.json
```

The script records a source SHA-256, counts, byte totals and reconstruction check.
For each new measured batch, append a dated entry and retain its aggregate
receipt. Record actual live table/export sizes separately when annotations are
published; include shared vocabulary, recipes, IDs, bookkeeping and search
projections before making a whole-catalog saving claim. Export bytes and billed
storage are different measures. Never count original media as metadata savings.

## Browser layout metadata

Natural thumbnail dimensions are cached locally for at most 2,048 asset IDs.
This is additional, bounded layout metadata used to prepare later visits. It
contains no image bytes and is separate from the tag-compression measurements
above; it must not be counted as a compression saving.

## September 6, 2026 — live lossless delta packing

The local catalog now contains 9,216 visual-enrichment results, all using shared
terms and recipes. The September 5 zero-result baseline above is historical.
After a private metadata backup, the resumable payload migration completed with
9,216 changed results and zero skipped rows. Each transaction verified exact
reconstruction before writing; only `tagPayload` changed.

| Measured scope | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| 251,108 scored assertions, including per-result headers | 3,087,024 B | 2,380,881 B | 706,143 B / 22.87% |

This is an additional reduction from already packed OTG-v1 payloads, achieved
with variable-length ID differences and unchanged float64 scores. It does not
add to the older sample percentages as a simple sum. All future submissions use
the smaller supported format. No model rerun or search reindex was needed.

The private pre-migration export also shows why this should not be presented as
a large total-storage reduction: source-snapshot JSONL is 92,620,332 bytes and
search-document JSONL is 53,495,821 bytes. Export framing and base64 encoding make
these different measures from binary tag payloads; neither estimates billing or
physical storage. This change leaves those records alone.

Aggregate evidence: [preflight](validation/tag-storage-v2-preflight.json),
[completed migration](validation/tag-storage-v2-live.json), and
[authenticated inspector parity](validation/tag-storage-v2-inspector.json).
Validation: 238 Vitest tests, 55 visual-worker tests, three launcher tests,
five backup tests, and full typechecking passed. Shared Python/TypeScript fixtures
cover both formats, malformed deltas, uint32 limits and full score precision.
Migration tests cover interruptions, stale jobs, idempotence and atomic rollback.

Repeat the payload audit against a private metadata export without exposing tags:

```sh
python3 workers/visual/measure_export_tag_storage.py /private/metadata.zip \
  --output /private/tag-storage-receipt.json
```

The visible tag summary remains bounded. Danbooru matching receipts have not
been published as catalog tags by this migration; candidate matches must remain
distinct from confirmed community terms and model suggestions.
