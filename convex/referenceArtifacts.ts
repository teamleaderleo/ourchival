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
