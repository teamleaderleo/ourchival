import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { upsertPreferenceSnapshotToDrive } from "./lib/drive";
import {
  preferenceSnapshotJson,
  reviewPreferenceFromReference,
  type ReviewPreferencePayload,
} from "./lib/reviewPreferences";

const exportStateKey = "google_drive_preference_snapshot";
const exportDebounceMs = 4_000;
const pageSize = 128;
const maxRetries = 3;

const platformValidator = v.union(
  v.literal("x"),
  v.literal("pinterest"),
  v.literal("pixiv"),
  v.literal("discord"),
  v.literal("manual"),
  v.literal("generic"),
);

const projectedPreferenceValidator = v.object({
  decision: v.union(v.literal("yes"), v.literal("maybe"), v.literal("no")),
  triageState: v.union(
    v.literal("kept"),
    v.literal("later"),
    v.literal("archived"),
  ),
  reviewedAt: v.number(),
  title: v.optional(v.string()),
  sourceUrl: v.string(),
  canonicalUrl: v.optional(v.string()),
  character: v.optional(v.string()),
  authorName: v.optional(v.string()),
  authorHandle: v.optional(v.string()),
  platform: platformValidator,
  sourceKind: v.optional(v.string()),
});

const backfillItemValidator = v.object({
  referenceId: v.id("references"),
  preference: v.optional(projectedPreferenceValidator),
});

type PreferencePage = {
  page: Doc<"reviewPreferences">[];
  isDone: boolean;
  continueCursor: string;
};

type BackfillPage = {
  page: Array<{
    referenceId: Id<"references">;
    preference?: Omit<ReviewPreferencePayload, "referenceId">;
  }>;
  isDone: boolean;
  continueCursor: string;
};

export const syncReferencePreference = internalMutation({
  args: { referenceId: v.id("references") },
  handler: async (ctx, args) => {
    const reference = await ctx.db.get(args.referenceId);
    if (!reference) return null;
    const snapshot = await latestSourceSnapshot(ctx, reference._id);
    const preference = reviewPreferenceFromReference(reference, snapshot);
    const changed = await writeProjectedPreference(ctx, reference._id, preference);
    if (changed) await queuePreferenceExport(ctx, exportDebounceMs);
    return null;
  },
});

export const requestRebuild = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.preferenceExport.rebuildSnapshot, {});
    return null;
  },
});

export const ensureExportRequested = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await exportState(ctx);
    if (existing) return false;
    await ctx.db.insert("preferenceExportState", {
      key: exportStateKey,
      generation: 0,
      status: "queued",
      requestedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.preferenceExport.rebuildSnapshot, {});
    return true;
  },
});

export const rebuildSnapshot = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let isDone = false;

    while (!isDone) {
      const result: BackfillPage = await ctx.runQuery(
        internal.preferenceExport.listReferenceBackfillPage,
        { paginationOpts: { numItems: pageSize, cursor } },
      );
      if (result.page.length > 0) {
        await ctx.runMutation(internal.preferenceExport.applyBackfillPage, {
          items: result.page,
        });
      }
      cursor = result.continueCursor;
      isDone = result.isDone;
    }

    await ctx.runMutation(internal.preferenceExport.queueRebuiltExport, {});
    return null;
  },
});

export const listReferenceBackfillPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      result.page.map(async (reference) => {
        const snapshot = await latestSourceSnapshot(ctx, reference._id);
        const preference = reviewPreferenceFromReference(reference, snapshot);
        return {
          referenceId: reference._id,
          ...(preference
            ? { preference: withoutReferenceId(preference) }
            : {}),
        };
      }),
    );
    return { ...result, page };
  },
});

export const applyBackfillPage = internalMutation({
  args: { items: v.array(backfillItemValidator) },
  handler: async (ctx, args) => {
    for (const item of args.items) {
      await writeProjectedPreference(
        ctx,
        item.referenceId,
        item.preference
          ? { referenceId: String(item.referenceId), ...item.preference }
          : undefined,
      );
    }
    return null;
  },
});

export const queueRebuiltExport = internalMutation({
  args: {},
  handler: async (ctx) => {
    await queuePreferenceExport(ctx, 0);
    return null;
  },
});

export const getExportState = internalQuery({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("preferenceExportState")
      .withIndex("by_key", (q) => q.eq("key", exportStateKey))
      .unique(),
});

export const listProjectionPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) =>
    await ctx.db
      .query("reviewPreferences")
      .withIndex("by_reviewed_at")
      .order("desc")
      .paginate(args.paginationOpts),
});

export const markExportRunning = internalMutation({
  args: { generation: v.number() },
  handler: async (ctx, args) => {
    const state = await exportState(ctx);
    if (state?.generation !== args.generation) return false;
    await ctx.db.patch(state._id, { status: "running", error: undefined });
    return true;
  },
});

export const completeExport = internalMutation({
  args: {
    generation: v.number(),
    driveFileId: v.string(),
    exportedAt: v.number(),
    itemCount: v.number(),
  },
  handler: async (ctx, args) => {
    const state = await exportState(ctx);
    if (state?.generation !== args.generation) return false;
    await ctx.db.patch(state._id, {
      status: "ready",
      driveFileId: args.driveFileId,
      exportedAt: args.exportedAt,
      itemCount: args.itemCount,
      error: undefined,
    });
    return true;
  },
});

export const failExport = internalMutation({
  args: { generation: v.number(), error: v.string() },
  handler: async (ctx, args) => {
    const state = await exportState(ctx);
    if (state?.generation !== args.generation) return false;
    await ctx.db.patch(state._id, { status: "error", error: args.error.slice(0, 240) });
    return true;
  },
});

export const exportSnapshot = internalAction({
  args: { generation: v.number(), retry: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const initialState: Doc<"preferenceExportState"> | null = await ctx.runQuery(
      internal.preferenceExport.getExportState,
      {},
    );
    if (!initialState || initialState.generation !== args.generation) return null;
    const claimed: boolean = await ctx.runMutation(
      internal.preferenceExport.markExportRunning,
      { generation: args.generation },
    );
    if (!claimed) return null;

    const items = await readPreferenceProjection(ctx);
    const currentState: Doc<"preferenceExportState"> | null = await ctx.runQuery(
      internal.preferenceExport.getExportState,
      {},
    );
    if (!currentState || currentState.generation !== args.generation) return null;

    const exportedAt = Date.now();
    try {
      const file = await upsertPreferenceSnapshotToDrive({
        json: preferenceSnapshotJson(items, exportedAt),
        driveFileId: currentState.driveFileId,
      });
      await ctx.runMutation(internal.preferenceExport.completeExport, {
        generation: args.generation,
        driveFileId: file.id,
        exportedAt,
        itemCount: items.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preference snapshot export failed";
      const recorded: boolean = await ctx.runMutation(
        internal.preferenceExport.failExport,
        { generation: args.generation, error: message },
      );
      const retry = args.retry ?? 0;
      if (recorded && retry < maxRetries) {
        await ctx.scheduler.runAfter(
          30_000 * 2 ** retry,
          internal.preferenceExport.exportSnapshot,
          { generation: args.generation, retry: retry + 1 },
        );
      }
    }
    return null;
  },
});

async function readPreferenceProjection(ctx: ActionCtx) {
  const items: ReviewPreferencePayload[] = [];
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone) {
    const result: PreferencePage = await ctx.runQuery(
      internal.preferenceExport.listProjectionPage,
      { paginationOpts: { numItems: pageSize, cursor } },
    );
    items.push(
      ...result.page.map((item) => ({
        referenceId: String(item.referenceId),
        decision: item.decision,
        triageState: item.triageState,
        reviewedAt: item.reviewedAt,
        ...(item.title ? { title: item.title } : {}),
        sourceUrl: item.sourceUrl,
        ...(item.canonicalUrl ? { canonicalUrl: item.canonicalUrl } : {}),
        ...(item.character ? { character: item.character } : {}),
        ...(item.authorName ? { authorName: item.authorName } : {}),
        ...(item.authorHandle ? { authorHandle: item.authorHandle } : {}),
        platform: item.platform,
        ...(item.sourceKind ? { sourceKind: item.sourceKind } : {}),
      })),
    );
    cursor = result.continueCursor;
    isDone = result.isDone;
  }
  return items;
}

async function writeProjectedPreference(
  ctx: MutationCtx,
  referenceId: Id<"references">,
  preference: ReviewPreferencePayload | undefined,
) {
  const existing = await ctx.db
    .query("reviewPreferences")
    .withIndex("by_reference", (q) => q.eq("referenceId", referenceId))
    .unique();
  if (!preference) {
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  }

  const payload = withoutReferenceId(preference);
  if (existing && projectedPreferencesEqual(existing, payload)) return false;
  const updatedAt = Date.now();
  if (existing) await ctx.db.patch(existing._id, { ...payload, updatedAt });
  else await ctx.db.insert("reviewPreferences", { referenceId, ...payload, updatedAt });
  return true;
}

async function queuePreferenceExport(ctx: MutationCtx, delayMs: number) {
  const state = await exportState(ctx);
  const generation = (state?.generation ?? 0) + 1;
  const requestedAt = Date.now();
  if (state) {
    await ctx.db.patch(state._id, {
      generation,
      status: "queued",
      requestedAt,
      error: undefined,
    });
  } else {
    await ctx.db.insert("preferenceExportState", {
      key: exportStateKey,
      generation,
      status: "queued",
      requestedAt,
    });
  }
  await ctx.scheduler.runAfter(delayMs, internal.preferenceExport.exportSnapshot, {
    generation,
  });
}

async function exportState(ctx: MutationCtx) {
  return await ctx.db
    .query("preferenceExportState")
    .withIndex("by_key", (q) => q.eq("key", exportStateKey))
    .unique();
}

async function latestSourceSnapshot(
  ctx: Pick<MutationCtx, "db">,
  referenceId: Id<"references">,
) {
  return await ctx.db
    .query("sourceSnapshots")
    .withIndex("by_reference", (q) => q.eq("referenceId", referenceId))
    .order("desc")
    .first();
}

function withoutReferenceId(preference: ReviewPreferencePayload) {
  const { referenceId: _referenceId, ...payload } = preference;
  return payload;
}

function projectedPreferencesEqual(
  existing: Doc<"reviewPreferences">,
  payload: Omit<ReviewPreferencePayload, "referenceId">,
) {
  return (
    existing.decision === payload.decision &&
    existing.triageState === payload.triageState &&
    existing.reviewedAt === payload.reviewedAt &&
    existing.title === payload.title &&
    existing.sourceUrl === payload.sourceUrl &&
    existing.canonicalUrl === payload.canonicalUrl &&
    existing.character === payload.character &&
    existing.authorName === payload.authorName &&
    existing.authorHandle === payload.authorHandle &&
    existing.platform === payload.platform &&
    existing.sourceKind === payload.sourceKind
  );
}
