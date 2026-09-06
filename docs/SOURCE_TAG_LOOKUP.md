# Reuse existing tags before predicting them

## Twitter / Pixiv matching, September 6, 2026

The lookup worker now accepts several observed artwork URLs per image. It queries
the image MD5, then the Twitter post and Pixiv artwork identities, preserving
earlier candidates when a later route has no results. A source-post match alone
does not identify an individual page of a multi-image work.

If the image is still unmatched, it can look up the recorded author profile in
Danbooru's artist API. It verifies that the returned artist record actually lists
that profile before querying the artist's posts. The linked Twitter/Pixiv profiles
are retained as attributed identity evidence; names alone do not join artists.
At most four source identities, two profiles and two artist tags are queried per
image, with capped result sets, truncation flags, and omitted-route counts.

Each receipt separates exact MD5 matches, same-post candidates, artist candidates,
bounded no-match results and errors. Only exact matches contain `communityTags`
and `verifiedMirrorSources`; a matching artist or source post cannot silently
transfer tags. General, artist, character, copyright and meta tags keep their
Danbooru post ID, post URL and provider update timestamp. Image SHA-256 remains in
the receipt, and optional reference/asset IDs and page indices survive lookup.

Sources-manifest records may contain `file`, `sourceUrl`, `sourceUrls`, `authorUrl`
and `authorUrls`. URLs are observations for that image; linked author profiles are
not artwork URLs. Existing single-source manifests continue to work. The runner
uses a shared query cache and one request per second; denial or rate limiting
checkpoints and stops. `--resume` requires the exact same input manifests, retries
unfinished images, preserves previous errors, and skips completed images.

The lookup remains read-only. Its exact-image receipts can now be published with
the separate [catalog publisher](COMMUNITY_TAG_PUBLICATION.md). Neither tool runs
a whole-archive lookup automatically or uploads image files to third parties.

### Learning from partial coverage

Use exact matches as attributed community-labeled examples. Keep community labels,
model predictions and owner corrections separate. Start with the existing WD
tagger and embedding/nearest-neighbor evaluation; compare a small regularized
multi-label classifier before introducing a larger vision-language model.

Evaluate by artwork family so Twitter/Pixiv mirrors and resized copies cannot
leak between training and testing. Also hold out artists and manually inspect
unmatched images: booru coverage is selective, and absent tags are not reliable
negative labels. Report precision/coverage by tag category rather than claiming
that transferred tags are canonical facts. A vision-language model can provide
additional predictions on uncertain cases, subject to a measured local memory
budget and explicit provenance. No cloud image upload or model installation is
part of this change.

API references: [posts](https://safebooru.donmai.us/wiki_pages/api:posts),
[artist profiles and URL lookup](https://safebooru.donmai.us/wiki_pages/api:artists).

Ourchival should first look for the same saved image in an existing tagged source.
This avoids spending inference time recreating community metadata and can recover
useful reference terms that models miss. The source's tags remain attributed
community claims, separate from model predictions and owner-confirmed metadata.

## Live test on the current archive

The [48-image reference trial](VISUAL_METADATA_EVALUATION.md) was extended with
read-only Danbooru queries. No image was uploaded to an image-search service and
no archive metadata was published. Requests used local file MD5s and public X
post IDs, with one request per second and bounded responses.

- The initial image files found **16 exact MD5 matches** and five source-post
  candidates. Some initial files were resized previews.
- Looking up the 17 corresponding stored originals recovered five more exact
  matches: four from Drive originals and one from a Convex original.
- The combined result is **21/48 exact MD5 matches**. All five source-post
  candidates were confirmed after checking originals. The other 27 were not
  found by these lookup methods; this does not prove they are absent from boorus.
- The booru general tags included useful terms such as `from_behind`,
  `hands_on_feet`, `plantar_flexion`, `tiptoes`, `hand_on_own_face` and `heart_hands`.
  The median focused reference view contained six terms per matched image.
- One Gelbooru API test returned HTTP 401. Its API requires authentication in
  this environment; no bypass or account change was attempted.

The sample is not large enough to extrapolate a reliable hit rate for the entire
archive, Pixiv or Pinterest. It does establish that this route works on actual
saved references. Exact MD5 matching is a practical file-identity check for booru
interoperability, not a security guarantee or proof that the supplied tags are true.

## Proposed enrichment order

1. Retain metadata already captured with the source.
2. Resolve direct booru post links or public source identities: X/Twitter post
   ID, Pixiv artwork ID, and any known original media URL. Direct URL/source-ID
   lookup is cheap, but source posts can contain multiple images.
3. Confirm the asset using the original file hash where possible. Preview hashes
   are not substitutes for original hashes. Store the matching evidence with the
   booru post ID and fetched metadata snapshot.
4. For unmatched or altered files, reverse-image lookup can produce candidates.
   Crops, resized copies, edits and multi-image source posts need image-level
   confirmation. Do not silently choose the first result or union tags from every
   image in a tweet/Pixiv gallery.
5. Use local tagging for gaps and semantic embeddings for descriptive retrieval.
   Keep a compact reference-oriented view over the full attributed tag vocabulary.

An imported tag set should record provider, post ID/link, source URL, match type,
asset/input identity, retrieval time, remote update time and tag categories. Keep
general, artist, character, copyright and meta tags separate. Do not overwrite
source credit or call community tags model-generated. Artist/character labels
from a matched post are source claims, not new visual identity predictions.
Owner rejections and additions remain independent of future provider refreshes.
Ratings and moderation flags do not control image access or ranking.

The eventual background worker should cache positive and negative lookups,
respect provider rate limits, refresh changed metadata deliberately, and work
incrementally on newly captured items. Existing sources take precedence over
spending inference on the same facts; conflicting claims remain distinguishable.

## Implemented experiment

`workers/visual/booru_lookup.py` performs bounded read-only Danbooru MD5 and
source-ID lookup. It validates source domains and exact post identities, keeps
source-post candidates distinct from file-hash matches, records provider metadata
and stops on denial/rate limiting. It has no archive publication function.

```sh
python workers/visual/booru_lookup.py \
  --images PRIVATE/images.json --sources PRIVATE/public-sources.json \
  --output PRIVATE/booru-results.json
```

The image manifest contains `{file, sha256}` entries. The source manifest contains
`{file, sourceUrl}` entries. Only public source IDs and hashes go to the lookup
provider. The output contains private archive associations and should remain
outside shared directories. This is a tested lookup prototype; background catalog
integration, persistent caching and reverse-image matching remain subsequent work.

Unit tests cover X/Twitter normalization, modern/legacy Pixiv links, lookalike
domains, credential-bearing URLs, source-ID prefix collisions, multi-image
candidates and hash-match precedence. The private comparison can display booru
metadata with `render_evaluation.py --booru PRIVATE/booru-combined.json`.

Primary references:

- [Danbooru search documentation](https://safebooru.donmai.us/wiki_pages/help:cheatsheet)
  documents `source:`, `pixiv:` and `md5:` queries.
- [Danbooru posts API](https://safebooru.donmai.us/wiki_pages/api:posts)
  provides source and category-specific tag fields.
- [Gelbooru API documentation](https://gelbooru.com/index.php?page=wiki&s=view&id=18780)
  describes source/hash metatag lookup and possible authentication requirements.
