import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  references: defineTable({
    kind: v.union(
      v.literal("image"),
      v.literal("post"),
      v.literal("page"),
      v.literal("link"),
      v.literal("article"),
      v.literal("video_frame"),
      v.literal("file"),
    ),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    sourceUrl: v.string(),
    canonicalUrl: v.optional(v.string()),
    platform: v.union(
      v.literal("x"),
      v.literal("pinterest"),
      v.literal("pixiv"),
      v.literal("discord"),
      v.literal("manual"),
      v.literal("generic"),
    ),
    authorName: v.optional(v.string()),
    authorHandle: v.optional(v.string()),
    authorUrl: v.optional(v.string()),
    postId: v.optional(v.string()),
    capturedAt: v.number(),
    publishedAt: v.optional(v.number()),
    boardIds: v.array(v.id("boards")),
    tagIds: v.array(v.id("tags")),
    favorite: v.boolean(),
    archived: v.boolean(),
    deleted: v.boolean(),
  })
    .index("by_source_url", ["sourceUrl"])
    .index("by_canonical_url", ["canonicalUrl"])
    .index("by_captured_at", ["capturedAt"])
    .searchIndex("search_references", {
      searchField: "title",
      filterFields: ["platform", "favorite", "archived", "deleted"],
    }),

  assets: defineTable({
    referenceId: v.id("references"),
    storageProvider: v.optional(
      v.union(
        v.literal("google_drive"),
        v.literal("convex"),
        v.literal("linked"),
      ),
    ),
    originalStorageId: v.optional(v.id("_storage")),
    previewStorageId: v.optional(v.id("_storage")),
    thumbStorageId: v.optional(v.id("_storage")),
    originalUrl: v.optional(v.string()),
    driveFileId: v.optional(v.string()),
    driveFolderId: v.optional(v.string()),
    driveWebViewLink: v.optional(v.string()),
    driveWebContentLink: v.optional(v.string()),
    driveThumbnailLink: v.optional(v.string()),
    driveMimeType: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    originalFileName: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    fileSize: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    perceptualHash: v.optional(v.string()),
    dominantColors: v.array(v.string()),
  })
    .index("by_reference", ["referenceId"])
    .index("by_original_url", ["originalUrl"])
    .index("by_drive_file_id", ["driveFileId"]),

  boards: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("finished"),
      v.literal("archived"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_name", ["name"]),

  projectReferences: defineTable({
    projectId: v.id("projects"),
    referenceId: v.id("references"),
    assetId: v.optional(v.id("assets")),
    reason: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_reference", ["referenceId"]),

  exports: defineTable({
    referenceId: v.id("references"),
    assetId: v.optional(v.id("assets")),
    target: v.union(
      v.literal("download"),
      v.literal("clip_studio_paint"),
      v.literal("procreate"),
      v.literal("google_photos"),
      v.literal("other"),
    ),
    createdAt: v.number(),
  }).index("by_reference", ["referenceId"]),

  tags: defineTable({
    name: v.string(),
    slug: v.string(),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  sourceSnapshots: defineTable({
    referenceId: v.id("references"),
    pageTitle: v.optional(v.string()),
    postText: v.optional(v.string()),
    altText: v.optional(v.string()),
    selectedText: v.optional(v.string()),
    jsonMetadata: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_reference", ["referenceId"]),
});
