import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";
import { decodeTags, encodeTags } from "./lib/tagCodec";

const key = "compact-tag-payload-v2";

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

/** This changes payload bytes only. Search text, scores, corrections, model and
 * input identities retain exactly the same values, so no reindex is needed. */
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
      phase: "results" as const,
      cursor: previous?.cursor ?? null,
      processed: previous?.processed ?? 0,
      changed: previous?.changed ?? 0,
      skipped: previous?.skipped ?? 0,
      beforeBytes: previous?.beforeBytes ?? 0,
      afterBytes: previous?.afterBytes ?? 0,
      updatedAt: Date.now(),
    };
    if (previous) await ctx.db.patch(previous._id, state);
    else await ctx.db.insert("metadataMigration", state);
    await ctx.scheduler.runAfter(0, internal.tagPayloadMigration.page, {
      generation: state.generation,
      cursor: state.cursor,
    });
    return state;
  },
});

export const page = internalMutation({
  args: { generation: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("metadataMigration")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (
      !state ||
      state.phase !== "results" ||
      state.generation !== args.generation ||
      state.cursor !== args.cursor
    )
      return;
    const batch = await ctx.db
      .query("visualEnrichments")
      .paginate({ numItems: 16, cursor: args.cursor });
    let changed = 0,
      skipped = 0,
      beforeBytes = 0,
      afterBytes = 0;
    for (const row of batch.page) {
      if (!row.tagPayload) {
        skipped++;
        continue;
      }
      const before = decodeTags(row.tagPayload);
      const packed = encodeTags(before);
      const after = decodeTags(packed);
      if (
        before.length !== after.length ||
        before.some(
          ([code, score], i) =>
            code !== after[i][0] || !Object.is(score, after[i][1]),
        )
      )
        throw new Error("Tag payload reconstruction failed");
      beforeBytes += row.tagPayload.byteLength;
      if (packed.byteLength < row.tagPayload.byteLength) {
        await ctx.db.patch(row._id, { tagPayload: packed });
        afterBytes += packed.byteLength;
        changed++;
      } else afterBytes += row.tagPayload.byteLength;
    }
    const cursor = batch.isDone ? null : batch.continueCursor;
    await ctx.db.patch(state._id, {
      phase: batch.isDone ? "complete" : "results",
      cursor,
      processed: state.processed + batch.page.length,
      changed: (state.changed ?? 0) + changed,
      skipped: (state.skipped ?? 0) + skipped,
      beforeBytes: (state.beforeBytes ?? 0) + beforeBytes,
      afterBytes: (state.afterBytes ?? 0) + afterBytes,
      updatedAt: Date.now(),
    });
    if (!batch.isDone)
      await ctx.scheduler.runAfter(50, internal.tagPayloadMigration.page, {
        generation: args.generation,
        cursor,
      });
  },
});
