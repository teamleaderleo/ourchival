import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";
import { applyReferenceStatsDelta } from "./lib/referenceCatalog";

export const setFavorite = mutation({
  args: {
    accessKey: v.string(),
    sessionKey: v.string(),
    referenceId: v.id("references"),
    favorite: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const reference = await ctx.db.get(args.referenceId);
    if (!reference || reference.captureSessionId !== args.sessionKey) {
      throw new Error("Capture session reference not found.");
    }

    const updated = { ...reference, favorite: args.favorite };
    await ctx.db.patch(reference._id, { favorite: args.favorite });
    await applyReferenceStatsDelta(ctx, reference, updated);

    const [remainingReference, session] = await Promise.all([
      ctx.db
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
        .first(),
      ctx.db
        .query("captureSessions")
        .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
        .unique(),
    ]);

    return {
      reference: {
        _id: updated._id,
        triageState: updated.triageState,
        reviewedAt: updated.reviewedAt,
        archived: updated.archived,
        deleted: updated.deleted,
        favorite: updated.favorite,
      },
      hasRemaining: Boolean(remainingReference),
      reviewState: session?.reviewState ?? "unreviewed",
    };
  },
});
