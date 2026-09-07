// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const accessKey = "historical-autolink-owner";
const createArtwork = makeFunctionReference<"mutation">("artworks:create");
const addRepresentation = makeFunctionReference<"mutation">(
  "artworks:addRepresentation",
);
const reconcileHash = makeFunctionReference<"mutation">(
  "artworkAutoLink:reconcileReferencesForContentHashInternal",
);

const exactHash = "c".repeat(64);

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
  return convexTest(schema, modules);
}

async function oldCapturedReference(
  t: ReturnType<typeof fixture>,
  postId: string,
) {
  return await t.run(async (ctx) => {
    const referenceId = await ctx.db.insert("references", {
      kind: "image",
      platform: "pixiv",
      sourceUrl: `https://www.pixiv.net/artworks/${postId}`,
      canonicalUrl: `https://www.pixiv.net/artworks/${postId}`,
      postId,
      capturedAt: 10,
      publishedAt: 9,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });
    await ctx.db.insert("assets", {
      referenceId,
      storageProvider: "google_drive",
      driveFileId: `captured-${postId}`,
      originalUrl: `https://i.pximg.net/${postId}.png`,
      sourceIndex: 0,
      sourceCount: 1,
      mimeType: "image/png",
      contentHash: exactHash,
      dominantColors: [],
      derivativeStatus: "ready",
    });
    return referenceId;
  });
}

async function publicationLinks(t: ReturnType<typeof fixture>, referenceId: string) {
  return await t.run((ctx) =>
    ctx.db
      .query("artworkPublications")
      .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
      .collect(),
  );
}

it("links already-hashed historical publications after the matching canonical master appears", async () => {
  const t = fixture();
  const referenceA = await oldCapturedReference(t, "8001");
  const referenceB = await oldCapturedReference(t, "8002");

  const before = await t.mutation(reconcileHash, { contentHash: exactHash });
  expect(before).toMatchObject({
    matchedAssets: 2,
    referencesChecked: 2,
    linked: 0,
    truncated: false,
  });
  expect(await publicationLinks(t, referenceA)).toEqual([]);

  const artwork = await t.mutation(createArtwork, {
    accessKey,
    title: "Historical master",
    status: "finished",
  });
  await t.mutation(addRepresentation, {
    accessKey,
    artworkId: artwork!._id,
    kind: "master_export",
    storageProvider: "google_drive",
    driveFileId: "canonical-master",
    fileName: "canonical.png",
    mimeType: "image/png",
    contentHash: exactHash,
  });

  const after = await t.mutation(reconcileHash, { contentHash: exactHash });
  expect(after).toMatchObject({
    matchedAssets: 2,
    referencesChecked: 2,
    linked: 2,
    truncated: false,
  });
  for (const referenceId of [referenceA, referenceB]) {
    const links = await publicationLinks(t, referenceId);
    expect(links).toHaveLength(1);
    expect(links[0]?.artworkId).toBe(artwork!._id);
  }
});

it("remains idempotent when historical reconciliation is repeated", async () => {
  const t = fixture();
  const referenceId = await oldCapturedReference(t, "8003");
  const artwork = await t.mutation(createArtwork, {
    accessKey,
    title: "Idempotent master",
    status: "finished",
  });
  await t.mutation(addRepresentation, {
    accessKey,
    artworkId: artwork!._id,
    kind: "master_export",
    storageProvider: "google_drive",
    driveFileId: "canonical-idempotent",
    contentHash: exactHash,
  });

  const first = await t.mutation(reconcileHash, { contentHash: exactHash });
  const second = await t.mutation(reconcileHash, { contentHash: exactHash });

  expect(first.linked).toBe(1);
  expect(second.linked).toBe(0);
  expect(second.results[0]?.status).toBe("already_linked");
  expect(await publicationLinks(t, referenceId)).toHaveLength(1);
});
