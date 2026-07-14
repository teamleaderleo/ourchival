import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { fetchLinkMetadata } from "./lib/linkMetadata";
import { applySourceMetadata } from "./lib/sourceMetadata";

const metadataStatus = v.union(
  v.literal("ready"),
  v.literal("missing"),
  v.literal("failed"),
);

const metadataValue = v.object({
  canonicalUrl: v.optional(v.string()),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  siteName: v.optional(v.string()),
  faviconUrl: v.optional(v.string()),
  previewImageUrl: v.optional(v.string()),
  author: v.optional(v.string()),
  contentType: v.optional(v.string()),
  httpStatus: v.optional(v.number()),
  metadataStatus,
  metadataFetchedAt: v.number(),
  error: v.optional(v.string()),
});

export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 30)));
    const jobs = await ctx.db
      .query("enrichmentJobs")
      .withIndex("by_updated_at")
      .order("desc")
      .take(limit);
    return await Promise.all(
      jobs.map(async (job) => ({
        ...job,
        reference: await ctx.db.get(job.referenceId),
      })),
    );
  },
});

export const listForReference = query({
  args: {
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("enrichmentJobs")
      .withIndex("by_reference", (q) => q.eq("referenceId", args.referenceId))
      .order("desc")
      .collect();
  },
});

export const enqueueSourceMetadata = mutation({
  args: {
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    const reference = await ctx.db.get(args.referenceId);
    if (!reference) throw new Error("Reference not found.");

    const existing = (
      await ctx.db
        .query("enrichmentJobs")
        .withIndex("by_reference_type", (q) =>
          q.eq("referenceId", args.referenceId).eq("type", "source_metadata"),
        )
        .collect()
    ).find((job) => job.status === "queued" || job.status === "running");
    if (existing) return existing;

    const now = Date.now();
    const jobId = await ctx.db.insert("enrichmentJobs", {
      referenceId: args.referenceId,
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
    return await ctx.db.get(jobId);
  },
});

export const retry = mutation({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Enrichment job not found.");
    if (job.status === "queued" || job.status === "running") return job;
    if (job.type !== "source_metadata") {
      throw new Error("This processor is not available yet.");
    }

    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "queued",
      requestedAt: now,
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
      resultSummary: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.enrichmentJobs.processSourceMetadata,
      { jobId: args.jobId },
    );
    return await ctx.db.get(args.jobId);
  },
});

export const dismiss = mutation({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return false;
    if (job.status === "running") {
      throw new Error("A running job cannot be dismissed.");
    }
    await ctx.db.patch(args.jobId, {
      status: "dismissed",
      completedAt: job.completedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const getJobContext = internalQuery({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    return {
      job,
      reference: await ctx.db.get(job.referenceId),
    };
  },
});

export const claim = internalMutation({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "queued") return false;
    await ctx.db.patch(args.jobId, {
      status: "running",
      attempts: job.attempts + 1,
      startedAt: Date.now(),
      completedAt: undefined,
      error: undefined,
      resultSummary: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const completeSourceMetadata = internalMutation({
  args: {
    jobId: v.id("enrichmentJobs"),
    metadata: metadataValue,
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Enrichment job not found.");
    const reference = await ctx.db.get(job.referenceId);
    if (!reference) throw new Error("Reference not found.");

    const result = await applySourceMetadata(ctx, {
      reference,
      metadata: args.metadata,
      reason: "enrichment_job",
      jobId: job._id,
    });
    const failed = args.metadata.metadataStatus === "failed";
    await ctx.db.patch(job._id, {
      status: failed ? "failed" : "succeeded",
      completedAt: Date.now(),
      error: failed ? args.metadata.error ?? "Metadata refresh failed." : undefined,
      resultSummary: result.summary,
      updatedAt: Date.now(),
    });
    return {
      status: failed ? "failed" : "succeeded",
      summary: result.summary,
    };
  },
});

export const fail = internalMutation({
  args: {
    jobId: v.id("enrichmentJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return false;
    await ctx.db.patch(args.jobId, {
      status: "failed",
      completedAt: Date.now(),
      error: args.error.slice(0, 1000),
      resultSummary: "Processor stopped before metadata could be stored.",
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const processSourceMetadata = action({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (ctx, args) => {
    const jobContext = await ctx.runQuery(
      internal.enrichmentJobs.getJobContext,
      args,
    );
    if (!jobContext?.reference || jobContext.job.status !== "queued") return null;

    const claimed = await ctx.runMutation(internal.enrichmentJobs.claim, args);
    if (!claimed) return null;

    try {
      const metadata = await fetchLinkMetadata(jobContext.reference.sourceUrl);
      return await ctx.runMutation(
        internal.enrichmentJobs.completeSourceMetadata,
        { jobId: args.jobId, metadata },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Metadata processor failed.";
      await ctx.runMutation(internal.enrichmentJobs.fail, {
        jobId: args.jobId,
        error: message,
      });
      return { status: "failed", summary: message };
    }
  },
});
