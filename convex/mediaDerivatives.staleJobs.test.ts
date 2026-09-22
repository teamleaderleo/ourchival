// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

const minute = 60_000;
const start = Date.UTC(2026, 0, 1);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
});
afterEach(() => {
  vi.useRealTimers();
});

async function fixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async ctx => {
    const referenceId = await ctx.db.insert("references", {
      kind: "image", platform: "manual", sourceUrl: "https://example.com/art",
      capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false,
    });
    const original = await ctx.storage.store(new Blob(["original"]));
    const assetId = await ctx.db.insert("assets", {
      referenceId, originalStorageId: original, dominantColors: [], derivativeStatus: "processing",
    });
    return { referenceId, assetId };
  });
}

function insertJob(
  t: ReturnType<typeof convexTest>,
  ids: { referenceId: Id<"references">; assetId: Id<"assets"> },
  fields: { status: "queued" | "running"; at: number; scheduledFunctionId?: Id<"_scheduled_functions"> },
) {
  return t.run(ctx => ctx.db.insert("enrichmentJobs", {
    referenceId: ids.referenceId, assetId: ids.assetId, type: "media_derivatives",
    status: fields.status, attempts: fields.status === "running" ? 1 : 0,
    requestedAt: fields.at, createdAt: fields.at, updatedAt: fields.at,
    ...(fields.status === "running" ? { startedAt: fields.at } : {}),
    ...(fields.scheduledFunctionId ? { scheduledFunctionId: fields.scheduledFunctionId } : {}),
  }));
}

test("cron fails orphaned derivative jobs and releases their assets", async () => {
  const t = convexTest(schema, modules);
  const running = await fixture(t);
  const queued = await fixture(t);
  const runningJob = await insertJob(t, running, { status: "running", at: start - 45 * minute });
  const queuedJob = await insertJob(t, queued, { status: "queued", at: start - 45 * minute });

  await t.mutation(internal.mediaDerivatives.queueMissing, {});

  await t.run(async ctx => {
    for (const [jobId, assetId] of [[runningJob, running.assetId], [queuedJob, queued.assetId]] as const) {
      expect(await ctx.db.get(jobId)).toMatchObject({ status: "failed", error: expect.stringMatching(/stalled/) });
      expect((await ctx.db.get(jobId))?.completedAt).toBe(start);
      expect((await ctx.db.get(assetId))?.derivativeStatus).toBe("failed");
    }
  });
});

test("recent jobs are left to their processor", async () => {
  const t = convexTest(schema, modules);
  const ids = await fixture(t);
  const jobId = await insertJob(t, ids, { status: "running", at: start - 5 * minute });

  await t.mutation(internal.mediaDerivatives.queueMissing, {});

  await t.run(async ctx => {
    expect((await ctx.db.get(jobId))?.status).toBe("running");
    expect((await ctx.db.get(ids.assetId))?.derivativeStatus).toBe("processing");
  });
});

test("the scheduler's view decides: a pending run is kept, a dead one is failed", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const referenceId = await ctx.db.insert("references", {
      kind: "image", platform: "manual", sourceUrl: "https://example.com/art",
      capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false,
    });
    const original = await ctx.storage.store(new Blob(["original"]));
    const assetId = await ctx.db.insert("assets", { referenceId, originalStorageId: original, dominantColors: [] });
    return { referenceId, assetId };
  });

  // Real queue path: the job remembers its scheduled processor run.
  await t.mutation(internal.mediaDerivatives.queueForAsset, { assetId: ids.assetId });
  const job = await t.run(async ctx => (await ctx.db.query("enrichmentJobs").collect())[0]);
  expect(job.scheduledFunctionId).toBeDefined();

  // Idle past the timeout but the scheduler still holds the run: keep it.
  vi.setSystemTime(start + 45 * minute);
  await t.mutation(internal.mediaDerivatives.queueMissing, {});
  await t.run(async ctx => {
    expect((await ctx.db.get(job._id))?.status).toBe("queued");
    expect((await ctx.db.get(ids.assetId))?.derivativeStatus).toBe("processing");
  });

  // The run is gone (canceled/failed without reaching `fail`): recover.
  await t.run(ctx => ctx.scheduler.cancel(job.scheduledFunctionId!));
  await t.mutation(internal.mediaDerivatives.queueMissing, {});
  await t.run(async ctx => {
    expect((await ctx.db.get(job._id))?.status).toBe("failed");
    expect((await ctx.db.get(ids.assetId))?.derivativeStatus).toBe("failed");
  });
});

test("a pending run is still written off past the hard cap", async () => {
  const t = convexTest(schema, modules);
  const ids = await fixture(t);
  const scheduledFunctionId = await t.run(ctx =>
    ctx.scheduler.runAfter(24 * 60 * minute, internal.retention.sweep, {}),
  );
  const jobId = await insertJob(t, ids, { status: "queued", at: start - 7 * 60 * minute, scheduledFunctionId });

  await t.mutation(internal.mediaDerivatives.queueMissing, {});

  await t.run(async ctx => {
    expect((await ctx.db.get(jobId))?.status).toBe("failed");
    expect((await ctx.db.get(ids.assetId))?.derivativeStatus).toBe("failed");
    await ctx.scheduler.cancel(scheduledFunctionId);
  });
});

test("an asset with another live run stays processing", async () => {
  const t = convexTest(schema, modules);
  const ids = await fixture(t);
  const stale = await insertJob(t, ids, { status: "running", at: start - 45 * minute });
  const fresh = await insertJob(t, ids, { status: "queued", at: start - minute });

  await t.mutation(internal.mediaDerivatives.queueMissing, {});

  await t.run(async ctx => {
    expect((await ctx.db.get(stale))?.status).toBe("failed");
    expect((await ctx.db.get(fresh))?.status).toBe("queued");
    expect((await ctx.db.get(ids.assetId))?.derivativeStatus).toBe("processing");
  });
});
