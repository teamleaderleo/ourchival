# Source tags and visual analysis: integration work

## Verified state, September 5, 2026

Read-only inspection of Air Blue's canonical local vault found 104 shared tags,
zero personal definitions/examples, and zero published visual enrichments. All
8,943 completed enrichment jobs at inspection were media derivatives. Those jobs
are not image-model inference. The existing inspector can review model results,
but an empty result must not imply that an image has been analyzed.

The canonical checkout has no installed model configuration or model directory.
The earlier validated models, Python environment and private pilot remain in
`/Users/leoli/Projects/worktrees/ourchival/search-first`. Do not duplicate their
weights or run from stale source. A future provisioning step must use canonical
worker code, validate artifact hashes and account for absolute paths in the old
configuration/environment before reuse. No inference was started during this audit.

Pasted links currently use `/capture-links`, which checkpoints link metadata
without downloading media. `workers/visual/booru_lookup.py` is a read-only lookup
experiment, not an integrated automatic importer. Browser search is keyword-based;
SigLIP semantic search currently uses the worker CLI.

## First usability change

Here, the user is trying to find useful reference details and correct mistakes.
The model inspector now groups detail terms using the same vocabulary as the
Python pilot, showing up to three terms per group. A searchable full list retains
all other terms and correction controls. Grouping changes neither the stored
predictions nor search inclusion. Unknown terms and artist/character predictions
remain in the full list. Empty-state copy explicitly distinguishes downloading
an image from running analysis. The vocabulary remains experimental; grouping is
not an accuracy claim.

## The one-link contract

A direct artwork post link should enter the existing capture session and produce:

1. A reference immediately, with progress distinguishing metadata fetched, image
   bytes stored, tags indexed, and optional model analysis. Failed stages are
   resumable independently. Never label metadata-only capture as fully imported.
2. The provider's original image bytes in Drive, verified with actual dimensions,
   byte count and hashes. Keep previews explicitly degraded. Record inaccessible,
   deleted, and unsupported media without guessing replacement URLs.
3. An attributed source snapshot containing raw tag categories, provider post ID,
   provider update time and retrieval time. Community claims are not machine
   predictions or owner-approved tags, and must not receive fabricated confidence.
4. Both the imported post URL and the provider-declared original source URL.
   A declared Pixiv/Twitter link is a relationship, not proof that every image in
   that source post is identical. Confirm image matches before transferring tags
   or attaching to existing multi-image references. Never credit the booru
   uploader as the artwork's artist.
5. A compact reference-detail view with attributed full tags behind disclosure.
   Owner additions and rejections survive refreshes. Existing sealing decisions
   cannot be weakened by community ratings or model predictions.

Use the current reference, asset, snapshot, origin, job and tag infrastructure.
Preserve the shared tag dictionary; add an explicit community-claim relationship
where necessary instead of pretending provider tags are model output. Store the
provider's wording/categories even when the UI normalizes spaces or aliases.

## Provider implementation order

- **Danbooru first:** the documented post endpoint provides distinct original,
  sample and preview URLs, category-specific tags, source and Pixiv ID. Missing
  media visibility must produce a recoverable gap, not a guessed download.
  [Post API](https://safebooru.donmai.us/wiki_pages/api:posts).
- **Zerochan next:** it documents a read-only API, but its detailed endpoint
  contract and original/source fields still need verification. The documentation
  fetch returned 502 during this audit. Do not assume booru-compatible fields.
  [API](https://www.zerochan.net/api).
- **Gelbooru:** the earlier pilot received 401. Support the documented credentials
  through the existing secret boundary before declaring the adapter usable.
  [API documentation](https://gelbooru.com/index.php?id=18780&page=wiki&s=view).
- **Instagram later:** reuse the same original-byte receipt and provenance
  contract; provider access and multi-image behavior require separate validation.

Each adapter needs a provider-wide paced queue, Retry-After handling, bounded
backoff, cached lookups and an explicit retry receipt. No account-wide crawling
is implied by importing a single post. Fixtures should cover unavailable media,
same-source/different-image cases, changed metadata and owner corrections.

## Model choices after source metadata

The 48-image local pilot supports WD ConvNeXt as the fast baseline, with EVA02
as an optional richer pass, and SigLIP for descriptive retrieval. These are pilot
results, not archive-wide accuracy evidence. Florence OCR/captions need review;
Qwen's tested structured captions hallucinated details and should not publish
reference fields automatically. See `VISUAL_METADATA_EVALUATION.md`.

Reuse exact verified input/recipe results; do not infer again for every repost.
Keep model/version/input hash alongside predictions. Personal concepts need
owner examples and held-out evaluation before propagation. A practical next
release should ship Danbooru end to end before adding more model choices, then
connect semantic retrieval to the archive search UI.

The first change above is implemented. Provider imports, worker activation and
browser semantic search remain outstanding; this document is their acceptance
contract, not a completion receipt.
