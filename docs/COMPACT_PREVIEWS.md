# Compact previews

Implemented 2026-09-07 in `convex/lib/previewEncoding.ts` and the media derivative
processor. Originals are unchanged. Newly generated or explicitly regenerated
derivatives use recipe version 2; existing derivatives remain readable.

## Measured result

The local benchmark sampled 12 JPEG/PNG images across the file-size range of a
120-image candidate pool from the archive. Inputs totaled 11,834,671 bytes.
Existing WebP derivatives were excluded from the input pool to avoid measuring
generational recompression. This is an illustration-heavy convenience sample,
not a whole-library forecast or a photographic/text readability study.

| Output | Existing total | New total | Reduction | New average |
| --- | ---: | ---: | ---: | ---: |
| 1600-pixel preview | 1,900,538 B | 1,183,403 B | 37.7% | 96.3 KiB |
| 384-pixel thumbnail | 172,616 B | 139,729 B | 19.1% | 11.4 KiB |

The new thumbnails total about 1.2% of sampled input bytes. The original is
still necessary for full-resolution editing, downloading, or examining detail.
Close-up crops of four sampled images were visually compared against the
resized input and existing WebP. Lines and colors remained useful for browsing;
AVIF smooths some fine texture. This is lossy preview compression, not a claim
of lossless equivalence.

AVIF encoding took 35.4 seconds across the 12 larger previews versus 4.2 seconds
for the existing WebP. Thumbnail encoding took 3.3 seconds versus 0.8 seconds.
Encoding runs during derivative generation, not on a gallery request. The
production selection computes both encodings, so budget for their combined
cost. Browser decode/whole-gallery latency has not been benchmarked here.

## Recipe and lifecycle

- Preserve the existing 1600/384 maximum dimensions, aspect ratio, orientation,
  and alpha; do not enlarge small images. Strip source metadata.
- Compare AVIF quality 55/50, effort 4, 4:4:4 chroma against the existing WebP
  quality 82/76. Store only the smaller result, with its correct MIME type.
- During replacement, retain an existing compact derivative of the same
  original when it is smaller or its exact bytes are still needed by another
  record. Discard the unused new output instead of growing storage.
- Fall back to WebP if the AVIF encoder fails. This is an encoding fallback,
  not browser content negotiation; supported clients must decode AVIF.
- Store exact derivative byte counts and recipe version on the asset.
- On replacement, remove superseded derivative objects only when no asset
  references them as an original, preview, or thumbnail, and no artwork or
  saved analysis/community evidence references them. Keep shared files.
  No historical orphan sweep or original migration is performed.
- Drive originals and the existing backup chain are unaffected.

The broader disk-cache budget and Drive-backed derivative migration in
`BOUNDED_LOCAL_MEDIA.md` are separate follow-up work. This change reduces the
bytes per preview; it does not impose a total storage limit.

## Reproduce and verify

Run `node scripts/benchmark-previews.mjs [input-directory] [output-directory]`.
Defaults use the local vault and `.convex/preview-benchmark`. The command only
reads source images; the HTML comparison and image outputs remain local and
are ignored by Git. It also compares a lower-quality WebP alternative.

Run `pnpm exec vitest run convex/lib/previewEncoding.test.ts convex/mediaDerivatives.integration.test.ts`
and `pnpm exec tsc -p convex/tsconfig.json --noEmit`.

Tests cover orientation, alpha, small images, codec failure, invalid input,
size selection, byte accounting, superseded-file removal, and preservation of
shared images and originals. Encoder options were checked against the
[Sharp output documentation](https://sharp.pixelplumbing.com/api-output/).
