# Ourchival

A private visual reference archive for saving images, sources, notes, tags, and boards.

Ourchival is the overall project. **Reliquary** is the vault experience inside it. **Ourchival Clipper** is the browser extension for saving images and source metadata from the web.

## Apps

- `apps/web` — the vault web app
- `apps/extension` — browser extension / clipper
- `convex` — Convex backend and HTTP capture endpoints
- `packages/shared` — shared metadata types and helpers
- `packages/parsers` — platform-specific source parsers

## Current milestone

Save a reference through either path:

- right-click an image in Edge with Ourchival Clipper
- paste source/image URLs into the manual Reliquary form

Saved references appear in the Reliquary gallery with:

- image URL or proxied Drive original
- source URL
- page title when available
- platform detection
- capture timestamp
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

Copy `.env.example` to `.env.local` and fill in your Convex values.

## Scripts

```bash
pnpm dev                # run web app
pnpm extension:dev      # run extension dev build
pnpm extension:build    # build Edge/Chrome extension
pnpm google:drive-auth  # generate Google Drive refresh token
pnpm build              # build all packages/apps
pnpm lint               # lint
pnpm typecheck          # typecheck
pnpm convex:dev         # start Convex dev
```

## HTTP endpoints

```txt
GET  /references
GET  /drive-file?id=...
POST /capture
```

The extension and manual web form both write through `/capture`. Drive-backed images render through `/drive-file` so originals can stay private.

## Storage principle

Ourchival keeps files portable:

```txt
/vault/YYYY/MM/<reference-id>/
  original.ext
  preview.webp
  thumb.webp
  metadata.json
```

The database tracks source, tags, boards, projects, notes, Drive file IDs, and generated metadata.
