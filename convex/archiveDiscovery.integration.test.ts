// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { refreshDiscoveryReference } from "./lib/discoveryIndex";
import { listReferencePage } from "./lib/referenceCatalog";
import { discoveryFacet, withDiscoveryFacet } from "../packages/shared/src/discoveryFilter";
import { visibleSearchText, replaceVisibleSearchText } from "../packages/shared/src/sourceFilters";
const modules = import.meta.glob("./**/*.ts");
const list = makeFunctionReference<"query">("archiveDiscovery:list");
const ensure = makeFunctionReference<"mutation">("archiveDiscovery:ensure");
const backfill = makeFunctionReference<"mutation">("archiveDiscovery:backfill");
const ref = (n: number) => ({ kind: "image" as const, platform: "pixiv" as const, sourceUrl: `https://www.pixiv.net/artworks/${n}`, authorName: "Artist", authorUrl: "https://www.pixiv.net/users/1", capturedAt: n, publishedAt: n, boardIds: [], tagIds: [], favorite: false, archived: false, deleted: false });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("global artist and tag directory", () => {
  it("backfills beyond the first page, resumes without duplicate counts, and enforces access", async () => {
    vi.useFakeTimers(); vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    await t.run(async ctx => { for (let n = 1; n <= 55; n++) await ctx.db.insert("references", ref(n)); });
    await expect(t.query(list, { accessKey: "wrong", revealSensitive: true })).rejects.toThrow();
    await t.mutation(ensure, { accessKey: "owner" });
    await t.mutation(backfill, { cursor: null });
    await t.mutation(backfill, { cursor: null }); // stale delivery is harmless
    await t.mutation(ensure, { accessKey: "owner" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const result = await t.query(list, { accessKey: "owner", revealSensitive: true });
    expect(result).toMatchObject({ ready: true, scanned: 55 });
    expect(result.artists).toHaveLength(1);
    expect(result.artists[0].count).toBe(55);
    await t.mutation(ensure, { accessKey: "owner" });
    expect((await t.query(list, { accessKey: "owner", revealSensitive: true })).scanned).toBe(55);
  });

  it("counts unique references, respects sensitivity, and updates tag/artist membership and removals", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    const id = await t.run(async ctx => {
      await ctx.db.insert("archiveDiscoveryState", { key: "global-v1", cursor: null, ready: true, running: false, scanned: 2, updatedAt: 1 });
      const tagId = await ctx.db.insert("tags", { name: "Lighting", slug: "lighting", createdAt: 1 });
      const id = await ctx.db.insert("references", { ...ref(1), tagIds: [tagId, tagId], sealed: true });
      await refreshDiscoveryReference(ctx, id); await refreshDiscoveryReference(ctx, id);
      const other = await ctx.db.insert("references", { ...ref(2), authorUrl: "https://www.pixiv.net/users/2" });
      await refreshDiscoveryReference(ctx, other);
      return id;
    });
    const hidden = await t.query(list, { accessKey: "owner", revealSensitive: false });
    expect(hidden.tags).toHaveLength(0); expect(hidden.artists).toHaveLength(1);
    const all = await t.query(list, { accessKey: "owner", revealSensitive: true });
    expect(all.artists).toHaveLength(2); expect(all.tags[0].count).toBe(1);
    expect((await t.query(list, { accessKey: "owner", revealSensitive: false, selected: all.tags[0].id })).selected).toBeNull();
    await t.run(async ctx => { await ctx.db.patch(id, { sealed: false }); await refreshDiscoveryReference(ctx, id); });
    expect((await t.query(list, { accessKey: "owner", revealSensitive: false })).tags[0].count).toBe(1);
    await t.run(async ctx => { await ctx.db.patch(id, { tagIds: [], deleted: true }); await refreshDiscoveryReference(ctx, id); });
    expect((await t.query(list, { accessKey: "owner", revealSensitive: true })).tags).toEqual([]);
  });

  it("filters by exact artist membership before pagination and preserves sort-specific cursors", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("archiveDiscoveryState", { key: "global-v1", cursor: null, ready: true, running: false, scanned: 40, updatedAt: 1 });
      for (let n = 1; n <= 40; n++) {
        const id = await ctx.db.insert("references", { ...ref(n), authorUrl: `https://www.pixiv.net/users/${n % 2}` });
        await refreshDiscoveryReference(ctx, id);
      }
    });
    const directory = await t.query(list, { accessKey: "owner", revealSensitive: true });
    const facet = directory.artists[0].id;
    const url = new URL("http://localhost/references?scope=active&collection=library&sort=saved-asc&limit=12&revealSensitive=true");
    url.searchParams.set("query", `facet:${facet}`);
    const first = await t.run(ctx => listReferencePage(ctx, url.toString()));
    expect(first.references).toHaveLength(12);
    expect(new Set(first.references.map((row: { authorUrl: string }) => row.authorUrl)).size).toBe(1);
    url.searchParams.set("cursor", first.continueCursor!);
    const second = await t.run(ctx => listReferencePage(ctx, url.toString()));
    expect(second.references).toHaveLength(8);
    expect(new Set([...first.references, ...second.references].map((row: { _id: string }) => row._id)).size).toBe(20);
    url.searchParams.set("sort", "saved-desc");
    await expect(t.run(ctx => listReferencePage(ctx, url.toString()))).rejects.toThrow("saved position");
  });

  it("keeps the selected facet out of the text box without losing it when text changes", () => {
    const query = withDiscoveryFacet("source:pixiv blue", "some-id");
    expect(discoveryFacet(query)).toBe("some-id");
    expect(visibleSearchText(query).trim()).toBe("blue");
    expect(discoveryFacet(replaceVisibleSearchText(query, "lighting"))).toBe("some-id");
    expect(discoveryFacet(withDiscoveryFacet(query, ""))).toBe("");
  });

  it("serves the directory over the owner-protected archive HTTP connection", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("archiveDiscoveryState", { key: "global-v1", cursor: null, ready: true, running: false, scanned: 1, updatedAt: 1 });
      const id = await ctx.db.insert("references", ref(1));
      await refreshDiscoveryReference(ctx, id);
    });
    expect((await t.fetch("/archive-discovery")).status).toBe(401);
    const response = await t.fetch("/archive-discovery?revealSensitive=true", { headers: { Authorization: "Bearer owner" } });
    expect(response.status).toBe(200);
    expect((await response.json()).artists[0]).toMatchObject({ label: "Artist", count: 1 });
  });

  it("removes own-art publications immediately and restores unlinked references", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "owner");
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      await ctx.db.insert("archiveDiscoveryState", { key: "global-v1", cursor: null, ready: true, running: false, scanned: 1, updatedAt: 1 });
      const referenceId = await ctx.db.insert("references", ref(1));
      const artworkId = await ctx.db.insert("artworks", { title: "Mine", status: "finished", createdAt: 1, updatedAt: 1 });
      await refreshDiscoveryReference(ctx, referenceId);
      return { referenceId, artworkId };
    });
    const args = { accessKey: "owner", ...ids };
    await t.mutation(makeFunctionReference<"mutation">("artworks:linkPublication"), args);
    expect((await t.query(list, { accessKey: "owner", revealSensitive: true })).artists).toEqual([]);
    await t.mutation(makeFunctionReference<"mutation">("artworks:unlinkPublication"), args);
    expect((await t.query(list, { accessKey: "owner", revealSensitive: true })).artists[0].count).toBe(1);
  });
});
