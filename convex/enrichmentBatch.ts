import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";

export const enqueueSourceMetadataMany = mutation({
  args: {
    accessKey: v.string(),
    referenceIds: v.array(v.id("references")),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const referenceIds = Array.from(new Set(args.referenceIds)).slice(0, 96);
    let queued = 0;
    let existing = 0;
    let skipped = 0;

    for (const referenceId of referenceIds) {
      const reference = await ctx.db.get(referenceId);
      if (!reference || !isLinkKind(reference.kind) || reference.deleted) {
        skipped += 1;
        continue;
      }

      const active = (
        await ctx.db
          .query("enrichmentJobs")
          .withIndex("by_reference_type", (q) =>
            q.eq("referenceId", referenceId).eq("type", "source_metadata"),
          )
          .collect()
      ).find((job) => job.status === "queued" || job.status === "running");
      if (active) {
        existing += 1;
        continue;
      }

      const now = Date.now();
      const jobId = await ctx.db.insert("enrichmentJobs", {
        referenceId,
        type: "source_metadata",
        status: "queued",
        attempts: 0,
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.enrichmentJobs.processSourceMetadata,
        { jobId },
      );
      queued += 1;
    }

    return { queued, existing, skipped };
  },
});

export function isLinkKind(kind: string) {
  return kind === "link" || kind === "page" || kind === "article";
}
