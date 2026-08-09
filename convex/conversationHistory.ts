import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";

export const listSnapshots = query({
  args: {
    accessKey: v.string(),
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) throw new Error("Conversation not found.");
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 50)));
    const snapshots = await ctx.db
      .query("conversationSnapshots")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .order("desc")
      .take(limit);

    return await Promise.all(
      snapshots.map(async (snapshot) => ({
        ...snapshot,
        storageUrl: await ctx.storage.getUrl(snapshot.storageId),
      })),
    );
  },
});

export const getSnapshot = query({
  args: {
    accessKey: v.string(),
    snapshotId: v.id("conversationSnapshots"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const snapshot = await ctx.db.get(args.snapshotId);
    if (!snapshot) return null;
    const conversation = await ctx.db.get(snapshot.conversationId);
    if (!conversation) return null;
    return {
      conversation,
      snapshot: {
        ...snapshot,
        storageUrl: await ctx.storage.getUrl(snapshot.storageId),
      },
    };
  },
});
