// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { expandVisual, compactVisual } from "./lib/compactVisual";
import { encodeTags, decodeTags } from "./lib/tagCodec";
const modules = import.meta.glob("./**/*.ts");
const start = makeFunctionReference<"mutation">("metadataMigration:start");
const accessKey = "migration-test";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("binary codec preserves uint32 boundaries and rejects malformed values", () => {
  const entries: Array<[number, number]> = [
    [0xffffffff, 0.35000000000000003],
    [1, 1],
  ];
  expect(decodeTags(encodeTags(entries))).toEqual([...entries].reverse());
  expect(Array.from(new Uint8Array(encodeTags([])))).toEqual([
    79, 84, 71, 1, 0, 0, 0, 0,
  ]);
  expect(() =>
    encodeTags([
      [1, 0.2],
      [1, 0.3],
    ]),
  ).toThrow();
  expect(() => encodeTags([[0, 0.2]])).toThrow();
  expect(() => encodeTags([[1, NaN]])).toThrow();
  expect(() => decodeTags(new ArrayBuffer(7))).toThrow();
  const bad = encodeTags(entries);
  new DataView(bad).setUint8(3, 2);
  expect(() => decodeTags(bad)).toThrow();
});

test("migration resumes, shares dictionaries and recipes, and preserves corrections and public values", async () => {
  const t = convexTest(schema, modules);
  const tags = [
    {
      name: "from_above",
      category: "general" as const,
      confidence: 0.35000000000000003,
    },
  ];
  const models = [
    { id: "test", revision: "1", sha256: "a".repeat(64), task: "tags" },
  ];
  const ids = await t.run(async (ctx) => {
    const tagId = await ctx.db.insert("tags", {
      name: "Saved",
      slug: "saved",
      createdAt: 1,
    });
    const referenceId = await ctx.db.insert("references", {
      kind: "image",
      platform: "manual",
      sourceUrl: "https://example.com/a",
      capturedAt: 1,
      boardIds: [],
      tagIds: [tagId],
      favorite: false,
      deleted: false,
      archived: false,
    });
    const inputStorageId = await ctx.storage.store(new Blob(["unchanged"]));
    const results = [];
    for (let i = 0; i < 5; i++) {
      const assetId = await ctx.db.insert("assets", {
        referenceId,
        originalStorageId: inputStorageId,
        dominantColors: [],
      });
      const id = await ctx.db.insert("visualEnrichments", {
        assetId,
        referenceId,
        inputStorageId,
        inputSha256: "b".repeat(64),
        pipelineFingerprint: "c".repeat(64),
        models,
        tags,
        ratings: [],
        ocrText: "Keep this",
        revision: 4,
        createdAt: 1,
        updatedAt: 2,
      });
      await ctx.db.insert("visualCorrections", {
        assetId,
        rejectedTags: ["from_above"],
        hideOcr: true,
        hideCaption: false,
        revision: 3,
        updatedAt: 3,
      });
      results.push(id);
    }
    return { results, tagId, referenceId };
  });
  await expect(t.mutation(start, { accessKey: "wrong" })).rejects.toThrow();
  await t.mutation(start, { accessKey });
  await t.mutation(start, { accessKey }); // Older scheduled generation must do nothing.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.run(async (ctx) => {
    expect((await ctx.db.query("metadataMigration").unique())!.phase).toBe(
      "complete",
    );
    expect((await ctx.db.get(ids.tagId))!.code).toBe(1);
    expect((await ctx.db.get(ids.referenceId))!.tagIds).toEqual([ids.tagId]);
    expect(await ctx.db.query("visualTerms").collect()).toHaveLength(1);
    expect(await ctx.db.query("visualRecipes").collect()).toHaveLength(1);
    for (const id of ids.results) {
      const row = (await ctx.db.get(id))!;
      expect(row.tags).toBeUndefined();
      expect(row.models).toBeUndefined();
      expect(row).toMatchObject({
        revision: 4,
        ocrText: "Keep this",
        updatedAt: 2,
      });
      expect(await expandVisual(ctx, row)).toEqual({ tags, models });
    }
    expect(
      (await ctx.db.query("visualCorrections").first())!.rejectedTags,
    ).toEqual(["from_above"]);
  });
  await t.mutation(start, { accessKey });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test("conflicting recipe provenance is rejected without changing shared metadata", async () => {
  const t = convexTest(schema, modules);
  const model = { id: "test", revision: "1", sha256: "a", task: "tags" };
  await t.run((ctx) => compactVisual(ctx, [], [model], "fingerprint"));
  await expect(
    t.run((ctx) =>
      compactVisual(ctx, [], [{ ...model, revision: "2" }], "fingerprint"),
    ),
  ).rejects.toThrow("conflicting");
  await t.run(async (ctx) => {
    expect((await ctx.db.query("visualRecipes").unique())!.models).toEqual([
      model,
    ]);
  });
});
