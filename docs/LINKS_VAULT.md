# Links vault

Ourchival saves images and links in one personal archive.

The core problem is the same:

- the browser is full of tabs
- saved links disappear into generic bookmark folders
- interesting pages lose the context for why they were saved
- project-specific links need to be reused without duplicating data

## Product shape

Reliquary remains the visual-reference workspace. Links live beside images as another saved item lane:

```txt
All
Images
Links
Favorites
Projects
```

A saved link should have:

- source URL
- title
- notes
- favorite state
- tags later
- project usage later
- capture timestamp
- optional selected text
- optional screenshot or preview image later

## Capture behavior

The extension supports four capture paths:

```txt
Right-click image → image reference
Right-click link  → link reference
Right-click page  → page/link reference
X profile Likes   → bounded, sourced post/image batch
```

Link saves are metadata-only. X Likes imports preserve the canonical post,
author/handle, text, language, posted timestamp, engagement counts visible at
capture time, and provenance. Engagement is optional and records replies,
reposts, quotes, likes, bookmarks, and views when X exposes them in the feed;
it is a point-in-time observation, not a live counter. When media is present,
every normalized original image enters the existing private Drive pipeline.
Imports are tagged `X Likes` and deduplicated by the existing source, canonical
URL, asset URL, and hash mechanisms.

On X, the Clipper checks visible canonical status URLs against the vault and
adds a compact lavender `✦ Archived` marker to posts already stored. Backlog
continuation seeks the last checkpoint, skips indexed posts, and captures the
next unknown post. A caught-up scan stops after a stable run of known posts;
temporary virtual-list stalls are retried and are not treated as the end of the
timeline. Capture requests use a four-item bounded concurrency window, while
checkpoint results are committed in source order. Confirmed Like clicks are
captured immediately; unliking on X does not delete the archival copy.

A post is the parent reference. Every image in a gallery is a separate asset
linked to that parent, with its own source index/count, alt text, notes, tags,
and bounded classifier metadata. Post-wide text, author, URL, published time,
and engagement stay on the parent/source snapshot. This lets classifiers or
reviewers describe one picture without duplicating the post or losing the
gallery relationship. Owner tools can update an asset with `PATCH /asset?id=`
using `notes`, `addTags`, `removeTagIds`, and `metadata`.

## Data model

Use the existing `references` table. Link-like items use:

```txt
kind: "link" | "article" | "page"
```

Visual items use:

```txt
kind: "image" | "post" | "video_frame" | "file"
```

This keeps one search index, one inspector, one project reuse model, and one favorite/archive/delete flow.

## Later improvements

- automatic page title extraction server-side
- favicon capture
- page excerpt
- read/unread state
- domain filter
- screenshot preview saved to Drive
- browser action button to save the current tab
- selected text capture as a quote/note
