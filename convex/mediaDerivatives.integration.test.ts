// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

test.each(["original", "artwork", "analysis"])("replacement preserves %s references while retiring unused previews and recording bytes", async sharedBy => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      const referenceId = await ctx.db.insert("references", {
        kind: "image", platform: "manual", title: "Preview fixture", sourceUrl: "https://example.com/art",
        capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false,
      });
      const original = await ctx.storage.store(new Blob(["original"]));
      const oldPreview = await ctx.storage.store(new Blob(["old-preview"]));
      const sharedThumb = await ctx.storage.store(new Blob(["shared-thumb"]));
      const preview = await ctx.storage.store(new Blob(["avif-preview"], { type: "image/avif" }));
      const thumb = await ctx.storage.store(new Blob(["webp-thumb"], { type: "image/webp" }));
      const assetId = await ctx.db.insert("assets", {
        referenceId, originalStorageId: original, previewStorageId: oldPreview, thumbStorageId: sharedThumb, dominantColors: [],
      });
      if (sharedBy === "original") {
        await ctx.db.insert("assets", { referenceId, originalStorageId: sharedThumb, dominantColors: [] });
      } else if (sharedBy === "artwork") {
        const artworkId = await ctx.db.insert("artworks", { title: "Kept artwork", status: "wip", createdAt: 1, updatedAt: 1 });
        await ctx.db.insert("artworkRepresentations", { artworkId, kind: "web_derivative", storageProvider: "convex", storageId: sharedThumb, createdAt: 1, updatedAt: 1 });
      } else {
        await ctx.db.insert("visualEnrichments", { assetId, referenceId, inputStorageId: sharedThumb,
          inputSha256: "a".repeat(64), pipelineFingerprint: "fixture", ratings: [], revision: 1, createdAt: 1, updatedAt: 1 });
      }
      const jobId = await ctx.db.insert("enrichmentJobs", {
        referenceId, assetId, type: "media_derivatives", status: "running", attempts: 1,
        requestedAt: 1, createdAt: 1, updatedAt: 1,
      });
      return { assetId, jobId, original, oldPreview, sharedThumb, preview, thumb };
    });
    await t.mutation(internal.mediaDerivatives.complete, {
      jobId: ids.jobId, assetId: ids.assetId, previewStorageId: ids.preview, thumbStorageId: ids.thumb,
      width: 1600, height: 800, contentHash: "a".repeat(64), perceptualHash: "b".repeat(16),
      dominantColors: ["#123456"], previewFileSize: 12, thumbFileSize: 10, derivativeVersion: 2,
    });
    await t.run(async ctx => {
      expect(await ctx.storage.getUrl(ids.oldPreview)).toBeNull();
      for (const id of [ids.original, ids.sharedThumb, ids.preview, ids.thumb])
        expect(await ctx.storage.getUrl(id)).not.toBeNull();
      expect(await ctx.db.get(ids.assetId)).toMatchObject({
        previewStorageId: ids.preview, thumbStorageId: ids.thumb,
        previewFileSize: 12, thumbFileSize: 10, derivativeVersion: 2, derivativeStatus: "ready",
      });
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally { vi.useRealTimers(); }
});

test("migration keeps an already smaller compact preview and deletes the unused new output", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      const referenceId = await ctx.db.insert("references", { kind: "image", platform: "manual", sourceUrl: "https://example.com", capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false });
      const old = await ctx.storage.store(new Blob(["tiny"], { type: "image/webp" }));
      // convex-test 0.0.56 omits Blob.type from its simulated _storage row.
      await ctx.db.patch(old as never, { contentType: "image/webp" } as never);
      const replacement = await ctx.storage.store(new Blob(["larger replacement"], { type: "image/avif" }));
      const thumb = await ctx.storage.store(new Blob(["thumb"], { type: "image/webp" }));
      const assetId = await ctx.db.insert("assets", { referenceId, previewStorageId: old, thumbStorageId: thumb, contentHash: "a".repeat(64), dominantColors: [] });
      const jobId = await ctx.db.insert("enrichmentJobs", { referenceId, assetId, type: "media_derivatives", status: "running", attempts: 1, requestedAt: 1, createdAt: 1, updatedAt: 1 });
      return { old, replacement, thumb, assetId, jobId };
    });
    await t.mutation(internal.mediaDerivatives.complete, {
      jobId: ids.jobId, assetId: ids.assetId, previewStorageId: ids.replacement, thumbStorageId: ids.thumb,
      width: 1600, height: 800, contentHash: "a".repeat(64), perceptualHash: "b".repeat(16),
      dominantColors: ["#123456"], previewFileSize: 18, thumbFileSize: 5, derivativeVersion: 2,
    });
    await t.run(async ctx => {
      expect((await ctx.db.get(ids.assetId))?.previewStorageId).toBe(ids.old);
      expect(await ctx.storage.getUrl(ids.replacement)).toBeNull();
      expect(await ctx.storage.getUrl(ids.old)).not.toBeNull();
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally { vi.useRealTimers(); }
});
