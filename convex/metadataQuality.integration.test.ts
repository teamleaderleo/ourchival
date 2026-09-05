// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { getSourceContext } from "./lib/sourceContext";
import { applySourceMetadata } from "./lib/sourceMetadata";
const modules = import.meta.glob("./**/*.ts");
const accessKey = "metadata-test-owner";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const referenceId = await ctx.db.insert("references", {
      kind: "image",
      platform: "manual",
      title: "Saved drawing",
      sourceUrl: "https://example.com/drawing",
      capturedAt: 1,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });
    const inputStorageId = await ctx.storage.store(new Blob(["original"]));
    const assetId = await ctx.db.insert("assets", {
      referenceId,
      originalStorageId: inputStorageId,
      dominantColors: [],
    });
    return { referenceId, assetId, inputStorageId };
  });
  const payload = {
    accessKey,
    assetId: ids.assetId,
    inputStorageId: ids.inputStorageId,
    originalContentHash: null,
    inputSha256: "a".repeat(64),
    pipelineFingerprint: "b".repeat(64),
    expectedRevision: 0,
    models: [
      { id: "test/model", revision: "1", sha256: "c".repeat(64), task: "tags" },
    ],
    tags: [
      { name: "blue_hair", category: "general" as const, confidence: 0.8 },
    ],
    ratings: [{ label: "sensitive", confidence: 0.9 }],
    ocrText: "Visible writing",
  };
  return { t, ...ids, payload };
}

test("sparse refreshes preserve captured text and the field's original provenance", async () => {
  const { t, referenceId } = await fixture();
  const originalId = await t.run((ctx) =>
    ctx.db.insert("sourceSnapshots", {
      referenceId,
      postText: "Midnight harbor",
      altText: "A yellow raincoat",
      createdAt: 100,
    }),
  );
  let descriptionId: string | undefined;
  await t.run(async (ctx) => {
    const reference = await ctx.db.get(referenceId);
    const result = await applySourceMetadata(ctx, {
      reference,
      reason: "manual_refresh",
      metadata: {
        description: "Watercolor study",
        metadataStatus: "ready",
        metadataFetchedAt: 200,
      },
    });
    descriptionId = result.snapshotId;
  });
  await t.run(async (ctx) => {
    await applySourceMetadata(ctx, {
      reference: await ctx.db.get(referenceId),
      reason: "manual_refresh",
      metadata: {
        description: "   ",
        metadataStatus: "failed",
        metadataFetchedAt: 300,
      },
    });
    const view = await getSourceContext(ctx, referenceId);
    expect(view).toMatchObject({
      postText: "Midnight harbor",
      altText: "A yellow raincoat",
      description: "Watercolor study",
    });
    expect(view?.fieldSources.postText).toEqual({
      snapshotId: originalId,
      capturedAt: 100,
    });
    expect(view?.fieldSources.description.snapshotId).toBe(descriptionId);
    expect(await ctx.db.get(originalId)).not.toHaveProperty("description");
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const page = await t.query(internal.httpDb.listReferences, {
    url: "https://archive.test/references?collection=library&query=midnight",
  });
  expect(page.references).toHaveLength(1);
});

test("read projection restores original context hidden by an older sparse refresh", async () => {
  const { t, referenceId } = await fixture();
  await t.run(async (ctx) => {
    await ctx.db.insert("sourceSnapshots", {
      referenceId,
      postText: "Captured post",
      createdAt: 1,
    });
    await ctx.db.insert("sourceSnapshots", {
      referenceId,
      description: "Later page metadata",
      createdAt: 2,
    });
    expect(await getSourceContext(ctx, referenceId)).toMatchObject({
      postText: "Captured post",
      description: "Later page metadata",
    });
    expect(await ctx.db.query("sourceSnapshots").collect()).toHaveLength(2);
  });
});

test("model tag aliases collapse to one scored prediction without changing saved tags", async () => {
  const { t, referenceId, payload } = await fixture();
  await t.mutation(api.visualEnrichment.submit, {
    ...payload,
    tags: [
      { name: "BLUE hair", category: "general", confidence: 0.7 },
      { name: "blue_hair", category: "general", confidence: 0.9 },
    ],
  });
  const view = await t.query(api.visualEnrichment.inspect, {
    accessKey,
    referenceId,
  });
  expect(view.items[0].tags).toEqual([
    {
      name: "blue_hair",
      category: "general",
      confidence: 0.9,
      rejected: false,
    },
  ]);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(referenceId))?.tagIds).toEqual([]);
    expect(
      (await ctx.db.query("referenceSearchDocuments").first())?.text,
    ).not.toContain("sensitive");
  });
});

test("corrections reject stale edits and survive model replacement; changed images show stale state", async () => {
  const { t, referenceId, assetId, payload } = await fixture();
  await t.mutation(api.visualEnrichment.submit, payload);
  const change = {
    accessKey,
    assetId,
    expectedRevision: 0,
    rejectedTags: ["BLUE hair"],
    hideOcr: true,
    hideCaption: false,
  };
  await t.mutation(api.visualEnrichment.correct, change);
  await expect(
    t.mutation(api.visualEnrichment.correct, { ...change, rejectedTags: [] }),
  ).rejects.toThrow("changed elsewhere");
  await t.mutation(api.visualEnrichment.submit, {
    ...payload,
    expectedRevision: 1,
    pipelineFingerprint: "d".repeat(64),
  });
  const view = await t.query(api.visualEnrichment.inspect, {
    accessKey,
    referenceId,
  });
  expect(view.items[0]).toMatchObject({
    state: "ready",
    corrections: { rejectedTags: ["blue_hair"], hideOcr: true, revision: 1 },
  });
  await t.run(async (ctx) => {
    const projection = await ctx.db.query("referenceSearchDocuments").first();
    expect(projection?.text).not.toContain("blue hair");
    expect(projection?.text).not.toContain("visible writing");
    await ctx.db.patch(assetId, { contentHash: "e".repeat(64) });
  });
  expect(
    (await t.query(api.visualEnrichment.inspect, { accessKey, referenceId }))
      .items[0].state,
  ).toBe("stale");
});

test("inspection and correction require owner access", async () => {
  const { t, referenceId, assetId, payload } = await fixture();
  await expect(
    t.query(api.visualEnrichment.inspect, { accessKey: "wrong", referenceId }),
  ).rejects.toThrow("invalid or expired");
  await expect(
    t.mutation(api.visualEnrichment.submit, { ...payload, accessKey: "wrong" }),
  ).rejects.toThrow("invalid or expired");
  await expect(
    t.mutation(api.visualEnrichment.correct, {
      accessKey: "wrong",
      assetId,
      rejectedTags: [],
      hideOcr: false,
      hideCaption: false,
    }),
  ).rejects.toThrow("invalid or expired");
});
