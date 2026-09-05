import { defineTable } from "convex/server";
import { v } from "convex/values";

export const visualTag = v.object({
  name: v.string(),
  category: v.union(v.literal("general"), v.literal("character")),
  confidence: v.number(),
});
export const visualModel = v.object({
  id: v.string(),
  revision: v.string(),
  sha256: v.string(),
  task: v.string(),
});
export const searchTables = {
  referenceSearchDocuments: defineTable({
    referenceId: v.id("references"),
    text: v.string(),
    fields: v.array(
      v.object({
        field: v.string(),
        label: v.string(),
        value: v.string(),
        origin: v.union(
          v.literal("source"),
          v.literal("catalog"),
          v.literal("owner"),
          v.literal("machine"),
        ),
      }),
    ),
    collection: v.string(),
    lane: v.string(),
    favorite: v.boolean(),
    kind: v.string(),
    indexedAt: v.number(),
    truncated: v.boolean(),
  })
    .index("by_reference_id", ["referenceId"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["collection", "lane", "favorite", "kind"],
    }),
  referenceSearchState: defineTable({
    key: v.string(),
    generation: v.number(),
    ready: v.boolean(),
    rebuilding: v.boolean(),
    dirty: v.boolean(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  visualEnrichments: defineTable({
    assetId: v.id("assets"),
    referenceId: v.id("references"),
    inputStorageId: v.id("_storage"),
    inputSha256: v.string(),
    originalContentHash: v.optional(v.string()),
    pipelineFingerprint: v.string(),
    models: v.array(visualModel),
    tags: v.array(visualTag),
    ratings: v.array(v.object({ label: v.string(), confidence: v.number() })),
    ocrText: v.optional(v.string()),
    caption: v.optional(v.string()),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_asset_id", ["assetId"])
    .index("by_reference_id", ["referenceId"]),
  visualCorrections: defineTable({
    assetId: v.id("assets"),
    rejectedTags: v.array(v.string()),
    hideOcr: v.boolean(),
    hideCaption: v.boolean(),
    updatedAt: v.number(),
  }).index("by_asset_id", ["assetId"]),
};
