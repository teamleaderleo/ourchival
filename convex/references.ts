import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

const kindValidator = v.union(
  v.literal("image"),
  v.literal("post"),
  v.literal("page"),
  v.literal("video_frame"),
  v.literal("file"),
);

const platformValidator = v.union(
  v.literal("x"),
  v.literal("pinterest"),
  v.literal("pixiv"),
  v.literal("discord"),
  v.literal("manual"),
  v.literal("generic"),
);

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

/**
 * Reactive replacement for the `GET /references` HTTP endpoint. Returns the
 * most recent non-deleted references, each joined with its assets and a
 * ready-to-render `storedUrl` (Drive proxy or Convex storage URL).
 */
export const listWithAssets = query({
  args: {},
  handler: async (ctx) => {
    const siteUrl = resolveSiteUrl();

    const references = await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .order("desc")
      .take(120);

    const visible = references.filter((reference) => !reference.deleted);

    return await Promise.all(
      visible.map(async (reference) => {
        const assets = await ctx.db
          .query("assets")
          .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
          .collect();

        const assetsWithUrls = await Promise.all(
          assets.map(async (asset) => ({
            ...asset,
            storedUrl: asset.driveFileId
              ? siteUrl
                ? `${siteUrl}/drive-file?id=${encodeURIComponent(asset.driveFileId)}`
                : null
              : asset.originalStorageId
                ? await ctx.storage.getUrl(asset.originalStorageId)
                : null,
          })),
        );

        return { ...reference, assets: assetsWithUrls };
      }),
    );
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

export const update = mutation({
  args: {
    id: v.id("references"),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    favorite: v.optional(v.boolean()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const patch: Partial<Doc<"references">> = {};

    if (typeof args.title === "string") patch.title = args.title.trim() || undefined;
    if (typeof args.notes === "string") patch.notes = args.notes.trim() || undefined;
    if (typeof args.favorite === "boolean") patch.favorite = args.favorite;
    if (typeof args.archived === "boolean") patch.archived = args.archived;

    await ctx.db.patch(args.id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("references") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deleted: true, archived: true });
  },
});

export const toggleBoard = mutation({
  args: { id: v.id("references"), boardId: v.id("boards") },
  handler: async (ctx, args) => {
    const reference = await ctx.db.get(args.id);
    if (!reference) return;

    const has = reference.boardIds.includes(args.boardId);
    const boardIds = has
      ? reference.boardIds.filter((boardId) => boardId !== args.boardId)
      : [...reference.boardIds, args.boardId];

    await ctx.db.patch(args.id, { boardIds });
  },
});

export const toggleTag = mutation({
  args: { id: v.id("references"), tagId: v.id("tags") },
  handler: async (ctx, args) => {
    const reference = await ctx.db.get(args.id);
    if (!reference) return;

    const has = reference.tagIds.includes(args.tagId);
    const tagIds = has
      ? reference.tagIds.filter((tagId) => tagId !== args.tagId)
      : [...reference.tagIds, args.tagId];

    await ctx.db.patch(args.id, { tagIds });
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const createFromUpload = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const label = args.title?.trim() || args.fileName?.trim() || "Uploaded reference";

    const referenceId = await ctx.db.insert("references", {
      kind: "image",
      sourceUrl: `upload:${args.fileName ?? args.storageId}`,
      title: label,
      platform: "manual",
      capturedAt: now,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });

    const metadata = await ctx.db.system.get(args.storageId);

    const assetId = await ctx.db.insert("assets", {
      referenceId,
      storageProvider: "convex",
      originalStorageId: args.storageId,
      ...(args.fileName ? { originalFileName: args.fileName } : {}),
      ...(args.mimeType ? { mimeType: args.mimeType } : {}),
      ...(metadata?.size ? { fileSize: metadata.size } : {}),
      dominantColors: [],
    });

    return { referenceId, assetId };
  },
});

/**
 * Persists a captured reference, its asset, and its source snapshot. Called by
 * the `/capture` HTTP action after it has done the (action-only) remote fetch
 * and storage work — HTTP actions cannot touch `ctx.db` directly.
 */
export const saveCapture = internalMutation({
  args: {
    kind: kindValidator,
    sourceUrl: v.string(),
    title: v.optional(v.string()),
    platform: platformValidator,
    capturedAt: v.number(),
    pageTitle: v.optional(v.string()),
    selectedText: v.optional(v.string()),
    jsonMetadata: v.string(),
    asset: v.optional(
      v.object({
        storageProvider: v.union(
          v.literal("google_drive"),
          v.literal("convex"),
          v.literal("linked"),
        ),
        originalUrl: v.string(),
        originalStorageId: v.optional(v.id("_storage")),
        mimeType: v.optional(v.string()),
        fileSize: v.optional(v.number()),
        driveFileId: v.optional(v.string()),
        driveFolderId: v.optional(v.string()),
        driveWebViewLink: v.optional(v.string()),
        driveWebContentLink: v.optional(v.string()),
        driveThumbnailLink: v.optional(v.string()),
        driveMimeType: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const referenceId = await ctx.db.insert("references", {
      kind: args.kind,
      ...(args.title ? { title: args.title } : {}),
      sourceUrl: args.sourceUrl,
      platform: args.platform,
      capturedAt: args.capturedAt,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });

    let assetId: Id<"assets"> | null = null;

    if (args.asset) {
      const asset = args.asset;
      assetId = await ctx.db.insert("assets", {
        referenceId,
        storageProvider: asset.storageProvider,
        originalUrl: asset.originalUrl,
        ...(asset.originalStorageId ? { originalStorageId: asset.originalStorageId } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
        ...(asset.fileSize ? { fileSize: asset.fileSize } : {}),
        ...(asset.driveFileId ? { driveFileId: asset.driveFileId } : {}),
        ...(asset.driveFolderId ? { driveFolderId: asset.driveFolderId } : {}),
        ...(asset.driveWebViewLink ? { driveWebViewLink: asset.driveWebViewLink } : {}),
        ...(asset.driveWebContentLink ? { driveWebContentLink: asset.driveWebContentLink } : {}),
        ...(asset.driveThumbnailLink ? { driveThumbnailLink: asset.driveThumbnailLink } : {}),
        ...(asset.driveMimeType ? { driveMimeType: asset.driveMimeType } : {}),
        dominantColors: [],
      });
    }

    await ctx.db.insert("sourceSnapshots", {
      referenceId,
      ...(args.pageTitle ? { pageTitle: args.pageTitle } : {}),
      ...(args.selectedText ? { selectedText: args.selectedText } : {}),
      jsonMetadata: args.jsonMetadata,
      createdAt: Date.now(),
    });

    return { referenceId, assetId };
  },
});

function resolveSiteUrl(): string | undefined {
  const site = process.env.CONVEX_SITE_URL?.replace(/\/$/, "");
  if (site) return site;

  const cloud = process.env.CONVEX_CLOUD_URL?.replace(/\/$/, "");
  if (!cloud) return undefined;

  return cloud.replace(/\.convex\.cloud$/, ".convex.site");
}
