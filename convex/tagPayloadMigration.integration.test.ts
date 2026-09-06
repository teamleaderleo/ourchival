// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { decodeTags, encodeTags } from "./lib/tagCodec";

const modules = import.meta.glob("./**/*.ts");
const start = makeFunctionReference<"mutation">("tagPayloadMigration:start");
const page = makeFunctionReference<"mutation">("tagPayloadMigration:page");
const status = makeFunctionReference<"query">("tagPayloadMigration:status");
const accessKey = "compact-test";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function seed(t: ReturnType<typeof convexTest>, count = 35) {
  return await t.run(async (ctx) => {
    const referenceId = await ctx.db.insert("references", {
      kind: "image",
      platform: "manual",
      sourceUrl: "https://example.com/image",
      capturedAt: 1,
      boardIds: [],
      tagIds: [],
      favorite: false,
      deleted: false,
      archived: false,
    });
    const inputStorageId = await ctx.storage.store(new Blob(["original"]));
    const assetId = await ctx.db.insert("assets", {
      referenceId,
      originalStorageId: inputStorageId,
      dominantColors: [],
    });
    const rows = [];
    for (let i = 0; i < count; i++) {
      const id = await ctx.db.insert("visualEnrichments", {
        referenceId,
        assetId,
        inputStorageId,
        inputSha256: "a".repeat(64),
        pipelineFingerprint: "b".repeat(64),
        ratings: [],
        tagPayload: encodeTags(
          [
            [1, -0],
            [129, 0.35000000000000003],
            [0xffffffff, 1],
          ],
          1,
        ),
        caption: "unchanged",
        revision: 4,
        createdAt: 1,
        updatedAt: 2,
      });
      rows.push((await ctx.db.get(id))!);
    }
    return rows;
  });
}

test("resumes the cursor, fences old jobs, verifies exact values and changes only smaller payloads", async () => {
  const t = convexTest(schema, modules);
  const before = await seed(t);
  await expect(t.mutation(start, { accessKey: "wrong" })).rejects.toThrow();
  await expect(t.query(status, { accessKey: "wrong" })).rejects.toThrow();
  await t.mutation(start, { accessKey });
  // Commit one page, then simulate a restart before its successor executes.
  await t.mutation(page, { generation: 1, cursor: null });
  expect((await t.query(status, { accessKey })).processed).toBe(16);
  await t.mutation(start, { accessKey });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const receipt = await t.query(status, { accessKey });
  expect(receipt).toMatchObject({
    phase: "complete",
    processed: 35,
    changed: 35,
    skipped: 0,
  });
  expect(receipt.afterBytes).toBeLessThan(receipt.beforeBytes);
  await t.run(async (ctx) => {
    for (const row of before) {
      const after = (await ctx.db.get(row._id))!;
      expect({ ...after, tagPayload: undefined }).toEqual({
        ...row,
        tagPayload: undefined,
      });
      expect(decodeTags(after.tagPayload!)).toEqual(
        decodeTags(row.tagPayload!),
      );
    }
  });
  await t.mutation(start, { accessKey });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(status, { accessKey })).toEqual(receipt);
});

test("invalid data rolls back the whole page including counters and earlier writes", async () => {
  const t = convexTest(schema, modules);
  const before = await seed(t, 2);
  await t.run((ctx) =>
    ctx.db.patch(before[1]._id, { tagPayload: new ArrayBuffer(3) }),
  );
  await t.mutation(start, { accessKey });
  await expect(
    t.mutation(page, { generation: 1, cursor: null }),
  ).rejects.toThrow();
  expect((await t.query(status, { accessKey })).processed).toBe(0);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(before[0]._id))!.tagPayload).toEqual(
      before[0].tagPayload,
    );
  });
  // Repair then resume the committed cursor. No partially migrated rows survive.
  await t.run((ctx) =>
    ctx.db.patch(before[1]._id, { tagPayload: before[1].tagPayload }),
  );
  await t.mutation(start, { accessKey });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.query(status, { accessKey })).processed).toBe(2);
});

test("already compact and inline rows are counted without fabricating savings", async () => {
  const t = convexTest(schema, modules);
  const rows = await seed(t, 2);
  const packed = encodeTags([[1, 0.5]]);
  await t.run(async (ctx) => {
    await ctx.db.patch(rows[0]._id, { tagPayload: packed });
    await ctx.db.patch(rows[1]._id, {
      tagPayload: undefined,
      tags: [],
      models: [],
    });
  });
  await t.mutation(start, { accessKey });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(status, { accessKey })).toMatchObject({
    phase: "complete",
    processed: 2,
    changed: 0,
    skipped: 1,
    beforeBytes: packed.byteLength,
    afterBytes: packed.byteLength,
  });
});
