import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";
import { allocateTagCode } from "./lib/tagIdentity";
import { compactVisual, expandVisual } from "./lib/compactVisual";

const key = "compact-visual-v1";
export const status = query({
  args: { accessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await ctx.db
      .query("metadataMigration")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
  },
});

/** Resume the committed cursor. A fresh generation fences any older scheduled invocation. */
export const start = mutation({
  args: { accessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const previous = await ctx.db
      .query("metadataMigration")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (previous?.phase === "complete") return previous;
    const state = {
      key,
      generation: (previous?.generation ?? 0) + 1,
      phase: previous?.phase ?? ("tags" as const),
      cursor: previous?.cursor ?? null,
      processed: previous?.processed ?? 0,
      updatedAt: Date.now(),
    };
    if (previous) await ctx.db.patch(previous._id, state);
    else await ctx.db.insert("metadataMigration", state);
    await ctx.scheduler.runAfter(0, internal.metadataMigration.page, {
      generation: state.generation,
      cursor: state.cursor,
      phase: state.phase,
    });
    return state;
  },
});

export const page = internalMutation({
  args: {
    generation: v.number(),
    cursor: v.union(v.string(), v.null()),
    phase: v.union(v.literal("tags"), v.literal("results")),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("metadataMigration")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (
      !state ||
      state.generation !== args.generation ||
      state.phase !== args.phase ||
      state.cursor !== args.cursor
    )
      return;
    let nextCursor: string | null,
      phase: "tags" | "results" | "complete" = args.phase,
      processed = 0;
    if (args.phase === "tags") {
      const batch = await ctx.db
        .query("tags")
        .paginate({ numItems: 32, cursor: args.cursor });
      for (const tag of batch.page) {
        if (tag.code === undefined)
          await ctx.db.patch(tag._id, { code: await allocateTagCode(ctx) });
        processed++;
      }
      nextCursor = batch.isDone ? null : batch.continueCursor;
      if (batch.isDone) phase = "results";
    } else {
      const batch = await ctx.db
        .query("visualEnrichments")
        .paginate({ numItems: 2, cursor: args.cursor });
      for (const row of batch.page) {
        if (row.tagPayload === undefined || !row.recipeId) {
          const before = await expandVisual(ctx, row);
          const packed = await compactVisual(
            ctx,
            before.tags,
            before.models,
            row.pipelineFingerprint,
          );
          const after = await expandVisual(ctx, { ...row, ...packed });
          const signature = (value: typeof before) =>
            JSON.stringify([
              value.tags.map((t) => [t.name, t.category, t.confidence]),
              value.models.map((m) => [m.id, m.revision, m.sha256, m.task]),
            ]);
          if (signature(before) !== signature(after))
            throw new Error("Metadata migration verification failed");
          // Only remove repeated fields after exact reconstruction succeeds in this transaction.
          await ctx.db.patch(row._id, {
            ...packed,
            tags: undefined,
            models: undefined,
          });
        }
        processed++;
      }
      nextCursor = batch.isDone ? null : batch.continueCursor;
      if (batch.isDone) phase = "complete";
    }
    await ctx.db.patch(state._id, {
      phase,
      cursor: nextCursor,
      processed: state.processed + processed,
      updatedAt: Date.now(),
    });
    if (phase !== "complete")
      await ctx.scheduler.runAfter(0, internal.metadataMigration.page, {
        generation: args.generation,
        cursor: nextCursor,
        phase,
      });
  },
});
