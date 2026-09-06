// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { decodeTagSet, encodeTagSet } from "./lib/tagSetCodec";
import { refreshReferenceSearch } from "./lib/searchIndex";
import { storageSha256 } from "./lib/storageDigest";
const modules = import.meta.glob("./**/*.ts");
const publish = makeFunctionReference<"mutation">("communityTags:publish"),
  inspect = makeFunctionReference<"query">("communityTags:inspect"),
  workItem = makeFunctionReference<"query">("communityTags:workItem");
const accessKey = "test-community-owner";
beforeEach(() => vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey));
afterEach(() => vi.unstubAllEnvs());
test("visual inspection selects late image pages and rejects another reference's asset", async () => {
  const t = convexTest(schema, modules);
  const first = await seed(t);
  const other = await seed(t);
  const last = await t.run(async (ctx) => {
    let id = first.assetId;
    for (let index = 0; index < 35; index++) {
      id = await ctx.db.insert("assets", { referenceId: first.referenceId, dominantColors: [] });
    }
    return id;
  });
  const visualInspect = makeFunctionReference<"query">("visualEnrichment:inspect");
  const result = await t.query(visualInspect, { accessKey, referenceId: first.referenceId, assetId: last });
  expect(result.items.map((item: { assetId: string }) => item.assetId)).toEqual([last]);
  expect(result.truncated).toBe(false);
  await expect(t.query(visualInspect, { accessKey, referenceId: first.referenceId, assetId: other.assetId }))
    .rejects.toThrow("Image does not belong");
});
async function seed(t: ReturnType<typeof convexTest>) {
  const ids = await t.run(async (ctx) => {
    const referenceId = await ctx.db.insert("references", {
      kind: "image",
      platform: "pixiv",
      sourceUrl: "https://www.pixiv.net/artworks/123",
      capturedAt: 1,
      boardIds: [],
      tagIds: [],
      favorite: false,
      deleted: false,
      archived: false,
      sealed: true,
    });
    const inputStorageId = await ctx.storage.store(new Blob(["image bytes"]));
    const assetId = await ctx.db.insert("assets", {
      referenceId,
      originalStorageId: inputStorageId,
      dominantColors: [],
    });
    const meta = (await ctx.db.system.get(inputStorageId))!;
    return {
      assetId,
      referenceId,
      inputStorageId,
      inputSha256: storageSha256(meta.sha256),
    };
  });
  return {
    ...ids,
    accessKey,
    originalContentHash: null,
    evidence: "exact_md5",
    inputMd5: "a".repeat(32),
    postMd5: "a".repeat(32),
    postId: 123,
    sourceUpdatedAt: 1000,
    retrievedAt: 2000,
    sourceUrl: "https://x.com/artist/status/123",
    pixivId: "123",
    tags: [
      { name: "crosshatching", category: "general" },
      { name: "artist_name", category: "artist" },
    ],
  };
}
test("publishes a separate compact source record, searchable with attribution, and replays without duplication", async () => {
  const t = convexTest(schema, modules),
    args = await seed(t);
  const a = await t.mutation(publish, args),
    b = await t.mutation(publish, args);
  expect(a.replayed).toBe(false);
  expect(b.replayed).toBe(true);
  const result = await t.query(inspect, { accessKey, assetId: args.assetId });
  expect(result.items[0]).toMatchObject({
    state: "current",
    evidence: "exact_md5",
    provider: "danbooru",
    postId: 123,
    tagCount: 2,
  });
  expect(
    result.items[0].tags.map(
      ({ name, category }: { name: string; category: string }) => ({
        name,
        category,
      }),
    ),
  ).toEqual(expect.arrayContaining(args.tags));
  await t.run(async (ctx) => {
    expect(await ctx.db.query("communityPosts").collect()).toHaveLength(1);
    expect(await ctx.db.query("communityTerms").collect()).toHaveLength(2);
    expect(await ctx.db.query("communityMatches").collect()).toHaveLength(1);
    expect(await ctx.db.query("visualEnrichments").collect()).toHaveLength(0);
    expect((await ctx.db.get(args.referenceId))!).toMatchObject({
      sealed: true,
      tagIds: [],
    });
    const search = await ctx.db.query("referenceSearchDocuments").unique();
    expect(search!.text).toContain("crosshatching");
    expect(
      search!.fields.find((f) => f.label === "Danbooru tags")!.origin,
    ).toBe("source");
    const post = (await ctx.db.query("communityPosts").unique())!;
    expect(post.tagPayload.byteLength).toBe(16);
  });
});
test("identical sources share snapshots across assets; changed images become stale and leave search on refresh", async () => {
  const t = convexTest(schema, modules),
    args = await seed(t);
  await t.mutation(publish, args);
  const second = await t.run((ctx) =>
    ctx.db.insert("assets", {
      referenceId: args.referenceId,
      originalStorageId: args.inputStorageId,
      dominantColors: [],
    }),
  );
  await t.mutation(publish, { ...args, assetId: second });
  await t.run(async (ctx) => {
    expect(await ctx.db.query("communityPosts").collect()).toHaveLength(1);
    await ctx.db.patch(args.assetId, { originalStorageId: undefined });
    await ctx.db.patch(second, { originalStorageId: undefined });
    await refreshReferenceSearch(ctx, args.referenceId);
    expect(
      (await ctx.db.query("referenceSearchDocuments").unique())!.text,
    ).not.toContain("crosshatching");
  });
  expect(
    (await t.query(inspect, { accessKey, assetId: args.assetId })).items[0]
      .state,
  ).toBe("stale");
});
test("requires owner access, matching archive inputs, exact evidence and valid source revisions", async () => {
  const t = convexTest(schema, modules),
    args = await seed(t);
  await expect(
    t.query(workItem, { accessKey: "wrong", assetId: args.assetId }),
  ).rejects.toThrow();
  for (const patch of [
    { accessKey: "wrong" },
    { inputSha256: "b".repeat(64) },
    { inputMd5: "b".repeat(32) },
    { originalContentHash: "changed" },
    { evidence: "source_candidate" },
    { sourceUpdatedAt: NaN },
    { tags: [args.tags[0], args.tags[0]] },
  ])
    await expect(t.mutation(publish, { ...args, ...patch })).rejects.toThrow();
  await t.mutation(publish, args);
  await expect(
    t.mutation(publish, {
      ...args,
      sourceUpdatedAt: 999,
      tags: [args.tags[0]],
    }),
  ).rejects.toThrow();
  await t.mutation(publish, {
    ...args,
    sourceUpdatedAt: 1001,
    tags: [args.tags[0]],
  });
  expect(
    (await t.query(inspect, { accessKey, assetId: args.assetId })).items[0]
      .tagCount,
  ).toBe(1);
});
test("unscored sets retain uint32 identities and reject malformed encodings", () => {
  expect(decodeTagSet(encodeTagSet([0xffffffff, 1]))).toEqual([1, 0xffffffff]);
  for (const codes of [[0], [1, 1], [2 ** 32], [NaN]])
    expect(() => encodeTagSet(codes)).toThrow();
  const bad = encodeTagSet([1]);
  new DataView(bad).setUint32(8, 0);
  expect(() => decodeTagSet(bad)).toThrow();
  expect(() => decodeTagSet(new ArrayBuffer(7))).toThrow();
});

test("Drive originals bind to both file identity and content hash", async () => {
  const t = convexTest(schema, modules),
    args = await seed(t);
  await t.run((ctx) =>
    ctx.db.patch(args.assetId, {
      originalStorageId: undefined,
      driveFileId: "drive-original",
      contentHash: args.inputSha256,
    }),
  );
  const { inputStorageId, ...base } = args;
  const drive = {
    ...base,
    originalContentHash: args.inputSha256,
    inputDriveFileId: "drive-original",
  };
  const work = await t.query(workItem, { accessKey, assetId: args.assetId });
  expect(work.inputs).toContainEqual({
    driveFileId: "drive-original",
    sha256: args.inputSha256,
  });
  await t.mutation(publish, drive);
  await expect(
    t.mutation(publish, { ...drive, inputDriveFileId: "different" }),
  ).rejects.toThrow();
  await expect(
    t.mutation(publish, { ...drive, inputStorageId }),
  ).rejects.toThrow();
  await t.run((ctx) =>
    ctx.db.patch(args.assetId, { driveFileId: "different" }),
  );
  expect(
    (await t.query(inspect, { accessKey, assetId: args.assetId })).items[0]
      .state,
  ).toBe("stale");
});

test("active Library searches published source tags across unreviewed items without leaking archive rows", async () => {
  const t = convexTest(schema, modules),
    args = await seed(t);
  await t.run(async (ctx) => {
    await ctx.db.patch(args.referenceId, { triageState: "inbox" });
    await ctx.db.insert("referenceSearchState", {
      key: "catalog-v1",
      generation: 1,
      ready: true,
      rebuilding: false,
      dirty: false,
      updatedAt: 1,
    });
  });
  await t.mutation(publish, args);
  const list = makeFunctionReference<"query">("httpDb:listReferences");
  const url =
    "http://localhost/references?collection=library&scope=active&query=crosshatching";
  const result = await t.query(list, { url });
  expect(result.references.map((r: { _id: string }) => r._id)).toContain(
    args.referenceId,
  );
  expect(result.references[0].searchMatches).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "Danbooru tags" }),
    ]),
  );
  await t.run(async (ctx) => {
    await ctx.db.patch(args.referenceId, { archived: true });
    await refreshReferenceSearch(ctx, args.referenceId);
  });
  expect((await t.query(list, { url })).references).toHaveLength(0);
});

test("hide/restore affects only this asset's source search, persists across updates and fences stale edits", async () => {
  const t = convexTest(schema, modules),
    args = await seed(t);
  await t.mutation(publish, args);
  const toggle = makeFunctionReference<"mutation">("communityTags:setHidden");
  const view = await t.query(inspect, { accessKey, assetId: args.assetId });
  const code = view.items[0].tags.find(
    (tag: { name: string }) => tag.name === "crosshatching",
  ).code;
  const change = {
    accessKey,
    assetId: args.assetId,
    code,
    hidden: true,
    expectedRevision: 0,
  };
  await expect(
    t.mutation(toggle, { ...change, accessKey: "wrong" }),
  ).rejects.toThrow();
  await expect(
    t.mutation(toggle, { ...change, code: 999999 }),
  ).rejects.toThrow();
  await t.mutation(toggle, change);
  await expect(
    t.mutation(toggle, { ...change, hidden: false }),
  ).rejects.toThrow();
  await t.mutation(publish, { ...args, sourceUpdatedAt: 1002 });
  const next = await t.query(inspect, { accessKey, assetId: args.assetId });
  expect(next.items[0].correctionRevision).toBe(1);
  expect(
    next.items[0].tags.find((tag: { code: number }) => tag.code === code)
      .hidden,
  ).toBe(true);
  await t.run(async (ctx) => {
    expect(
      (await ctx.db.query("referenceSearchDocuments").unique())!.text,
    ).not.toContain("crosshatching");
    expect((await ctx.db.get(args.referenceId))!.tagIds).toEqual([]);
    expect(await ctx.db.query("visualCorrections").collect()).toHaveLength(0);
  });
  await t.mutation(toggle, { ...change, hidden: false, expectedRevision: 1 });
  await t.run(async (ctx) => {
    expect(
      (await ctx.db.query("referenceSearchDocuments").unique())!.text,
    ).toContain("crosshatching");
  });
});
