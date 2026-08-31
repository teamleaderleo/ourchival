# Ourchival

An open-source, single-owner archive app for saving images, links, sources, notes, tags, boards, and project references. Vault records and media stay private in Convex and the owner’s Google Drive; this repository contains the application layer.

Ourchival is the overall project. **Reliquary** is the vault experience inside it. **Ourchival Clipper** is the browser extension for saving images, links, pages, and source metadata from the web.

## Apps

- `apps/web` — the vault web app
- `apps/extension` — browser extension / clipper
- `convex` — Convex backend, capture endpoints, and asynchronous media processing
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
- open your X profile’s Likes page and import a bounded batch with Ourchival Clipper
- paste source/image URLs into the manual Reliquary form

Saved items appear in the Reliquary gallery with:

- All / Images / Links lanes
- generated WebP thumbnails when a stored original is available
- image URL or proxied Drive original as a fallback
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

For private owner access and revocable Clipper pairing, see [`docs/PRIVATE_ACCESS.md`](docs/PRIVATE_ACCESS.md).

For Google Drive storage, see [`docs/GOOGLE_DRIVE.md`](docs/GOOGLE_DRIVE.md).

For generated previews, thumbnails, hashes, and palettes, see [`docs/MEDIA_PIPELINE.md`](docs/MEDIA_PIPELINE.md).

For the links vault direction, see [`docs/LINKS_VAULT.md`](docs/LINKS_VAULT.md).

For large OneTab/X Likes intake, storage-provider boundaries, and ChatGPT/Codex
access, see
[`docs/ARCHIVE_INTAKE_AND_AGENT_ACCESS.md`](docs/ARCHIVE_INTAKE_AND_AGENT_ACCESS.md).

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
GET    /auth-check
GET    /references
GET    /drive-file?id=...
GET    /preference-export
PATCH  /reference?id=...
DELETE /reference?id=...
POST   /reference-metadata?id=...
POST   /preference-export
POST   /capture
POST   /clipper-pairing
POST   /clipper-exchange
GET    /clipper-devices
DELETE /clipper-devices?id=...
```

The web vault exchanges a short-lived Google identity credential for a signed, sliding one-year Ourchival session; the owner key is a recovery fallback and session signer. Ourchival Clipper uses a separate paired device credential for `/capture`. Drive-backed images render through `/drive-file` so originals can stay private. Link-only captures save metadata without creating a Drive file. The private preference snapshot is rebuilt or inspected through `/preference-export`.

## Storage principle

Ourchival keeps files portable:

```txt
/vault/YYYY/MM/<reference-id>/
  original.ext
  preview.webp
  thumb.webp
  metadata.json
```

Google Drive remains the preferred home for originals. Convex Storage holds generated WebP derivatives so the gallery can load small private files directly. The database tracks source, tags, boards, projects, notes, file IDs, hashes, palettes, dimensions, links, and generated metadata.
