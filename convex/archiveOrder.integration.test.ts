// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import {
  chronologicalPage,
  decodeOrderCursor,
  orderScope,
} from "./lib/archiveOrder";

const modules = import.meta.glob("./**/*.ts");
const reference = (capturedAt: number, publishedAt?: number) => ({
  kind: "image" as const,
  platform: "manual" as const,
  sourceUrl: `https://example.com/${capturedAt}`,
  capturedAt,
  ...(publishedAt === undefined ? {} : { publishedAt }),
  boardIds: [],
  tagIds: [],
  favorite: false,
  archived: false,
  deleted: false,
});
describe("chronological archive pagination", () => {
  it("keeps later imports out of a saved page chain until refresh", async () => {
    const t = convexTest(schema, modules);
    const original = await t.run((ctx) => ctx.db.insert("references", { ...reference(20, 20), triageState: "inbox" }));
    const url = new URL("https://example.com/references?sort=published-asc&collection=inbox");
    const first = await t.query(internal.httpDb.listReferences, { url: url.toString() });
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60000);
    try {
      const imported = await t.run((ctx) => ctx.db.insert("references", { ...reference(30, 10), triageState: "inbox" }));
      url.searchParams.set("cursor", first.references[0]!.browseCursor as string);
      const resumed = await t.query(internal.httpDb.listReferences, { url: url.toString() });
      expect(resumed.references.map((r: { _id: string }) => r._id)).toEqual([original]);
      url.searchParams.delete("cursor");
      const refreshed = await t.query(internal.httpDb.listReferences, { url: url.toString() });
      expect(refreshed.references.map((r: { _id: string }) => r._id)).toEqual([imported, original]);
    } finally { clock.mockRestore(); }
  });
  it("keeps machine-only search matches when chronological order is requested", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", {
        ...reference(1),
        triageState: "inbox",
      });
      await ctx.db.insert("referenceSearchDocuments", {
        referenceId,
        text: "heart hands",
        fields: [
          {
            field: "visual.example.tags",
            label: "Visual tags · machine",
            value: "heart_hands",
            origin: "machine",
          },
        ],
        collection: "inbox",
        lane: "images",
        favorite: false,
        kind: "image",
        indexedAt: Date.now(),
        truncated: false,
      });
      return referenceId;
    });
    const result = await t.query(internal.httpDb.listReferences, {
      url: "https://example.com/references?sort=saved-asc&query=heart&collection=inbox",
    });
    expect(result.references.map((r: { _id: string }) => r._id)).toEqual([id]);
    expect(result.references[0]?.searchMatches[0]?.label).toBe(
      "Visual tags · machine",
    );
  });
  it("orders the whole collection before paging, keeps ties, and puts undated works last both ways", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const [saved, published] of [
        [10, 300],
        [20, undefined],
        [30, 100],
        [40, 100],
        [50, undefined],
      ])
        await ctx.db.insert("references", reference(saved!, published));
    });
    for (const [sort, expected] of [
      ["saved-asc", [10, 20, 30, 40, 50]],
      ["saved-desc", [50, 40, 30, 20, 10]],
      ["published-asc", [100, 100, 300, undefined, undefined]],
      ["published-desc", [300, 100, 100, undefined, undefined]],
    ] as const) {
      const url = new URL(`https://example.com/references?sort=${sort}`);
      const results = [];
      for (let i = 0; i < 10; i++) {
        const page = await t.run((ctx) => chronologicalPage(ctx, url, 2));
        results.push(...page.page);
        if (page.isDone) break;
        url.searchParams.set("cursor", page.continueCursor);
      }
      expect(new Set(results.map((r) => r._id)).size).toBe(5);
      expect(
        results.map((r) =>
          sort.startsWith("saved") ? r.capturedAt : r.publishedAt,
        ),
      ).toEqual(expected);
    }
  });
  it("binds cursors to a view, retains the cutoff, and supplies a replayable page boundary", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 4; i++)
        await ctx.db.insert("references", reference(i));
    });
    const url = new URL(
      "https://example.com/references?sort=saved-asc&query=pose",
    );
    const first = await t.run((ctx) => chronologicalPage(ctx, url, 2));
    url.searchParams.set("cursor", first.startCursor);
    const replay = await t.run((ctx) => chronologicalPage(ctx, url, 2));
    expect(replay.page.map((r) => r._id)).toEqual(first.page.map((r) => r._id));
    expect(replay.cutoff).toBe(first.cutoff);
    url.searchParams.set("sort", "saved-desc");
    expect(() =>
      decodeOrderCursor(first.continueCursor, orderScope(url)),
    ).toThrow(/does not match/);
  });
});
