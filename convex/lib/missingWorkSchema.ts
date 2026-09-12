import { defineTable } from "convex/server";
import { v } from "convex/values";
export const researchOutcome = v.union(
  v.literal("lead"),
  v.literal("no_match"),
  v.literal("confirmed_identity"),
  v.literal("ruled_out"),
);
export const missingWorkTables = {
  missingWorkChecks: defineTable({
    referenceId: v.id("references"),
    url: v.string(),
    outcome: researchOutcome,
    evidence: v.string(),
    relationship: v.optional(v.union(v.literal("same_artist"), v.literal("possible_same_image"), v.literal("archived_page"))),
    createdAt: v.number(),
  }).index("by_reference", ["referenceId"]),
};
