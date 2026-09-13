# Roadmap

Ourchival is a private, modern visual-reference vault: image archive, link archive, source tracker, project board, and browser clipper.

The current goal is not polish for its own sake. The goal is a local-first-feeling personal tool that can reliably save images and source metadata from the web, especially X/Twitter, then let the same saved asset be reused across boards and projects.

## Product direction

- **Ourchival**: whole project, public name, domain, repo.
- **Reliquary**: the vault app UI.
- **Ourchival Clipper**: Edge/Chrome extension.
- **Storage direction**: Google Drive is the preferred home for originals; Convex stores catalog/search/source metadata and provides fallback storage.
- **Domain direction**: use `app.ourchival.com` for the private app. Keep `ourchival.com` for a landing page later.
- **Primary user flow**: right-click image/post/link/page → save → image/source appears in Reliquary → edit title/notes/tags → add to boards/projects → reuse/export later.

## Current state

### Working or mostly wired

- Monorepo with `apps/web`, `apps/extension`, `packages/shared`, `packages/parsers`, and `convex`.
- Next.js Reliquary app with gallery, search, lanes, inspector, manual save form, edit/delete/favorite basics, and storage-provider labels.
- Edge/Chrome extension with context-menu capture for images, links, and pages.
- Extension popup accepts a configurable `/capture` endpoint and shows last capture status.
- Convex HTTP actions:
  - `GET /references`
  - `POST /capture`
  - `PATCH /reference?id=...`
  - `DELETE /reference?id=...`
  - `GET /drive-file?id=...`
- Google Drive OAuth helper script: `pnpm google:drive-auth`.
- Google Drive upload helper in Convex.
- Drive-backed originals with Convex Storage fallback.
- Private Drive file proxy for rendering saved Drive images in the app.
- Schema support for assets, references, boards, tags, source snapshots, projects, project references, and export history.
- Domain docs for `ourchival.com` and `app.ourchival.com`.

### Partially wired

- Drive upload works once Google OAuth env vars are configured; pipeline
  progress (previews, Drive copies, reclaimed bytes) is visible in
  Settings → Archive health, but a Drive-env configured/missing card is
  still open.
- Projects/personal tags support reuse reasons and used-states; deeper
  project workflows (statuses, handoffs) remain light.
- Links can be captured, but link browsing and link-specific inspector fields need more care.
- Image display works through stored/proxied URLs, but fallbacks for blocked remote fetches need better UX.
- Domain deployment is documented, but production hosting still runs the
  local vault (`next dev` daemon); a production `next start` switch is open.

Done since (Sep 2026): sign-in gate with session credentials, HTTP
actions behind owner auth, private Drive files, board/tag CRUD with
gallery filtering, inspector editing (title/notes/favorite/archive/
delete), duplicate protection (`alreadySaved`), capture receipts with
recovery progress, tweet DOM parsing, multi-image posts, generated
compact previews + Drive mirrors with reclamation, dominant colors,
perceptual hashes, similar-image search, suggested tags, saved
searches, No/Maybe/Yes review deck, and gallery/viewer keyboard triage.

## Phase 1 — Make the capture loop reliable

Goal: saving from browser to vault should feel dependable.

### 1.1 Stabilize build and deployment

- Confirm Vercel root directory is `apps/web`.
- Confirm Vercel output directory is blank/default for Next.js.
- Add production env vars:
  - `NEXT_PUBLIC_APP_URL=https://app.ourchival.com`
  - `NEXT_PUBLIC_CONVEX_URL=...`
  - `NEXT_PUBLIC_CONVEX_SITE_URL=...`
- Add Convex env vars:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REFRESH_TOKEN`
  - `GOOGLE_DRIVE_PARENT_FOLDER_ID`
- Add a visible app status panel showing whether Drive env is configured.

### 1.2 Improve capture result handling

- Show precise statuses in the UI:
  - saved to Google Drive
  - saved to Convex fallback
  - metadata-only/link-only
  - fetch failed
  - file too large
- Persist the last capture response in the extension popup.
- Add retry guidance when server-side image fetch is blocked.
- Add duplicate protection using `sourceUrl + assetUrl` before inserting a new reference.

### 1.3 Manual upload

- Add drag-and-drop/manual file upload in Reliquary.
- Upload local file bytes to Drive.
- Create reference + asset records from uploaded files.
- Let the user set source URL/title/notes during upload.

## Phase 2 — Make Reliquary usable as a daily vault

Goal: browsing and organizing references should feel like a personal Danbooru.

### 2.1 Inspector editing

- Inline edit title.
- Inline edit notes.
- Toggle favorite.
- Archive/unarchive.
- Soft-delete/restore view.
- Copy source URL.
- Copy image URL.
- Open Drive file.

### 2.2 Boards

- Create board.
- Rename board.
- Delete/archive board.
- Add selected reference to board.
- Remove selected reference from board.
- Filter gallery by board.
- Show board counts.

### 2.3 Tags

- Create tag from inspector.
- Attach tags to reference.
- Remove tags from reference.
- Tag search/filter.
- Tag aliases later.

### 2.4 Projects and reuse history

- Create project.
- Add reference/asset to project.
- Store reuse reason and notes.
- Show “used in these projects” on each reference.
- Let the same asset appear in many boards/projects without duplicating the Drive file.

### 2.5 Link vault lane

- Improve link-only cards.
- Add title/description/favicon fields later.
- Add source type filters:
  - image
  - post
  - page
  - link
  - file
- Keep links and images in one searchable archive.

## Phase 3 — X/Twitter-first clipping

Goal: one-click save from X/Twitter should capture the image and useful source metadata.

### 3.1 Tweet DOM parser

- In the content script, detect the nearest tweet/article around the clicked image.
- Extract:
  - author display name
  - author handle
  - tweet text
  - tweet/status URL
  - image URL(s)
  - timestamp when available
- Send this metadata through `/capture`.
- Store raw snapshot JSON for future parser fixes.

### 3.2 Multi-image post support

- If a tweet/post has multiple images, create one source snapshot and multiple assets/references as needed.
- Keep the post URL common across all captured images.
- Add a UI grouping cue for images from the same source post.

### 3.3 Capture picker

- Toolbar popup can scan the current page for candidate images.
- User can select multiple images before saving.
- Show dimensions/source hints.

## Phase 4 — Storage, portability, and exports

Goal: the archive should stay under the user's control.

### 4.1 Drive folder organization

- Save originals under dated folders later:
  - `Ourchival/originals/YYYY/MM`
- Store Drive folder IDs in Convex.
- Add a migration script for existing Drive-root uploads.

### 4.2 Generated previews

- Generate thumbnails/previews.
- Store preview metadata.
- Use smaller previews in grid.
- Keep original untouched.

### 4.3 Export pack

- Export selected references as:
  - original files
  - JSON sidecars
  - source metadata
  - board/project info
- Add project export for Clip Studio Paint / Procreate handoff.
- Google Photos export remains optional later.

## Phase 5 — Enrichment and search

Goal: help future-you find references without manually tagging everything.

- Dominant color extraction.
- Perceptual hash / duplicate detection.
- OCR for screenshots and image text.
- Auto-generated descriptions.
- Suggested tags.
- Similar-image search.
- Saved searches.

## Phase 6 — Privacy and account safety

Goal: private vault by default.

- Add sign-in before loading the vault in production.
- Gate Convex HTTP actions behind a private token/session.
- Keep Drive files private.
- Avoid public gallery routes by default.
- Add local/dev bypass only when explicitly enabled.

## Agent handoff: next best tasks

### Good task: Drive/config status card

Implement an endpoint and UI card that reports whether Drive env vars are configured. Do not return secrets. Return only booleans/status labels.

Acceptance:

- Reliquary shows Drive status (fits beside Archive health in Settings).
- Missing Drive env explains that Convex fallback will be used.
- No secret values reach the browser.

### Good task: production web switch

Move the local vault's web server from `next dev` to `next start` with a
build step, keeping a dev fallback for iteration.

Acceptance:

- Vault boots into production mode; gallery loads without StrictMode
  double-fire or HMR overhead.
- A documented env flag restores `next dev` for UI iteration.
- Reboot and status commands keep working.

### Good task: link lane care

Links capture but get second-class browsing and inspector fields.

Acceptance:

- Link cards show title/description/favicon reliably.
- Inspector edits link-specific fields.
- Source-type filters cover image/post/page/link/file.

## Do not spend time on yet

- Public landing page polish.
- Google Photos export.
- Full mobile app.
- Heavy AI tagging.
- Marketplace/browser store publishing.
- Multi-user collaboration.

Those can wait until saving, browsing, editing, and project reuse are pleasant.
