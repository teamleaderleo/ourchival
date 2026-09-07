import { defineTable } from "convex/server";
import { v } from "convex/values";

export const artworkStatus = v.union(
  v.literal("wip"),
  v.literal("finished"),
  v.literal("abandoned"),
  v.literal("study"),
);

export const artworkRepresentationKind = v.union(
  v.literal("editable_source"),
  v.literal("master_export"),
  v.literal("web_derivative"),
);

export const artworkStorageProvider = v.union(
  v.literal("google_drive"),
  v.literal("convex"),
  v.literal("linked"),
);

export const artworkSourceApplication = v.union(
  v.literal("procreate"),
  v.literal("clip_studio_paint"),
  v.literal("blender"),
  v.literal("photoshop"),
  v.literal("other"),
);

export const artworkTables = {
  artworks: defineTable({
    title: v.string(),
    notes: v.optional(v.string()),
    status: artworkStatus,
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_and_updated_at", ["status", "updatedAt"])
    .index("by_updated_at", ["updatedAt"]),

  artworkRepresentations: defineTable({
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_artwork_id", ["artworkId"])
    .index("by_drive_file_id", ["driveFileId"])
    .index("by_linked_url", ["linkedUrl"])
    .index("by_content_hash", ["contentHash"]),

  artworkPublications: defineTable({
    artworkId: v.id("artworks"),
    referenceId: v.id("references"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_artwork_id", ["artworkId"])
    .index("by_reference_id", ["referenceId"])
    .index("by_artwork_id_and_reference_id", ["artworkId", "referenceId"]),
};
