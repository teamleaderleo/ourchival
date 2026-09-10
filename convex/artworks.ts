import { paginationOptsValidator } from "convex/server";
import { refreshDiscoveryReference } from "./lib/discoveryIndex";
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  artworkRepresentationKind,
  artworkSourceApplication,
  artworkStatus,
  artworkStorageProvider,
} from "./lib/artworkSchema";
import { requireOwnerAccess } from "./lib/privateAccess";

const maxPageSize = 100;
const maxRelatedRows = 100;

export const list = query({
  args: {
    accessKey: v.string(),
    status: v.optional(artworkStatus),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (args.paginationOpts.numItems > maxPageSize) {
      throw new Error(`Request at most ${maxPageSize} artworks per page.`);
    }

    if (args.status) {
      return await ctx.db
        .query("artworks")
        .withIndex("by_status_and_updated_at", (q) => q.eq("status", args.status!))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("artworks")
      .withIndex("by_updated_at")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const get = query({
  args: {
    accessKey: v.string(),
    artworkId: v.id("artworks"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const artwork = await ctx.db.get(args.artworkId);
    if (!artwork) return null;

    const [representationRows, publicationRows] = await Promise.all([
      ctx.db
        .query("artworkRepresentations")
        .withIndex("by_artwork_id", (q) => q.eq("artworkId", args.artworkId))
        .order("desc")
        .take(maxRelatedRows + 1),
      ctx.db
        .query("artworkPublications")
        .withIndex("by_artwork_id", (q) => q.eq("artworkId", args.artworkId))
        .order("desc")
        .take(maxRelatedRows + 1),
    ]);

    const publications = await Promise.all(
      publicationRows.slice(0, maxRelatedRows).map(async (publication) => {
        const reference = await ctx.db.get(publication.referenceId);
        return {
          ...publication,
          reference: reference
            ? {
                id: reference._id,
                title: reference.title ?? null,
                sourceUrl: reference.sourceUrl,
                canonicalUrl: reference.canonicalUrl ?? null,
                platform: reference.platform,
                postId: reference.postId ?? null,
                publishedAt: reference.publishedAt ?? null,
                deleted: reference.deleted,
              }
            : null,
        };
      }),
    );

    return {
      artwork,
      representations: representationRows.slice(0, maxRelatedRows),
      publications,
      representationsTruncated: representationRows.length > maxRelatedRows,
      publicationsTruncated: publicationRows.length > maxRelatedRows,
    };
  },
});

export const create = mutation({
  args: {
    accessKey: v.string(),
    title: v.string(),
    notes: v.optional(v.string()),
    status: v.optional(artworkStatus),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const title = cleanRequired(args.title, 160, "Artwork title is required.");
    assertDateOrder(args.startedAt, args.completedAt);
    const now = Date.now();
    const artworkId = await ctx.db.insert("artworks", {
      title,
      ...(cleanOptional(args.notes, 4000)
        ? { notes: cleanOptional(args.notes, 4000) }
        : {}),
      status: args.status ?? "wip",
      ...(args.startedAt !== undefined ? { startedAt: args.startedAt } : {}),
      ...(args.completedAt !== undefined ? { completedAt: args.completedAt } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(artworkId);
  },
});

export const update = mutation({
  args: {
    accessKey: v.string(),
    artworkId: v.id("artworks"),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(artworkStatus),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const artwork = await ctx.db.get(args.artworkId);
    if (!artwork) throw new Error("Artwork not found.");

    const startedAt = args.startedAt ?? artwork.startedAt;
    const completedAt = args.completedAt ?? artwork.completedAt;
    assertDateOrder(startedAt, completedAt);

    await ctx.db.patch(args.artworkId, {
      ...(args.title !== undefined
        ? { title: cleanRequired(args.title, 160, "Artwork title is required.") }
        : {}),
      ...(args.notes !== undefined ? { notes: cleanOptional(args.notes, 4000) } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.startedAt !== undefined ? { startedAt: args.startedAt } : {}),
      ...(args.completedAt !== undefined ? { completedAt: args.completedAt } : {}),
      updatedAt: Date.now(),
    });
    return await ctx.db.get(args.artworkId);
  },
});

export const addRepresentation = mutation({
  args: {
    accessKey: v.string(),
    artworkId: v.id("artworks"),
    kind: artworkRepresentationKind,
    storageProvider: artworkStorageProvider,
    storageId: v.optional(v.id("_storage")),
    driveFileId: v.optional(v.string()),
    linkedUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    sourceApplication: v.optional(artworkSourceApplication),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (!(await ctx.db.get(args.artworkId))) throw new Error("Artwork not found.");
    validateRepresentationLocator(args);
    validateDimensions(args.width, args.height);
    validateFileSize(args.fileSize);

    const existing = await findRepresentationByLocator(ctx, args);
    if (existing) {
      if (existing.artworkId !== args.artworkId) {
        throw new Error("This file representation is already linked to another artwork.");
      }
      if (existing.kind !== args.kind) {
        throw new Error("This file is already linked with a different representation kind.");
      }
      return existing;
    }

    const now = Date.now();
    const representationId = await ctx.db.insert("artworkRepresentations", {
      artworkId: args.artworkId,
      kind: args.kind,
      storageProvider: args.storageProvider,
      ...(args.storageId ? { storageId: args.storageId } : {}),
      ...(cleanOptional(args.driveFileId, 512)
        ? { driveFileId: cleanOptional(args.driveFileId, 512) }
        : {}),
      ...(cleanUrl(args.linkedUrl) ? { linkedUrl: cleanUrl(args.linkedUrl) } : {}),
      ...(cleanOptional(args.fileName, 255)
        ? { fileName: cleanOptional(args.fileName, 255) }
        : {}),
      ...(cleanOptional(args.mimeType, 160)
        ? { mimeType: cleanOptional(args.mimeType, 160) }
        : {}),
      ...(args.fileSize !== undefined ? { fileSize: args.fileSize } : {}),
      ...(cleanOptional(args.contentHash, 160)
        ? { contentHash: cleanOptional(args.contentHash, 160) }
        : {}),
      ...(args.width !== undefined ? { width: args.width } : {}),
      ...(args.height !== undefined ? { height: args.height } : {}),
      ...(args.sourceApplication ? { sourceApplication: args.sourceApplication } : {}),
      createdAt: now,
      updatedAt: now,
    });
    await touchArtwork(ctx, args.artworkId, now);
    return await ctx.db.get(representationId);
  },
});

export const updateRepresentation = mutation({
  args: {
    accessKey: v.string(),
    representationId: v.id("artworkRepresentations"),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    sourceApplication: v.optional(artworkSourceApplication),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const representation = await ctx.db.get(args.representationId);
    if (!representation) throw new Error("Artwork representation not found.");
    validateDimensions(args.width, args.height);
    validateFileSize(args.fileSize);
    const now = Date.now();
    await ctx.db.patch(args.representationId, {
      ...(args.fileName !== undefined
        ? { fileName: cleanOptional(args.fileName, 255) }
        : {}),
      ...(args.mimeType !== undefined
        ? { mimeType: cleanOptional(args.mimeType, 160) }
        : {}),
      ...(args.fileSize !== undefined ? { fileSize: args.fileSize } : {}),
      ...(args.contentHash !== undefined
        ? { contentHash: cleanOptional(args.contentHash, 160) }
        : {}),
      ...(args.width !== undefined ? { width: args.width } : {}),
      ...(args.height !== undefined ? { height: args.height } : {}),
      ...(args.sourceApplication !== undefined
        ? { sourceApplication: args.sourceApplication }
        : {}),
      updatedAt: now,
    });
    await touchArtwork(ctx, representation.artworkId, now);
    return await ctx.db.get(args.representationId);
  },
});

export const removeRepresentation = mutation({
  args: {
    accessKey: v.string(),
    representationId: v.id("artworkRepresentations"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const representation = await ctx.db.get(args.representationId);
    if (!representation) return { removed: false };
    await ctx.db.delete(args.representationId);
    await touchArtwork(ctx, representation.artworkId, Date.now());
    return { removed: true };
  },
});

export const linkPublication = mutation({
  args: {
    accessKey: v.string(),
    artworkId: v.id("artworks"),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const [artwork, reference] = await Promise.all([
      ctx.db.get(args.artworkId),
      ctx.db.get(args.referenceId),
    ]);
    if (!artwork) throw new Error("Artwork not found.");
    if (!reference) throw new Error("Reference not found.");

    const existing = await ctx.db
      .query("artworkPublications")
      .withIndex("by_artwork_id_and_reference_id", (q) =>
        q.eq("artworkId", args.artworkId).eq("referenceId", args.referenceId),
      )
      .unique();
    if (existing) return existing;

    const now = Date.now();
    const publicationId = await ctx.db.insert("artworkPublications", {
      artworkId: args.artworkId,
      referenceId: args.referenceId,
      createdAt: now,
      updatedAt: now,
    });
    await touchArtwork(ctx, args.artworkId, now);
    await refreshDiscoveryReference(ctx, args.referenceId);
    return await ctx.db.get(publicationId);
  },
});

export const unlinkPublication = mutation({
  args: {
    accessKey: v.string(),
    artworkId: v.id("artworks"),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const existing = await ctx.db
      .query("artworkPublications")
      .withIndex("by_artwork_id_and_reference_id", (q) =>
        q.eq("artworkId", args.artworkId).eq("referenceId", args.referenceId),
      )
      .unique();
    if (!existing) return { removed: false };
    await ctx.db.delete(existing._id);
    await refreshDiscoveryReference(ctx, args.referenceId);
    if (await ctx.db.get(args.artworkId)) {
      await touchArtwork(ctx, args.artworkId, Date.now());
    }
    return { removed: true };
  },
});

export const listForReference = query({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const rows = await ctx.db
      .query("artworkPublications")
      .withIndex("by_reference_id", (q) => q.eq("referenceId", args.referenceId))
      .order("desc")
      .take(maxRelatedRows + 1);
    const page = await Promise.all(
      rows.slice(0, maxRelatedRows).map(async (row) => ({
        ...row,
        artwork: await ctx.db.get(row.artworkId),
      })),
    );
    return { page, truncated: rows.length > maxRelatedRows };
  },
});

async function findRepresentationByLocator(
  ctx: MutationCtx,
  args: {
    artworkId: Id<"artworks">;
    storageProvider: "google_drive" | "convex" | "linked";
    driveFileId?: string;
    linkedUrl?: string;
  },
) {
  if (args.storageProvider === "google_drive") {
    const driveFileId = cleanOptional(args.driveFileId, 512)!;
    return await ctx.db
      .query("artworkRepresentations")
      .withIndex("by_drive_file_id", (q) => q.eq("driveFileId", driveFileId))
      .unique();
  }
  if (args.storageProvider === "linked") {
    const linkedUrl = cleanUrl(args.linkedUrl)!;
    return await ctx.db
      .query("artworkRepresentations")
      .withIndex("by_linked_url", (q) => q.eq("linkedUrl", linkedUrl))
      .unique();
  }
  return null;
}

function validateRepresentationLocator(args: {
  storageProvider: "google_drive" | "convex" | "linked";
  storageId?: Id<"_storage">;
  driveFileId?: string;
  linkedUrl?: string;
}) {
  if (args.storageProvider === "google_drive") {
    if (!cleanOptional(args.driveFileId, 512)) {
      throw new Error("Google Drive representations require a Drive file ID.");
    }
    return;
  }
  if (args.storageProvider === "convex") {
    if (!args.storageId) {
      throw new Error("Convex representations require a storage ID.");
    }
    return;
  }
  if (!cleanUrl(args.linkedUrl)) {
    throw new Error("Linked representations require an absolute http(s) URL.");
  }
}

async function touchArtwork(ctx: MutationCtx, artworkId: Id<"artworks">, now: number) {
  await ctx.db.patch(artworkId, { updatedAt: now });
}

function cleanRequired(value: string, maxLength: number, error: string) {
  const cleaned = cleanOptional(value, maxLength);
  if (!cleaned) throw new Error(error);
  return cleaned;
}

function cleanOptional(value: string | undefined, maxLength: number) {
  const cleaned = value?.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return cleaned || undefined;
}

function cleanUrl(value: string | undefined) {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function validateDimensions(width: number | undefined, height: number | undefined) {
  for (const [label, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new Error(`Representation ${label} must be a positive number.`);
    }
  }
}

function validateFileSize(fileSize: number | undefined) {
  if (fileSize !== undefined && (!Number.isFinite(fileSize) || fileSize < 0)) {
    throw new Error("Representation file size must be a non-negative number.");
  }
}

function assertDateOrder(startedAt: number | undefined, completedAt: number | undefined) {
  if (startedAt !== undefined && !Number.isFinite(startedAt)) {
    throw new Error("Artwork start time must be finite.");
  }
  if (completedAt !== undefined && !Number.isFinite(completedAt)) {
    throw new Error("Artwork completion time must be finite.");
  }
  if (startedAt !== undefined && completedAt !== undefined && completedAt < startedAt) {
    throw new Error("Artwork completion time cannot precede its start time.");
  }
}
