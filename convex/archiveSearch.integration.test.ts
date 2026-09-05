// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const accessKey = "search-integration-owner";
const reference = (overrides: Partial<Doc<"references">> = {}) => ({
  kind: "image" as const,
  platform: "manual" as const,
  title: "Untitled",
  sourceUrl: "https://example.com/art",
  capturedAt: 1,
  triageState: "kept" as const,
  boardIds: [],
  tagIds: [],
  favorite: false,
  archived: false,
  deleted: false,
  ...overrides,
});

describe("archive-wide search with Convex functions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("backfill finds old references on page one and preserves scopes and cursors", async () => {
    const t = convexTest(schema, modules);
    const oldest = await t.run(async (ctx) => {
      const id = await ctx.db.insert(
        "references",
        reference({ title: "Cerulean raincoat" }),
      );
      for (let n = 0; n < 30; n++) {
        await ctx.db.insert(
          "references",
          reference({ title: "Recent drawing", capturedAt: n + 2 }),
        );
      }
      await ctx.db.insert(
        "references",
        reference({ title: "Cerulean trash", deleted: true }),
      );
      return id;
    });
    await t.mutation(internal.httpDb.initializeReferenceStats, {});
    const url =
      "https://archive.test/api/references?collection=library&query=cerulean&limit=12";
    const before = await t.query(internal.httpDb.listReferences, { url });
    expect(before.searchMode).toBe("page_scan");
    expect(before.references).toHaveLength(0);
    await t.mutation(api.archiveSearch.rebuild, { accessKey });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await t.query(api.archiveSearch.status, { accessKey }),
    ).toMatchObject({ ready: true, rebuilding: false });
    const after = await t.query(internal.httpDb.listReferences, { url });
    expect(after.searchMode).toBe("indexed");
    expect(after.references.map((r: { _id: string }) => r._id)).toEqual([
      oldest,
    ]);
    expect(
      (
        await t.query(internal.httpDb.listReferences, {
          url: url + "&favorites=true",
        })
      ).references,
    ).toHaveLength(0);
    const continued = await t.query(internal.httpDb.listReferences, {
      url: url + "&cursor=" + encodeURIComponent(before.continueCursor!),
    });
    expect(continued.searchMode).toBe("page_scan");
  });

  test("indexed pagination returns every match once", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let n = 0; n < 27; n++)
        await ctx.db.insert(
          "references",
          reference({ title: `Raincoat ${n}` }),
        );
    });
    await t.mutation(internal.httpDb.initializeReferenceStats, {});
    await t.mutation(api.archiveSearch.rebuild, { accessKey });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const url =
        "https://archive.test/api/references?collection=library&query=raincoat&limit=12" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      const result = await t.query(internal.httpDb.listReferences, { url });
      ids.push(...result.references.map((r: { _id: string }) => r._id));
      cursor = result.continueCursor;
      if (!result.hasMore) break;
    }
    expect(ids).toHaveLength(27);
    expect(new Set(ids).size).toBe(27);
    expect(cursor).toBeNull();
  });

  test("corrections survive model revisions and preserve original bytes and the color/hash API", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", reference());
      const inputStorageId = await ctx.storage.store(
        new Blob(["unchanged original"]),
      );
      const assetId = await ctx.db.insert("assets", {
        referenceId,
        originalStorageId: inputStorageId,
        dominantColors: [],
      });
      return { referenceId, inputStorageId, assetId };
    });
    const payload = {
      accessKey,
      assetId: fixture.assetId,
      inputStorageId: fixture.inputStorageId,
      inputSha256: "a".repeat(64),
      originalContentHash: null,
      pipelineFingerprint: "b".repeat(64),
      expectedRevision: 0,
      models: [
        {
          id: "test/model",
          revision: "v1",
          sha256: "c".repeat(64),
          task: "tags",
        },
      ],
      tags: [
        { name: "blue_hair", category: "general" as const, confidence: 0.9 },
      ],
      ratings: [],
    };
    expect(
      await t.mutation(api.visualEnrichment.submit, payload),
    ).toMatchObject({ revision: 1, replayed: false });
    expect(
      await t.mutation(api.visualEnrichment.submit, payload),
    ).toMatchObject({ revision: 1, replayed: true });
    await t.mutation(api.visualEnrichment.correct, {
      accessKey,
      assetId: fixture.assetId,
      rejectedTags: ["blue hair"],
      hideOcr: false,
      hideCaption: false,
    });
    await expect(
      t.mutation(api.visualEnrichment.submit, {
        ...payload,
        pipelineFingerprint: "d".repeat(64),
      }),
    ).rejects.toThrow("Another worker");
    await t.mutation(api.visualEnrichment.submit, {
      ...payload,
      pipelineFingerprint: "d".repeat(64),
      expectedRevision: 1,
    });
    await t.run(async (ctx) => {
      const doc = await ctx.db
        .query("referenceSearchDocuments")
        .withIndex("by_reference_id", (q) =>
          q.eq("referenceId", fixture.referenceId),
        )
        .unique();
      expect(doc?.text).not.toContain("blue hair");
      expect(
        await (await ctx.storage.get(fixture.inputStorageId))!.text(),
      ).toBe("unchanged original");
    });
    const jobs = await t.mutation(api.visualEnrichment.start, {
      accessKey,
      referenceId: fixture.referenceId,
      assetId: fixture.assetId,
    });
    expect(jobs.jobs).toHaveLength(2);
  });

  test("all new public entry points require owner access", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.archiveSearch.status, { accessKey: "wrong" }),
    ).rejects.toThrow("invalid or expired");
    await expect(
      t.mutation(api.archiveSearch.rebuild, { accessKey: "wrong" }),
    ).rejects.toThrow("invalid or expired");
    await expect(
      t.query(api.visualEnrichment.listAssets, {
        accessKey: "wrong",
        paginationOpts: { numItems: 32, cursor: null },
      }),
    ).rejects.toThrow("invalid or expired");
  });

  test("image edits and source refresh update searchable fields", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", reference());
      const assetId = await ctx.db.insert("assets", {
        referenceId,
        dominantColors: [],
      });
      return { referenceId, assetId };
    });
    await t.mutation(internal.httpDb.updateAssetMetadata, {
      assetId: ids.assetId,
      patch: { notes: "Chiaroscuro study" },
      addTagNames: ["dramatic lighting"],
      removeTagIds: [],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx) => {
      const doc = await ctx.db
        .query("referenceSearchDocuments")
        .withIndex("by_reference_id", (q) =>
          q.eq("referenceId", ids.referenceId),
        )
        .unique();
      expect(doc?.text).toContain("chiaroscuro");
      expect(doc?.text).toContain("dramatic lighting");
    });
    const { applySourceMetadata } = await import("./lib/sourceMetadata");
    await t.run(async (ctx) => {
      await applySourceMetadata(ctx, {
        reference: await ctx.db.get(ids.referenceId),
        reason: "manual_refresh",
        metadata: {
          description: "Moonlit harbor",
          metadataStatus: "ready",
          metadataFetchedAt: 123,
        },
      });
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx) => {
      const doc = await ctx.db
        .query("referenceSearchDocuments")
        .withIndex("by_reference_id", (q) =>
          q.eq("referenceId", ids.referenceId),
        )
        .unique();
      expect(doc?.text).toContain("moonlit harbor");
    });
  });
});
