import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const vaultView = v.union(
  v.literal("inbox"),
  v.literal("all"),
  v.literal("images"),
  v.literal("links"),
  v.literal("favorites"),
  v.literal("later"),
  v.literal("archive"),
  v.literal("trash"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const searches = await ctx.db.query("savedSearches").collect();
    return searches.sort((left, right) => right.updatedAt - left.updatedAt);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    query: v.string(),
    view: vaultView,
  },
  handler: async (ctx, args) => {
    const name = cleanSavedSearchName(args.name);
    const searchQuery = cleanSavedSearchQuery(args.query);
    if (!name) throw new Error("Saved search name is required.");
    if (!searchQuery && args.view === "all") {
      throw new Error("Add a search or choose a focused vault view.");
    }
    await assertUniqueName(ctx, name);

    const now = Date.now();
    const id = await ctx.db.insert("savedSearches", {
      name,
      query: searchQuery,
      view: args.view,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    savedSearchId: v.id("savedSearches"),
    name: v.string(),
    query: v.string(),
    view: vaultView,
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.savedSearchId);
    if (!search) throw new Error("Saved search not found.");

    const name = cleanSavedSearchName(args.name);
    const searchQuery = cleanSavedSearchQuery(args.query);
    if (!name) throw new Error("Saved search name is required.");
    if (!searchQuery && args.view === "all") {
      throw new Error("Add a search or choose a focused vault view.");
    }
    await assertUniqueName(ctx, name, args.savedSearchId);

    await ctx.db.patch(args.savedSearchId, {
      name,
      query: searchQuery,
      view: args.view,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(args.savedSearchId);
  },
});

export const remove = mutation({
  args: {
    savedSearchId: v.id("savedSearches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.savedSearchId);
    if (!search) return false;
    await ctx.db.delete(args.savedSearchId);
    return true;
  },
});

export function cleanSavedSearchName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function cleanSavedSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 500);
}

async function assertUniqueName(ctx: any, name: string, ignoredId?: any) {
  const normalized = name.toLocaleLowerCase();
  const searches = await ctx.db.query("savedSearches").collect();
  const duplicate = searches.find(
    (search: any) =>
      search._id !== ignoredId &&
      search.name.trim().toLocaleLowerCase() === normalized,
  );
  if (duplicate) throw new Error("A saved search with that name already exists.");
}
