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
