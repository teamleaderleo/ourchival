// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

const refDoc = {
  kind: "image" as const, platform: "manual" as const, sourceUrl: "https://example.com",
  capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false,
};

async function mediaJobs(t: ReturnType<typeof convexTest>) {
  return await t.run(async ctx =>
    (await ctx.db.query("enrichmentJobs").take(100)).filter(j => j.type === "media_derivatives"));
}

async function scheduled(t: ReturnType<typeof convexTest>, name: string) {
  return await t.run(async ctx =>
    (await ctx.db.system.query("_scheduled_functions").take(100)).filter(f => f.name.startsWith(name)));
}

// Regression: the compact-preview sweep re-encoded Drive-mirrored assets. The
// drive feeder then reclaimed the fresh blobs (the twin already exists and is
// never refreshed), so every such Sharp job was thrown away.
test.each([
  { derivativeVersion: 2, counter: "alreadyCurrent" },
  { derivativeVersion: 1, counter: "skipped" },
])("migration does not re-encode Drive-mirrored assets (v$derivativeVersion)", async ({ derivativeVersion, counter }) => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      const ref = await ctx.db.insert("references", refDoc);
      const original = await ctx.storage.store(new Blob(["original"]));
      await ctx.db.insert("assets", {
        referenceId: ref, dominantColors: [], originalStorageId: original, derivativeVersion,
        derivativeStatus: "ready", drivePreviewFileId: "drive-preview", driveThumbFileId: "drive-thumb",
      });
    });
    await t.mutation(internal.previewMigration.advance, {});
    expect(await mediaJobs(t)).toHaveLength(0);
    expect(await scheduled(t, "mediaDerivativesNode")).toHaveLength(0);
    expect(await t.query(internal.previewMigration.status, {})).toMatchObject({ scanned: 1, pending: [], [counter]: 1 });
  } finally { vi.useRealTimers(); }
});

test("migration still re-encodes an unmirrored asset exactly once", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      const ref = await ctx.db.insert("references", refDoc);
      const original = await ctx.storage.store(new Blob(["original"]));
      await ctx.db.insert("assets", { referenceId: ref, dominantColors: [], originalStorageId: original, derivativeVersion: 1, derivativeStatus: "ready" });
    });
    await t.mutation(internal.previewMigration.advance, {});
    // A cron tick racing the self-scheduled chain must not double-queue.
    await t.mutation(internal.previewMigration.advance, {});
    await t.mutation(internal.mediaDerivatives.queueMissing, { limit: 4 });
    expect(await mediaJobs(t)).toHaveLength(1);
    expect(await scheduled(t, "mediaDerivativesNode")).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

// Guards for the backstop cron: an in-flight asset is never queued twice and a
// terminal failure is not retried every 2 minutes.
test("queueMissing schedules one job per asset and never re-queues a failed one", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      const ref = await ctx.db.insert("references", refDoc);
      const original = await ctx.storage.store(new Blob(["original"]));
      await ctx.db.insert("assets", { referenceId: ref, dominantColors: [], originalStorageId: original });
    });
    await t.mutation(internal.mediaDerivatives.queueMissing, { limit: 4 });
    await t.mutation(internal.mediaDerivatives.queueMissing, { limit: 4 });
    const [job] = await mediaJobs(t);
    expect(await mediaJobs(t)).toHaveLength(1);
    expect(await scheduled(t, "mediaDerivativesNode")).toHaveLength(1);
    await t.mutation(internal.mediaDerivatives.fail, { jobId: job._id, error: "decode failed" });
    for (let tick = 0; tick < 5; tick++) await t.mutation(internal.mediaDerivatives.queueMissing, { limit: 4 });
    expect(await mediaJobs(t)).toHaveLength(1);
    expect(await scheduled(t, "mediaDerivativesNode")).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

test("drive queueMissing schedules one upload job per asset while in flight", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      const ref = await ctx.db.insert("references", refDoc);
      const blob = await ctx.storage.store(new Blob(["preview"]));
      await ctx.db.insert("assets", { referenceId: ref, dominantColors: [], previewStorageId: blob, thumbStorageId: blob, derivativeStatus: "ready" });
    });
    await t.mutation(internal.driveDerivatives.queueMissing, { limit: 2 });
    await t.mutation(internal.driveDerivatives.queueMissing, { limit: 2 });
    expect(await scheduled(t, "driveDerivativesNode")).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});
