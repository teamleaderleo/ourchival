import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type DatabaseReader,
} from "./_generated/server";

const referenceKind = v.union(
  v.literal("image"),
  v.literal("post"),
  v.literal("page"),
  v.literal("link"),
  v.literal("article"),
  v.literal("video_frame"),
  v.literal("file"),
);

const sourcePlatform = v.union(
  v.literal("x"),
  v.literal("pinterest"),
  v.literal("pixiv"),
  v.literal("discord"),
  v.literal("manual"),
  v.literal("generic"),
);

const storedAsset = v.object({
  storageProvider: v.union(
    v.literal("google_drive"),
    v.literal("convex"),
    v.literal("linked"),
  ),
  storageId: v.optional(v.id("_storage")),
  mimeType: v.optional(v.string()),
  fileSize: v.optional(v.number()),
  driveFileId: v.optional(v.string()),
  driveFolderId: v.optional(v.string()),
  driveWebViewLink: v.optional(v.string()),
  driveWebContentLink: v.optional(v.string()),
  driveThumbnailLink: v.optional(v.string()),
  driveMimeType: v.optional(v.string()),
});

export const listReferences = internalQuery({
  args: {},
  handler: async (ctx) => {
    const references = await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .order("desc")
      .take(120);

    const visibleReferences = references.filter((reference) => !reference.deleted);

    return await Promise.all(
      visibleReferences.map(async (reference) => {
        const assets = await ctx.db
          .query("assets")
          .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
          .take(20);

        const assetsWithStorageUrls = await Promise.all(
          assets.map(async (asset) => ({
            ...asset,
            storedUrl: asset.originalStorageId
              ? await ctx.storage.getUrl(asset.originalStorageId)
              : null,
          })),
        );

        return { ...reference, assets: assetsWithStorageUrls };
      }),
    );
  },
});

export const findDuplicate = internalQuery({
  args: {
    sourceUrl: v.string(),
    assetUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await findDuplicateReference(ctx.db, args);
  },
});

export const createCapture = internalMutation({
  args: {
    kind: referenceKind,
    sourceUrl: v.string(),
    assetUrl: v.optional(v.string()),
    pageTitle: v.optional(v.string()),
    selectedText: v.optional(v.string()),
    capturedAt: v.number(),
    platform: sourcePlatform,
    jsonMetadata: v.string(),
    storedAsset: v.optional(storedAsset),
  },
  handler: async (ctx, args) => {
    const duplicate = await findDuplicateReference(ctx.db, {
      sourceUrl: args.sourceUrl,
      assetUrl: args.assetUrl,
    });

    if (duplicate) {
      return { ...duplicate, alreadySaved: true };
    }

    if (args.assetUrl && !args.storedAsset) {
      throw new Error("Stored asset metadata is required when assetUrl is present");
    }

    const referenceId = await ctx.db.insert("references", {
      kind: args.kind,
      ...(args.pageTitle ? { title: args.pageTitle } : {}),
      sourceUrl: args.sourceUrl,
      captureKey: captureKeyFor(args.sourceUrl, args.assetUrl),
      platform: args.platform,
      capturedAt: args.capturedAt,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });

    let assetId = null;

    if (args.assetUrl && args.storedAsset) {
      assetId = await ctx.db.insert("assets", {
        referenceId,
        storageProvider: args.storedAsset.storageProvider,
        originalUrl: args.assetUrl,
        ...(args.storedAsset.storageId
          ? { originalStorageId: args.storedAsset.storageId }
          : {}),
        ...(args.storedAsset.mimeType ? { mimeType: args.storedAsset.mimeType } : {}),
        ...(args.storedAsset.fileSize ? { fileSize: args.storedAsset.fileSize } : {}),
        ...(args.storedAsset.driveFileId
          ? { driveFileId: args.storedAsset.driveFileId }
          : {}),
        ...(args.storedAsset.driveFolderId
          ? { driveFolderId: args.storedAsset.driveFolderId }
          : {}),
        ...(args.storedAsset.driveWebViewLink
          ? { driveWebViewLink: args.storedAsset.driveWebViewLink }
          : {}),
        ...(args.storedAsset.driveWebContentLink
          ? { driveWebContentLink: args.storedAsset.driveWebContentLink }
          : {}),
        ...(args.storedAsset.driveThumbnailLink
          ? { driveThumbnailLink: args.storedAsset.driveThumbnailLink }
          : {}),
        ...(args.storedAsset.driveMimeType
          ? { driveMimeType: args.storedAsset.driveMimeType }
          : {}),
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

    return { referenceId, assetId, alreadySaved: false };
  },
});

export const updateReference = internalMutation({
  args: {
    referenceId: v.string(),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    favorite: v.optional(v.boolean()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const referenceId = ctx.db.normalizeId("references", args.referenceId);
    if (!referenceId || !(await ctx.db.get(referenceId))) return false;

    await ctx.db.patch("references", referenceId, {
      ...(typeof args.title === "string" ? { title: args.title.trim() } : {}),
      ...(typeof args.notes === "string" ? { notes: args.notes.trim() } : {}),
      ...(typeof args.favorite === "boolean" ? { favorite: args.favorite } : {}),
      ...(typeof args.archived === "boolean" ? { archived: args.archived } : {}),
    });

    return true;
  },
});

export const softDeleteReference = internalMutation({
  args: { referenceId: v.string() },
  handler: async (ctx, args) => {
    const referenceId = ctx.db.normalizeId("references", args.referenceId);
    if (!referenceId || !(await ctx.db.get(referenceId))) return false;

    await ctx.db.patch("references", referenceId, {
      deleted: true,
      archived: true,
    });

    return true;
  },
});

async function findDuplicateReference(
  db: DatabaseReader,
  args: { sourceUrl: string; assetUrl?: string },
) {
  const captureKey = captureKeyFor(args.sourceUrl, args.assetUrl);
  const keyedReferences = await db
    .query("references")
    .withIndex("by_capture_key", (q) => q.eq("captureKey", captureKey))
    .take(1);

  const keyedReference = keyedReferences[0];
  if (keyedReference && !keyedReference.deleted) {
    const assets = await db
      .query("assets")
      .withIndex("by_reference", (q) => q.eq("referenceId", keyedReference._id))
      .take(1);

    return { referenceId: keyedReference._id, assetId: assets[0]?._id ?? null };
  }

  // Older records predate captureKey. Preserve duplicate protection for those
  // records while new saves use the indexed key above.
  const references = await db
    .query("references")
    .withIndex("by_source_url", (q) => q.eq("sourceUrl", args.sourceUrl))
    .order("desc")
    .take(20);

  for (const reference of references) {
    if (reference.deleted) continue;

    const assets = await db
      .query("assets")
      .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
      .take(20);

    if (args.assetUrl) {
      const matchingAsset = assets.find((asset) => asset.originalUrl === args.assetUrl);
      if (matchingAsset) {
        return { referenceId: reference._id, assetId: matchingAsset._id };
      }
    } else if (assets.length === 0) {
      return { referenceId: reference._id, assetId: null };
    }
  }

  return null;
}

function captureKeyFor(sourceUrl: string, assetUrl: string | undefined) {
  return JSON.stringify([sourceUrl, assetUrl ?? null]);
}
