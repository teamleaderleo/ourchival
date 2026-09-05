import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  ensureTag,
  getTagsByIds,
  listTags,
  updateAssetTags,
  updateReferenceTags,
  normalizeTagName,
  slugifyTagName,
} from "./lib/tags";
import { requireOwnerAccess } from "./lib/privateAccess";
import { allocateTagCode } from "./lib/tagIdentity";
import { startSearchRebuild } from "./lib/searchIndex";

export const createDefinition = mutation({
  args: { accessKey: v.string(), name: v.string(), definition: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const definition = args.definition.trim();
    if (definition.length > 2000)
      throw new Error("Keep the definition under 2,000 characters.");
    const slug = slugifyTagName(args.name);
    if (
      (await listTags(ctx)).some((tag) =>
        [
          tag.slug,
          slugifyTagName(tag.name),
          ...(tag.aliases ?? []).map(slugifyTagName),
        ].includes(slug),
      )
    ) {
      throw new Error(
        "That tag already exists. Select it to edit its definition.",
      );
    }
    const tag = await ensureTag(ctx, args.name);
    await ctx.db.patch(tag._id, {
      definition,
      definitionVersion: definition ? 1 : 0,
      revision: 1,
    });
    if (definition)
      await ctx.db.insert("tagDefinitions", {
        tagId: tag._id,
        version: 1,
        definition,
        createdAt: Date.now(),
      });
    return await ctx.db.get(tag._id);
  },
});

export const editDefinition = mutation({
  args: {
    accessKey: v.string(),
    tagId: v.id("tags"),
    expectedRevision: v.number(),
    name: v.string(),
    definition: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const tag = await ctx.db.get(args.tagId);
    if (!tag) throw new Error("Tag not found.");
    if ((tag.revision ?? 0) !== args.expectedRevision)
      throw new Error("Tag changed. Reload before saving.");
    const name = normalizeTagName(args.name);
    if (!slugifyTagName(name))
      throw new Error("Tag name must include a letter or number.");
    const definition = args.definition.trim();
    if (definition.length > 2000)
      throw new Error("Keep the definition under 2,000 characters.");
    const slug = slugifyTagName(name);
    const collision = (await listTags(ctx)).find(
      (other) =>
        other._id !== tag._id &&
        [
          other.slug,
          slugifyTagName(other.name),
          ...(other.aliases ?? []).map(slugifyTagName),
        ].includes(slug),
    );
    if (collision) throw new Error("That name already belongs to another tag.");
    const aliases = Array.from(
      new Set([
        ...(tag.aliases ?? []),
        ...(tag.name !== name ? [tag.name] : []),
      ]),
    );
    if (aliases.length > 64)
      throw new Error("This tag has reached its 64-name history limit.");
    const changed = definition !== (tag.definition ?? "");
    const definitionVersion = (tag.definitionVersion ?? 0) + (changed ? 1 : 0);
    if (changed)
      await ctx.db.insert("tagDefinitions", {
        tagId: tag._id,
        version: definitionVersion,
        definition,
        createdAt: Date.now(),
      });
    await ctx.db.patch(tag._id, {
      name,
      aliases,
      definition,
      definitionVersion,
      revision: (tag.revision ?? 0) + 1,
      code: tag.code ?? (await allocateTagCode(ctx)),
    });
    if (name !== tag.name) await startSearchRebuild(ctx);
    return await ctx.db.get(tag._id);
  },
});

export const setExample = mutation({
  args: {
    accessKey: v.string(),
    tagId: v.id("tags"),
    assetId: v.id("assets"),
    definitionVersion: v.number(),
    positive: v.union(v.boolean(), v.null()),
    applyTag: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const tag = await ctx.db.get(args.tagId);
    const asset = await ctx.db.get(args.assetId);
    if (!tag || !asset) throw new Error("Tag or image not found.");
    const reference = await ctx.db.get(asset.referenceId);
    if (!reference || reference.deleted)
      throw new Error("Reference not available.");
    if (!tag.definition || tag.definitionVersion !== args.definitionVersion) {
      throw new Error(
        "Define the tag and reload its current meaning before choosing examples.",
      );
    }
    const existing = await ctx.db
      .query("tagExamples")
      .withIndex("by_tagId_and_assetId", (q) =>
        q.eq("tagId", tag._id).eq("assetId", asset._id),
      )
      .unique();
    if (args.positive === null) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    const payload = {
      tagId: tag._id,
      assetId: asset._id,
      definitionVersion: args.definitionVersion,
      positive: args.positive,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, payload);
    else await ctx.db.insert("tagExamples", payload);
    if (args.positive && args.applyTag)
      await updateAssetTags(ctx, asset._id, { addNames: [tag.name] });
    return null;
  },
});

export const examplesForAsset = query({
  args: { accessKey: v.string(), tagId: v.id("tags"), assetId: v.id("assets") },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await ctx.db
      .query("tagExamples")
      .withIndex("by_tagId_and_assetId", (q) =>
        q.eq("tagId", args.tagId).eq("assetId", args.assetId),
      )
      .unique();
  },
});

/** Bounded, owner-only training input for a particular definition version. */
export const listExamples = query({
  args: {
    accessKey: v.string(),
    tagId: v.id("tags"),
    definitionVersion: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const tag = await ctx.db.get(args.tagId);
    if (!tag?.definition || tag.definitionVersion !== args.definitionVersion)
      throw new Error("Definition changed; restart example enumeration.");
    const page = await ctx.db
      .query("tagExamples")
      .withIndex("by_tagId_and_assetId", (q) => q.eq("tagId", tag._id))
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(32, Math.max(1, args.paginationOpts.numItems)),
      });
    const items = [];
    for (const example of page.page) {
      if (example.definitionVersion !== args.definitionVersion) continue;
      const asset = await ctx.db.get(example.assetId);
      if (!asset) continue;
      const reference = await ctx.db.get(asset.referenceId);
      if (!reference || reference.deleted) continue;
      const storageId = asset.previewStorageId ?? asset.originalStorageId;
      items.push({
        ...example,
        inputStorageId: storageId ?? null,
        inputUrl: storageId ? await ctx.storage.getUrl(storageId) : null,
        originalContentHash: asset.contentHash ?? null,
      });
    }
    return {
      tag,
      items,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

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
