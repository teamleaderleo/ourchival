import { defineTable } from "convex/server";
import { v } from "convex/values";

export const communityCategory = v.union(
  v.literal("general"),
  v.literal("artist"),
  v.literal("character"),
  v.literal("copyright"),
  v.literal("meta"),
);
export const communityTag = v.object({
  name: v.string(),
  category: communityCategory,
});
export const communityTables = {
  communityCorrections: defineTable({
    assetId: v.id("assets"),
    hiddenTagPayload: v.bytes(),
    revision: v.number(),
  }).index("by_asset_id", ["assetId"]),
  communityTerms: defineTable({
    name: v.string(),
    category: communityCategory,
    code: v.number(),
  })
    .index("by_category_and_name", ["category", "name"])
    .index("by_code", ["code"]),
  communityPosts: defineTable({
    provider: v.literal("danbooru"),
    postId: v.number(),
    fingerprint: v.string(),
    md5: v.string(),
    sourceUpdatedAt: v.number(),
    sourceUrl: v.optional(v.string()),
    pixivId: v.optional(v.string()),
    tagPayload: v.bytes(),
  }).index("by_fingerprint", ["fingerprint"]),
  communityMatches: defineTable({
    assetId: v.id("assets"),
    referenceId: v.id("references"),
    postId: v.number(),
    postSnapshotId: v.id("communityPosts"),
    inputStorageId: v.optional(v.id("_storage")),
    inputDriveFileId: v.optional(v.string()),
    inputSha256: v.string(),
    originalContentHash: v.union(v.string(), v.null()),
    evidence: v.literal("exact_md5"),
    retrievedAt: v.number(),
  })
    .index("by_asset_id_and_post_id", ["assetId", "postId"])
    .index("by_reference_id", ["referenceId"]),
};
