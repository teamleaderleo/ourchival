# Creative site adapters

Related: #65, #64, #66, #58, #67

Ourchival's feed-native capture path should feel the same across X, Pixiv, Pinterest, Danbooru, and later creative sources while preserving the richest source-native provenance each site exposes.

## Ownership boundary

The shared Clipper layer owns:

- trusted-user activation
- injected control state and closed-shadow rendering
- SPA/infinite-scroll observation scheduling
- local Saved / Queued / Warning restoration
- durable queue persistence and storage budgets
- pairing/authentication
- retry/recovery behavior
- capture-session identity and progress reporting
- duplicate/idempotency behavior

A site adapter owns only:

- whether the current location belongs to the site
- which DOM node represents one saveable creative item
- stable source identity for that item
- source-specific snapshot extraction
- normalized capture payload preparation
- where the shared save control should be mounted

This keeps site DOM churn away from credentials, queue semantics, and archive mutation authority.

## Adapter interface

`CreativeSiteAdapter` provides:

- `platform`
- `matchesLocation(location)`
- `listItems(root)`
- `closestItem(element)`
- `identify(item)`
- `prepareCapture(item)`
- `actionContainer(item)`

The first implementation is `xCreativeSiteAdapter`. Pixiv, Pinterest, and Danbooru should implement the same contract rather than copying the X controller.

## Capture rule

A deliberate click becomes **Queued** only after the complete normalized payload group is persisted in extension-local storage.

The page/content script never receives the paired-device credential. The service worker performs authenticated capture from the durable queue.

Injected controls accept trusted user events only. Per-item Saved / Queued / Warning state remains inside a closed Shadow DOM and isolated extension-script state.

## Queue compatibility

The v1 creative queue key remains stable across the adapter refactor.

New queue records store `platform` explicitly. Older #67 records that stored `source: "x_post"` normalize to `platform: "x"` when read. Malformed records are ignored instead of blocking the queue drain.

Queue source keys must be platform-qualified, for example:

```text
x:123456789
pixiv:123456789
danbooru:123456
pinterest:987654321
```

## Provenance requirements

Every adapter should preserve, when reliably observable:

- canonical item URL and stable source ID
- creator/account identity and profile URL
- title/caption/description
- original publish time
- capture time
- ordered media identity
- alt text when present
- source-native tags/categories with their source provenance
- source relationships such as quoted post, series, pool, parent/child, board, or outbound source
- a versioned raw snapshot sufficient to repair a parser later

Do not infer source facts from weak visual guesses. Generated tags/descriptions belong to the downstream enrichment pipeline in #66.

## Multi-image works

A multi-image or multi-page creative item should normally become one capture bundle with one stable session identity and ordered child assets.

Partial success remains retryable because the backend performs source/content deduplication and the queue keeps stable identity across retries.

## Performance rules

Adapters run inside pages the user is actively scrolling, so discovery must stay cheap:

- process affected/new item nodes instead of rescanning the whole document per mutation
- batch remount work through `requestAnimationFrame`
- avoid remote calls during item discovery
- avoid expensive image processing in the content script
- derive Saved/Queued state from local extension storage
- perform authenticated capture and enrichment outside the page hot path

## Runtime fixture checklist

Each adapter should be verified against real current pages before being treated as stable:

1. initial page load
2. SPA navigation
3. infinite scrolling / recycled cards
4. single-image item
5. multi-image/page item
6. source-only/text item when meaningful
7. already-saved state
8. rapid repeated saves
9. offline / revoked device / queue-full behavior
10. page-script attempt to synthesize capture
11. source relationships that can confuse provenance
12. extension reload with pending queued captures

## Site-specific priorities

### Pixiv

Preserve artwork ID, artist identity, title/description, publish time, source-native tags, ordered pages, and series information when present. The parser should consume a versioned snapshot; selectors stay in the adapter.

### Pinterest

Preserve pin identity plus the outbound/original source URL aggressively. Pinterest is often an intermediary, so the upstream source belongs beside the pin metadata.

### Danbooru

Preserve post identity, source/original URL, dimensions, artist attribution, rating/category data, pools/parent-child relationships, and the complete native tag set with category/namespace provenance.

Danbooru tags remain source facts. They do not silently become user-authored Ourchival tags.
