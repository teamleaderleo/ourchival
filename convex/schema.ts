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
    captureSessionId: v.optional(v.string()),
    triageState: v.optional(
      v.union(v.literal("inbox"), v.literal("kept"), v.literal("later")),
    ),
    reviewedAt: v.optional(v.number()),
    lastOpenedAt: v.optional(v.number()),
    boardIds: v.array(v.id("boards")),
    tagIds: v.array(v.id("tags")),
    favorite: v.boolean(),
    archived: v.boolean(),
    deleted: v.boolean(),
  })
    .index("by_source_url", ["sourceUrl"])
    .index("by_canonical_url", ["canonicalUrl"])
    .index("by_capture_session", ["captureSessionId"])
    .index("by_triage_state", ["triageState"])
    .index("by_captured_at", ["capturedAt"])
    .searchIndex("search_references", {
      searchField: "title",
      filterFields: ["platform", "favorite", "triageState", "archived", "deleted"],
    }),

  referenceStats: defineTable({
    key: v.string(),
    inbox: v.number(),
    library: v.number(),
    later: v.number(),
    archive: v.number(),
    trash: v.number(),
    images: v.number(),
    links: v.number(),
    favorites: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

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

  savedSearches: defineTable({
    name: v.string(),
    query: v.string(),
    view: v.union(
      v.literal("inbox"),
      v.literal("all"),
      v.literal("images"),
      v.literal("links"),
      v.literal("favorites"),
      v.literal("later"),
      v.literal("archive"),
      v.literal("trash"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  enrichmentJobs: defineTable({
    referenceId: v.id("references"),
    type: v.union(
      v.literal("source_metadata"),
      v.literal("ocr"),
      v.literal("description"),
      v.literal("suggested_tags"),
      v.literal("dominant_colors"),
      v.literal("perceptual_hash"),
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("dismissed"),
    ),
    attempts: v.number(),
    requestedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_reference", ["referenceId"])
    .index("by_status", ["status"])
    .index("by_reference_type", ["referenceId", "type"])
    .index("by_updated_at", ["updatedAt"]),

  enrichmentSuggestions: defineTable({
    referenceId: v.id("references"),
    jobId: v.id("enrichmentJobs"),
    type: v.literal("tag"),
    value: v.string(),
    normalizedValue: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("dismissed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_reference", ["referenceId"])
    .index("by_job", ["jobId"])
    .index("by_reference_status", ["referenceId", "status"]),

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
    description: v.optional(v.string()),
    siteName: v.optional(v.string()),
    faviconUrl: v.optional(v.string()),
    previewImageUrl: v.optional(v.string()),
    pageAuthor: v.optional(v.string()),
    canonicalUrl: v.optional(v.string()),
    contentType: v.optional(v.string()),
    metadataStatus: v.optional(
      v.union(v.literal("ready"), v.literal("missing"), v.literal("failed")),
    ),
    httpStatus: v.optional(v.number()),
    metadataFetchedAt: v.optional(v.number()),
    jsonMetadata: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_reference", ["referenceId"]),
});
