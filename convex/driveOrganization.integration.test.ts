// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { it, expect, vi, afterEach } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());
it("includes nested files in reconciliation and preserves the image identity when repairing a folder", async () => {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
  vi.stubEnv("GOOGLE_DRIVE_PARENT_FOLDER_ID", "root");
  const t = convexTest(schema, modules);
  const assetId = await t.run(async ctx => {
    const referenceId = await ctx.db.insert("references", {
      kind: "post", platform: "pixiv", sourceUrl: "https://www.pixiv.net/artworks/1",
      capturedAt: 1, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false,
    });
    return ctx.db.insert("assets", { referenceId, driveFileId: "stable-id", driveFolderId: "old-nested-folder", dominantColors: [] });
  });
  const args = { accessKey: "owner", paginationOpts: { cursor: null, numItems: 500 } };
  const endpoint = makeFunctionReference<"query">("driveOrganization:rootPointers");
  expect((await t.query(endpoint, args)).items).toEqual([]);
  expect((await t.query(endpoint, { ...args, all: true })).items).toEqual([
    { id: assetId, fileId: "stable-id", parent: "old-nested-folder" },
  ]);
  await t.mutation(makeFunctionReference<"mutation">("driveOrganization:remember"), {
    accessKey: "owner", moves: [{ id: "stable-id", parent: "user-chosen-folder" }],
  });
  expect(await t.run(ctx => ctx.db.get(assetId))).toMatchObject({ driveFileId: "stable-id", driveFolderId: "user-chosen-folder" });
  await expect(t.query(endpoint, { ...args, all: true, accessKey: "wrong" })).rejects.toThrow();
});
it("routes owned originals and uninstrumented legacy rows without changing bytes", async () => {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const artworkId = await ctx.db.insert("artworks", {
      title: "Mine",
      status: "finished",
      createdAt: 1,
      updatedAt: 1,
    });
    for (const own of [true, false]) {
      const referenceId = await ctx.db.insert("references", {
        kind: "post",
        platform: "x",
        sourceUrl: "https://x.com/a/status/1",
        capturedAt: 1,
        boardIds: [],
        tagIds: [],
        favorite: false,
        archived: false,
        deleted: false,
      });
      await ctx.db.insert("assets", {
        referenceId,
        driveFileId: own ? "mine" : "legacy",
        dominantColors: [],
        ...(own
          ? { fetchedUrl: "https://pbs.twimg.com/media/a?name=orig" }
          : { quality: "original" }),
      });
      if (own)
        await ctx.db.insert("artworkPublications", {
          referenceId,
          artworkId,
          createdAt: 1,
          updatedAt: 1,
        });
    }
  });
  const ref = makeFunctionReference<"query">("driveOrganization:classify");
  const args = {
    accessKey: "owner",
    files: [
      { id: "mine", sourceUrl: "" },
      { id: "legacy", sourceUrl: "" },
    ],
  };
  expect(await t.query(ref, args)).toEqual([
    { id: "mine", path: "My Art/Twitter (X)/Posted originals" },
    { id: "legacy", path: "Twitter (X)/Unverified images" },
  ]);
  await expect(t.query(ref, { ...args, accessKey: "wrong" })).rejects.toThrow();
});
