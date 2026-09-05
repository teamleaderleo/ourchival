// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import type { CatalogPage } from "../apps/web/app/catalog-export/catalogExport";

const modules = import.meta.glob("./**/*.ts");
const find = makeFunctionReference<
  "query",
  {
    accessKey: string;
    limit?: number;
    cursor?: string;
    fields?: string[];
    platform?: string;
    sessionKey?: string;
    collection?: "inbox" | "library" | "later" | "archive";
  },
  CatalogPage
>("catalog:find");
const accessKey = "catalog-test-owner";

describe("bounded catalog query", () => {
  beforeEach(() => vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey));
  afterEach(() => vi.unstubAllEnvs());

  async function fixture() {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let ordinal = 0; ordinal < 61; ordinal++) {
        await ctx.db.insert("references", {
          kind: "link",
          title: `Saved ${ordinal}`,
          sourceUrl: `https://example.com/${ordinal}`,
          platform: ordinal === 0 ? "pixiv" : "generic",
          capturedAt: ordinal,
          captureSessionId: ordinal < 4 ? "import-a" : "import-b",
          boardIds: [],
          tagIds: [],
          favorite: false,
          archived: ordinal === 2,
          deleted: ordinal === 1,
        });
      }
    });
    return t;
  }

  it("rejects unauthenticated reads and invalid bounds/fields", async () => {
    const t = await fixture();
    await expect(t.query(find, { accessKey: "wrong" })).rejects.toThrow();
    for (const limit of [0, 51, 1.5])
      await expect(t.query(find, { accessKey, limit })).rejects.toThrow();
    await expect(
      t.query(find, { accessKey, fields: ["jsonMetadata"] }),
    ).rejects.toThrow();
  });

  it("paginates sparse filters through empty pages without losing matches", async () => {
    const t = await fixture();
    let cursor: string | undefined;
    const ids = new Set<string>();
    let scanned = 0;
    for (let i = 0; i < 10; i++) {
      const page = await t.query(find, {
        accessKey,
        platform: "pixiv",
        limit: 25,
        ...(cursor ? { cursor } : {}),
      });
      expect(page.scanned).toBeLessThanOrEqual(25);
      if (i === 0) expect(page).toMatchObject({ returned: 0, hasMore: true });
      scanned += page.scanned;
      page.rows.forEach((row) => ids.add(row.id));
      if (!page.hasMore) break;
      cursor = page.nextCursor!;
    }
    expect(scanned).toBe(61);
    expect(ids.size).toBe(1);
  });

  it("replays a cursor deterministically and rejects changed filters", async () => {
    const t = await fixture();
    const first = await t.query(find, { accessKey, limit: 25 });
    const args = { accessKey, limit: 25, cursor: first.nextCursor! };
    expect(await t.query(find, args)).toEqual(await t.query(find, args));
    await expect(t.query(find, { ...args, platform: "pixiv" })).rejects.toThrow(
      "Filters changed",
    );
    await expect(t.query(find, { ...args, fields: ["title"] })).rejects.toThrow(
      "Filters changed",
    );
    for (const cursor of ["null", "{}", "invalid"])
      await expect(t.query(find, { accessKey, cursor })).rejects.toThrow();
  });

  it("uses exact import scope, omits Trash, and treats legacy records as Inbox", async () => {
    const t = await fixture();
    const page = await t.query(find, {
      accessKey,
      sessionKey: "import-a",
      collection: "inbox",
      fields: ["title", "triageState"],
    });
    expect(page.scanned).toBe(4);
    expect(page.rows.map((row) => row.title)).toEqual(["Saved 3", "Saved 0"]);
    expect(
      page.rows.every((row) => row.triageState === "inbox" && !row.sourceUrl),
    ).toBe(true);
    expect(page.hasMore).toBe(false);
  });

  it("marks Unicode-safe truncation without changing source documents", async () => {
    const t = convexTest(schema, modules);
    const title = "🎨".repeat(1100);
    const id = await t.run((ctx) =>
      ctx.db.insert("references", {
        title,
        sourceUrl: "https://example.com/art",
        kind: "link",
        platform: "generic",
        capturedAt: 1,
        boardIds: [],
        tagIds: [],
        favorite: false,
        archived: false,
        deleted: false,
        notes: "private notes never in this projection",
      }),
    );
    const page = await t.query(find, { accessKey });
    expect(Array.from(String(page.rows[0].title))).toHaveLength(1024);
    expect(page.rows[0].truncatedFields).toEqual(["title"]);
    expect(page.rows[0]).not.toHaveProperty("notes");
    expect(await t.run(async (ctx) => (await ctx.db.get(id))?.title)).toBe(
      title,
    );
  });
});
