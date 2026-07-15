import { internalMutation, internalQuery, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";

const defaultBatchSize = 4;
const maxBatchSize = 12;

type ProcessMediaArgs = { jobId: Id<"enrichmentJobs"> };
const processMediaDerivatives = makeFunctionReference<
  "action",
  ProcessMediaArgs,
  unknown
>("mediaDerivativesNode:process") as FunctionReference<
  "action",
  "internal",
  ProcessMediaArgs,
  unknown
>;

export const enqueue = mutation({
  args: {
    assetId: v.id("assets"),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Asset not found.");
    if (!hasStoredOriginal(asset)) {
      throw new Error("Store the original before generating media derivatives.");
    }
    if (!args.force && asset.previewStorageId && asset.thumbStorageId) {
      return { queued: false, reason: "ready", job: null };
    }

    const job = await queueAsset(ctx, asset, Boolean(args.force));
    return {
      queued: job.status === "queued",
      reason:
        job.status === "queued"
          ? "queued"
          : job.status === "running"
            ? "active"
            : "previous_attempt",
      job,
    };
  },
});

export const enqueueMissing = mutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await queueMissingAssets(ctx, normalizedLimit(args.limit));
  },
});

export const queueMissing = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await queueMissingAssets(ctx, normalizedLimit(args.limit));
  },
});

export const getJobContext = internalQuery({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.type !== "media_derivatives" || !job.assetId) return null;

    const asset = await ctx.db.get(job.assetId);
    if (!asset || asset.referenceId !== job.referenceId) return null;

    const reference = await ctx.db.get(job.referenceId);
    if (!reference) return null;

    return {
      job,
      asset,
      reference,
      originalStorageUrl: asset.originalStorageId
        ? await ctx.storage.getUrl(asset.originalStorageId)
        : null,
    };
  },
});

export const complete = internalMutation({
  args: {
    jobId: v.id("enrichmentJobs"),
    assetId: v.id("assets"),
    previewStorageId: v.id("_storage"),
    thumbStorageId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    contentHash: v.string(),
    perceptualHash: v.string(),
    dominantColors: v.array(v.string()),
    previewFileSize: v.number(),
    thumbFileSize: v.number(),
  },
  handler: async (ctx, args) => {
    const [job, asset] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.assetId),
    ]);
    if (!job || job.type !== "media_derivatives") {
      throw new Error("Media derivative job not found.");
    }
    if (!asset || job.assetId !== asset._id || job.referenceId !== asset.referenceId) {
      throw new Error("Media derivative asset mismatch.");
    }

    await ctx.db.patch(asset._id, {
      previewStorageId: args.previewStorageId,
      thumbStorageId: args.thumbStorageId,
      width: positiveInteger(args.width),
      height: positiveInteger(args.height),
      contentHash: normalizeHash(args.contentHash, 64, "Content hash"),
      perceptualHash: normalizeHash(args.perceptualHash, 16, "Perceptual hash"),
      dominantColors: normalizeColors(args.dominantColors),
      derivativeStatus: "ready",
    });

    const previewKilobytes = Math.max(1, Math.round(args.previewFileSize / 1024));
    const thumbKilobytes = Math.max(1, Math.round(args.thumbFileSize / 1024));
    await ctx.db.patch(job._id, {
      status: "succeeded",
      completedAt: Date.now(),
      error: undefined,
      resultSummary: `Generated ${previewKilobytes} KB preview and ${thumbKilobytes} KB thumbnail.`,
      updatedAt: Date.now(),
    });

    return { status: "succeeded" as const };
  },
});

export const fail = internalMutation({
  args: {
    jobId: v.id("enrichmentJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.type !== "media_derivatives") return false;

    if (job.assetId) {
      const asset = await ctx.db.get(job.assetId);
      if (asset && asset.referenceId === job.referenceId) {
        await ctx.db.patch(asset._id, { derivativeStatus: "failed" });
      }
    }

    await ctx.db.patch(job._id, {
      status: "failed",
      completedAt: Date.now(),
      error: args.error.trim().slice(0, 1000) || "Media derivative processor failed.",
      resultSummary: "Media derivatives could not be generated.",
      updatedAt: Date.now(),
    });
    return true;
  },
});

async function queueMissingAssets(ctx: any, limit: number) {
  const candidates = await ctx.db
    .query("assets")
    .withIndex("by_derivative_status", (q: any) =>
      q.eq("derivativeStatus", undefined),
    )
    .take(limit * 4);

  let queued = 0;
  let active = 0;
  let skipped = 0;

  for (const asset of candidates) {
    if (queued + active >= limit) break;
    if (asset.previewStorageId && asset.thumbStorageId) {
      await ctx.db.patch(asset._id, { derivativeStatus: "ready" });
      skipped += 1;
      continue;
    }
    if (!hasStoredOriginal(asset)) {
      await ctx.db.patch(asset._id, { derivativeStatus: "failed" });
      skipped += 1;
      continue;
    }

    const job = await queueAsset(ctx, asset, false);
    if (job.status === "queued") queued += 1;
    else if (job.status === "running") active += 1;
    else skipped += 1;
  }

  return { queued, active, skipped };
}

async function queueAsset(ctx: any, asset: any, force: boolean) {
  const jobs = await ctx.db
    .query("enrichmentJobs")
    .withIndex("by_reference_type", (q: any) =>
      q.eq("referenceId", asset.referenceId).eq("type", "media_derivatives"),
    )
    .collect();
  const assetJobs = jobs
    .filter((job: any) => job.assetId === asset._id)
    .sort((left: any, right: any) => right.updatedAt - left.updatedAt);
  const active = assetJobs.find(
    (job: any) => job.status === "queued" || job.status === "running",
  );
  if (active) return active;
  if (!force && assetJobs[0]) {
    await ctx.db.patch(asset._id, {
      derivativeStatus: assetJobs[0].status === "succeeded" ? "ready" : "failed",
    });
    return assetJobs[0];
  }

  const now = Date.now();
  const jobId = await ctx.db.insert("enrichmentJobs", {
    referenceId: asset.referenceId,
    assetId: asset._id,
    type: "media_derivatives",
    status: "queued",
    attempts: 0,
    requestedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(asset._id, { derivativeStatus: "processing" });
  await ctx.scheduler.runAfter(0, processMediaDerivatives, { jobId });
  const job = await ctx.db.get(jobId);
  if (!job) throw new Error("Could not create media derivative job.");
  return job;
}

function hasStoredOriginal(asset: {
  driveFileId?: string;
  originalStorageId?: unknown;
}) {
  return Boolean(asset.driveFileId || asset.originalStorageId);
}

function normalizedLimit(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultBatchSize;
  return Math.min(maxBatchSize, Math.max(1, Math.floor(value)));
}

function positiveInteger(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Image dimensions must be positive numbers.");
  }
  return Math.round(value);
}

function normalizeHash(value: string, length: number, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(normalized)) {
    throw new Error(`${label} must contain ${length} hexadecimal characters.`);
  }
  return normalized;
}

function normalizeColors(values: string[]) {
  const colors = Array.from(
    new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter((value) => /^#[0-9a-f]{6}$/.test(value)),
    ),
  ).slice(0, 8);
  if (colors.length === 0) throw new Error("At least one dominant color is required.");
  return colors;
}
