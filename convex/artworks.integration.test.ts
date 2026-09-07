// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const accessKey = "artwork-fixture-owner";
const createArtwork = makeFunctionReference<"mutation">("artworks:create");
const listArtworks = makeFunctionReference<"query">("artworks:list");
const getArtwork = makeFunctionReference<"query">("artworks:get");
const addRepresentation = makeFunctionReference<"mutation">(
  "artworks:addRepresentation",
);
const linkPublication = makeFunctionReference<"mutation">(
  "artworks:linkPublication",
);
const listForReference = makeFunctionReference<"query">(
  "artworks:listForReference",
);

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
  return convexTest(schema, modules);
}

async function insertPublishedReference(t: ReturnType<typeof fixture>) {
  return await t.run((ctx) =>
    ctx.db.insert("references", {
      kind: "post",
      platform: "pixiv",
      sourceUrl: "https://www.pixiv.net/artworks/131",
      canonicalUrl: "https://www.pixiv.net/artworks/131",
      postId: "131",
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

it("keeps one artwork identity across Drive originals and captured publications", async () => {
  const t = fixture();
  const artwork = await t.mutation(createArtwork, {
    accessKey,
    title: "  Pink   Navia  ",
    status: "finished",
    startedAt: 100,
    completedAt: 200,
  });
  expect(artwork).toMatchObject({ title: "Pink Navia", status: "finished" });

  const representation = await t.mutation(addRepresentation, {
    accessKey,
    artworkId: artwork!._id,
    kind: "editable_source",
    storageProvider: "google_drive",
    driveFileId: "drive-procreate-131",
    fileName: "Pink Navia.procreate",
    sourceApplication: "procreate",
  });
  const repeatedRepresentation = await t.mutation(addRepresentation, {
    accessKey,
    artworkId: artwork!._id,
    kind: "editable_source",
    storageProvider: "google_drive",
    driveFileId: "drive-procreate-131",
  });
  expect(repeatedRepresentation?._id).toBe(representation?._id);

  const referenceId = await insertPublishedReference(t);
  const publication = await t.mutation(linkPublication, {
    accessKey,
    artworkId: artwork!._id,
    referenceId,
  });
  const repeatedPublication = await t.mutation(linkPublication, {
    accessKey,
    artworkId: artwork!._id,
    referenceId,
  });
  expect(repeatedPublication?._id).toBe(publication?._id);

  const result = await t.query(getArtwork, {
    accessKey,
    artworkId: artwork!._id,
  });
  expect(result?.representations).toHaveLength(1);
  expect(result?.representations[0]).toMatchObject({
    kind: "editable_source",
    driveFileId: "drive-procreate-131",
    sourceApplication: "procreate",
  });
  expect(result?.publications).toHaveLength(1);
  expect(result?.publications[0]?.reference).toMatchObject({
    id: referenceId,
    platform: "pixiv",
    postId: "131",
  });

  const sourceReference = await t.run((ctx) => ctx.db.get(referenceId));
  expect(sourceReference).toMatchObject({
    sourceUrl: "https://www.pixiv.net/artworks/131",
    postId: "131",
  });
});

it("allows one publication to contain multiple canonical artworks without merging them", async () => {
  const t = fixture();
  const [first, second] = await Promise.all([
    t.mutation(createArtwork, { accessKey, title: "Artwork A" }),
    t.mutation(createArtwork, { accessKey, title: "Artwork B" }),
  ]);
  const referenceId = await insertPublishedReference(t);

  await t.mutation(linkPublication, {
    accessKey,
    artworkId: first!._id,
    referenceId,
  });
  await t.mutation(linkPublication, {
    accessKey,
    artworkId: second!._id,
    referenceId,
  });

  const linked = await t.query(listForReference, { accessKey, referenceId });
  expect(linked.truncated).toBe(false);
  expect(linked.page).toHaveLength(2);
  expect(new Set(linked.page.map((row: any) => row.artwork?.title))).toEqual(
    new Set(["Artwork A", "Artwork B"]),
  );
});

it("fails closed on ambiguous file identity, invalid locators, access, and oversized reads", async () => {
  const t = fixture();
  const first = await t.mutation(createArtwork, { accessKey, title: "Artwork A" });
  const second = await t.mutation(createArtwork, { accessKey, title: "Artwork B" });

  await t.mutation(addRepresentation, {
    accessKey,
    artworkId: first!._id,
    kind: "master_export",
    storageProvider: "google_drive",
    driveFileId: "same-drive-file",
  });
  await expect(
    t.mutation(addRepresentation, {
      accessKey,
      artworkId: second!._id,
      kind: "master_export",
      storageProvider: "google_drive",
      driveFileId: "same-drive-file",
    }),
  ).rejects.toThrow("another artwork");

  await expect(
    t.mutation(addRepresentation, {
      accessKey,
      artworkId: first!._id,
      kind: "web_derivative",
      storageProvider: "linked",
      linkedUrl: "not-a-url",
    }),
  ).rejects.toThrow("absolute http(s) URL");

  await expect(
    t.query(getArtwork, { accessKey: "wrong", artworkId: first!._id }),
  ).rejects.toThrow();
  await expect(
    t.query(listArtworks, {
      accessKey,
      paginationOpts: { numItems: 101, cursor: null },
    }),
  ).rejects.toThrow("100");
});
