# Product direction

Ourchival is a personal, modern Danbooru for art references.

## Product center

Reliquary is the main experience:

- visual browsing
- search
- boards
- project collections
- reference reuse history
- source attribution
- notes about why an image was useful
- export into art workflows

Ourchival Clipper is one capture doorway. The product is the vault.

## Storage call

Use Google Drive as the primary file home.

Drive gives Ourchival a normal file backing store with folders, file IDs, thumbnails/previews, and lots of personal storage. Ourchival keeps its own catalog in Convex:

- reference metadata
- tags
- boards
- project membership
- source snapshots
- reuse history
- search fields
- Drive file IDs and web links

The same original image can appear in many boards and projects through metadata. There should be one asset record and many relationships.

## Google Photos call

Treat Google Photos as an optional later export path.

Photos is good for personal photo browsing, but Ourchival wants precise file control, source metadata, and project reuse. Drive fits that better.

## Capture flow

One-click capture should do this:

1. User clicks Save to Ourchival from a page or image.
2. Extension extracts:
   - source URL
   - canonical URL
   - image URL or image bytes
   - page title
   - selected text
   - platform
   - author handle/name when available
   - post text when available
3. Backend stores the original image in Drive.
4. Backend creates or reuses the asset record in Convex.
5. Backend creates a reference record and source snapshot.
6. UI shows the new reference immediately.

For X/Twitter, the extension should run a platform parser in the page context and collect visible post metadata from the DOM. API support can come later.

## UI priorities

Reliquary should feel like a working artist table:

- dense visual grid
- keyboard search
- selected-image inspector
- current project shelf
- boards as living collections
- tags and notes editable inline
- clear source link
- quick copy/download/open actions
- reused-in-projects history

The interaction rules in [UI design guidelines](UI_DESIGN_GUIDELINES.md) are part of this product direction.

## Data model direction

Core objects:

- `assets`: one original image/file, stored in Drive
- `references`: source-aware saved item pointing to an asset
- `boards`: reusable collections
- `projects`: work sessions or art projects
- `projectReferences`: join table with project-specific notes
- `tags`: reusable labels
- `sourceSnapshots`: captured web metadata
- `exports`: history of files copied/downloaded for CSP, Procreate, etc.

## Principle

One image, many meanings.

A reference can belong to many projects because the reason you saved it changes: lighting, fabric, pose, line economy, color, mood, hands, composition, outfit, creature design, buildings, a whole spell of small visual decisions.
