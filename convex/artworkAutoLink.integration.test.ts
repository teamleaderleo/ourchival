// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const accessKey = "artwork-autolink-owner";
const createArtwork = makeFunctionReference<"mutation">("artworks:create");
const addRepresentation = makeFunctionReference<"mutation">(
  "artworks:addRepresentation",
);
const linkPublication = makeFunctionReference<"mutation">(
  "artworks:linkPublication",
);
const reconcileCapturedReference = makeFunctionReference<"mutation">(
  "artworkAutoLink:reconcileCapturedReference",
);

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
  return convexTest(schema, modules);
}

async function artwork(t: ReturnType<typeof fixture>, title: string) {
  return await t.mutation(createArtwork, {
    accessKey,
    title,
    status: "finished",
  });
}

async function representation(
  t: ReturnType<typeof fixture>,
  artworkId: string,
  suffix: string,
  contentHash: string,
) {
  return await t.mutation(addRepresentation, {
    accessKey,
    artworkId,
    kind: "master_export",
    storageProvider: "google_drive",
    driveFileId: `master-${suffix}`,
    fileName: `${suffix}.png`,
    mimeType: "image/png",
    contentHash,
  });
}

async function capturedReference(t: ReturnType<typeof fixture>, suffix: string) {
  return await t.run((ctx) =>
    ctx.db.insert("references", {
      kind: "post",
      platform: "pixiv",
      sourceUrl: `https://www.pixiv.net/artworks/${suffix}`,
      canonicalUrl: `https://www.pixiv.net/artworks/${suffix}`,
      postId: suffix,
      capturedAt: 10,
      publishedAt: 9,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    }),
  );
}

async function capturedAsset(
  t: ReturnType<typeof fixture>,
  referenceId: string,
  index: number,
  options: {
    contentHash?: string;
    storageProvider?: "google_drive" | "convex" | "linked";
    sourceCount?: number;
    sourceIndex?: number;
  } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("assets", {
      referenceId,
      storageProvider: options.storageProvider ?? "google_drive",
      driveFileId:
        (options.storageProvider ?? "google_drive") === "google_drive"
          ? `captured-${referenceId}-${index}`
          : undefined,
      originalUrl: `https://example.test/captured-${index}.png`,
      sourceIndex: options.sourceIndex ?? index,
      sourceCount: options.sourceCount ?? 1,
      mimeType: "image/png",
      ...(options.contentHash ? { contentHash: options.contentHash } : {}),
      dominantColors: [],
    }),
  );
}

async function publicationLinks(t: ReturnType<typeof fixture>, referenceId: string) {
  return await t.run((ctx) =>
    ctx.db
      .query("artworkPublications")
      .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
      .collect(),
  );
}

it("auto-links a single durable captured image when its exact bytes identify one artwork", async () => {
  const t = fixture();
  const art = await artwork(t, "Exact artwork");
  await representation(t, art!._id, "exact", "sha256:exact");
  const referenceId = await capturedReference(t, "501");
  await capturedAsset(t, referenceId, 0, { contentHash: "sha256:exact" });

  const result = await t.mutation(reconcileCapturedReference, {
    accessKey,
    referenceId,
  });

  expect(result).toMatchObject({
    status: "linked",
    changed: true,
    artworkId: String(art!._id),
    assetCount: 1,
    expectedAssetCount: 1,
  });
  const links = await publicationLinks(t, referenceId);
  expect(links).toHaveLength(1);
  expect(links[0]?.artworkId).toBe(art!._id);
});

it("auto-links a multi-image publication only when every exact hash resolves to the same artwork", async () => {
  const t = fixture();
  const art = await artwork(t, "Two-page artwork");
  await representation(t, art!._id, "page-a", "sha256:page-a");
  await representation(t, art!._id, "page-b", "sha256:page-b");
  const referenceId = await capturedReference(t, "502");
  await capturedAsset(t, referenceId, 0, {
    contentHash: "sha256:page-a",
    sourceCount: 2,
  });
  await capturedAsset(t, referenceId, 1, {
    contentHash: "sha256:page-b",
    sourceCount: 2,
  });

  const result = await t.mutation(reconcileCapturedReference, {
    accessKey,
    referenceId,
  });

  expect(result).toMatchObject({
    status: "linked",
    artworkId: String(art!._id),
    assetCount: 2,
    expectedAssetCount: 2,
  });
  expect(await publicationLinks(t, referenceId)).toHaveLength(1);
});

it("waits for a complete source asset set before linking", async () => {
  const t = fixture();
  const art = await artwork(t, "Chunked artwork");
  await representation(t, art!._id, "chunk-a", "sha256:chunk-a");
  const referenceId = await capturedReference(t, "5021");
  await capturedAsset(t, referenceId, 0, {
    contentHash: "sha256:chunk-a",
    sourceCount: 2,
  });

  const result = await t.mutation(reconcileCapturedReference, {
    accessKey,
    referenceId,
  });

  expect(result).toMatchObject({
    status: "review",
    changed: false,
    assetCount: 1,
    expectedAssetCount: 2,
  });
  expect(result.message).toContain("incomplete");
  expect(await publicationLinks(t, referenceId)).toEqual([]);
});

it("refuses duplicate or inconsistent source indexes", async () => {
  const t = fixture();
  const art = await artwork(t, "Index guard artwork");
  await representation(t, art!._id, "index-a", "sha256:index-a");
  const referenceId = await capturedReference(t, "5022");
  await capturedAsset(t, referenceId, 0, {
    contentHash: "sha256:index-a",
    sourceCount: 2,
    sourceIndex: 0,
  });
  await capturedAsset(t, referenceId, 1, {
    contentHash: "sha256:index-a",
    sourceCount: 2,
    sourceIndex: 0,
  });

  const result = await t.mutation(reconcileCapturedReference, {
    accessKey,
    referenceId,
  });

  expect(result).toMatchObject({
    status: "review",
    changed: false,
    expectedAssetCount: 2,
  });
  expect(result.message).toContain("duplicate or missing");
  expect(await publicationLinks(t, referenceId)).toEqual([]);
});

it("refuses to link a carousel whose exact hashes resolve to different artworks", async () => {
  const t = fixture();
  const [artA, artB] = await Promise.all([
    artwork(t, "Artwork A"),
    artwork(t, "Artwork B"),
  ]);
  await representation(t, artA!._id, "mixed-a", "sha256:mixed-a");
  await representation(t, artB!._id, "mixed-b", "sha256:mixed-b");
  const referenceId = await capturedReference(t, "503");
  await capturedAsset(t, referenceId, 0, {
    contentHash: "sha256:mixed-a",
    sourceCount: 2,
  });
  await capturedAsset(t, referenceId, 1, {
    contentHash: "sha256:mixed-b",
    sourceCount: 2,
  });

  const result = await t.mutation(reconcileCapturedReference, {
    accessKey,
    referenceId,
  });

  expect(result).toMatchObject({ status: "ambiguous", changed: false });
  expect(await publicationLinks(t, referenceId)).toEqual([]);
});

it("requires complete durable hash evidence for every captured asset", async () => {
  const t = fixture();
  const art = await artwork(t, "Partial evidence artwork");
  await representation(t, art!._id, "partial", "sha256:partial");
  const referenceId = await capturedReference(t, "504");
  await capturedAsset(t, referenceId, 0, {
    contentHash: "sha256:partial",
    sourceCount: 2,
  });
  await capturedAsset(t, referenceId, 1, {
    storageProvider: "linked",
    sourceCount: 2,
  });

  const result = await t.mutation(reconcileCapturedReference, {
    accessKey,
    referenceId,
  });

  expect(result).toMatchObject({
    status: "review",
    changed: false,
    assetCount: 2,
    expectedAssetCount: 2,
    hashedDurableAssetCount: 1,
  });
  expect(await publicationLinks(t, referenceId)).toEqual([]);
});

it("refuses a hash that is already represented by more than one canonical artwork", async () => {
  const t = fixture();
  const [artA, artB] = await Promise.all([
    artwork(t, "Artwork A"),
    artwork(t, "Artwork B"),
  ]);
  await representation(t, artA!._id, "shared-a", "sha256:shared");
  await representation(t, artB!._id, "shared-b", "sha256:shared");
  const referenceId = await capturedReference(t, "505");
  await capturedAsset(t, referenceId, 0, { contentHash: "sha256:shared" });

  const result = await t.mutation(reconcileCapturedReference, {
    accessKey,
    referenceId,
  });

  expect(result).toMatchObject({ status: "ambiguous", changed: false });
  expect(new Set((result as any).artworkIds)).toEqual(
    new Set([String(artA!._id), String(artB!._id)]),
  );
  expect(await publicationLinks(t, referenceId)).toEqual([]);
});

it("never overrides an existing explicit publication relationship, including multi-art posts", async () => {
  const t = fixture();
  const [artA, artB] = await Promise.all([
    artwork(t, "Artwork A"),
    artwork(t, "Artwork B"),
  ]);
  const referenceId = await capturedReference(t, "506");
  await t.mutation(linkPublication, { accessKey, artworkId: artA!._id, referenceId });
  await t.mutation(linkPublication, { accessKey, artworkId: artB!._id, referenceId });
  await capturedAsset(t, referenceId, 0, { contentHash: "sha256:any" });

  const result = await t.mutation(reconcileCapturedReference, {
    accessKey,
    referenceId,
  });

  expect(result).toMatchObject({ status: "already_linked", changed: false });
  expect(new Set((result as any).artworkIds)).toEqual(
    new Set([String(artA!._id), String(artB!._id)]),
  );
  expect(await publicationLinks(t, referenceId)).toHaveLength(2);
});

it("fails closed for unmatched bytes and invalid owner access", async () => {
  const t = fixture();
  const referenceId = await capturedReference(t, "507");
  await capturedAsset(t, referenceId, 0, { contentHash: "sha256:unknown" });

  const result = await t.mutation(reconcileCapturedReference, {
    accessKey,
    referenceId,
  });
  expect(result).toMatchObject({ status: "unmatched", changed: false });
  expect(await publicationLinks(t, referenceId)).toEqual([]);

  await expect(
    t.mutation(reconcileCapturedReference, {
      accessKey: "wrong",
      referenceId,
    }),
  ).rejects.toThrow();
});
