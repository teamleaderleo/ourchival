// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const accessKey = "artwork-intake-owner";
const createArtwork = makeFunctionReference<"mutation">("artworks:create");
const addRepresentation = makeFunctionReference<"mutation">(
  "artworks:addRepresentation",
);
const linkPublication = makeFunctionReference<"mutation">(
  "artworks:linkPublication",
);
const resolveIntake = makeFunctionReference<"query">("artworkIntake:resolve");

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
  return convexTest(schema, modules);
}

async function createNamedArtwork(t: ReturnType<typeof fixture>, title: string) {
  return await t.mutation(createArtwork, { accessKey, title, status: "finished" });
}

async function addDriveRepresentation(
  t: ReturnType<typeof fixture>,
  artworkId: string,
  driveFileId: string,
  contentHash: string,
) {
  return await t.mutation(addRepresentation, {
    accessKey,
    artworkId,
    kind: "master_export",
    storageProvider: "google_drive",
    driveFileId,
    contentHash,
    fileName: `${driveFileId}.png`,
    mimeType: "image/png",
  });
}

async function insertReference(t: ReturnType<typeof fixture>, suffix: string) {
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

it("resolves exact identities, review-only hashes, and genuinely new files without writing", async () => {
  const t = fixture();
  const [artA, artB, artC] = await Promise.all([
    createNamedArtwork(t, "Artwork A"),
    createNamedArtwork(t, "Artwork B"),
    createNamedArtwork(t, "Artwork C"),
  ]);

  await addDriveRepresentation(t, artA!._id, "drive-a", "hash-a");
  await addDriveRepresentation(t, artB!._id, "drive-b", "hash-shared");
  await addDriveRepresentation(t, artC!._id, "drive-c", "hash-shared");

  const before = await t.run(async (ctx) => ({
    artworks: await ctx.db.query("artworks").take(10),
    representations: await ctx.db.query("artworkRepresentations").take(10),
  }));

  const result = await t.query(resolveIntake, {
    accessKey,
    observations: [
      { key: "exact", kind: "drive_file", driveFileId: "drive-a" },
      {
        key: "review",
        kind: "drive_file",
        driveFileId: "unknown-review",
        contentHash: "hash-a",
      },
      {
        key: "ambiguous",
        kind: "drive_file",
        driveFileId: "unknown-ambiguous",
        contentHash: "hash-shared",
      },
      { key: "new", kind: "drive_file", driveFileId: "unknown-new" },
    ],
  });

  expect(result[0]).toMatchObject({
    key: "exact",
    resolution: "exact",
    evidence: "drive_file_id",
    candidates: [{ artwork: { title: "Artwork A" } }],
  });
  expect(result[1]).toMatchObject({
    key: "review",
    resolution: "review",
    evidence: "content_hash",
    candidates: [{ artwork: { title: "Artwork A" } }],
  });
  expect(result[2]).toMatchObject({
    key: "ambiguous",
    resolution: "ambiguous",
    evidence: "content_hash",
  });
  expect(
    new Set(result[2].candidates.map((candidate: any) => candidate.artwork.title)),
  ).toEqual(new Set(["Artwork B", "Artwork C"]));
  expect(result[3]).toMatchObject({
    key: "new",
    resolution: "unresolved",
    evidence: null,
    candidates: [],
  });

  const after = await t.run(async (ctx) => ({
    artworks: await ctx.db.query("artworks").take(10),
    representations: await ctx.db.query("artworkRepresentations").take(10),
  }));
  expect(after).toEqual(before);
});

it("treats explicit publication links as exact even when one post contains several artworks", async () => {
  const t = fixture();
  const [artA, artB] = await Promise.all([
    createNamedArtwork(t, "Artwork A"),
    createNamedArtwork(t, "Artwork B"),
  ]);
  const referenceId = await insertReference(t, "131");

  await t.mutation(linkPublication, { accessKey, artworkId: artA!._id, referenceId });
  await t.mutation(linkPublication, { accessKey, artworkId: artB!._id, referenceId });

  const result = await t.query(resolveIntake, {
    accessKey,
    observations: [{ key: "post", kind: "publication", referenceId }],
  });

  expect(result[0]).toMatchObject({
    key: "post",
    kind: "publication",
    resolution: "exact",
    evidence: "publication_link",
    reference: { id: referenceId, platform: "pixiv", postId: "131" },
    truncated: false,
  });
  expect(new Set(result[0].candidates.map((candidate: any) => candidate.title))).toEqual(
    new Set(["Artwork A", "Artwork B"]),
  );
});

it("distinguishes unresolved and missing publication references", async () => {
  const t = fixture();
  const unresolvedReferenceId = await insertReference(t, "201");
  const missingReferenceId = await insertReference(t, "202");
  await t.run((ctx) => ctx.db.delete(missingReferenceId));

  const result = await t.query(resolveIntake, {
    accessKey,
    observations: [
      { key: "unlinked", kind: "publication", referenceId: unresolvedReferenceId },
      { key: "missing", kind: "publication", referenceId: missingReferenceId },
    ],
  });

  expect(result[0]).toMatchObject({
    key: "unlinked",
    resolution: "unresolved",
    candidates: [],
  });
  expect(result[1]).toMatchObject({
    key: "missing",
    resolution: "missing_reference",
    reference: null,
    candidates: [],
  });
});

it("fails closed on bad access, duplicate keys, invalid linked URLs, and oversized batches", async () => {
  const t = fixture();

  await expect(
    t.query(resolveIntake, {
      accessKey: "wrong",
      observations: [{ key: "one", kind: "drive_file", driveFileId: "drive-a" }],
    }),
  ).rejects.toThrow();

  await expect(
    t.query(resolveIntake, {
      accessKey,
      observations: [
        { key: "same", kind: "drive_file", driveFileId: "a" },
        { key: "same", kind: "drive_file", driveFileId: "b" },
      ],
    }),
  ).rejects.toThrow("Duplicate observation key");

  await expect(
    t.query(resolveIntake, {
      accessKey,
      observations: [{ key: "bad-url", kind: "linked_file", linkedUrl: "not-a-url" }],
    }),
  ).rejects.toThrow("absolute http(s) URL");

  await expect(
    t.query(resolveIntake, {
      accessKey,
      observations: Array.from({ length: 101 }, (_, index) => ({
        key: `row-${index}`,
        kind: "drive_file" as const,
        driveFileId: `drive-${index}`,
      })),
    }),
  ).rejects.toThrow("100");
});
