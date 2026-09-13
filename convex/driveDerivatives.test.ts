// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

afterEach(() => {
  vi.unstubAllEnvs();
});

const modules = import.meta.glob("./**/*.ts");
const refDoc = (n: number) => ({
  kind: "image" as const,
  platform: "manual" as const,
  sourceUrl: `https://example.com/${n}`,
  capturedAt: n,
  boardIds: [],
  tagIds: [],
  favorite: false,
  archived: false,
  deleted: false,
});

describe("drive derivative mirroring", () => {
  it("queues ready assets missing Drive IDs and skips the rest", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(1));
      const blob = await ctx.storage.store(new Blob(["thumb"]));
      await ctx.db.insert("assets", {
        referenceId,
        previewStorageId: blob,
        thumbStorageId: blob,
        derivativeStatus: "ready",
        tagIds: [],
        dominantColors: [],
      });
      await ctx.db.insert("assets", {
        referenceId,
        previewStorageId: blob,
        thumbStorageId: blob,
        derivativeStatus: "ready",
        drivePreviewFileId: "done-preview",
        driveThumbFileId: "done-thumb",
        tagIds: [],
        dominantColors: [],
      });
      await ctx.db.insert("assets", {
        referenceId,
        originalUrl: "https://example.com/linked.jpg",
        derivativeStatus: "failed",
        tagIds: [],
        dominantColors: [],
      });
    });

    const result = await t.mutation(internal.driveDerivatives.queueMissing, {
      limit: 4,
    });
    expect(result.queued).toBe(1);

    const jobs = await t.run(async (ctx) =>
      (await ctx.db.query("enrichmentJobs").collect()).filter(
        (job) => job.type === "drive_derivatives",
      ),
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("queued");

    // Second sweep sees the active job and queues nothing new.
    const again = await t.mutation(internal.driveDerivatives.queueMissing, {
      limit: 4,
    });
    expect(again).toMatchObject({ queued: 0, active: 1 });
  });

  it("claims the next upload without scheduling extra actions", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(3));
      const blob = await ctx.storage.store(new Blob(["thumb"]));
      const assetId = await ctx.db.insert("assets", {
        referenceId,
        previewStorageId: blob,
        thumbStorageId: blob,
        derivativeStatus: "ready",
        tagIds: [],
        dominantColors: [],
      });
      const mirroredId = await ctx.db.insert("assets", {
        referenceId,
        previewStorageId: blob,
        thumbStorageId: blob,
        derivativeStatus: "ready",
        drivePreviewFileId: "done-preview",
        driveThumbFileId: "done-thumb",
        tagIds: [],
        dominantColors: [],
      });
      return { assetId, mirroredId };
    });

    const claimed = await t.mutation(internal.driveDerivatives.claimNextUpload, {
      excludeAssetIds: [],
    });
    expect(claimed?.assetId).toBe(ids.assetId);

    // Excluding the eligible asset leaves only the mirrored one: no claim,
    // with the scan marked done so the worker stops instead of looping.
    const none = await t.mutation(internal.driveDerivatives.claimNextUpload, {
      excludeAssetIds: [ids.assetId],
    });
    expect(none).toMatchObject({ jobId: null, assetId: null, done: true });
  });

  it("rotates the feeder cursor past long-done index heads", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(4));
      const blob = await ctx.storage.store(new Blob(["thumb"]));
      // Fill the whole first scan page with already-mirrored assets.
      for (let i = 0; i < 20; i++) {
        await ctx.db.insert("assets", {
          referenceId,
          previewStorageId: blob,
          thumbStorageId: blob,
          derivativeStatus: "ready",
          drivePreviewFileId: `done-preview-${i}`,
          driveThumbFileId: `done-thumb-${i}`,
          tagIds: [],
          dominantColors: [],
        });
      }
      await ctx.db.insert("assets", {
        referenceId,
        previewStorageId: blob,
        thumbStorageId: blob,
        derivativeStatus: "ready",
        tagIds: [],
        dominantColors: [],
      });
    });

    // A fixed take() would re-read the 20 mirrored heads forever and queue
    // nothing; the cursor must carry the feeder to the fresh asset.
    let queued = 0;
    for (let i = 0; i < 4 && queued === 0; i++) {
      const result = await t.mutation(internal.driveDerivatives.queueMissing, { limit: 2 });
      queued += result.queued;
    }
    expect(queued).toBe(1);
  });

  it("reclaims metered blobs once Drive twins verify", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(5));
      const preview = await ctx.storage.store(new Blob(["preview-bytes"]));
      const thumb = await ctx.storage.store(new Blob(["thumb-bytes"]));
      const assetId = await ctx.db.insert("assets", {
        referenceId,
        previewStorageId: preview,
        thumbStorageId: thumb,
        derivativeStatus: "ready",
        drivePreviewFileId: "drive-preview",
        driveThumbFileId: "drive-thumb",
        tagIds: [],
        dominantColors: [],
      });
      return { assetId, preview, thumb };
    });

    const result = await t.mutation(internal.driveDerivatives.queueMissing, {
      limit: 4,
    });
    expect(result.reclaimed).toBe(2);
    expect(result.reclaimedBytes).toBeGreaterThan(0);

    await t.run(async (ctx) => {
      const asset = await ctx.db.get(ids.assetId);
      expect(asset?.previewStorageId).toBeUndefined();
      expect(asset?.thumbStorageId).toBeUndefined();
      expect(asset?.derivativeStatus).toBe("ready");
      expect(await ctx.storage.getUrl(ids.preview)).toBeNull();
      expect(await ctx.storage.getUrl(ids.thumb)).toBeNull();
    });
  });

  it("keeps shared blobs until their last referrer detaches", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(6));
      const shared = await ctx.storage.store(new Blob(["shared-thumb"]));
      const first = await ctx.db.insert("assets", {
        referenceId,
        thumbStorageId: shared,
        derivativeStatus: "ready",
        driveThumbFileId: "drive-thumb-1",
        tagIds: [],
        dominantColors: [],
      });
      const second = await ctx.db.insert("assets", {
        referenceId,
        thumbStorageId: shared,
        derivativeStatus: "ready",
        driveThumbFileId: "drive-thumb-2",
        tagIds: [],
        dominantColors: [],
      });
      return { first, second, shared };
    });

    const result = await t.mutation(internal.driveDerivatives.queueMissing, {
      limit: 4,
    });
    expect(result.reclaimed).toBe(1);

    await t.run(async (ctx) => {
      expect((await ctx.db.get(ids.first))?.thumbStorageId).toBeUndefined();
      expect((await ctx.db.get(ids.second))?.thumbStorageId).toBeUndefined();
      expect(await ctx.storage.getUrl(ids.shared)).toBeNull();
    });
  });

  it("treats Drive-mirrored assets as ready without metered bytes", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    const assetId = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(9));
      return await ctx.db.insert("assets", {
        referenceId,
        derivativeStatus: "ready",
        drivePreviewFileId: "drive-preview",
        driveThumbFileId: "drive-thumb",
        tagIds: [],
        dominantColors: [],
      });
    });
    expect(
      await t.mutation(api.mediaDerivatives.ensurePreview, {
        accessKey: "owner",
        assetId,
      }),
    ).toBe("ready");
    const jobs = await t.run(async (ctx) =>
      (await ctx.db.query("enrichmentJobs").collect()).filter(
        (job) => job.type === "media_derivatives",
      ),
    );
    expect(jobs).toHaveLength(0);
  });

  it("treats an already-mirrored stale job as success", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(7));
      const assetId = await ctx.db.insert("assets", {
        referenceId,
        derivativeStatus: "ready",
        drivePreviewFileId: "drive-preview",
        driveThumbFileId: "drive-thumb",
        tagIds: [],
        dominantColors: [],
      });
      const jobId = await ctx.db.insert("enrichmentJobs", {
        referenceId,
        assetId,
        type: "drive_derivatives",
        status: "queued",
        attempts: 0,
        requestedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return { assetId, jobId };
    });

    const completed = await t.mutation(internal.driveDerivatives.complete, {
      jobId: ids.jobId,
      assetId: ids.assetId,
    });
    expect(completed).toEqual({ status: "succeeded" });
  });

  it("never overwrites a verified Drive identity (first wins)", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(8));
      const blob = await ctx.storage.store(new Blob(["thumb"]));
      const assetId = await ctx.db.insert("assets", {
        referenceId,
        previewStorageId: blob,
        thumbStorageId: blob,
        derivativeStatus: "ready",
        drivePreviewFileId: "first-preview",
        driveThumbFileId: "first-thumb",
        tagIds: [],
        dominantColors: [],
      });
      const jobId = await ctx.db.insert("enrichmentJobs", {
        referenceId,
        assetId,
        type: "drive_derivatives",
        status: "running",
        attempts: 1,
        requestedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return { assetId, jobId };
    });

    await t.mutation(internal.driveDerivatives.complete, {
      jobId: ids.jobId,
      assetId: ids.assetId,
      preview: { id: "second-preview", size: 100, md5Checksum: "a".repeat(32) },
      thumb: { id: "second-thumb", size: 50, md5Checksum: "b".repeat(32) },
    });
    const asset = await t.run(async (ctx) => ctx.db.get(ids.assetId));
    expect(asset).toMatchObject({
      drivePreviewFileId: "first-preview",
      driveThumbFileId: "first-thumb",
    });
  });

  it("records verified IDs and exposes them to hydration", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(2));
      const blob = await ctx.storage.store(new Blob(["thumb"]));
      const assetId = await ctx.db.insert("assets", {
        referenceId,
        previewStorageId: blob,
        thumbStorageId: blob,
        derivativeStatus: "ready",
        tagIds: [],
        dominantColors: [],
      });
      const jobId = await ctx.db.insert("enrichmentJobs", {
        referenceId,
        assetId,
        type: "drive_derivatives",
        status: "running",
        attempts: 1,
        requestedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return { assetId, jobId };
    });

    const completed = await t.mutation(internal.driveDerivatives.complete, {
      jobId: ids.jobId,
      assetId: ids.assetId,
      preview: { id: "drive-preview", size: 100, md5Checksum: "a".repeat(32) },
      thumb: { id: "drive-thumb", size: 50, md5Checksum: "b".repeat(32) },
    });
    expect(completed).toEqual({ status: "succeeded" });

    const asset = await t.run(async (ctx) => ctx.db.get(ids.assetId));
    expect(asset).toMatchObject({
      drivePreviewFileId: "drive-preview",
      driveThumbFileId: "drive-thumb",
    });

    const hydrated = await t.run((ctx) =>
      ctx.db.get(ids.assetId).then((asset) =>
        ctx.db
          .get(asset!.referenceId)
          .then((reference) =>
            import("./lib/referenceCatalog").then((m) =>
              m.hydrateReference(
                ctx,
                "http://localhost:3211",
                reference,
                null,
                [],
                false,
                false,
              ),
            ),
          ),
      ),
    );
    expect(hydrated.assets[0].thumbUrl).toBe(
      "http://localhost:3211/drive-file?id=drive-thumb",
    );
    expect(hydrated.assets[0].previewUrl).toBe(
      "http://localhost:3211/drive-file?id=drive-preview",
    );
  });
});

  it("yields new uploads while the gallery is active but still reclaims", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(10));
      const blob = await ctx.storage.store(new Blob(["thumb"]));
      // Fresh asset eligible for a new upload job.
      await ctx.db.insert("assets", {
        referenceId,
        previewStorageId: blob,
        thumbStorageId: blob,
        derivativeStatus: "ready",
        tagIds: [],
        dominantColors: [],
      });
      // Mirrored asset holding its own metered blob: reclaim must still run.
      const old = await ctx.storage.store(new Blob(["old thumb"]));
      await ctx.db.insert("assets", {
        referenceId,
        previewStorageId: old,
        thumbStorageId: old,
        derivativeStatus: "ready",
        drivePreviewFileId: "drive-preview",
        driveThumbFileId: "drive-thumb",
        tagIds: [],
        dominantColors: [],
      });
    });
    await t.mutation(internal.httpDb.touchFeedActivity, {});
    const result = await t.mutation(internal.driveDerivatives.queueMissing, { limit: 4 });
    expect(result.queued).toBe(0);
    expect(result.reclaimed).toBeGreaterThan(0);
    // Claim ends the worker batch early instead of starting new mirrors.
    const claim = await t.mutation(internal.driveDerivatives.claimNextUpload, { excludeAssetIds: [] });
    expect(claim).toMatchObject({ jobId: null, done: true });
  });

  it("deletes never-ran orphan jobs so their assets become eligible again", async () => {
    const t = convexTest(schema, modules);
    const assetId = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(11));
      const blob = await ctx.storage.store(new Blob(["thumb"]));
      const id = await ctx.db.insert("assets", {
        referenceId,
        previewStorageId: blob,
        thumbStorageId: blob,
        derivativeStatus: "ready",
        tagIds: [],
        dominantColors: [],
      });
      await ctx.db.insert("enrichmentJobs", {
        referenceId,
        assetId: id,
        type: "drive_derivatives",
        status: "queued",
        attempts: 0,
        requestedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return id;
    });
    const result = await t.mutation(internal.driveDerivatives.queueMissing, { limit: 4 });
    expect(result.orphaned).toBe(1);
    expect(result.queued).toBe(1);
    const jobs = await t.run(async (ctx) =>
      (await ctx.db.query("enrichmentJobs").collect()).filter(
        (job) => job.type === "drive_derivatives" && job.assetId === assetId,
      ),
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("queued");
    expect(jobs[0].createdAt).toBeGreaterThan(1);
  });
