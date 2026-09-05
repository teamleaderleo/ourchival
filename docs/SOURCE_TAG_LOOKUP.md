# Reuse existing tags before predicting them

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
