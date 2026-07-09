# Ourchival

A private archive for saving images, links, sources, notes, tags, boards, and project references.

Ourchival is the overall project. **Reliquary** is the vault experience inside it. **Ourchival Clipper** is the browser extension for saving images, links, pages, and source metadata from the web.

## Apps

- `apps/web` — the vault web app
- `apps/extension` — browser extension / clipper
- `convex` — Convex backend and HTTP capture endpoints
- `packages/shared` — shared metadata types and helpers
- `packages/parsers` — platform-specific source parsers

## Domain

The owned domain is:

```txt
ourchival.com
```

Recommended production app URL:

```txt
https://app.ourchival.com
```

For DNS and deployment notes, see [`docs/DOMAIN.md`](docs/DOMAIN.md).

## Current milestone

Save a reference through any path:

- right-click an image in Edge with Ourchival Clipper
- right-click a link in Edge with Ourchival Clipper
- right-click the current page in Edge with Ourchival Clipper
- paste source/image URLs into the manual Reliquary form

Saved items appear in the Reliquary gallery with:

- All / Images / Links lanes
- image URL or proxied Drive original when available
- source URL
- page title when available
- platform detection
- capture timestamp
- editable title and notes
- favorite state
- source snapshot metadata
- storage provider status

## Setup

```bash
pnpm install
pnpm convex:dev
```

In another terminal:

```bash
pnpm dev
```

For full local instructions, see [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md).

For Google Drive storage, see [`docs/GOOGLE_DRIVE.md`](docs/GOOGLE_DRIVE.md).

For the links vault direction, see [`docs/LINKS_VAULT.md`](docs/LINKS_VAULT.md).

Copy `.env.example` to `.env.local` and fill in your Convex values.

## Scripts

```bash
pnpm dev                # run web app
pnpm extension:dev      # run extension dev build
pnpm extension:build    # build Edge/Chrome extension
pnpm google:drive-auth  # generate Google Drive refresh token
pnpm test               # run model tests
pnpm build              # build all packages/apps
pnpm lint               # lint
pnpm typecheck          # typecheck
pnpm convex:dev         # start Convex dev
```

## HTTP endpoints

```txt
GET    /references
GET    /drive-file?id=...
PATCH  /reference?id=...
DELETE /reference?id=...
POST   /capture
```

The extension and manual web form both write through `/capture`. Drive-backed images render through `/drive-file` so originals can stay private. Link-only captures save metadata without creating a Drive file.

## Storage principle

Ourchival keeps files portable:

```txt
/vault/YYYY/MM/<reference-id>/
  original.ext
  preview.webp
  thumb.webp
  metadata.json
```

The database tracks source, tags, boards, projects, notes, Drive file IDs, links, and generated metadata.
