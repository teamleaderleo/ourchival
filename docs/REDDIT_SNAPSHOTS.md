# Reddit thread snapshots

Ourchival preserves the visible loaded portion of a Reddit thread as a versioned JSON artifact when the user explicitly saves the page or current tab.

## Capture contract

The `reddit.dom` adapter records:

- source and canonical URLs
- thread title and subreddit
- visible post ID, author, timestamp, permalink, and body
- comments in visible DOM order
- comment ID, author, timestamp, permalink, body, and nesting depth
- adapter version and capture time
- visible and captured comment counts
- an explicit truncation flag

The artifact uses `referenceArtifacts.kind = page_snapshot` with archival retention.

## Supported page families

The adapter uses layered selectors for:

- current Reddit custom elements such as `shreddit-post` and `shreddit-comment`
- common app markup such as `data-testid` post and comment containers
- old Reddit `thing`, `comment`, `author`, `md`, and `live-timestamp` markup

The adapter version must change when a repair changes interpretation of stored fields.

## Bounds

- 500 comment containers inspected
- 20,000 characters per comment
- 100,000 characters for the post body
- 900 KB maximum serialized JSON
- 1.5 MB maximum uploaded artifact

Oversized threads retain the earliest visible comments that fit and record both counts plus `truncated: true`.

## Privacy boundary

The adapter reads visible rendered DOM after an explicit capture action. It does not:

- call Reddit APIs
- inspect cookies, local storage, or authorization headers
- expand collapsed branches
- capture comments absent from the current page
- capture unrelated sidebar or account pages as thread snapshots

Generic readable text and the visible screenshot remain independent fallback artifacts.

## Replacement

Convex Storage supplies the authoritative SHA-256 hash. Unchanged recaptures discard the redundant upload and refresh capture time. Changed snapshots replace the prior owned JSON blob.

Tracking issue: #43

Stacked implementation: #49 on #48
