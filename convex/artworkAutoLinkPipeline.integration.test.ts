// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const accessKey = "artwork-autolink-pipeline-owner";
const createArtwork = makeFunctionReference<"mutation">("artworks:create");
const addRepresentation = makeFunctionReference<"mutation">(
  "artworks:addRepresentation",
);
const completeMedia = makeFunctionReference<"mutation">(
  "mediaDerivatives:complete",
);

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const perceptualHash = "1".repeat(16);

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
  return convexTest(schema, modules);
}

async function artworkWithHashes(
  t: ReturnType<typeof fixture>,
  title: string,
  hashes: string[],
) {
  const artwork = await t.mutation(createArtwork, {
    accessKey,
    title,
    status: "finished",
  });
  for (const [index, contentHash] of hashes.entries()) {
    await t.mutation(addRepresentation, {
      accessKey,
      artworkId: artwork!._id,
      kind: "master_export",
      storageProvider: "google_drive",
      driveFileId: `master-${title}-${index}`,
      fileName: `${title}-${index}.png`,
      mimeType: "image/png",
      contentHash,
    });
  }
  return artwork!;
}

async function seedReferenceAssets(
  t: ReturnType<typeof fixture>,
  sourceCount: number,
) {
  return await t.run(async (ctx) => {
    const referenceId = await ctx.db.insert("references", {
      kind: "post",
      platform: "x",
      sourceUrl: `https://x.com/TeamLeaderLeo/status/${sourceCount}001`,
      canonicalUrl: `https://x.com/TeamLeaderLeo/status/${sourceCount}001`,
      postId: `${sourceCount}001`,
      capturedAt: 10,
      publishedAt: 9,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });

    const rows = [];
    for (let index = 0; index < sourceCount; index += 1) {
      const originalStorageId = await ctx.storage.store(
        new Blob([`original-${index}`]),
      );
      const assetId = await ctx.db.insert("assets", {
        referenceId,
        storageProvider: "convex",
        originalStorageId,
        originalUrl: `https://pbs.twimg.com/media/test-${index}`,
        sourceIndex: index,
        sourceCount,
        mimeType: "image/png",
        dominantColors: [],
        derivativeStatus: "processing",
      });
      const now = Date.now();
      const jobId = await ctx.db.insert("enrichmentJobs", {
        referenceId,
        assetId,
        type: "media_derivatives",
        status: "running",
        attempts: 1,
        requestedAt: now,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      rows.push({ assetId, jobId });
    }
    return { referenceId, rows };
  });
}

async function complete(
  t: ReturnType<typeof fixture>,
  row: { assetId: string; jobId: string },
  contentHash: string,
) {
  const storage = await t.run(async (ctx) => ({
    previewStorageId: await ctx.storage.store(new Blob([`preview-${contentHash}`])),
    thumbStorageId: await ctx.storage.store(new Blob([`thumb-${contentHash}`])),
  }));
  return await t.mutation(completeMedia, {
    jobId: row.jobId,
    assetId: row.assetId,
    previewStorageId: storage.previewStorageId,
    thumbStorageId: storage.thumbStorageId,
    width: 1024,
    height: 1024,
    contentHash,
    perceptualHash,
    dominantColors: ["#123456"],
    previewFileSize: 1024,
    thumbFileSize: 512,
  });
}

async function links(t: ReturnType<typeof fixture>, referenceId: string) {
  return await t.run((ctx) =>
    ctx.db
      .query("artworkPublications")
      .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
      .collect(),
  );
}

it("links a single-image publication when its automatic content hash completes", async () => {
  const t = fixture();
  const artwork = await artworkWithHashes(t, "Single", [hashA]);
  const seeded = await seedReferenceAssets(t, 1);

  const result = await complete(t, seeded.rows[0]!, hashA);

  expect(result).toMatchObject({
    status: "succeeded",
    artworkAutoLinkStatus: "linked",
  });
  const publicationLinks = await links(t, seeded.referenceId);
  expect(publicationLinks).toHaveLength(1);
  expect(publicationLinks[0]?.artworkId).toBe(artwork._id);
});

it("waits for the final hash of a multi-image publication before linking", async () => {
  const t = fixture();
  const artwork = await artworkWithHashes(t, "Two page", [hashA, hashB]);
  const seeded = await seedReferenceAssets(t, 2);

  const first = await complete(t, seeded.rows[0]!, hashA);
  expect(first).toMatchObject({
    status: "succeeded",
    artworkAutoLinkStatus: "review",
  });
  expect(await links(t, seeded.referenceId)).toEqual([]);

  const second = await complete(t, seeded.rows[1]!, hashB);
  expect(second).toMatchObject({
    status: "succeeded",
    artworkAutoLinkStatus: "linked",
  });
  const publicationLinks = await links(t, seeded.referenceId);
  expect(publicationLinks).toHaveLength(1);
  expect(publicationLinks[0]?.artworkId).toBe(artwork._id);
});
