import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";

const defaultBatchSize = 4;
const maxBatchSize = 12;

type ProcessDriveDerivativesArgs = { jobId: import("./_generated/dataModel").Id<"enrichmentJobs"> };
const processDriveDerivatives = makeFunctionReference<
  "action",
  ProcessDriveDerivativesArgs,
  unknown
>("driveDerivativesNode:process") as unknown as FunctionReference<
  "action",
  "internal",
  ProcessDriveDerivativesArgs,
  unknown
>;

export const queueMissing = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = normalizedLimit(args.limit);
    const candidates = await ctx.db
      .query("assets")
      .withIndex("by_derivative_status", (q: any) =>
        q.eq("derivativeStatus", "ready"),
      )
      .take(limit * 8);

    let queued = 0;
    let active = 0;
    let skipped = 0;
    for (const asset of candidates) {
      if (queued + active >= limit) break;
      const decision = await classifyUploadCandidate(ctx, asset);
      if (decision === "active") {
        active += 1;
        continue;
      }
      if (decision !== "eligible") {
        skipped += 1;
        continue;
      }
      await insertUploadJob(ctx, asset);
      queued += 1;
    }
    return { queued, active, skipped };
  },
});

// The batch worker pulls its next asset through here so many assets drain
// sequentially inside one action instead of N concurrent actions.
export const claimNextUpload = internalMutation({
  args: {
    excludeAssetIds: v.array(v.id("assets")),
  },
  handler: async (ctx, args) => {
    const excluded = new Set(args.excludeAssetIds.map(String));
    const candidates = await ctx.db
      .query("assets")
      .withIndex("by_derivative_status", (q: any) =>
        q.eq("derivativeStatus", "ready"),
      )
      .take(32);
    for (const asset of candidates) {
      if (excluded.has(String(asset._id))) continue;
      if ((await classifyUploadCandidate(ctx, asset)) !== "eligible") {
        continue;
      }
      const jobId = await insertUploadJob(ctx, asset, false);
      return { jobId, assetId: asset._id };
    }
    return null;
  },
});

type UploadCandidateDecision = "eligible" | "active" | "done" | "unready";

async function classifyUploadCandidate(
  ctx: any,
  asset: any,
): Promise<UploadCandidateDecision> {
  if (asset.drivePreviewFileId && asset.driveThumbFileId) return "done";
  if (!asset.previewStorageId && !asset.thumbStorageId) return "unready";
  const jobs = await ctx.db
    .query("enrichmentJobs")
    .withIndex("by_reference_type", (q: any) =>
      q.eq("referenceId", asset.referenceId).eq("type", "drive_derivatives"),
    )
    .collect();
  const assetJobs = jobs.filter((job: any) => job.assetId === asset._id);
  if (
    assetJobs.some(
      (job: any) => job.status === "queued" || job.status === "running",
    )
  ) {
    return "active";
  }
  // Terminal attempts (including failures) stay put like the media
  // pipeline: a fresh attempt needs a new derivative generation upstream.
  if (assetJobs.length > 0) return "done";
  return "eligible";
}

async function insertUploadJob(
  ctx: any,
  asset: any,
  schedule = true,
) {
  const now = Date.now();
  const jobId = await ctx.db.insert("enrichmentJobs", {
    referenceId: asset.referenceId,
    assetId: asset._id,
    type: "drive_derivatives",
    status: "queued",
    attempts: 0,
    requestedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (schedule) {
    await ctx.scheduler.runAfter(0, processDriveDerivatives, { jobId });
  }
  return jobId;
}

export const getDriveJobContext = internalQuery({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.type !== "drive_derivatives" || !job.assetId) return null;
    const asset = await ctx.db.get(job.assetId);
    if (!asset || asset.referenceId !== job.referenceId) return null;
    const reference = await ctx.db.get(job.referenceId);
    if (!reference) return null;
    return {
      job,
      asset,
      reference,
      previewStorageUrl: asset.previewStorageId
        ? await ctx.storage.getUrl(asset.previewStorageId)
        : null,
      thumbStorageUrl: asset.thumbStorageId
        ? await ctx.storage.getUrl(asset.thumbStorageId)
        : null,
    };
  },
});

const verifiedFileValidator = v.object({
  id: v.string(),
  size: v.number(),
  md5Checksum: v.string(),
});

export const complete = internalMutation({
  args: {
    jobId: v.id("enrichmentJobs"),
    assetId: v.id("assets"),
    preview: v.optional(verifiedFileValidator),
    thumb: v.optional(verifiedFileValidator),
    resultSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [job, asset] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.assetId),
    ]);
    if (!job || job.type !== "drive_derivatives") {
      throw new Error("Drive derivative job not found.");
    }
    if (!asset || asset.referenceId !== job.referenceId) {
      throw new Error("Drive derivative asset mismatch.");
    }
    if (!args.preview && !args.thumb) {
      throw new Error("Drive derivative upload recorded no files.");
    }
    // First wins: a concurrent worker may have recorded its twin already.
    // Never overwrite an existing verified identity with another file.
    const patch: Record<string, string> = {};
    if (args.preview && !asset.drivePreviewFileId) {
      patch.drivePreviewFileId = args.preview.id;
    }
    if (args.thumb && !asset.driveThumbFileId) {
      patch.driveThumbFileId = args.thumb.id;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(asset._id, patch);
    }
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "succeeded",
      completedAt: now,
      error: undefined,
      resultSummary:
        args.resultSummary ??
        `Mirrored ${args.preview ? "preview" : ""}${args.preview && args.thumb ? " + " : ""}${args.thumb ? "thumb" : ""} to Drive.`,
      updatedAt: now,
    });
    return { status: "succeeded" as const };
  },
});

function normalizedLimit(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultBatchSize;
  return Math.min(maxBatchSize, Math.max(1, Math.floor(value)));
}
