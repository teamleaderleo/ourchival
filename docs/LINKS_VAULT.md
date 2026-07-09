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

The extension should support three capture paths:

```txt
Right-click image → image reference
Right-click link  → link reference
Right-click page  → page/link reference
```

For now, link saves are metadata-only. They do not create Drive files unless a preview/screenshot feature is added later.

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
