import { defineTable } from "convex/server";
import { v } from "convex/values";

export const discoveryTables = {
  archiveFacets: defineTable({
    key: v.string(), kind: v.union(v.literal("artist"), v.literal("tag")),
    label: v.string(), detail: v.string(), searchText: v.string(),
    total: v.number(), visible: v.number(),
  }).index("by_key", ["key"])
    .index("by_kind_and_total", ["kind", "total"])
    .index("by_kind_and_visible", ["kind", "visible"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["kind"] }),
  archiveFacetMembers: defineTable({
    facetId: v.id("archiveFacets"), referenceId: v.id("references"),
    capturedAt: v.number(), publishedAt: v.optional(v.number()), sealed: v.boolean(),
  }).index("by_reference_id", ["referenceId"])
    .index("by_facet_id_and_captured_at", ["facetId", "capturedAt"])
    .index("by_facet_id_and_published_at", ["facetId", "publishedAt"]),
  archiveDiscoveryState: defineTable({
    key: v.string(), cursor: v.union(v.string(), v.null()), scanned: v.number(),
    ready: v.boolean(), running: v.boolean(), updatedAt: v.number(),
  }).index("by_key", ["key"]),
};
