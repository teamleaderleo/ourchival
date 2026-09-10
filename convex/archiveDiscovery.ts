import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOwnerAccess } from "./lib/privateAccess";
import { refreshDiscoveryReference } from "./lib/discoveryIndex";

function displayLabel(label: string, fallback: string) {
  return /[^\s\p{Cf}\u115f\u1160\u2800\u3164]/u.test(label) ? label : fallback;
}

export const status = query({
  args: { accessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await ctx.db.query("archiveDiscoveryState").withIndex("by_key", q => q.eq("key", "global-v1")).unique();
  },
});

export const ensure = mutation({
  args: { accessKey: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireOwnerAccess(args.accessKey);
    let state = await ctx.db.query("archiveDiscoveryState").withIndex("by_key", q => q.eq("key", "global-v1")).unique();
    if (state?.ready || (state?.running && Date.now() - state.updatedAt < 60_000)) return null;
    if (!state) {
      const id = await ctx.db.insert("archiveDiscoveryState", { key: "global-v1", cursor: null, scanned: 0, ready: false, running: true, updatedAt: Date.now() });
      state = (await ctx.db.get(id))!;
    } else await ctx.db.patch(state._id, { running: true, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.archiveDiscovery.backfill, { cursor: state.cursor });
    return null;
  },
});

export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<null> => {
    const state = await ctx.db.query("archiveDiscoveryState").withIndex("by_key", q => q.eq("key", "global-v1")).unique();
    if (!state || state.ready || !state.running || state.cursor !== args.cursor) return null;
    const page = await ctx.db.query("references").paginate({ cursor: args.cursor, numItems: 24 });
    for (const ref of page.page) await refreshDiscoveryReference(ctx, ref._id);
    await ctx.db.patch(state._id, { cursor: page.continueCursor, scanned: state.scanned + page.page.length, ready: page.isDone, running: !page.isDone, updatedAt: Date.now() });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.archiveDiscovery.backfill, { cursor: page.continueCursor });
    return null;
  },
});

export const list = query({
  args: { accessKey: v.string(), revealSensitive: v.boolean(), search: v.optional(v.string()), selected: v.optional(v.id("archiveFacets")) },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const state = await ctx.db.query("archiveDiscoveryState").withIndex("by_key", q => q.eq("key", "global-v1")).unique();
    const count = (row: { total: number; visible: number }) => args.revealSensitive ? row.total : row.visible;
    const selected = args.selected ? await ctx.db.get(args.selected) : null;
    const choices = async (kind: "artist" | "tag") => {
      if (!state?.ready) return [];
      const search = args.search?.trim().slice(0, 120);
      const rows = search
        ? await ctx.db.query("archiveFacets").withSearchIndex("search_text", q => q.search("searchText", search).eq("kind", kind)).take(40)
        : args.revealSensitive
          ? await ctx.db.query("archiveFacets").withIndex("by_kind_and_total", q => q.eq("kind", kind).gt("total", 0)).order("desc").take(8)
          : await ctx.db.query("archiveFacets").withIndex("by_kind_and_visible", q => q.eq("kind", kind).gt("visible", 0)).order("desc").take(8);
      return rows.filter(row => count(row) > 0).sort((a, b) => count(b) - count(a) || a.label.localeCompare(b.label)).slice(0, search ? 20 : 8)
        .map(row => ({ id: row._id, kind: row.kind, label: displayLabel(row.label, row.detail), detail: row.detail, count: count(row) }));
    };
    return { ready: state?.ready ?? false, scanned: state?.scanned ?? 0,
      artists: await choices("artist"), tags: await choices("tag"),
      selected: selected && count(selected) > 0 ? { id: selected._id, kind: selected.kind, label: displayLabel(selected.label, selected.detail) } : null };
  },
});
