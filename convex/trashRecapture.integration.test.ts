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
