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
    // Orphan sweep first: actions behind stale queued/running jobs are gone
    // (lost scheduler wakeups leave them ritually "active" forever, which
    // also pins the feeder limit). They never ran, so delete rather than
    // fail: no terminal record, the asset simply becomes eligible again.
    const ORPHAN_MS = 60 * 60_000;
    let orphaned = 0;
    for (const tracked of ["queued", "running"] as const) {
      const stale = await ctx.db
        .query("enrichmentJobs")
        .withIndex("by_type_status", (q: any) => q.eq("type", "drive_derivatives").eq("status", tracked))
        .take(32);
      for (const job of stale) {
        if (Date.now() - job.createdAt < ORPHAN_MS) continue;
        await ctx.db.delete(job._id);
        orphaned += 1;
      }
    }
    // Yield new uploads while the human browses, but always reclaim: shedding
    // metered bytes is cheap reads, seeding Sharp/Drive work is not.
    const yieldToForeground = await ctx.runQuery(internal.httpDb.foregroundActive, {});
    // Rotating cursor: the ready-asset index head is all long-done work, so
    // a fixed take() would re-scan it forever and never reach fresh assets.
    const cursorKey = "drive-mirrors-v1";
    const saved = await ctx.db
      .query("driveMirrorCursors")
      .withIndex("by_key", (q: any) => q.eq("key", cursorKey))
      .unique();
    let cursor: string | null = saved?.cursor ?? null;
    if (saved?.scanDone) cursor = null;

    let queued = 0;
    let active = 0;
    let skipped = 0;
    let reclaimed = 0;
    let reclaimedBytes = 0;
    let scanDone = false;
    // One paginated scan per tick (Convex allows a single paginate() per
    // function): a generous page usually fills the limit, and the persisted
    // cursor carries the remainder to the following ticks.
    const page = await ctx.db
      .query("assets")
      .withIndex("by_derivative_status", (q: any) =>
        q.eq("derivativeStatus", "ready"),
      )
      .paginate({ cursor, numItems: Math.min(256, limit * 32) });
    for (const asset of page.page) {
      if (queued + active >= limit) break;
      if (asset.drivePreviewFileId || asset.driveThumbFileId) {
        // Verified twin exists: shed the metered bytes, keep serving the
        // Drive copy. Shared blobs stay until their last referrer clears.
        // Sides without a recorded twin are left alone (nothing to fall
        // back to yet).
        const freed = await reclaimMirroredBlobs(ctx, asset);
        reclaimed += freed.files;
        reclaimedBytes += freed.bytes;
        continue;
      }
        const decision = await classifyUploadCandidate(ctx, asset);
        if (decision === "active") {
          active += 1;
          continue;
        }
        if (decision !== "eligible" || yieldToForeground) {
          skipped += 1;
          continue;
        }
        await insertUploadJob(ctx, asset);
        queued += 1;
    }
    cursor = page.continueCursor;
    scanDone = page.isDone;
    if (saved) {
      await ctx.db.patch(saved._id, { cursor, scanDone, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("driveMirrorCursors", { key: cursorKey, cursor, scanDone, updatedAt: Date.now() });
    }
    return { queued, active, skipped, reclaimed, reclaimedBytes, orphaned };
  },
});

// The batch worker pulls its next asset through here so many assets drain
// sequentially inside one action instead of N concurrent actions. The cursor
// threads through the worker loop for the same reason the feeder persists
// one: a fixed take() would re-read the same index head every claim.
export const claimNextUpload = internalMutation({
  args: {
    excludeAssetIds: v.array(v.id("assets")),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    // End the batch early when the human arrives: the seeded job still
    // mirrors its own asset, and the cron reseeds later.
    if (await ctx.runQuery(internal.httpDb.foregroundActive, {})) {
      return { jobId: null, assetId: null, cursor: args.cursor ?? null, done: true };
    }
    const excluded = new Set(args.excludeAssetIds.map(String));
    const page = await ctx.db
      .query("assets")
      .withIndex("by_derivative_status", (q: any) =>
        q.eq("derivativeStatus", "ready"),
      )
      .paginate({ cursor: args.cursor ?? null, numItems: 32 });
    for (const asset of page.page) {
      if (excluded.has(String(asset._id))) continue;
      if ((await classifyUploadCandidate(ctx, asset)) !== "eligible") {
        continue;
      }
      const jobId = await insertUploadJob(ctx, asset, false);
      return { jobId, assetId: asset._id, cursor: page.continueCursor, done: page.isDone };
    }
    // Head page held nothing claimable: hand the next page to the worker
    // rather than stalling the batch on done work.
    return { jobId: null, assetId: null, cursor: page.continueCursor, done: page.isDone };
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

// Live-media guard, local copy: shared derivative blobs stay until their
// last referrer detaches. (mediaDerivatives carries the same check for its
// own retirements; duplicated to keep this pipeline dependency-free.)
async function storageIsReferenced(
  ctx: any,
  storageId: any,
  ignoreAsset?: any,
) {
  const [previews, thumbs, originals, artwork, analysis, community] =
    await Promise.all([
      ctx.db
        .query("assets")
        .withIndex("by_preview_storage_id", (q: any) =>
          q.eq("previewStorageId", storageId),
        )
        .take(2),
      ctx.db
        .query("assets")
        .withIndex("by_thumb_storage_id", (q: any) =>
          q.eq("thumbStorageId", storageId),
        )
        .take(2),
      ctx.db
        .query("assets")
        .withIndex("by_original_storage_id", (q: any) =>
          q.eq("originalStorageId", storageId),
        )
        .take(2),
      ctx.db
        .query("artworkRepresentations")
        .withIndex("by_storage_id", (q: any) => q.eq("storageId", storageId))
        .first(),
      ctx.db
        .query("visualEnrichments")
        .withIndex("by_input_storage_id", (q: any) =>
          q.eq("inputStorageId", storageId),
        )
        .first(),
      ctx.db
        .query("communityMatches")
        .withIndex("by_input_storage_id", (q: any) =>
          q.eq("inputStorageId", storageId),
        )
        .first(),
    ]);
  return (
    previews.some((a: any) => a._id !== ignoreAsset) ||
    thumbs.some((a: any) => a._id !== ignoreAsset) ||
    originals.length > 0 ||
    Boolean(artwork || analysis || community)
  );
}

async function reclaimMirroredBlobs(ctx: any, asset: any) {  let files = 0;
  let bytes = 0;
  const clear: Record<string, undefined> = {};
  const handled = new Set<string>();
  const sides = [
    { storage: "previewStorageId", drive: "drivePreviewFileId" },
    { storage: "thumbStorageId", drive: "driveThumbFileId" },
  ] as const;
  for (const { storage, drive } of sides) {
    const storageId = asset[storage];
    if (!storageId || !asset[drive]) continue;
    // Detach unconditionally: the Drive twin is now the source of truth.
    // The bytes stay until their last referrer detaches.
    clear[storage] = undefined;
    // Preview and thumb often share one blob: delete it once.
    if (handled.has(String(storageId))) continue;
    handled.add(String(storageId));
    if (await storageIsReferenced(ctx, storageId, asset._id)) continue;
    const metadata = await ctx.db.system.get(storageId);
    if (!metadata) continue;
    await ctx.storage.delete(storageId);
    files += 1;
    bytes += metadata?.size ?? 0;
  }
  if (Object.keys(clear).length > 0) {
    await ctx.db.patch(asset._id, {
      ...clear,
      derivativeStatus: "ready",
    });
  }
  return { files, bytes };
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

export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const byStatus: Record<string, number> = {};
    let oldestActiveAt: number | null = null;
    for (const s of ["queued", "running", "succeeded", "failed"]) {
      const rows = await ctx.db
        .query("enrichmentJobs")
        .withIndex("by_type_status", (q: any) => q.eq("type", "drive_derivatives").eq("status", s))
        .take(1000);
      byStatus[s] = rows.length;
      if (s === "queued" || s === "running") {
        for (const row of rows) {
          if (oldestActiveAt == null || row.createdAt < oldestActiveAt) oldestActiveAt = row.createdAt;
        }
      }
    }
    return { byStatus, oldestActiveAt };
  },
});

export const getDriveJobContext = internalQuery({  args: {
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
      // A stale queued job for an asset mirrored (and reclaimed) by another
      // worker: nothing left to record, still a success.
      if (!(asset.drivePreviewFileId && asset.driveThumbFileId)) {
        throw new Error("Drive derivative upload recorded no files.");
      }
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
