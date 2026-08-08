# X / Twitter capture ergonomics

Parent roadmap: #37
Related capture sessions: #40

## Goal

Make saving a useful X/Twitter post while scrolling feel like a native feed action: one deliberate gesture, immediate confirmation, rich provenance, and no popup or filing chore for the ordinary case.

Ourchival is the durable memory for references that would otherwise disappear into timeline churn, likes, bookmarks, or forgotten tabs.

## Current foundation

The Clipper already detects X/Twitter pages and can snapshot the nearest `article`, including tweet text, displayed user identity, timestamp, links, images and alt text, clicked image, page context, and raw parser metadata. Multi-image post identity can already feed capture sessions/bundles.

## Primary interaction

Inject a small Ourchival action into each visible post's native action row or an adjacent unobtrusive position.

States:

- Save
- Saving…
- Saved
- Already saved
- Saved with warning

The ordinary click should capture immediately using the paired Clipper credential. The user keeps scrolling.

A secondary gesture/menu can expose richer choices:

- save entire post bundle
- save one specific image
- save source/post only
- favorite immediately
- assign current project
- add quick reason/note
- open saved item in Ourchival

## Metadata target

Capture as much stable visible provenance as practical from the rendered post and parser layer:

- canonical post URL / status ID
- author display name
- author handle
- author/profile URL
- post text
- post timestamp
- capture timestamp
- media URLs
- media ordering
- image alt text
- image dimensions when available
- quoted-post relationship and quoted author/source when visible
- reply-parent/conversation relationship when visible and reliable
- external links / expanded URLs when visible
- source client/labels when visible and useful
- multi-image bundle/session identity
- whether the capture originated from Home, Following, profile, list, search, bookmarks, etc. when this can be derived without brittle assumptions
- parser version and repairable raw snapshot

Engagement counts should be treated as ephemeral capture-time observations if retained, never core provenance.

## Feed ergonomics

The injected action should:

- avoid opening the Ourchival popup for ordinary saves
- avoid moving scroll position
- avoid requiring tags or destination decisions
- keep a local set of known saved post IDs so the button can render Saved immediately
- update optimistically, then reconcile server result
- recognize duplicates before uploading large media where possible
- survive X's virtualized/recycled feed DOM
- work as new posts enter the viewport during endless scrolling
- remain usable from Home, Following, profile timelines, search, lists, bookmarks, and individual post pages
- keep injected UI lightweight enough to have negligible effect on feed scrolling

## Capture semantics

### Default click

For a post with images:

- capture the post provenance once
- save the complete visual bundle by default
- preserve media ordering
- deduplicate assets by exact hash / known source identity
- attach every saved visual reference to the same source bundle/session

For a text/link post:

- save a link/reference with post snapshot and source context

### Modifier/secondary actions

Explore:

- Option/Alt-click: save source only
- Shift-click: save and favorite
- secondary menu: choose one image, whole bundle, project, or reason

Do not require users to memorize modifiers; they are accelerators after the basic button is excellent.

## Local feedback and offline tolerance

The extension should keep a bounded local capture queue so a save can acknowledge immediately even during transient network failure.

Desired behavior:

1. user clicks Save
2. post marks as queued/saved immediately
3. service worker uploads in the background
4. successful result becomes durable Saved
5. failures become a visible retry state without interrupting scrolling

Queue entries should preserve exact source identity and remain idempotent across service-worker restarts.

## Bulk opportunities

After single-post capture is excellent, explore user-invoked bulk helpers:

- save all currently visible liked/bookmarked posts
- select several visible posts, then save
- import a bounded current timeline window the user has explicitly scrolled through

Avoid autonomous account scraping or hidden background traversal. The user-controlled feed session is the source of truth for what should enter the private archive.

## Performance targets

- injected Save control appears within one animation frame or one MutationObserver turn after a post action row becomes available
- click-to-visible Saved/Queued feedback: < 50 ms
- capture action should never block feed scrolling
- already-saved state should resolve locally for known post IDs
- duplicate save should avoid redundant original-media upload when source/hash evidence is sufficient

## First implementation slice

1. Add a robust X feed post observer keyed by canonical status ID.
2. Inject one Ourchival save button into each discovered post.
3. Reuse the existing X parser/capture payload for click capture.
4. Add local known-saved/queued post state and optimistic feedback.
5. Persist a bounded retry queue across extension service-worker restarts.
6. Default multi-image posts to one complete creative bundle.
7. Test Home, Following, profile, search, lists, bookmarks, and individual-post views.
8. Measure feed scroll performance with hundreds of recycled post nodes.
9. Add a secondary action for save-one-image / save-source-only after the single-click path is solid.

## Acceptance criteria

- While scrolling X, a user can save a post to Ourchival with one click and continue scrolling immediately.
- Multi-image art posts arrive as coherent bundles with creator, text, timestamp, alt text, canonical source, and media order preserved.
- The same post visibly shows as already saved during later encounters in the session/local cache.
- Network or service-worker interruptions do not silently lose deliberate saves.
- Injected controls remain stable as X recycles timeline DOM nodes.
- The extension performs no hidden timeline crawling; captured items come from explicit user actions on posts the user is viewing.
