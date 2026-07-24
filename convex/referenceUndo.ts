import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";
import { applyReferenceStatsDelta } from "./lib/referenceCatalog";

const triageState = v.union(
  v.null(),
  v.literal("inbox"),
  v.literal("kept"),
  v.literal("later"),
);

export const restoreMove = mutation({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
    triageState,
    reviewedAt: v.union(v.null(), v.number()),
    archived: v.boolean(),
    deleted: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const before = await ctx.db.get(args.referenceId);
    if (!before) throw new Error("Reference not found.");

    const patch = {
      triageState: args.triageState ?? undefined,
      reviewedAt: args.reviewedAt ?? undefined,
      archived: args.archived,
      deleted: args.deleted,
    };
    await ctx.db.patch(before._id, patch);
    const restored = { ...before, ...patch };
    await applyReferenceStatsDelta(ctx, before, restored);

    return {
      _id: restored._id,
      triageState: restored.triageState,
      reviewedAt: restored.reviewedAt,
      archived: restored.archived,
      deleted: restored.deleted,
    };
  },
});
