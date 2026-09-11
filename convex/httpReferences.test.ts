// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ref = (n: number) => ({
  kind: "image" as const,
  platform: "pixiv" as const,
  sourceUrl: `https://www.pixiv.net/artworks/${n}`,
  capturedAt: n,
  boardIds: [],
  tagIds: [],
  favorite: false,
  archived: false,
  deleted: false,
});
const auth = { headers: { Authorization: "Bearer owner" } };
const feedPath =
  "/references?limit=12&collection=library&scope=active&lane=all&sort=saved-desc&excludeOwned=false";
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/references feed maintenance", () => {
  it("bootstraps stats and export state once, then serves warm hits read-only", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let n = 1; n <= 3; n++) await ctx.db.insert("references", ref(n));
    });

    expect(await t.query(internal.httpDb.feedMaintenanceStatus, {})).toEqual({
      statsReady: false,
    });
    expect(
      await t.query(internal.preferenceExport.getExportState, {}),
    ).toBeNull();

    const cold = await t.fetch(feedPath, auth);
    expect(cold.status).toBe(200);
    const coldBody = await cold.json();
    expect(coldBody.ok).toBe(true);
    expect(coldBody.references).toHaveLength(3);

    expect(await t.query(internal.httpDb.feedMaintenanceStatus, {})).toEqual({
      statsReady: true,
    });
    const exportState = await t.query(
      internal.preferenceExport.getExportState,
      {},
    );
    expect(exportState?.status).toBe("queued");

    const warm = await t.fetch(feedPath, auth);
    expect(warm.status).toBe(200);
    expect((await warm.json()).references).toHaveLength(3);

    // Warm hits must not duplicate the one-time bootstrap rows.
    const counts = await t.run(async (ctx) => ({
      stats: (await ctx.db.query("referenceStats").collect()).length,
      exports: (await ctx.db.query("preferenceExportState").collect()).length,
    }));
    expect(counts).toEqual({ stats: 1, exports: 1 });
  });

  it("serves a compact card payload without diagnostic blobs", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    const referenceId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("references", ref(1));
      await ctx.db.insert("assets", {
        referenceId: id,
        originalUrl: "https://example.com/a.jpg",
        fetchReceipt: JSON.stringify({ attempt: 1 }),
        promotionReceipt: JSON.stringify({ previous: null }),
        jsonMetadata: JSON.stringify({ raw: true }),
        tagIds: [],
        dominantColors: [],
      });
      await ctx.db.insert("sourceSnapshots", {
        referenceId: id,
        pageTitle: "Card title",
        postText: "filterable text",
        createdAt: 1,
      });
      return id;
    });
    void referenceId;

    const compact = await t.fetch(`${feedPath}&compact=true`, auth);
    expect(compact.status).toBe(200);
    const [card] = (await compact.json()).references;
    expect(card.sourceSnapshot.pageTitle).toBe("Card title");
    expect(card.sourceSnapshot.postText).toBe("filterable text");
    expect(card.assets[0].thumbUrl ?? card.assets[0].storedUrl).toBeDefined();
    for (const asset of card.assets) {
      expect(asset.fetchReceipt).toBeUndefined();
      expect(asset.promotionReceipt).toBeUndefined();
      expect(asset.jsonMetadata).toBeUndefined();
    }
    expect(card.sourceSnapshot.fieldSources).toBeUndefined();
    expect(card.sourceSnapshot.sourceMetadata).toBeUndefined();

    const full = await t.fetch(feedPath, auth);
    const [fullCard] = (await full.json()).references;
    expect(fullCard.assets[0].fetchReceipt).toContain("attempt");
  });

  it("still requires the owner key", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    expect((await t.fetch("/references?limit=12")).status).toBe(401);
  });
});
