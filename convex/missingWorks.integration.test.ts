// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi, afterEach } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const list = makeFunctionReference<"query">("missingWorks:list");
const detail = makeFunctionReference<"query">("missingWorks:detail");
const record = makeFunctionReference<"mutation">("missingWorks:recordCheck");
afterEach(() => vi.unstubAllEnvs());
it("finds missing pages without queueing complete image sets or deleted references", async () => {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "test-owner-key");
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 3; i++) {
      const referenceId = await ctx.db.insert("references", {
        kind: "post",
        platform: "pixiv",
        sourceUrl: `https://www.pixiv.net/artworks/${i}`,
        capturedAt: i,
        boardIds: [],
        tagIds: [],
        favorite: false,
        archived: false,
        deleted: i === 2,
      });
      await ctx.db.insert("assets", {
        referenceId,
        driveFileId: `file-${i}`,
        storageProvider: "google_drive",
        sourceIndex: 0,
        sourceCount: i === 1 ? 2 : 1,
        dominantColors: [],
      });
    }
  });
  const result = await t.query(list, {
    accessKey: "test-owner-key",
    paginationOpts: { cursor: null, numItems: 48 },
  });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    sourceUrl: "https://www.pixiv.net/artworks/1",
    durablePages: 1,
    expectedPages: 2,
  });
});
it("keeps missing-work research private and separate from source identity and assets", async () => {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "test-owner-key");
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("references", {
      kind: "post",
      platform: "pixiv",
      sourceUrl: "https://www.pixiv.net/artworks/123",
      title: "-----",
      capturedAt: 1,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    }),
  );
  await expect(
    t.query(list, {
      accessKey: "wrong",
      paginationOpts: { cursor: null, numItems: 48 },
    }),
  ).rejects.toThrow();
  expect(
    (
      await t.query(list, {
        accessKey: "test-owner-key",
        paginationOpts: { cursor: null, numItems: 48 },
      })
    ).items,
  ).toHaveLength(1);
  const args = {
    accessKey: "test-owner-key",
    referenceId: id,
    url: "https://example.com/gallery/123",
    outcome: "confirmed_identity",
    evidence: "Matching source ID in the archive caption.",
  };
  const first = await t.mutation(record, args);
  expect(await t.mutation(record, args)).toBe(first);
  await t.mutation(record, {
    ...args,
    outcome: "ruled_out",
    evidence: "Correction: this is another image from the same series.",
  });
  const result = await t.query(detail, {
    accessKey: "test-owner-key",
    referenceId: id,
  });
  expect(result.checks).toHaveLength(2);
  expect(result.checks[0].outcome).toBe("ruled_out");
  expect(result.sourceUrl).toBe("https://www.pixiv.net/artworks/123");
  expect(
    (
      await t.query(list, {
        accessKey: "test-owner-key",
        paginationOpts: { cursor: null, numItems: 48 },
      })
    ).items,
  ).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("assets").take(1))).toHaveLength(0);
  await expect(
    t.mutation(record, { ...args, url: "javascript:alert(1)" }),
  ).rejects.toThrow();
  await expect(
    t.mutation(record, { ...args, url: "https://user:password@example.com" }),
  ).rejects.toThrow();
  await expect(
    t.mutation(record, { ...args, url: "https://example.com?token=secret" }),
  ).rejects.toThrow();
  await expect(
    t.mutation(record, { ...args, evidence: " " }),
  ).rejects.toThrow();
});
