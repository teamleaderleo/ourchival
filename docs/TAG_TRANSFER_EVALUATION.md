# Tag transfer pilot

On September 5, 2026, a local leave-one-out experiment found that transferring
reference tags from visually similar images was substantially weaker than the
existing WD tagger on this sample. Keep transferred tags as experimental
suggestions; do not automatically publish them into the catalog.

The sample contains 48 images from the ongoing archive, including 21 exact MD5
matches with Danbooru records. Those 21 records contain 117 occurrences of tags
in the experimental reference vocabulary (pose, viewpoint, framing, lighting,
expression, clothing construction, hands and props). For each matched image, its
labels were hidden from the donor pool. Self, identical input bytes, shared
original MD5, shared archive reference, and shared source-post identity were
excluded. SigLIP 2 ranked the remaining matched donors by image cosine similarity.

Methods and thresholds were fixed before the run. Nearest copies the closest
donor's reference tags. Majority requires two of three nearest donors. Agreement
also requires the target image's WD score to reach 0.15. WD alone uses 0.35.
The prior baseline selects the five most frequent tags among eligible donors,
without similarity. No weights were trained or catalog metadata changed.

| Method | Recorded tags recovered / 117 | Suggestions | Unconfirmed suggestions |
| --- | ---: | ---: | ---: |
| WD ConvNeXt | 82 | 136 | 54 |
| Nearest image | 20 | 121 | 101 |
| Three-neighbor majority | 15 | 59 | 44 |
| Majority plus ConvNeXt agreement | 14 | 31 | 17 |
| ConvNeXt plus agreement additions | 83 | 141 | 58 |
| Five most frequent donor tags | 31 | 105 | 74 |
| WD EVA | 93 | 182 | 89 |
| EVA plus agreement additions | 93 | 185 | 92 |

“Unconfirmed” means absent from that image's recorded community annotations;
it does not prove a visual error. These annotations are neither exhaustive nor
owner-confirmed. The comparison is exploratory: 21 examples are too few to judge
a larger, denser donor collection, the reference vocabulary was developed on
this sample, and overlap with pretrained WD training data is unknown. Cached WD
results were capped at 128 predictions above 0.01; low-scoring tails may be absent.
These are annotation-agreement counts, not owner-rated precision or an archive
retrieval benchmark. No confidence calibration is claimed.

The practical next step is broader exact-source matching and a larger tagged
donor collection, followed by another independently held-out evaluation. Keep
WD predictions separate from attributed community tags and owner corrections.
Use similarity for reference browsing now; this experiment does not support
automatically inheriting specific pose, angle or lighting labels from neighbors.

Run from the repository root with the private pilot and pinned local models:

```sh
workers/visual/.venv/bin/python workers/visual/evaluate_transfer.py \
  --pilot .models/current-pilot \
  --config workers/visual/models.local.json \
  --output .models/current-pilot/transfer-results.json
```

Choose a fresh output filename for reruns. The private JSON includes model
provenance, hash-associated embeddings, donor identities/scores, per-image
predictions, aggregates, and experimental suggestions for the 27 unmatched
images. It contains private archive metadata and stays outside Git. Inference
uses the existing offline worker model loader; no images are uploaded. The
underlying sample and model revisions are documented in
[the metadata evaluation](VISUAL_METADATA_EVALUATION.md).

Validation: all 42 Python worker/helper tests passed, including self/source/hash
exclusion, agreement requirements, and unconfirmed-count arithmetic. The actual
48-image embedding run completed on the Mac. No app or backend code changed in
this experiment.
