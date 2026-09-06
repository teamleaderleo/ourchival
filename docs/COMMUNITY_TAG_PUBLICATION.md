# Publish verified community tags

Danbooru labels are stored separately from owner tags and model suggestions.
The publisher accepts exact MD5 receipts only, checks the local file's SHA-256
and MD5 again, and binds it to a current archive input. A same-post candidate,
artist-profile match or similar-looking picture cannot publish tags.

The authenticated owner worker bridges Danbooru's MD5 to the archive SHA-256.
The mutation verifies that SHA-256 against immutable Convex storage metadata, or
against the current Drive file ID and original content hash. It checks the asset's
reference and original identity again in the write transaction. Drive binding
checks use the catalog's recorded identity; they are not a new Drive availability
audit. No media is uploaded or copied during publication.

## Storage and retrieval

- `communityTerms` shares names/categories with immutable numeric codes. It stays
  separate from the machine vocabulary and accepted owner-tag list.
- `communityPosts` stores one immutable source snapshot per normalized receipt:
  provider, post ID, MD5, update time, observed source URL, Pixiv ID, and an unscored
  binary term set. Matching images reuse that snapshot.
- `communityMatches` binds an asset to the snapshot and verified input identity.
  It records exact-MD5 evidence and retrieval time. Retries are idempotent. Newer
  source revisions may replace an association; older/conflicting revisions cannot
  overwrite it. Existing snapshots remain valid for their other associations.

No confidence score is invented, reference author/source credit is not rewritten,
and sealed/private visibility and accepted tags are preserved. Raw lookup routes,
candidate lists, failures and file paths remain in private worker receipts.

`communityTags:inspect` is owner-authenticated and returns complete categories,
terms, source links, evidence and revision times for one asset. Changed input
bindings return `stale`. Search projection refresh excludes stale associations
and labels current terms **Danbooru tags**, with source provenance. Active Library
search without an explicit chronological sort now uses the search index across
filed and unreviewed items; archived/trash rows remain excluded. Explicit
chronological searches retain the existing scan-and-pagination behavior.

Limits are deliberate: four post associations per asset, 512 terms per source
snapshot; search expands up to eight associations and 64 terms each per reference.
Truncation is explicit and the full per-asset inspector retains the other terms.
Owner/source text has priority over community/model terms in the bounded search
projection. These bounds avoid copying a source graph into every card or creating
one database row for every image/tag pair.

The image viewer shows up to six source terms beside the selected image. A
disclosure reveals categorized, filterable terms and source links. Sealed images
require an explicit reveal before loading source tags. Stale matches are labeled
and cannot be edited in the viewer.

Hide/restore changes only that image's community search terms. Preferences use
one compact binary code set per image in `communityCorrections`, with revision
checks to prevent stale edits. Original snapshots, owner tags and model decisions
remain separate; source updates preserve the preferences. The same term can
still match another image or another metadata source. Model suggestions in the
viewer now follow the selected image, including pages beyond the former 32-image
inspection limit.

## Run locally

The image manifest is an array of `{file, assetId, referenceId, sha256}` objects.
An optional `localPath` points at existing image bytes when they are in another
directory; otherwise `file` resolves beside the manifest. The receipt's `file`
must match exactly. Multiple receipt variants should be reconciled into one
manifest entry with the actual verified file hash, never an assumed rendition.

```sh
node scripts/publish-community-tags.mjs \
  --images /private/images.json --receipts /private/booru-results.json \
  --output /private/publication.json
```

The default is a dry run. Add `--apply` to publish. The command reads the local
owner key in memory, accepts only a loopback vault URL, and writes private atomic
checkpoints. It prints aggregate counts only. Re-running revalidates inputs and
replays successful mutations without duplicates, including after partial failure.
Failures remain explicit and produce a nonzero exit code; transport errors are
not serialized because they may contain request arguments. No browser session,
cookies, model invocation or source-network request is required for this step.

The receipt distinguishes observed images, historical exact matches, unconfirmed
images, newly published versus existing associations, and publication failures.
An exact historical match with different current archive bytes is an unresolved
binding, not a valid current match. Use the original lookup workflow on the
current rendition to investigate it; do not weaken the hash check.

## Local application, September 6, 2026

Of 48 pilot images, 21 had historical exact-MD5 receipts. Eighteen still matched
current archive inputs and were published: 18 canonical references, 18 shared
source snapshots, 636 term assignments and 391 distinct community terms. Their
unscored binary payloads total 2,688 bytes; this excludes dictionaries, provenance,
search projection and database overhead.

Three exact historical receipts have no matching current archive input and remain
explicit unresolved bindings. The other 27 pilot images remain unconfirmed.
The publisher therefore exits nonzero for this input set even though 18 writes
succeeded. Replaying it created zero new associations and recognized all 18
existing ones; the same three bindings remained unresolved.

All 18 published results were read back and compared with their full source tags
and update/source metadata. Three live active-Library searches found the target
references with **Danbooru tags** match attribution. Aggregate evidence is in
[the publication receipt](validation/community-publication-live.json); private
paths, source payloads and failure details remain in the local reconciliation
directory. This is a verified pilot application, not archive-wide coverage.

Validation passed: 244 Vitest tests, six Node tests, five backup tests, 55 visual
worker tests and full typechecking. Focused coverage includes source/owner/model
separation, shared snapshots, stale input rejection, Drive binding, revision
conflicts, active-Library filtering, binary validation, partial-write replay and
credential-safe failure receipts.

The subsequent viewer pass passed 249 Vitest tests, all auxiliary suites, full
typechecking and a production web build. A browser fixture using the real viewer
styles checked 1280×720, 1440×900 and 700×900 layouts and hide/restore interactions;
this was not an authenticated end-to-end browser test. Live read-only checks
verified all 636 source terms and 21 selected-image queries after local deployment.
No owner preferences were changed. See [the review receipt](validation/community-review-live.json).
The local launcher now allows two minutes for a large backend to start, avoiding
repeated interruption by its former 30-second timeout.
