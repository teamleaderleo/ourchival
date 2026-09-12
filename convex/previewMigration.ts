import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { queueAsset } from "./mediaDerivatives";
import { paginationOptsValidator } from "convex/server";

const key = "compact-previews-v2";
const batchSize = 2;
const interval = 60_000;
// Pause threshold stays at 4 consecutive failures: smaller batches must not
// make the sweep twitchier about systemic rot.
const maxFailureStreak = 4;

export const inventory = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("assets").paginate({ ...args.paginationOpts, numItems: Math.min(500, args.paginationOpts.numItems) });
    return { cursor: page.continueCursor, done: page.isDone, counts: {
      assets: page.page.length,
      driveOriginals: page.page.filter(a => a.driveFileId).length,
      localOriginals: page.page.filter(a => a.originalStorageId).length,
      bothPreviews: page.page.filter(a => a.previewStorageId && a.thumbStorageId).length,
      compact: page.page.filter(a => a.derivativeVersion === 2).length,
      mirrored: page.page.filter(a => a.drivePreviewFileId && a.driveThumbFileId).length,
    } };
  },
});

export const status = internalQuery({
  args: {},
  handler: ctx => ctx.db.query("previewMigrations").withIndex("by_key", q => q.eq("key", key)).unique(),
});

export const start = internalMutation({
  args: {},
  handler: async ctx => {
    const current = await ctx.db.query("previewMigrations").withIndex("by_key", q => q.eq("key", key)).unique();
    if (current?.status === "running" || current?.status === "complete") return current;
    if (current) {
      await ctx.db.patch(current._id, { status: "running", nextRunAt: 0, failureStreak: 0, message: undefined });
    } else {
      await ctx.db.insert("previewMigrations", {
        key, status: "running", cursor: null, scanDone: false, pending: [], scanned: 0,
        upgraded: 0, alreadyCurrent: 0, skipped: 0, failed: 0, reclaimedBytes: 0,
        failureStreak: 0, failures: [], nextRunAt: 0, startedAt: Date.now(), updatedAt: Date.now(),
      });
    }
    await ctx.scheduler.runAfter(0, internal.previewMigration.advance, {});
    return { status: "running" };
  },
});

export const pause = internalMutation({
  args: {},
  handler: async ctx => {
    const state = await ctx.db.query("previewMigrations").withIndex("by_key", q => q.eq("key", key)).unique();
    if (state?.status === "running") await ctx.db.patch(state._id, { status: "paused", message: "Paused by owner", updatedAt: Date.now() });
  },
});

/** Transactional checkpoint + scheduler; the minute cron recovers interrupted scheduling. */
export const advance = internalMutation({
  args: {},
  handler: async ctx => {
    // Yield to the human: gallery reads never queue behind batch Sharp
    // work. The 5-minute cron re-fires this tick; nothing is lost.
    if (await ctx.runQuery(internal.httpDb.foregroundActive, {})) return;
    let state = await ctx.db.query("previewMigrations").withIndex("by_key", q => q.eq("key", key)).unique();
    // Self-starting: the cron owns this migration, so the first tick creates
    // the checkpoint instead of waiting for a manual kick that never comes.
    if (!state) {
      const id = await ctx.db.insert("previewMigrations", {
        key, status: "running", cursor: null, scanDone: false, pending: [], scanned: 0,
        upgraded: 0, alreadyCurrent: 0, skipped: 0, failed: 0, reclaimedBytes: 0,
        failureStreak: 0, failures: [], nextRunAt: 0, startedAt: Date.now(), updatedAt: Date.now(),
      });
      state = await ctx.db.get(id);
    }
    if (!state || state.status !== "running" || state.nextRunAt > Date.now()) return;
    let { upgraded, alreadyCurrent, skipped, failed, reclaimedBytes, failureStreak } = state;
    const failures = [...state.failures];
    const pending = [];
    for (const item of state.pending) {
      const job = await ctx.db.get(item.jobId);
      if (job && (job.status === "queued" || job.status === "running")) {
        if (Date.now() - job.createdAt > 30 * 60_000) {
          // Orphaned: the action behind this job is gone and never coming
          // back. Fail it loudly and keep draining; the streak guard below
          // still halts the migration on systemic failure.
          await ctx.db.patch(item.jobId, {
            status: "failed", error: "Preview action stalled; eligible for retry.",
            completedAt: Date.now(), updatedAt: Date.now(),
          });
          failed++;
          failureStreak++;
          if (failures.length < 40) failures.push({ assetId: item.assetId, reason: "Preview action stalled" });
          continue;
        }
        pending.push(item);
        continue;
      }
      const asset = await ctx.db.get(item.assetId);
      if (job?.status === "succeeded" && asset?.derivativeVersion === 2) {
        upgraded++;
        reclaimedBytes += job.reclaimedBytes ?? 0;
        failureStreak = 0;
      } else if (job?.status === "succeeded" && asset) {
        // Succeeded under an older recipe: requeue for the compact version
        // instead of writing the asset off as failed.
        const retry = await queueAsset(ctx, asset, true);
        pending.push({ jobId: retry._id, assetId: asset._id });
      } else {
        failed++;
        failureStreak++;
        if (failures.length < 40) failures.push({ assetId: item.assetId, reason: (job?.error ?? "Preview did not complete").slice(0, 250) });
      }
    }
    const progress = { pending, upgraded, alreadyCurrent, skipped, failed, reclaimedBytes, failureStreak, failures, updatedAt: Date.now() };
    if (failureStreak >= maxFailureStreak) {
      await ctx.db.patch(state._id, { ...progress, status: "paused", message: "Repeated preview failures; originals and existing previews retained." });
      return;
    }
    if (pending.length) {
      await ctx.db.patch(state._id, { ...progress, nextRunAt: Date.now() + interval });
      await ctx.scheduler.runAfter(interval, internal.previewMigration.advance, {});
      return;
    }
    if (state.scanDone) {
      // Retry lap: transient backend fetches ("fetch failed" under load) are
      // the common failure, so requeue retained failures up to 3 laps before
      // calling the migration done. failureStreak still halts systemic rot.
      const laps = state.laps ?? 0;
      if (failures.length > 0 && laps < 3) {
        const retryPending = [];
        for (const failure of failures) {
          const asset = await ctx.db.get(failure.assetId);
          if (!asset) continue;
          const job = await queueAsset(ctx, asset, true);
          retryPending.push({ jobId: job._id, assetId: asset._id });
        }
        await ctx.db.patch(state._id, {
          ...progress, pending: retryPending, failures: [], laps: laps + 1,
          message: `Retry lap ${laps + 1}: ${retryPending.length} failed items requeued.`,
          nextRunAt: Date.now() + interval,
        });
        await ctx.scheduler.runAfter(interval, internal.previewMigration.advance, {});
        return;
      }
      await ctx.db.patch(state._id, { ...progress, status: "complete", message: failed ? "Scan complete with failed items retained for retry." : "Existing previews migrated." });
      return;
    }
    const page = await ctx.db.query("assets").paginate({ cursor: state.cursor, numItems: batchSize });
    for (const asset of page.page) {
      if (asset.derivativeVersion === 2 && asset.previewStorageId && asset.thumbStorageId) { alreadyCurrent++; continue; }
      const reference = await ctx.db.get(asset.referenceId);
      if (!reference || reference.deleted || (!asset.driveFileId && !asset.originalStorageId)) { skipped++; continue; }
      const job = await queueAsset(ctx, asset, true);
      pending.push({ jobId: job._id, assetId: asset._id });
    }
    await ctx.db.patch(state._id, {
      ...progress, pending, alreadyCurrent, skipped, scanned: state.scanned + page.page.length,
      cursor: page.continueCursor, scanDone: page.isDone, nextRunAt: Date.now() + interval,
    });
    await ctx.scheduler.runAfter(interval, internal.previewMigration.advance, {});
  },
});
