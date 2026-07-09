import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .order("desc")
      .take(60);
  },
});

export const create = mutation({
  args: {
    kind: v.union(
      v.literal("image"),
      v.literal("post"),
      v.literal("page"),
      v.literal("video_frame"),
      v.literal("file"),
    ),
    sourceUrl: v.string(),
    title: v.optional(v.string()),
    platform: v.union(
      v.literal("x"),
      v.literal("pinterest"),
      v.literal("pixiv"),
      v.literal("discord"),
      v.literal("manual"),
      v.literal("generic"),
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    return await ctx.db.insert("references", {
      kind: args.kind,
      sourceUrl: args.sourceUrl,
      ...(args.title ? { title: args.title } : {}),
      ...(args.notes ? { notes: args.notes } : {}),
      platform: args.platform,
      capturedAt: now,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });
  },
});
