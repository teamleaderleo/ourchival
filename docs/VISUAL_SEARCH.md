# Search-first visual enrichment

Ourchival searches saved references across the selected collection. Titles,
notes, source text, saved reference/image tags, per-image notes and alt text,
boards, projects, and published machine annotations contribute searchable text.
Match explanations label machine-generated fields. Ratings never change access,
blur, collection placement, or ranking. Original media and source credit are not
rewritten by the worker.

The existing Convex adapter remains the catalog for this implementation, including
local Convex deployments described in [Local-first vault](LOCAL_FIRST_VAULT.md).
Drive originals and Convex previews retain their existing roles. SQLite is a
private, disposable worker cache and embedding index, not a replacement catalog.

Browser search uses keywords. Semantic text-to-image search currently uses the
worker CLI. Browser semantic search, a correction editor, a caption model adapter,
and blur controls remain separate work.

## Install and validate

The code is integrated into the repository; the earlier delivery applicator is
not needed. Use the existing development deployment workflow, then run:

```sh
pnpm install --frozen-lockfile
pnpm exec convex codegen
pnpm test
pnpm typecheck
pnpm build
```

Codegen requires a configured deployment. Convex local Node actions require Node
20, 22, or 24. Python is independent: Python 3.14.6 was used for the Mac validation.
There is no requirement to downgrade to 3.11/3.12. See
[validation results](VISUAL_SEARCH_VALIDATION.md) for tested versions and limits.

```sh
cd workers/visual
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-setup.txt -r requirements-embeddings.txt
python prepare_models.py --with-embeddings
python worker.py check --config models.local.json
python -m pip freeze > requirements.local.txt
```

Setup explicitly downloads immutable WD ConvNeXt v3 and SigLIP 2 model revisions,
records SHA-256 manifests, and retains available model cards/license files. Models
live in the ignored repository `.models/` directory by default; `--model-root`
selects another private location. Keep models, config, caches, and diagnostics out
of synchronized/public folders. Use a new `--output` filename for a new recipe.
Reuse `--wd-revision` and `--siglip-revision` to provision matching weights.

Inference verifies local artifacts and uses Hugging Face offline mode with
telemetry disabled. It does not send images to an inference provider. Enforced
network isolation, if needed, belongs in host egress rules; environment flags are
not a firewall. `check` reports the actual runtime/provider/device. WD defaults to
CPU ONNX Runtime. SigLIP auto-selects CUDA, then MPS, then CPU, using float32.
NVIDIA/CoreML setup and throughput must be validated on the intended device.

## Enable archive-wide keyword search

Deploy the additive schema/functions to the chosen development instance first.
Then configure the worker's API origin and owner credential in the session:

```sh
export OURCHIVAL_CONVEX_URL="https://YOUR-DEPLOYMENT.convex.cloud"
# Supply OURCHIVAL_ACCESS_KEY from your secret manager or session environment.
python workers/visual/worker.py rebuild-search
python workers/visual/worker.py status
```

Use the Convex deployment origin, not `.convex.site` or the website URL. Explicit
localhost HTTP origins work for local development. The access key is the existing
owner session/recovery credential, not a Convex deploy key; it currently grants
owner-level authority. A scoped worker credential remains future work.

Until the first backfill completes, search keeps its chronological scan fallback.
The HTTP endpoint can scan multiple chronological pages within a bounded request;
older matches beyond that window need further pagination. Once ready, new queries
use the full-text index. An existing fallback pagination chain keeps its mode.
The HTTP response includes `searchMode` (`browse`, `page_scan`, or `indexed`).

Backfill processes eight references per scheduled mutation. Generations fence
stale jobs; repeating `rebuild-search` restarts the generation. Board/project
renames coalesce rebuild requests. Reference, source, tag, board/project membership,
image metadata, and derivative writes refresh projections; machine submissions
and corrections refresh synchronously. New metadata write paths must also call
`scheduleReferenceSearch`. Run a rebuild after direct storage/hash maintenance.

## Compute a pilot, then publish cached results

```sh
cd workers/visual
python worker.py sync --config models.local.json \
  --cache "$HOME/.local/share/ourchival/visual.sqlite" --limit 250
python worker.py sync --config models.local.json \
  --cache "$HOME/.local/share/ourchival/visual.sqlite" --cached-only --publish
python worker.py search --config models.local.json \
  --cache "$HOME/.local/share/ourchival/visual.sqlite" \
  --query "blue raincoat, city at night, reflected neon" --limit 20
```

`--limit` bounds new tasks. Reruns reuse cached results and proceed to uncached
images. `--cached-only --publish` publishes cached results for the active recipe
without image downloads or new inference; it still loads the configured models.
After evaluating the pilot, `--limit 0 --publish` processes the remaining archive.

The worker enumerates owned storage objects, preferring previews over originals.
Drive-only/linked assets need the existing derivative pipeline. It does not fetch
source URLs as substitute images. Additional owned media hosts require an explicit
`--asset-host`; image requests omit the owner credential and refuse redirects.

Original bytes remain untouched. A decoded working copy applies EXIF orientation,
white alpha compositing, and model preprocessing. Limits are 32 MiB encoded and
40 megapixels decoded. Animation is skipped with a failure count/stderr message;
frame-aware support remains pending. Preview OCR can miss small text.

Cache identity includes asset/storage identity, original hash, model bytes,
thresholds, and preprocessing/runtime versions. A full sync retires missing items
from local semantic results; partial and cached-only runs preserve other entries.
An offline search can retain a live-deleted reference until a full sync. Semantic
results include asset/reference IDs, title, source URL, and cosine score. Multiple
assets of a reference may appear separately. A cosine score is not a probability.

## Corrections and provenance

`visualEnrichments` stores the latest result with model provenance, hashes,
scores, and revision. Publication uses compare-and-swap revisions and idempotent
retries. `visualCorrections` separately preserves human rejections across model
reruns. The owner-authenticated mutation `visualEnrichment:correct` accepts:

```json
{
  "accessKey": "OWNER_SESSION_FROM_ENVIRONMENT",
  "assetId": "ACTUAL_ASSET_ID",
  "rejectedTags": ["blue_hair"],
  "hideOcr": false,
  "hideCaption": false
}
```

This replaces the complete correction set for that asset. Add confirmed terms
through the existing saved-tag editor. Predicted artist labels are excluded;
ratings are stored separately. Projection origins distinguish source claims,
editable catalog metadata, owner notes/corrections, and machine output. Existing
capture-populated titles/tags are not retroactively called human-confirmed.

## Optional OCR and retrieval limits

OCR is not required for tagging or embeddings. Install `requirements-ocr.txt` only
when using it. Supply compatible, locally vetted RapidOCR detector, classifier,
recognizer, and dictionary artifacts using `prepare_models.py`'s `--ocr-det`,
`--ocr-cls`, `--ocr-rec`, `--ocr-keys`, `--ocr-id`, and `--ocr-revision` options.
The adapter/model combination still needs real-model validation. Hashes prove
artifact identity, not recognition quality or model compatibility.

Queries normalize to at most 16 terms. Convex tokenization/relevance applies;
this is not arbitrary substring matching, especially for Japanese text. Domain,
tag, board, and project restrictions are checked against current reference data
after candidate retrieval, so sparse filters can require more pages. Convex's
1,024-result search-scan limit still applies.

Projection caps: 32,000 field characters, 256 fields, 64 reference tags, 64 distinct
image tags across up to 32 assets, 32 boards, 32 project uses, and 32 machine results.
Overflow sets `truncated`. Submissions cap tags at 128, OCR at 16,000 characters,
and captions at 2,000. These limits need evaluation against the actual archive.

A representative 250-image pilot remains the quality gate for archive-wide use:
write realistic queries first, record relevant IDs, and measure recall@20, useful
tag precision, OCR errors, latency, and memory across the archive's image types.
The synthetic integration smoke is not that evaluation.

Rollback by stopping the worker and reverting application changes. Added tables
can remain while old code runs. Do not delete tables/caches as part of rollback
without an explicit retention decision. Original images need no restoration.

## Primary references

- [Convex text search](https://docs.convex.dev/search/text-search)
- [Convex function HTTP API](https://docs.convex.dev/http-api/)
- [WD model](https://huggingface.co/SmilingWolf/wd-convnext-tagger-v3) and [author preprocessing](https://huggingface.co/spaces/SmilingWolf/wd-tagger/blob/main/app.py)
- [SigLIP 2 model](https://huggingface.co/google/siglip2-base-patch16-256)
- [RapidOCR usage](https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/usage/) and [local model parameters](https://rapidai.github.io/RapidOCRDocs/main/install_usage/rapidocr/parameters/)
