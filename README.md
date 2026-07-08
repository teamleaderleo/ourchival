# Ourchival

A private visual reference archive for saving images, sources, notes, tags, and boards.

Ourchival is the overall project. **Reliquary** is the vault experience inside it. **Ourchival Clipper** is the browser extension for saving images and source metadata from the web.

## Apps

- `apps/web` — the vault web app
- `apps/extension` — browser extension / clipper
- `convex` — Convex backend
- `packages/shared` — shared metadata types and helpers
- `packages/parsers` — platform-specific source parsers

## First milestone

Right-click an image in the browser, save it to Ourchival, then view it in the Reliquary gallery with:

- original image
- preview image
- source URL
- page title
- author/source metadata when available
- boards
- tags
- notes

## Setup

```bash
pnpm install
pnpm dev
```

In another terminal:

```bash
pnpm convex:dev
```

Copy `.env.example` to `.env.local` and fill in your Convex values.

## Scripts

```bash
pnpm dev              # run web app
pnpm extension:dev    # run extension dev build
pnpm build            # build all packages/apps
pnpm lint             # lint
pnpm typecheck        # typecheck
pnpm convex:dev       # start Convex dev
```

## Storage principle

Ourchival keeps files portable:

```txt
/vault/YYYY/MM/<reference-id>/
  original.ext
  preview.webp
  thumb.webp
  metadata.json
```

The database tracks source, tags, boards, projects, notes, and generated metadata.
