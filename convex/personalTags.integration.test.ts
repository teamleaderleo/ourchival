// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { refreshReferenceSearch } from "./lib/searchIndex";
const modules = import.meta.glob("./**/*.ts");
const accessKey = "personal-tag-test";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("multi-tag assignment allocates distinct codes in a single transaction", async () => {
  const t = convexTest(schema, modules);
  const referenceId = await t.run((ctx) =>
    ctx.db.insert("references", {
      kind: "image",
      platform: "manual",
      sourceUrl: "https://example.com/multi",
      capturedAt: 1,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    }),
  );
  const tags = await t.mutation(api.tags.updateReference, {
    accessKey,
    referenceId,
    addNames: ["One", "Two", "Three"],
    removeIds: [],
  });
  expect(new Set(tags.map((tag) => tag.code)).size).toBe(3);
});

test("rename retains identity, assignments, old names and definition version", async () => {
  const t = convexTest(schema, modules);
  const tag = (await t.mutation(api.tags.createDefinition, {
    accessKey,
    name: "Scratchy ink",
    definition: "Broken outlines",
  }))!;
  const referenceId = await t.run((ctx) =>
    ctx.db.insert("references", {
      kind: "image",
      platform: "manual",
      sourceUrl: "https://example.com/a",
      capturedAt: 1,
      boardIds: [],
      tagIds: [tag._id],
      favorite: false,
      archived: false,
      deleted: false,
    }),
  );
  const renamed = (await t.mutation(api.tags.editDefinition, {
    accessKey,
    tagId: tag._id,
    expectedRevision: 1,
    name: "Broken linework",
    definition: "Broken outlines",
  }))!;
  expect(renamed).toMatchObject({
    code: tag.code,
    slug: tag.slug,
    definitionVersion: 1,
    aliases: ["Scratchy ink"],
  });
  expect(
    (await t.mutation(api.tags.create, { accessKey, name: "Broken linework" }))
      ._id,
  ).toBe(tag._id);
  expect(
    (await t.mutation(api.tags.create, { accessKey, name: "Scratchy ink" }))
      ._id,
  ).toBe(tag._id);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(referenceId))!.tagIds).toEqual([tag._id]);
    await refreshReferenceSearch(ctx, referenceId);
    const doc = await ctx.db
      .query("referenceSearchDocuments")
      .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
      .unique();
    expect(doc!.text).toContain("broken linework");
    expect(doc!.text).toContain("scratchy ink");
  });
});

test("collision and stale edits cannot overwrite another meaning", async () => {
  const t = convexTest(schema, modules);
  const a = (await t.mutation(api.tags.createDefinition, {
    accessKey,
    name: "Dry brush",
    definition: "Visible gaps",
  }))!;
  await t.mutation(api.tags.create, { accessKey, name: "Soft edges" });
  await expect(
    t.mutation(api.tags.editDefinition, {
      accessKey,
      tagId: a._id,
      expectedRevision: 1,
      name: "Soft edges",
      definition: "Different",
    }),
  ).rejects.toThrow("another tag");
  await expect(
    t.mutation(api.tags.editDefinition, {
      accessKey,
      tagId: a._id,
      expectedRevision: 0,
      name: a.name,
      definition: "Different",
    }),
  ).rejects.toThrow("Reload");
  await expect(
    t.mutation(api.tags.createDefinition, {
      accessKey,
      name: "Dry brush",
      definition: "Different",
    }),
  ).rejects.toThrow("already exists");
  expect(
    (await t.query(api.tags.list, { accessKey })).find((x) => x._id === a._id)
      ?.definition,
  ).toBe("Visible gaps");
});

test("meaning versions preserve history and invalidate earlier examples", async () => {
  const t = convexTest(schema, modules);
  const tag = (await t.mutation(api.tags.createDefinition, {
    accessKey,
    name: "My style",
    definition: "Hard edges",
  }))!;
  const assetId = await t.run(async (ctx) => {
    const referenceId = await ctx.db.insert("references", {
      kind: "image",
      platform: "manual",
      sourceUrl: "https://example.com/b",
      capturedAt: 1,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });
    return await ctx.db.insert("assets", { referenceId, dominantColors: [] });
  });
  await t.mutation(api.tags.setExample, {
    accessKey,
    tagId: tag._id,
    assetId,
    definitionVersion: 1,
    positive: false,
  });
  await t.mutation(api.tags.editDefinition, {
    accessKey,
    tagId: tag._id,
    expectedRevision: 1,
    name: tag.name,
    definition: "Hard edges and flat fills",
  });
  expect(
    await t.query(api.tags.examplesForAsset, {
      accessKey,
      tagId: tag._id,
      assetId,
    }),
  ).toMatchObject({ definitionVersion: 1, positive: false });
  const currentExamples = await t.query(api.tags.listExamples, {
    accessKey,
    tagId: tag._id,
    definitionVersion: 2,
    paginationOpts: { numItems: 32, cursor: null },
  });
  expect(currentExamples.items).toEqual([]);
  await expect(
    t.mutation(api.tags.setExample, {
      accessKey,
      tagId: tag._id,
      assetId,
      definitionVersion: 1,
      positive: true,
    }),
  ).rejects.toThrow("current meaning");
  await t.run(async (ctx) => {
    const history = await ctx.db
      .query("tagDefinitions")
      .withIndex("by_tagId_and_version", (q) => q.eq("tagId", tag._id))
      .collect();
    expect(history.map((x) => x.version)).toEqual([1, 2]);
  });
  await t.mutation(api.tags.setExample, {
    accessKey,
    tagId: tag._id,
    assetId,
    definitionVersion: 2,
    positive: true,
  });
  expect(
    (
      await t.query(api.tags.listExamples, {
        accessKey,
        tagId: tag._id,
        definitionVersion: 2,
        paginationOpts: { numItems: 32, cursor: null },
      })
    ).items,
  ).toHaveLength(1);
  await t.mutation(api.tags.setExample, {
    accessKey,
    tagId: tag._id,
    assetId,
    definitionVersion: 2,
    positive: null,
  });
  expect(
    await t.query(api.tags.examplesForAsset, {
      accessKey,
      tagId: tag._id,
      assetId,
    }),
  ).toBeNull();
});

test("legacy tags gain unique codes without changing their IDs; owner auth is required", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("tags", { name: "Legacy", slug: "legacy", createdAt: 1 }),
  );
  await expect(
    t.mutation(api.tags.editDefinition, {
      accessKey: "wrong",
      tagId: id,
      expectedRevision: 0,
      name: "Legacy",
      definition: "Test",
    }),
  ).rejects.toThrow();
  const a = (await t.mutation(api.tags.editDefinition, {
    accessKey,
    tagId: id,
    expectedRevision: 0,
    name: "Legacy",
    definition: "Test",
  }))!;
  const b = await t.mutation(api.tags.create, { accessKey, name: "Another" });
  expect(a._id).toBe(id);
  expect(a.code).toBe(1);
  expect(b.code).toBe(2);
});
