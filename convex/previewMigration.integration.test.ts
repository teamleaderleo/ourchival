// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

test("migration is idempotent and resumes a persisted cursor without requeuing current images", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      const ref = await ctx.db.insert("references", { kind: "image", platform: "manual", title: "Fixture", sourceUrl: "https://example.com", capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false });
      const storage = await ctx.storage.store(new Blob(["preview"]));
      for (let i = 0; i < 9; i++) await ctx.db.insert("assets", { referenceId: ref, dominantColors: [], derivativeVersion: 2, thumbStorageId: storage, previewStorageId: storage });
    });
    await t.mutation(internal.previewMigration.start, {});
    await t.mutation(internal.previewMigration.start, {});
    await t.mutation(internal.previewMigration.advance, {});
    expect((await t.query(internal.previewMigration.status, {}))?.scanned).toBe(4);
    await t.mutation(internal.previewMigration.advance, {});
    expect((await t.query(internal.previewMigration.status, {}))?.scanned).toBe(4);
    await t.mutation(internal.previewMigration.pause, {});
    await t.mutation(internal.previewMigration.advance, {});
    expect((await t.query(internal.previewMigration.status, {}))?.status).toBe("paused");
    await t.mutation(internal.previewMigration.start, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(internal.previewMigration.status, {})).toMatchObject({ status: "complete", scanned: 9, alreadyCurrent: 9, pending: [], failed: 0 });
  } finally { vi.useRealTimers(); }
});

test("repeated failures pause without losing the checkpoint or erasing existing media", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    await t.mutation(internal.previewMigration.start, {});
    await t.run(async ctx => {
      const ref = await ctx.db.insert("references", { kind: "image", platform: "manual", sourceUrl: "https://example.com", capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false });
      const storage = await ctx.storage.store(new Blob(["old preview"]));
      const pending = [];
      for (let i = 0; i < 4; i++) {
        const assetId = await ctx.db.insert("assets", { referenceId: ref, dominantColors: [], previewStorageId: storage });
        const jobId = await ctx.db.insert("enrichmentJobs", { referenceId: ref, assetId, type: "media_derivatives", status: "failed", error: "Drive unavailable", attempts: 1, requestedAt: 1, createdAt: 1, updatedAt: 1 });
        pending.push({ assetId, jobId });
      }
      const state = await ctx.db.query("previewMigrations").first();
      await ctx.db.patch(state!._id, { pending, scanned: 4 });
    });
    await t.mutation(internal.previewMigration.advance, {});
    expect(await t.query(internal.previewMigration.status, {})).toMatchObject({ status: "paused", failed: 4, scanned: 4, pending: [] });
    await t.run(async ctx => {
      for (const asset of await ctx.db.query("assets").take(4)) expect(await ctx.storage.getUrl(asset.previewStorageId!)).not.toBeNull();
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally { vi.useRealTimers(); }
});

test("orphaned queued jobs fail loudly while the migration keeps draining", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    await t.mutation(internal.previewMigration.start, {});
    await t.run(async ctx => {
      const ref = await ctx.db.insert("references", { kind: "image", platform: "manual", sourceUrl: "https://example.com", capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false });
      const assetId = await ctx.db.insert("assets", { referenceId: ref, dominantColors: [] });
      const jobId = await ctx.db.insert("enrichmentJobs", { referenceId: ref, assetId, type: "media_derivatives", status: "queued", attempts: 1, requestedAt: 1, createdAt: 1, updatedAt: 1 });
      const state = await ctx.db.query("previewMigrations").first();
      await ctx.db.patch(state!._id, { pending: [{ assetId, jobId }], scanned: 1 });
    });
    await t.mutation(internal.previewMigration.advance, {});
    const status = await t.query(internal.previewMigration.status, {});
    expect(status).toMatchObject({ status: "running", failed: 1 });
    await t.run(async ctx => {
      const jobs = await ctx.db.query("enrichmentJobs").collect();
      expect(jobs.find(j => j.status === "failed")?.error).toMatch(/stalled/);
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally { vi.useRealTimers(); }
});

test("jobs that succeeded under an older recipe requeue instead of failing", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    await t.mutation(internal.previewMigration.start, {});
    await t.run(async ctx => {
      const ref = await ctx.db.insert("references", { kind: "image", platform: "manual", sourceUrl: "https://example.com", capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false });
      const storage = await ctx.storage.store(new Blob(["old preview"]));
      const assetId = await ctx.db.insert("assets", { referenceId: ref, dominantColors: [], previewStorageId: storage, thumbStorageId: storage });
      const jobId = await ctx.db.insert("enrichmentJobs", { referenceId: ref, assetId, type: "media_derivatives", status: "succeeded", attempts: 1, requestedAt: 1, createdAt: 1, updatedAt: 1 });
      const state = await ctx.db.query("previewMigrations").first();
      await ctx.db.patch(state!._id, { pending: [{ assetId, jobId }], scanned: 1 });
    });
    await t.mutation(internal.previewMigration.advance, {});
    const status = await t.query(internal.previewMigration.status, {});
    expect(status).toMatchObject({ failed: 0 });
    expect(status?.pending.length).toBeGreaterThan(0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally { vi.useRealTimers(); }
});

test("completed scans retry retained failures for up to 3 laps", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    await t.mutation(internal.previewMigration.start, {});
    const assetId = await t.run(async ctx => {
      const ref = await ctx.db.insert("references", { kind: "image", platform: "manual", sourceUrl: "https://example.com", capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false });
      const storage = await ctx.storage.store(new Blob(["old preview"]));
      const id = await ctx.db.insert("assets", { referenceId: ref, dominantColors: [], previewStorageId: storage });
      const state = await ctx.db.query("previewMigrations").first();
      await ctx.db.patch(state!._id, { scanDone: true, failed: 1, failures: [{ assetId: id, reason: "fetch failed" }] });
      return id;
    });
    await t.mutation(internal.previewMigration.advance, {});
    const status = await t.query(internal.previewMigration.status, {});
    expect(status).toMatchObject({ status: "running", laps: 1 });
    expect(status?.pending.map(p => String(p.assetId))).toContain(String(assetId));
    expect(status?.failures).toHaveLength(0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally { vi.useRealTimers(); }
});

test("advance yields while the gallery is active", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    await t.mutation(internal.previewMigration.start, {});
    await t.run(async ctx => {
      const ref = await ctx.db.insert("references", { kind: "image", platform: "manual", sourceUrl: "https://example.com", capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false });
      await ctx.db.insert("assets", { referenceId: ref, dominantColors: [] });
    });
    await t.mutation(internal.httpDb.touchFeedActivity, {});
    await t.mutation(internal.previewMigration.advance, {});
    expect(await t.query(internal.previewMigration.status, {})).toMatchObject({ status: "running", scanned: 0 });
    // An hour of silence: the batch resumes on its own.
    await t.run(async ctx => {
      const row = await ctx.db.query("activityState").first();
      await ctx.db.patch(row!._id, { lastFeedAt: 1 });
    });
    await t.mutation(internal.previewMigration.advance, {});
    expect((await t.query(internal.previewMigration.status, {}))?.scanned).toBeGreaterThan(0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally { vi.useRealTimers(); }
});
