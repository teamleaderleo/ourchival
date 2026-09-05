import { describe, expect, it } from "vitest";
import { buildCatalogExport, type CatalogPage } from "./catalogExport";

const page: CatalogPage = {
  schemaVersion: 1,
  mode: "live-projection",
  filters: { sessionKey: null, platform: null, collection: null },
  fields: ["title"],
  rows: [{ id: "ref-1", title: "A\n🎨" }],
  scanned: 25,
  returned: 1,
  hasMore: true,
  nextCursor: "next",
};
describe("catalog download receipt", () => {
  it("has stable bytes and digest with explicit resume boundaries", async () => {
    const result = await buildCatalogExport(page, "previous");
    expect(result).toEqual(await buildCatalogExport(page, "previous"));
    expect(result.manifest).toMatchObject({
      fromCursor: "previous",
      nextCursor: "next",
      returned: 1,
      scanned: 25,
    });
    expect(JSON.parse(result.ndjson)).toEqual(page.rows[0]);
    expect(result.manifest.bytes).toBe(
      new TextEncoder().encode(result.ndjson).length,
    );
    expect(result.manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
    const changed = await buildCatalogExport(
      { ...page, rows: [{ id: "ref-2" }] },
      null,
    );
    expect(changed.manifest.sha256).not.toBe(result.manifest.sha256);
  });
  it("preserves continuation even for an empty download", async () => {
    const result = await buildCatalogExport(
      { ...page, rows: [], returned: 0 },
      null,
    );
    expect(result.ndjson).toBe("");
    expect(result.manifest).toMatchObject({
      bytes: 0,
      hasMore: true,
      nextCursor: "next",
    });
  });
});
