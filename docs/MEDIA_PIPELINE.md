# Media derivative pipeline

Ourchival preserves original image bytes and generates smaller files for everyday browsing.

## Outputs

For every stored original, the pipeline creates:

- a WebP preview bounded to 1600×1600 at quality 82
- a WebP thumbnail bounded to 384×384 at quality 76
- original oriented width and height
- a SHA-256 content hash
- a 64-bit average perceptual hash
- five dominant palette colors

EXIF orientation is applied before resizing. Metadata is omitted from derivatives. Originals remain unchanged in Google Drive or Convex Storage.

## Execution

`convex/crons.ts` looks for stored assets without derivatives once per minute and queues a small batch. `convex/mediaDerivativesNode.ts` runs as a Convex Node action and uses Sharp/libvips with one Sharp worker thread per action. Job state is stored in `enrichmentJobs` with the `media_derivatives` type.

Sharp is configured as a Convex external package in `convex.json`. This keeps the native libvips binary outside the Convex source bundle.

## Storage

The `assets` record keeps:

- `originalStorageId` or `driveFileId` for preservation
- `previewStorageId` for larger viewing
- `thumbStorageId` for gallery cards
- dimensions, content hash, perceptual hash, and dominant colors
- `derivativeStatus` for dispatch and failure control

Reference hydration resolves the derivative storage IDs into private URLs. Cards prefer the thumbnail, then the preview, then the stored original or source URL.

## Limits and failure behavior

Processing accepts stored images up to 25 MB and 80 megapixels. Failed jobs remain visible in the enrichment job history and the automatic dispatcher leaves them alone, preventing an endless retry loop.

To force a retry for a specific asset during development:

```bash
npx convex run mediaDerivatives:enqueue '{"assetId":"<asset-id>","force":true}'
```

To queue a bounded backfill manually:

```bash
npx convex run mediaDerivatives:enqueueMissing '{"limit":8}'
```
