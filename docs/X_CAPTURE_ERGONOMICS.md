# X / Twitter capture ergonomics

Related issues: #64, #65, #40
Related implementation: #67

## Target interaction

While browsing X, a visible post should gain one compact Ourchival action. Clicking it should preserve the post without opening another page, popup, or tab.

The ordinary interaction is:

1. click Ourchival on a post
2. the post snapshot becomes a normalized capture payload group
3. the payload group is durably queued in extension-local storage
4. the UI immediately shows Queued
5. the service worker captures the group
6. the UI advances through Saving to Saved, or shows a retryable warning

For visual posts, the default is the complete post bundle in source order. Source-only and one-image actions remain secondary controls for a later slice.

## Current implementation in #67

The current draft includes:

- X post discovery through the existing DOM parser
- one Shadow-DOM-isolated action in the native post action row
- targeted MutationObserver processing for X's SPA/infinite-scroll/recycled DOM
- stable local source keys based on post ID with canonical URL fallback
- deterministic payload generation with source metadata, creator identity, timestamp, post text, media order, alt text, and raw parser snapshot
- a persistent creative-capture queue stored in `chrome.storage.local`
- queue deduplication by source key
- explicit item and serialized-byte budgets; full queues reject new saves instead of silently evicting old ones
- a service-worker queue processor with persisted retry metadata
- a one-shot Alarms API recovery wake-up for unexpected service-worker suspension
- shared `captureSessionId` values for multi-image groups
- live capture-session reporting through the existing #53 session reporter
- local Saved IDs so repeat encounters can render Saved without a network lookup
- queued/failure state restoration when X recycles a feed card
- tests for payload/source-key behavior and queue bounds/retry bookkeeping

## Reliability rules

A click is acknowledged as Queued only after the payload group has been written to extension storage.

Queued work survives page navigation and unexpected service-worker termination. The worker attempts capture immediately and has one delayed recovery wake-up as a fallback. Failed entries remain in the queue with their latest error instead of disappearing.

Connection/auth/rate/server failures stop the current drain after the first affected item so the worker does not hammer every queued capture with the same failure. Individual request failures that appear item-specific can be recorded while allowing unrelated queued groups to proceed.

Partial multi-image success is safe to retry because capture uses source/content deduplication and a stable group session ID.

## Remaining runtime verification

Live X testing is still required for:

- Home and Following feeds
- profiles
- search
- lists and bookmarks where supported by the current DOM
- single-image and multi-image posts
- text-only posts
- quoted/reposted content
- rapid repeated clicks across multiple tabs
- X DOM recycling during long scrolling sessions
- browser service-worker termination during a queued capture
- offline, revoked-device, rate-limited, and queue-full states
- extension reload/update with pending queue entries

## Later adapter work

#65 generalizes this interaction contract to Pixiv, Pinterest, and Danbooru. Site adapters should own source discovery/parsing while the shared Clipper owns queueing, auth, inline state, persistence, retries, and capture-session behavior.
