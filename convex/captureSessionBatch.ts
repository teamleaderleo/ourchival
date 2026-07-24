import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";
import { applyReferenceStatsDelta } from "./lib/referenceCatalog";
import { captureSessionReviewPatch } from "./lib/captureSessionReview";

const batchDestination = v.union(
  v.literal("keep"),
  v.literal("later"),
  v.literal("archive"),
  v.literal("trash"),
);

export const reviewPending = mutation({
  args: {
    accessKey: v.string(),
    sessionKey: v.string(),
    destination: batchDestination,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const limit = Math.min(48, Math.max(1, Math.floor(args.limit ?? 48)));
    const references = await ctx.db
      .query("references")
      .withIndex("by_capture_session", (q) =>
        q.eq("captureSessionId", args.sessionKey),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("triageState"), "inbox"),
          q.eq(q.field("archived"), false),
          q.eq(q.field("deleted"), false),
        ),
      )
      .take(limit);

    const reviewedAt = Date.now();
    const patch = captureSessionReviewPatch(args.destination, reviewedAt);
    for (const reference of references) {
      const updated = { ...reference, ...patch };
      await ctx.db.patch(reference._id, patch);
      await applyReferenceStatsDelta(ctx, reference, updated);
    }

    const remaining = await ctx.db
      .query("references")
      .withIndex("by_capture_session", (q) =>
        q.eq("captureSessionId", args.sessionKey),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("triageState"), "inbox"),
          q.eq(q.field("archived"), false),
          q.eq(q.field("deleted"), false),
        ),
      )
      .first();
    const hasRemaining = Boolean(remaining);
    const reviewState = hasRemaining ? "reviewing" as const : "completed" as const;
    const session = await ctx.db
      .query("captureSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    if (session && session.reviewState !== reviewState) {
      await ctx.db.patch(session._id, { reviewState, updatedAt: reviewedAt });
    }

    return {
      updated: references.length,
      hasRemaining,
      reviewState,
    };
  },
});
