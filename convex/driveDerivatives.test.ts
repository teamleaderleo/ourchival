// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

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
