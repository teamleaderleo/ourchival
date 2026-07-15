"use node";

import { createHash } from "node:crypto";
import sharp from "sharp";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { fetchDriveFile } from "./lib/drive";
import {
  averageHashFromGrayscale,
  dominantColorsFromRgba,
} from "./lib/imageAnalysis";

const maxInputBytes = 25 * 1024 * 1024;
const maxInputPixels = 80_000_000;
const previewMaxPixels = 1600;
const thumbMaxPixels = 384;

sharp.cache({ files: 0, items: 64, memory: 32 });
sharp.concurrency(1);

export const process = internalAction({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "succeeded" | "failed"; summary?: string } | null> => {
    const jobContext = await ctx.runQuery(
      internal.mediaDerivatives.getJobContext,
      args,
    );
    if (!jobContext || jobContext.job.status !== "queued") return null;

    const claimed = await ctx.runMutation(internal.enrichmentJobs.claim, args);
    if (!claimed) return null;

    try {
      const input = await loadOriginal(jobContext);
      const metadata = await sharp(input, sharpInputOptions()).metadata();
      const dimensions = orientedDimensions(metadata);

      const [preview, thumb, hashPixels, palettePixels] = await Promise.all([
        makeWebp(input, previewMaxPixels, 82),
        makeWebp(input, thumbMaxPixels, 76),
        sharp(input, sharpInputOptions())
          .rotate()
          .resize(8, 8, { fit: "fill", kernel: sharp.kernel.lanczos3 })
          .grayscale()
          .raw()
          .toBuffer(),
        sharp(input, sharpInputOptions())
          .rotate()
          .resize(64, 64, { fit: "fill", kernel: sharp.kernel.lanczos3 })
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .ensureAlpha()
          .raw()
          .toBuffer(),
      ]);

      const previewStorageId = await ctx.storage.store(
        new Blob([new Uint8Array(preview)], { type: "image/webp" }),
      );
      const thumbStorageId = await ctx.storage.store(
        new Blob([new Uint8Array(thumb)], { type: "image/webp" }),
      );

      await ctx.runMutation(internal.mediaDerivatives.complete, {
        jobId: args.jobId,
        assetId: jobContext.asset._id,
        previewStorageId,
        thumbStorageId,
        width: dimensions.width,
        height: dimensions.height,
        contentHash: createHash("sha256").update(input).digest("hex"),
        perceptualHash: averageHashFromGrayscale(new Uint8Array(hashPixels)),
        dominantColors: dominantColorsFromRgba(new Uint8Array(palettePixels), 5),
        previewFileSize: preview.byteLength,
        thumbFileSize: thumb.byteLength,
      });

      return { status: "succeeded" };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Media derivative processor failed.";
      await ctx.runMutation(internal.mediaDerivatives.fail, {
        jobId: args.jobId,
        error: message,
      });
      return { status: "failed", summary: message };
    }
  },
});

async function loadOriginal(jobContext: {
  asset: {
    driveFileId?: string;
    mimeType?: string;
  };
  originalStorageUrl?: string | null;
}) {
  const response = jobContext.asset.driveFileId
    ? await fetchDriveFile(jobContext.asset.driveFileId)
    : jobContext.originalStorageUrl
      ? await fetch(jobContext.originalStorageUrl)
      : null;

  if (!response) throw new Error("Stored original is unavailable.");
  if (!response.ok) {
    throw new Error(`Original image fetch failed with HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("Content-Type") ?? jobContext.asset.mimeType;
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Stored original is ${contentType}, not an image.`);
  }

  const contentLength = Number(response.headers.get("Content-Length") ?? 0);
  if (contentLength > maxInputBytes) {
    throw new Error("Stored original exceeds the 25 MB processing limit.");
  }

  const input = Buffer.from(await response.arrayBuffer());
  if (input.byteLength === 0) throw new Error("Stored original is empty.");
  if (input.byteLength > maxInputBytes) {
    throw new Error("Stored original exceeds the 25 MB processing limit.");
  }
  return input;
}

async function makeWebp(input: Buffer, maxPixels: number, quality: number) {
  return await sharp(input, sharpInputOptions())
    .rotate()
    .resize({
      width: maxPixels,
      height: maxPixels,
      fit: "inside",
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .webp({ quality, effort: 4, smartSubsample: true })
    .toBuffer();
}

function sharpInputOptions() {
  return {
    failOn: "error" as const,
    limitInputPixels: maxInputPixels,
    sequentialRead: true,
  };
}

function orientedDimensions(metadata: {
  width?: number;
  height?: number;
  orientation?: number;
}) {
  if (!metadata.width || !metadata.height) {
    throw new Error("Image dimensions could not be read.");
  }
  const swapsAxes = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  return swapsAxes
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}
