import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";

const retention = v.union(
  v.literal("review"),
  v.literal("pinned"),
  v.literal("archival"),
);

export const listForReference = query({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await ctx.db
      .query("referenceArtifacts")
      .withIndex("by_reference", (q) => q.eq("referenceId", args.referenceId))
      .order("desc")
      .collect();
  },
});

export const setRetention = mutation({
  args: {
    accessKey: v.string(),
    artifactId: v.id("referenceArtifacts"),
    retention,
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) throw new Error("Reference artifact not found.");
    await ctx.db.patch(artifact._id, {
      retention: args.retention,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(artifact._id);
  },
});

export const purgeExpiredReviewArtifacts = mutation({
  args: {
    accessKey: v.string(),
    before: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const before = validCutoff(args.before);
    const limit = Math.min(32, Math.max(1, Math.floor(args.limit ?? 16)));
    const candidates = await ctx.db
      .query("referenceArtifacts")
      .withIndex("by_retention", (q) => q.eq("retention", "review"))
      .filter((q) => q.lt(q.field("updatedAt"), before))
      .take(limit);

    let deleted = 0;
    let skipped = 0;
    for (const artifact of candidates) {
      const reference = await ctx.db.get(artifact.referenceId);
      if (!reference?.reviewedAt || reference.reviewedAt >= before) {
        skipped += 1;
        continue;
      }

      if (artifact.storageId) {
        const asset = await ctx.db
          .query("assets")
          .withIndex("by_reference", (q) => q.eq("referenceId", artifact.referenceId))
          .first();
        if (asset && screenshotIsCurrentPreview(asset, artifact.storageId)) {
          if (assetHasOwnedOriginal(asset)) {
            await ctx.db.patch(asset._id, {
              previewStorageId: undefined,
              thumbStorageId: undefined,
              derivativeStatus: undefined,
            });
          } else {
            await ctx.db.delete(asset._id);
          }
        }
        await ctx.storage.delete(artifact.storageId);
      }
      await ctx.db.delete(artifact._id);
      deleted += 1;
    }

    return {
      scanned: candidates.length,
      deleted,
      skipped,
      hasMore: candidates.length === limit,
    };
  },
});

function validCutoff(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > Date.now()) {
    throw new Error("Artifact cleanup cutoff is invalid.");
  }
  return value;
}

function screenshotIsCurrentPreview(asset: any, storageId: any) {
  return asset.previewStorageId === storageId || asset.thumbStorageId === storageId;
}

function assetHasOwnedOriginal(asset: any) {
  return Boolean(
    asset.originalStorageId ||
      asset.originalUrl ||
      asset.driveFileId ||
      asset.driveWebContentLink ||
      asset.driveWebViewLink,
  );
}
