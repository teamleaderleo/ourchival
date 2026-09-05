# Reference-oriented metadata trial — September 5, 2026

The useful target is an artist's reference detail: pose, gesture, viewpoint,
framing, lighting, expression, clothing construction and composition. A large
Danbooru tag vocabulary is a useful intermediate result, not the whole user
experience. An observed feature must remain separate from the owner's reason
for saving an image.

## Sample and method

The initial hosted-catalog sample contained nine mostly official illustrations.
Leo identified it as the wrong archive. It is retained privately as a smoke test,
and is not evidence for production thresholds or relevance to the ongoing archive.

The subsequent test used Air Blue's current local Convex catalog, whose originals
are linked to Google Drive. A read-only inbox traversal covered 18,398 references;
15,850 had an available stored-image link. Reservoir sampling with seed 20260905
selected 48 eligible references across the traversal, selecting one image from
each. All 48 unique images were retrieved: 31 through the authenticated local
Drive proxy and 17 through local Convex preview URLs. Originals, catalog data,
the extension and import checkpoints were not modified.

This sample includes illustration, character art, sketches, environments,
photography, comics and graphic layouts. It is sampled from eligible references,
not uniformly from every image: multi-image posts have one chance per reference.
The catalog is live, so this traversal is not a transactionally frozen snapshot.
The manifest records the selected asset/reference identities and SHA-256 hashes.
Private images, manifests, raw annotations and the interactive comparison remain
under the ignored `.models/current-pilot/` directory; they are not committed.

After inspecting the sample, the assistant wrote 34 descriptive queries with an
intended target before running inference. These emphasize gestures, angles,
framing and visual details. The resulting ranks are a small-candidate retrieval
sanity check, not owner-judged relevance or recall across 18,398 references.

## Observations

| Method | Measured result on 48 images | Practical implication |
| --- | --- | --- |
| WD ConvNeXt v3, CPU | Median 0.262 s/image; 28 general tags at 0.35 | Fast baseline for automatic tagging |
| WD EVA02 Large v3, CPU | Median 1.026 s/image; 37.5 general tags at 0.35 | More detail and more output; about four times slower here |
| SigLIP 2 base, MPS | Intended target first for 29/34 queries; top five for 34/34 | Promising for remembering an image through a description |
| Florence-2 base-ft, MPS | Completed captions and OCR on 48 images | Captions can be generic; OCR and object/pose claims require review |
| Qwen3-VL 2B, MPS float16 | Median 7.501 s/image; all 48 outputs exceeded requested structural limits | Review-only experiment; not suitable for automatic field publication as tested |

The experimental reference grouping reduces the median surfaced terms to six
for ConvNeXt and 7.5 for EVA, without deleting raw predictions. Pose/gesture
groups appear for 25/48 and 32/48 images respectively; viewpoint groups appear
for 10/48 and 13/48. These are coverage counts, **not accuracy measurements**.
The group vocabulary was refined during inspection and is not a held-out test.

Useful examples include seated/from-behind for the drummer reference, hand on
cheek for a resting-head pose, and heart hands for a finger gesture. Missing
details remain a real limitation: a raised arm can be absent even when clothing
tags are plentiful. The ballet image gets standing-on-one-leg and foot-position
details; these do not exhaust its bending gesture. Models disagree on some
sitting/squatting poses.

Qwen3-VL 2B was also tested with a structured artist-reference prompt. It often
exceeded the requested field limits, introduced generic claims such as balanced
composition, and invented absent details. On a snowy forest road without a
visible person it supplied poses, a winter coat, a sweater and an expression.
This model/prompt is unsuitable for automatically populating those fields.
All 48 outputs parsed as JSON, but every output violated the requested field
limits. Format failures and visual factual errors are separate findings.
That is a result for this tested configuration, not a verdict on every
vision-language model or on a future constrained decoder.

Natural language retrieval handles descriptions that a fixed tag list misses.
Its five non-first results were still in the first five, but similar portraits
and costumes compete with the intended image. A 48-image candidate set is much
easier than the full archive; no archive-scale success rate is claimed.

## Direction

Start with [existing source-tag lookup](SOURCE_TAG_LOOKUP.md): a subsequent live
test found 21 exact Danbooru MD5 matches among these 48 images after checking
originals. This should precede inference when an existing tagged match is available.

1. Keep automatic local Danbooru-style tagging for gaps, with the complete machine result available
   underneath a smaller reference-oriented view. Do not promote generic tags
   such as subject count into the main review experience just because they have
   high scores. This is presentation/grouping, not a content exclusion policy.
2. Use SigLIP for descriptive lookup and similarity. Continue testing poses and
   near-duplicate compositions against a larger candidate set before choosing
   final ranking behavior.
3. Treat free-form or structured vision-language suggestions as reviewable
   additions. Empty or uncertain viewpoint fields are preferable to invented
   camera angles. OCR should not become automatic search text until its quality
   is validated for the archive's Japanese, English and graphic typography.
4. Keep personal save reasons separate. Optional notes or a selected region can
   say “the hand gesture” or “these sleeve folds”; corrections and repeated
   choices can later guide which predicted details are surfaced. The model
   cannot establish why the owner saved an image from pixels alone.

No production thresholds, inference provider, publication behavior or display
rules were changed by this trial. `reference_facets.py` is an experimental view
used by the local comparison, not a deployed catalog migration.

## Reproduction

Use the worker's Python environment plus compatible `torchvision` for Qwen's
processor. The tested Mac environment uses Python 3.14.6, Torch 2.14.0,
Torchvision 0.29.0, Transformers 5.16.1 and ONNX Runtime 1.29.0. Model acquisition
is a separate explicit online step; evaluation imports the worker's offline
settings and loads local safetensors/ONNX without remote model code.

| Model | Pinned revision |
| --- | --- |
| SmilingWolf/wd-convnext-tagger-v3 | `d39e46de298d27340111b64965e20b8185c407e6` |
| SmilingWolf/wd-eva02-large-tagger-v3 | `b25b82a03f7282e41aa2f257a52c7583b710bd1c` |
| google/siglip2-base-patch16-256 | `3f9f96cb90da5dbc758b01813f2f6f1aee24c1ab` |
| florence-community/Florence-2-base-ft | `0b03b6f15a4a211370fb204aee4e7dd48887ea37` |
| Qwen/Qwen3-VL-2B-Instruct | `89644892e4d85e24eaac8bacfd4f463576704203` |

`images.json` is an array of `{file, sha256}` entries (optional private IDs are
retained only locally). `queries.json` contains `{text, relevant: [filename]}`.
The existing worker config supplies WD and SigLIP. Each additional local model
recipe contains `{id, revision, directory}` pointing to artifacts downloaded
from the exact pinned revision. Evaluators record the actual model hashes.
Never point these scripts at unreviewed downloaded Python model code.

```sh
python workers/visual/evaluate_local.py \
  --images PRIVATE/images.json --queries PRIVATE/queries.json \
  --config workers/visual/models.local.json \
  --eva PRIVATE/eva-model.json --florence PRIVATE/florence-model.json \
  --output PRIVATE/results.json
python workers/visual/evaluate_caption.py \
  --images PRIVATE/images.json --model PRIVATE/qwen-model.json \
  --task reference --output PRIVATE/qwen-results.json
python workers/visual/render_evaluation.py \
  --results PRIVATE/results.json --qwen PRIVATE/qwen-results.json \
  --output PRIVATE/comparison.html
```

Keep the image files beside the result JSON for the renderer. The HTML embeds
the images and is private; do not publish it. Comparisons are sequential, use
one inference per image/task, and include warm-up in per-image timings. They do
not establish steady-state p95 latency or memory limits. Big Red acceleration,
broader image coverage and a human relevance/precision evaluation remain open.

Validation: 39 Python tests pass, including source-identity matching, reference grouping, thresholding,
deduplication, per-group limits and preservation of raw predictions. Both model
evaluators completed on all 48 selected images. All downloaded input SHA-256
hashes remained unchanged. The private HTML was inspected in Chrome, including
its threshold control and embedded image loading. The evaluated prototype is
not a deployed change to the archive's search or inspector.

## Primary sources reviewed

- [WD ConvNeXt model card](https://huggingface.co/SmilingWolf/wd-convnext-tagger-v3)
  and [WD EVA02 model card](https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3):
  different published validation thresholds; their scores should not be treated
  as interchangeable calibrated probabilities.
- [SigLIP 2 model card](https://huggingface.co/google/siglip2-base-patch16-256):
  image/text representations used for local retrieval.
- [Florence-2 documentation](https://huggingface.co/docs/transformers/model_doc/florence2):
  native caption and OCR task support.
- [Qwen3-VL model card](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct):
  the small vision-language model evaluated for reference suggestions.
- [PixAI Tagger model card](https://huggingface.co/pixai-labs/pixai-tagger-v0.9):
  a newer anime vocabulary and recall-oriented candidate. Reviewed but not run
  in this comparison. Its author-reported benchmark is not a result on this archive.
