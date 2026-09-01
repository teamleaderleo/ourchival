import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  ensureTag,
  getTagsByIds,
  listTags,
  updateAssetTags,
  updateReferenceTags,
} from "./lib/tags";
import { requireOwnerAccess } from "./lib/privateAccess";

export const list = query({
  args: { accessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await listTags(ctx);
  },
});

export const create = mutation({
  args: {
    accessKey: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await ensureTag(ctx, args.name);
  },
});

export const listForReference = query({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const reference = await ctx.db.get(args.referenceId);
    if (!reference) return [];
    return await getTagsByIds(ctx, reference.tagIds);
  },
});

export const updateReference = mutation({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
    addNames: v.array(v.string()),
    removeIds: v.array(v.id("tags")),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await updateReferenceTags(ctx, args.referenceId, {
      addNames: args.addNames,
      removeIds: args.removeIds.map(String),
    });
  },
});

export const updateReferences = mutation({
  args: {
    accessKey: v.string(),
    referenceIds: v.array(v.id("references")),
    addNames: v.array(v.string()),
    removeIds: v.array(v.id("tags")),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const referenceIds = Array.from(new Set(args.referenceIds)).slice(0, 96);
    const addNames = Array.from(
      new Set(args.addNames.map((name) => name.trim()).filter(Boolean)),
    ).slice(0, 20);
    const removeIds = Array.from(new Set(args.removeIds.map(String))).slice(
      0,
      20,
    );
    let updated = 0;

    for (const referenceId of referenceIds) {
      const reference = await ctx.db.get(referenceId);
      if (!reference) continue;
      await updateReferenceTags(ctx, referenceId, { addNames, removeIds });
      updated += 1;
    }

    return { updated };
  },
});

export const listForAsset = query({
  args: {
    accessKey: v.string(),
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return [];
    return await getTagsByIds(ctx, asset.tagIds ?? []);
  },
});

export const updateAsset = mutation({
  args: {
    accessKey: v.string(),
    assetId: v.id("assets"),
    addNames: v.array(v.string()),
    removeIds: v.array(v.id("tags")),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await updateAssetTags(ctx, args.assetId, {
      addNames: args.addNames,
      removeIds: args.removeIds.map(String),
    });
  },
});
