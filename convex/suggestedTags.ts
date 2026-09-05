import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";
import { getTagsByIds, slugifyTagName, updateReferenceTags } from "./lib/tags";
import {
  deriveSuggestedTags,
  type SuggestedTagCandidate,
} from "./lib/suggestedTags";

export const listForReference = query({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await ctx.db
      .query("enrichmentSuggestions")
      .withIndex("by_reference", (q) => q.eq("referenceId", args.referenceId))
      .order("desc")
      .collect();
  },
});

export const enqueue = mutation({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const reference = await ctx.db.get(args.referenceId);
    if (!reference || reference.deleted) throw new Error("Reference not found.");
    const result = await enqueueOne(ctx, args.referenceId);
    return result.job;
  },
});

export const enqueueMany = mutation({
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
      if (!reference || reference.deleted) {
        skipped += 1;
        continue;
      }
      const result = await enqueueOne(ctx, referenceId);
      if (result.created) queued += 1;
      else existing += 1;
    }

    return { queued, existing, skipped };
  },
});

export const accept = mutation({
  args: {
    accessKey: v.string(),
    suggestionId: v.id("enrichmentSuggestions"),
    value: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) throw new Error("Suggestion not found.");
    const value = cleanSuggestionValue(args.value ?? suggestion.value);
    if (!value) throw new Error("Tag name is required.");

    const tags = await updateReferenceTags(ctx, suggestion.referenceId, {
      addNames: [value],
      removeIds: [],
    });
    await ctx.db.patch(suggestion._id, {
      value,
      normalizedValue: slugifyTagName(value),
      status: "accepted",
      updatedAt: Date.now(),
    });
    return { suggestion: await ctx.db.get(suggestion._id), tags };
  },
});

export const acceptAll = mutation({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const suggestions = await ctx.db
      .query("enrichmentSuggestions")
      .withIndex("by_reference_status", (q) =>
        q.eq("referenceId", args.referenceId).eq("status", "pending"),
      )
      .collect();
    if (suggestions.length === 0) return { accepted: 0, tags: [] };

    const tags = await updateReferenceTags(ctx, args.referenceId, {
      addNames: suggestions.map((suggestion) => suggestion.value),
      removeIds: [],
    });
    const now = Date.now();
    for (const suggestion of suggestions) {
      await ctx.db.patch(suggestion._id, {
        status: "accepted",
        updatedAt: now,
      });
    }
    return { accepted: suggestions.length, tags };
  },
});

export const dismiss = mutation({
  args: {
    accessKey: v.string(),
    suggestionId: v.id("enrichmentSuggestions"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) return false;
    await ctx.db.patch(suggestion._id, {
      status: "dismissed",
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const getContext = internalQuery({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.type !== "suggested_tags") return null;
    const reference = await ctx.db.get(job.referenceId);
    if (!reference) return null;
    const [snapshot, tags] = await Promise.all([
      ctx.db
        .query("sourceSnapshots")
        .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
        .order("desc")
        .first(),
      getTagsByIds(ctx, reference.tagIds),
    ]);
    return { job, reference, snapshot, tags };
  },
});

export const complete = internalMutation({
  args: {
    jobId: v.id("enrichmentJobs"),
    candidates: v.array(
      v.object({
        value: v.string(),
        normalizedValue: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Enrichment job not found.");
    const reference = await ctx.db.get(job.referenceId);
    if (!reference) throw new Error("Reference not found.");

    const existingTags = await getTagsByIds(ctx, reference.tagIds);
    const existingSlugs = new Set(existingTags.map((tag) => tag.slug));
    const previousPending = await ctx.db
      .query("enrichmentSuggestions")
      .withIndex("by_reference_status", (q) =>
        q.eq("referenceId", reference._id).eq("status", "pending"),
      )
      .collect();
    const now = Date.now();
    for (const suggestion of previousPending) {
      await ctx.db.patch(suggestion._id, {
        status: "dismissed",
        updatedAt: now,
      });
    }

    let inserted = 0;
    const seen = new Set(existingSlugs);
    for (const candidate of args.candidates) {
      const value = cleanSuggestionValue(candidate.value);
      const normalizedValue = slugifyTagName(candidate.normalizedValue || value);
      if (!value || !normalizedValue || seen.has(normalizedValue)) continue;
      seen.add(normalizedValue);
      await ctx.db.insert("enrichmentSuggestions", {
        referenceId: reference._id,
        jobId: job._id,
        type: "tag",
        value,
        normalizedValue,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    const summary =
      inserted === 0
        ? "No new tag suggestions were found."
        : `${inserted} ${inserted === 1 ? "tag suggestion" : "tag suggestions"} ready.`;
    await ctx.db.patch(job._id, {
      status: "succeeded",
      completedAt: now,
      error: undefined,
      resultSummary: summary,
      updatedAt: now,
    });
    return { inserted, summary };
  },
});

export const process = internalAction({
  args: {
    jobId: v.id("enrichmentJobs"),
  },
  handler: async (ctx, args): Promise<{ inserted: number; summary: string } | { status: string; summary: string } | null> => {
    const context = await ctx.runQuery(internal.suggestedTags.getContext, args);
    if (!context || context.job.status !== "queued") return null;
    const claimed = await ctx.runMutation(internal.enrichmentJobs.claim, args);
    if (!claimed) return null;

    try {
      const candidates = deriveSuggestedTags({
        title: context.reference.title,
        notes: context.reference.notes,
        authorName: context.reference.authorName,
        authorHandle: context.reference.authorHandle,
        postText: context.snapshot?.postText,
        altText: context.snapshot?.altText,
        selectedText: context.snapshot?.selectedText,
        description: context.snapshot?.description,
        siteName: context.snapshot?.siteName,
        existingSlugs: context.tags.map((tag: any) => tag.slug),
      });
      return await ctx.runMutation(internal.suggestedTags.complete, {
        jobId: args.jobId,
        candidates,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tag suggestion processor failed.";
      await ctx.runMutation(internal.enrichmentJobs.fail, {
        jobId: args.jobId,
        error: message,
      });
      return { status: "failed", summary: message };
    }
  },
});

async function enqueueOne(ctx: any, referenceId: any) {
  const active = (
    await ctx.db
      .query("enrichmentJobs")
      .withIndex("by_reference_type", (q: any) =>
        q.eq("referenceId", referenceId).eq("type", "suggested_tags"),
      )
      .collect()
  ).find((job: any) => job.status === "queued" || job.status === "running");
  if (active) return { created: false, job: active };

  const now = Date.now();
  const jobId = await ctx.db.insert("enrichmentJobs", {
    referenceId,
    type: "suggested_tags",
    status: "queued",
    attempts: 0,
    requestedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.suggestedTags.process, { jobId });
  return { created: true, job: await ctx.db.get(jobId) };
}

function cleanSuggestionValue(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 48);
}
