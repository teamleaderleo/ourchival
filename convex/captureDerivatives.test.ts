// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

vi.mock("./lib/linkMetadata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/linkMetadata")>()),
  fetchPublicResponse: vi.fn(),
}));
vi.mock("./lib/drive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/drive")>()),
  uploadBlobToDrive: vi.fn(),
  fetchDriveFile: vi.fn(),
}));

import { fetchPublicResponse } from "./lib/linkMetadata";
import { uploadBlobToDrive, fetchDriveFile } from "./lib/drive";

const modules = import.meta.glob("./**/*.ts");
const owner = { headers: { Authorization: "Bearer owner" } };
const refDoc = (n: number) => ({
  kind: "image" as const,
  platform: "pixiv" as const,
  sourceUrl: `https://www.pixiv.net/artworks/${n}`,
  capturedAt: n,
  boardIds: [],
  tagIds: [],
  favorite: false,
  archived: false,
  deleted: false,
});
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("event-driven derivatives", () => {
  it("queues a targeted job per asset and stays idempotent", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    const assetId = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(1));
      return await ctx.db.insert("assets", {
        referenceId,
        driveFileId: "drive-1",
        tagIds: [],
        dominantColors: [],
      });
    });

    const first = await t.mutation(internal.mediaDerivatives.queueForAsset, {
      assetId,
    });
    expect(first?.queued).toBe(true);
    // Returning the still-active job is the dedup path, not a second job.
    const second = await t.mutation(internal.mediaDerivatives.queueForAsset, {
      assetId,
    });
    expect(second?.status).toBe("queued");

    const jobs = await t.run(async (ctx) =>
      (await ctx.db.query("enrichmentJobs").collect()).filter(
        (job) => job.type === "media_derivatives",
      ),
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("queued");
  });

  it("marks link-only assets failed without a job", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    const assetId = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", refDoc(2));
      return await ctx.db.insert("assets", {
        referenceId,
        originalUrl: "https://example.com/a.jpg",
        tagIds: [],
        dominantColors: [],
      });
    });
    const result = await t.mutation(internal.mediaDerivatives.queueForAsset, {
      assetId,
    });
    expect(result).toMatchObject({ queued: false });
    const asset = await t.run(async (ctx) => ctx.db.get(assetId));
    expect(asset?.derivativeStatus).toBe("failed");
  });

  it("captures without an asset without scheduling work", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    const response = await t.fetch("/capture", {
      method: "POST",
      ...owner,
      body: JSON.stringify({
        kind: "image",
        sourceUrl: "https://example.com/p/1",
      }),
    });
    expect(response.status).toBe(201);
    const jobs = await t.run(async (ctx) =>
      (await ctx.db.query("enrichmentJobs").collect()).filter(
        (job) => job.type === "media_derivatives",
      ),
    );
    expect(jobs).toHaveLength(0);
  });

  it("captures with an asset whose derivative job the intake sweep can queue", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    vi.mocked(fetchPublicResponse).mockResolvedValue({
      finalUrl: "https://example.com/a.jpg",
      response: new Response(png, {
        headers: { "Content-Type": "image/png" },
      }),
    });
    vi.mocked(uploadBlobToDrive).mockResolvedValue({
      ok: true,
      status: "stored",
      file: { id: "drive-9" },
    });
    const t = convexTest(schema, modules);
    const response = await t.fetch("/capture", {
      method: "POST",
      ...owner,
      body: JSON.stringify({
        kind: "image",
        sourceUrl: "https://example.com/p/9",
        assetUrl: "https://example.com/a.jpg",
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.assetId).toBeTruthy();
    // Exercise the exact mutation the intake scheduler enqueues per asset.
    const queued = await t.mutation(internal.mediaDerivatives.queueForAsset, {
      assetId: body.assetId,
    });
    expect(queued?.queued).toBe(true);
    const jobs = await t.run(async (ctx) =>
      (await ctx.db.query("enrichmentJobs").collect()).filter(
        (job) => job.type === "media_derivatives",
      ),
    );
    expect(jobs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("/drive-file caching", () => {
  it("emits an entity tag and revalidates into 304", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    vi.mocked(fetchDriveFile).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Type": "image/png" }),
      body: "fake-bytes",
    } as unknown as Response);
    const t = convexTest(schema, modules);
    const first = await t.fetch("/drive-file?id=abc", owner);
    expect(first.status).toBe(200);
    const etag = first.headers.get("ETag");
    expect(etag).toBe('"drive-abc"');
    expect(first.headers.get("Cache-Control")).toContain("max-age=86400");

    const revalidate = await t.fetch("/drive-file?id=abc", {
      headers: { Authorization: "Bearer owner", "If-None-Match": etag! },
    });
    expect(revalidate.status).toBe(304);
    expect((await t.fetch("/drive-file?id=abc")).status).toBe(401);
  });
});
