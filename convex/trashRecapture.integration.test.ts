// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

test("Trash is retained during source, canonical and asset deduplication", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    const referenceId = await ctx.db.insert("references", {
      kind: "image", platform: "manual", sourceUrl: "https://example.com/post",
      canonicalUrl: "https://example.com/canonical", capturedAt: 1,
      boardIds: [], tagIds: [], favorite: false, archived: true, deleted: true,
    });
    await ctx.db.insert("assets", { referenceId, originalUrl: "https://example.com/art.png", dominantColors: [] });
    return referenceId;
  });
  for (const args of [
    { sourceUrl: "https://example.com/post", canonicalUrl: "https://example.com/other" },
    { sourceUrl: "https://example.com/other", canonicalUrl: "https://example.com/canonical" },
    { sourceUrl: "https://example.com/other", canonicalUrl: "https://example.com/other", assetUrl: "https://example.com/art.png" },
  ]) {
    const hit = await t.query(internal.httpDb.findDuplicateCapture, args);
    expect(hit?.reference._id).toBe(id);
    expect(hit?.reference.deleted).toBe(true);
  }
  await t.mutation(internal.httpDb.saveDuplicateCapture, {
    referenceId: id, reason: "source_url", body: {}, tagNames: ["must not be added"], details: { postText: "must not overwrite" },
  });
  await t.run(async (ctx) => {
    expect((await ctx.db.get(id))?.tagIds).toEqual([]);
    expect(await ctx.db.query("sourceSnapshots").first()).toBeNull();
    await ctx.db.patch(id, { deleted: false, archived: false });
  });
  const restored = await t.query(internal.httpDb.findDuplicateCapture, { sourceUrl: "https://example.com/post", canonicalUrl: "https://example.com/canonical" });
  expect(restored?.reference.deleted).toBe(false);
});

test("An existing asset can be recaptured without a fetched replacement", async () => {
  const t = convexTest(schema, modules);
  const { referenceId, assetId } = await t.run(async (ctx) => {
    const referenceId = await ctx.db.insert("references", {
      kind: "image",
      platform: "pinterest",
      sourceUrl: "https://www.pinterest.com/pin/123/",
      capturedAt: 1,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });
    const assetId = await ctx.db.insert("assets", {
      referenceId,
      originalUrl: "https://i.pinimg.com/originals/a/b/c.jpg",
      dominantColors: [],
    });
    return { referenceId, assetId };
  });

  await expect(
    t.mutation(internal.httpDb.saveDuplicateCapture, {
      referenceId,
      reason: "source_url",
      assetUrl: "https://i.pinimg.com/originals/a/b/c.jpg",
      body: { kind: "image" },
      tagNames: [],
      details: { assetIndex: 0, assetCount: 1 },
    }),
  ).resolves.toBeTruthy();

  await t.run(async (ctx) => {
    const asset = await ctx.db.get(assetId);
    expect(asset?.storageProvider).toBeUndefined();
    expect(asset?.sourceIndex).toBe(0);
    expect(asset?.sourceCount).toBe(1);
  });
});
