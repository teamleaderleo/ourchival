import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOwnerAccess } from "./lib/privateAccess";

const platform = v.union(
  v.literal("x"),
  v.literal("pinterest"),
  v.literal("pixiv"),
  v.literal("discord"),
  v.literal("manual"),
  v.literal("generic"),
);

export const listContainers = query({
  args: { accessKey: v.string(), platform, after: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const items: Array<{ key: string; name: string }> = [];
    let after = args.after;
    for (let i = 0; i < 24; i++) {
      const row = await ctx.db.query("referenceOrigins").withIndex("by_platform_and_container_key", q =>
        after === undefined ? q.eq("platform", args.platform) : q.eq("platform", args.platform).gt("containerKey", after),
      ).first();
      if (!row) return { items, after: null };
      items.push({ key: row.containerKey, name: row.containerName ?? row.containerType });
      after = row.containerKey;
    }
    return { items, after: after ?? null };
  },
});

export const listForReference = query({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await ctx.db
      .query("referenceOrigins")
      .withIndex("by_reference_id", (q) =>
        q.eq("referenceId", args.referenceId),
      )
      .take(100);
  },
});

export const listForContainer = query({
  args: {
    accessKey: v.string(),
    platform,
    containerKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const limit = Math.min(200, Math.max(1, Math.floor(args.limit ?? 100)));
    return await ctx.db
      .query("referenceOrigins")
      .withIndex("by_platform_and_container_key", (q) =>
        q.eq("platform", args.platform).eq("containerKey", args.containerKey),
      )
      .order("desc")
      .take(limit);
  },
});
