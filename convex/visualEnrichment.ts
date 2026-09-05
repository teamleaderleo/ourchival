import { paginationOptsValidator } from "convex/server";
import { visualModel, visualTag } from "./lib/searchSchema";
import { validateVisualResult } from "./lib/visualValidation";
import { refreshReferenceSearch } from "./lib/searchIndex";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";
import { hammingDistanceHex, sharedPaletteColors } from "./lib/perceptualHash";

const visualJobTypes = ["dominant_colors", "perceptual_hash"] as const;

export const start = mutation({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const [reference, asset] = await Promise.all([
      ctx.db.get(args.referenceId),
      ctx.db.get(args.assetId),
    ]);
    if (!reference || reference.deleted)
      throw new Error("Reference not found.");
    if (!asset || asset.referenceId !== args.referenceId) {
      throw new Error("Visual asset not found.");
    }

    const jobs = [];
    for (const type of visualJobTypes) {
      const active = (
        await ctx.db
          .query("enrichmentJobs")
          .withIndex("by_reference_type", (q) =>
            q.eq("referenceId", args.referenceId).eq("type", type),
          )
          .collect()
      ).find((job) => job.status === "queued" || job.status === "running");
      if (active) {
        jobs.push(active);
        continue;
      }

      const now = Date.now();
      const jobId = await ctx.db.insert("enrichmentJobs", {
        referenceId: args.referenceId,
        type,
        status: "queued",
        attempts: 0,
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const job = await ctx.db.get(jobId);
      if (job) jobs.push(job);
    }

    return { assetId: asset._id, jobs };
  },
});

export const begin = mutation({
  args: {
    accessKey: v.string(),
    jobIds: v.array(v.id("enrichmentJobs")),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const now = Date.now();
    const started: string[] = [];
    for (const jobId of Array.from(new Set(args.jobIds)).slice(0, 4)) {
      const job = await ctx.db.get(jobId);
      if (
        !job ||
        job.status !== "queued" ||
        (job.type !== "dominant_colors" && job.type !== "perceptual_hash")
      ) {
        continue;
      }
      await ctx.db.patch(job._id, {
        status: "running",
        attempts: job.attempts + 1,
        startedAt: now,
        completedAt: undefined,
        error: undefined,
        resultSummary: undefined,
        updatedAt: now,
      });
      started.push(String(job._id));
    }
    return started;
  },
});

export const complete = mutation({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
    assetId: v.id("assets"),
    jobIds: v.array(v.id("enrichmentJobs")),
    perceptualHash: v.string(),
    dominantColors: v.array(v.string()),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const [reference, asset] = await Promise.all([
      ctx.db.get(args.referenceId),
      ctx.db.get(args.assetId),
    ]);
    if (!reference) throw new Error("Reference not found.");
    if (!asset || asset.referenceId !== reference._id) {
      throw new Error("Visual asset not found.");
    }

    const perceptualHash = normalizeHash(args.perceptualHash);
    const dominantColors = normalizeColors(args.dominantColors);
    await ctx.db.patch(asset._id, {
      perceptualHash,
      dominantColors,
      width: positiveDimension(args.width),
      height: positiveDimension(args.height),
    });

    const now = Date.now();
    for (const jobId of Array.from(new Set(args.jobIds)).slice(0, 4)) {
      const job = await ctx.db.get(jobId);
      if (!job || job.referenceId !== reference._id) continue;
      if (job.type === "perceptual_hash") {
        await ctx.db.patch(job._id, {
          status: "succeeded",
          completedAt: now,
          error: undefined,
          resultSummary: "Stored a 64-bit perceptual hash.",
          updatedAt: now,
        });
      } else if (job.type === "dominant_colors") {
        await ctx.db.patch(job._id, {
          status: "succeeded",
          completedAt: now,
          error: undefined,
          resultSummary: `Stored ${dominantColors.length} dominant ${dominantColors.length === 1 ? "color" : "colors"}.`,
          updatedAt: now,
        });
      }
    }

    return {
      perceptualHash,
      dominantColors,
      width: positiveDimension(args.width),
      height: positiveDimension(args.height),
    };
  },
});

export const fail = mutation({
  args: {
    accessKey: v.string(),
    jobIds: v.array(v.id("enrichmentJobs")),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const now = Date.now();
    let updated = 0;
    for (const jobId of Array.from(new Set(args.jobIds)).slice(0, 4)) {
      const job = await ctx.db.get(jobId);
      if (
        !job ||
        (job.type !== "dominant_colors" && job.type !== "perceptual_hash")
      ) {
        continue;
      }
      await ctx.db.patch(job._id, {
        status: "failed",
        completedAt: now,
        error: args.error.trim().slice(0, 1000) || "Visual analysis failed.",
        resultSummary: "The browser could not complete visual analysis.",
        updatedAt: now,
      });
      updated += 1;
    }
    return { updated };
  },
});

export const findSimilar = query({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const reference = await ctx.db.get(args.referenceId);
    if (!reference) throw new Error("Reference not found.");
    const targetAssets = await ctx.db
      .query("assets")
      .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
      .collect();
    const target = targetAssets.find(
      (asset) =>
        typeof asset.perceptualHash === "string" &&
        asset.perceptualHash.length > 0,
    );
    if (!target?.perceptualHash) return [];

    const bestByReference = new Map<
      string,
      {
        asset: Doc<"assets">;
        distance: number;
        sharedColors: string[];
        score: number;
      }
    >();
    let cursor: string | null = null;
    let isDone = false;
    let scanned = 0;

    while (!isDone && scanned < 4096) {
      const page = await ctx.db
        .query("assets")
        .paginate({ numItems: 256, cursor });
      cursor = page.continueCursor;
      isDone = page.isDone;
      scanned += page.page.length;

      for (const candidate of page.page) {
        if (
          candidate.referenceId === reference._id ||
          !candidate.perceptualHash ||
          candidate.perceptualHash.length !== target.perceptualHash.length
        ) {
          continue;
        }
        const distance = hammingDistanceHex(
          target.perceptualHash,
          candidate.perceptualHash,
        );
        const sharedColors = sharedPaletteColors(
          target.dominantColors,
          candidate.dominantColors,
        );
        if (distance > 10 && !(distance <= 16 && sharedColors.length >= 2)) {
          continue;
        }
        const score = 64 - distance + sharedColors.length * 3;
        const key = String(candidate.referenceId);
        const current = bestByReference.get(key);
        if (!current || score > current.score) {
          bestByReference.set(key, {
            asset: candidate,
            distance,
            sharedColors,
            score,
          });
        }
      }
    }

    const limit = Math.min(12, Math.max(1, Math.floor(args.limit ?? 8)));
    const ranked = Array.from(bestByReference.values())
      .sort(
        (left, right) =>
          right.score - left.score || left.distance - right.distance,
      )
      .slice(0, limit * 2);
    const results = [];

    for (const match of ranked) {
      if (results.length >= limit) break;
      const candidateReference = await ctx.db.get(match.asset.referenceId);
      if (
        !candidateReference ||
        candidateReference.deleted ||
        candidateReference.archived
      ) {
        continue;
      }
      const snapshot = await ctx.db
        .query("sourceSnapshots")
        .withIndex("by_reference", (q) =>
          q.eq("referenceId", candidateReference._id),
        )
        .order("desc")
        .first();
      const storedUrl = match.asset.originalStorageId
        ? await ctx.storage.getUrl(match.asset.originalStorageId)
        : null;
      results.push({
        reference: {
          _id: candidateReference._id,
          title: candidateReference.title,
          sourceUrl: candidateReference.sourceUrl,
          kind: candidateReference.kind,
          platform: candidateReference.platform,
          capturedAt: candidateReference.capturedAt,
        },
        previewUrl:
          storedUrl ??
          match.asset.driveThumbnailLink ??
          match.asset.originalUrl ??
          snapshot?.previewImageUrl ??
          null,
        distance: match.distance,
        sharedColors: match.sharedColors,
        score: match.score,
        reasons: [
          match.distance === 0
            ? "Exact perceptual hash"
            : `${match.distance}-bit visual distance`,
          ...(match.sharedColors.length > 0
            ? [
                `${match.sharedColors.length} shared palette ${match.sharedColors.length === 1 ? "color" : "colors"}`,
              ]
            : []),
        ],
      });
    }

    return results;
  },
});

function normalizeHash(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!/^[0-9a-f]{16}$/.test(normalized)) {
    throw new Error("Perceptual hash must be 16 hexadecimal characters.");
  }
  return normalized;
}

function normalizeColors(values: string[]) {
  const colors = Array.from(
    new Set(
      values
        .map((value) => value.trim().toLocaleLowerCase())
        .filter((value) => /^#[0-9a-f]{6}$/.test(value)),
    ),
  ).slice(0, 8);
  if (colors.length === 0)
    throw new Error("At least one dominant color is required.");
  return colors;
}

function positiveDimension(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Image dimensions must be positive numbers.");
  }
  return Math.round(value);
}

/** Authenticated, bounded work enumeration; serves owned storage objects only. */
export const listAssets = query({
  args: { accessKey: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const page = await ctx.db.query("assets").paginate({
      ...args.paginationOpts,
      numItems: Math.min(32, Math.max(1, args.paginationOpts.numItems)),
    });
    const items = [];
    let skipped = 0;
    for (const asset of page.page) {
      const reference = await ctx.db.get(asset.referenceId);
      const inputStorageId = asset.previewStorageId ?? asset.originalStorageId;
      // Linked URLs and Drive originals await the existing derivative pipeline.
      if (
        !reference ||
        reference.deleted ||
        !inputStorageId ||
        (asset.mimeType && !asset.mimeType.startsWith("image/"))
      ) {
        skipped++;
        continue;
      }
      const inputUrl = await ctx.storage.getUrl(inputStorageId);
      if (!inputUrl) {
        skipped++;
        continue;
      }
      const existing = await ctx.db
        .query("visualEnrichments")
        .withIndex("by_asset_id", (q) => q.eq("assetId", asset._id))
        .unique();
      items.push({
        assetId: asset._id,
        referenceId: reference._id,
        inputStorageId,
        inputUrl,
        inputVariant:
          asset.previewStorageId === inputStorageId ? "preview" : "original",
        originalContentHash: asset.contentHash ?? null,
        sourceUrl: reference.sourceUrl,
        title: reference.title ?? "",
        platform: reference.platform,
        expectedRevision: existing?.revision ?? 0,
        completedPipeline:
          existing?.inputStorageId === inputStorageId &&
          (existing.originalContentHash ?? null) === (asset.contentHash ?? null)
            ? existing.pipelineFingerprint
            : null,
      });
    }
    return {
      items,
      skipped,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const submit = mutation({
  args: {
    accessKey: v.string(),
    assetId: v.id("assets"),
    inputStorageId: v.id("_storage"),
    inputSha256: v.string(),
    originalContentHash: v.union(v.string(), v.null()),
    pipelineFingerprint: v.string(),
    expectedRevision: v.number(),
    models: v.array(visualModel),
    tags: v.array(visualTag),
    ratings: v.array(v.object({ label: v.string(), confidence: v.number() })),
    ocrText: v.optional(v.string()),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    validateVisualResult(args);
    if (
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < 0
    )
      throw new Error("Invalid result revision.");
    const asset = await ctx.db.get(args.assetId);
    if (
      !asset ||
      ![asset.previewStorageId, asset.originalStorageId].includes(
        args.inputStorageId,
      )
    )
      throw new Error("Asset input changed; reload the work item.");
    const reference = await ctx.db.get(asset.referenceId);
    if (!reference || reference.deleted)
      throw new Error("Reference is unavailable.");
    if ((asset.contentHash ?? null) !== args.originalContentHash)
      throw new Error("Original content changed; reload the work item.");
    const existing = await ctx.db
      .query("visualEnrichments")
      .withIndex("by_asset_id", (q) => q.eq("assetId", args.assetId))
      .unique();
    if (
      existing &&
      existing.pipelineFingerprint === args.pipelineFingerprint &&
      existing.inputSha256 === args.inputSha256 &&
      existing.inputStorageId === args.inputStorageId &&
      (existing.originalContentHash ?? null) === args.originalContentHash
    ) {
      return { id: existing._id, replayed: true, revision: existing.revision };
    }
    if ((existing?.revision ?? 0) !== args.expectedRevision)
      throw new Error(
        "Another worker completed this asset; reload the work item.",
      );
    const now = Date.now();
    const payload = {
      assetId: asset._id,
      referenceId: asset.referenceId,
      inputStorageId: args.inputStorageId,
      inputSha256: args.inputSha256,
      pipelineFingerprint: args.pipelineFingerprint,
      ...(args.originalContentHash
        ? { originalContentHash: args.originalContentHash }
        : {}),
      models: args.models,
      tags: args.tags,
      ratings: args.ratings,
      ...(args.ocrText !== undefined ? { ocrText: args.ocrText } : {}),
      ...(args.caption !== undefined ? { caption: args.caption } : {}),
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const id =
      existing?._id ?? (await ctx.db.insert("visualEnrichments", payload));
    if (existing) await ctx.db.replace(existing._id, payload);
    // Human corrections live in their own table and survive replacement of machine output.
    await refreshReferenceSearch(ctx, asset.referenceId);
    return { id, replayed: false, revision: payload.revision };
  },
});

export const correct = mutation({
  args: {
    accessKey: v.string(),
    assetId: v.id("assets"),
    rejectedTags: v.array(v.string()),
    hideOcr: v.boolean(),
    hideCaption: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (
      args.rejectedTags.length > 256 ||
      args.rejectedTags.some((t) => !t.trim() || t.length > 120)
    )
      throw new Error("Invalid correction list.");
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Asset is unavailable.");
    const existing = await ctx.db
      .query("visualCorrections")
      .withIndex("by_asset_id", (q) => q.eq("assetId", asset._id))
      .unique();
    const payload = {
      assetId: asset._id,
      rejectedTags: [...new Set(args.rejectedTags)],
      hideOcr: args.hideOcr,
      hideCaption: args.hideCaption,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, payload);
    else await ctx.db.insert("visualCorrections", payload);
    await refreshReferenceSearch(ctx, asset.referenceId);
    return null;
  },
});
