import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOwnerAccess } from "./lib/privateAccess";
import { refreshReferenceSearch, startSearchRebuild } from "./lib/searchIndex";

export const rebuild = mutation({
  args: { accessKey: v.string() },
  handler: async (ctx, args): Promise<number> => {
    await requireOwnerAccess(args.accessKey);
    return await startSearchRebuild(ctx, true);
  },
});
export const status = query({
  args: { accessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const state = await ctx.db
      .query("referenceSearchState")
      .withIndex("by_key", (q) => q.eq("key", "catalog-v1"))
      .unique();
    return {
      ready: state?.ready ?? false,
      rebuilding: state?.rebuilding ?? false,
      updatedAt: state?.updatedAt ?? null,
    };
  },
});
export const refreshReference = internalMutation({
  args: { referenceId: v.id("references") },
  handler: async (ctx, args): Promise<null> => {
    await refreshReferenceSearch(ctx, args.referenceId);
    return null;
  },
});
export const rebuildPage = internalMutation({
  args: { generation: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<null> => {
    const state = await ctx.db
      .query("referenceSearchState")
      .withIndex("by_key", (q) => q.eq("key", "catalog-v1"))
      .unique();
    if (!state || state.generation !== args.generation || !state.rebuilding)
      return null;
    const page = await ctx.db
      .query("references")
      .paginate({ numItems: 8, cursor: args.cursor });
    for (const reference of page.page)
      await refreshReferenceSearch(ctx, reference._id);
    if (!page.isDone) {
      await ctx.db.patch(state._id, { updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.archiveSearch.rebuildPage, {
        generation: args.generation,
        cursor: page.continueCursor,
      });
    } else if (state.dirty) {
      await ctx.db.patch(state._id, { rebuilding: false, ready: true });
      await startSearchRebuild(ctx, true);
    } else {
      await ctx.db.patch(state._id, {
        ready: true,
        rebuilding: false,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
