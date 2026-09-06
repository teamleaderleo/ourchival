// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  readSourceFilters,
  setSourceFilter,
  visibleSearchText,
  replaceVisibleSearchText,
} from "../packages/shared/src/sourceFilters";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

it("restores hosted links idempotently and preserves archive state", async () => {
  const t = convexTest(schema, modules);
  const reference = { _id: "old-id", _creationTime: 1, kind: "link", platform: "generic", sourceUrl: "https://example.com/restored", title: "Original wording", notes: "My note", capturedAt: 12, archived: true, deleted: false, favorite: true, boardIds: [], tagIds: [] };
  const rows = [{ reference, snapshots: [] }];
  const result = await t.mutation(internal.browseMigration.restoreLinks, { rows });
  expect(result[0]?.restored).toBe(true);
  expect(await t.run(ctx => ctx.db.get(result[0]!.referenceId))).toMatchObject({ title: reference.title, notes: reference.notes, capturedAt: 12, archived: true, favorite: true, browseLane: "links" });
  expect((await t.mutation(internal.browseMigration.restoreLinks, { rows }))[0]?.restored).toBe(false);
});

it("browses unreviewed images, imported links and favorites without changing filing", async () => {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    for (const entry of [
      { kind: "image", triageState: "inbox" as const, favorite: true },
      { kind: "link", triageState: "later" as const, favorite: false },
      { kind: "image", triageState: "kept" as const, favorite: false },
      { kind: "image", triageState: "inbox" as const, favorite: true, deleted: true },
    ]) await ctx.db.insert("references", { platform: "generic", sourceUrl: "https://example.com", capturedAt: 1, boardIds: [], tagIds: [], archived: false, deleted: false, ...entry });
  });
  const migration = await t.mutation(internal.browseMigration.backfill, { cursor: null });
  expect(migration).toMatchObject({ done: true, changed: 4, links: 1 });
  expect(await t.mutation(internal.browseMigration.backfill, { cursor: null })).toMatchObject({ changed: 0 });
  const browse = (suffix = "") => t.query(internal.httpDb.listReferences, { url: `https://example.com/references?collection=library&scope=active&sort=saved-desc${suffix}` });
  expect((await browse()).references).toHaveLength(3);
  expect((await browse("&lane=links")).references).toHaveLength(1);
  expect((await browse("&favorites=true")).references).toHaveLength(1);
  expect((await browse("&lane=images")).references).toHaveLength(2);
  expect((await t.query(internal.httpDb.listReferences, { url: "https://example.com/references?collection=inbox&sort=saved-desc" })).references).toHaveLength(1);
});

it("combines source inclusions, honors exclusions and imported board membership before returning a page", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (const platform of ["x", "pinterest", "pixiv"] as const)
      ids.push(
        await ctx.db.insert("references", {
          platform,
          kind: "image",
          sourceUrl: `https://example.com/${platform}`,
          capturedAt: ids.length,
          triageState: "inbox",
          boardIds: [],
          tagIds: [],
          favorite: false,
          archived: false,
          deleted: false,
        }),
      );
    await ctx.db.insert("referenceOrigins", {
      referenceId: ids[1]!,
      platform: "pinterest",
      containerType: "board",
      containerKey: "board/hands and poses",
      containerName: "Hands & poses",
      providerItemId: "pin1",
      firstObservedAt: 1,
      lastObservedAt: 1,
    });
    return ids;
  });
  const run = async (query: string) => {
    const url = new URL(
      "https://example.com/references?collection=inbox&sort=saved-desc",
    );
    url.searchParams.set("query", query);
    return (
      await t.query(internal.httpDb.listReferences, { url: url.toString() })
    ).references.map((r) => r._id);
  };
  expect(await run("source:x source:pinterest")).toEqual([ids[1], ids[0]]);
  expect(await run("-source:pinterest")).toEqual([ids[2], ids[0]]);
  expect(await run("origin:board%2Fhands%20and%20poses")).toEqual([ids[1]]);
  expect(await run("-origin:board%2Fhands%20and%20poses")).toEqual([
    ids[2],
    ids[0],
  ]);
});

it("lists distinct source containers with bounded pagination and owner access", async () => {
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "fixture-owner");
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const referenceId = await ctx.db.insert("references", {
      platform: "pinterest",
      kind: "image",
      sourceUrl: "https://example.com",
      capturedAt: 0,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });
    for (let i = 0; i < 27; i++)
      for (let duplicate = 0; duplicate < 2; duplicate++)
        await ctx.db.insert("referenceOrigins", {
          referenceId,
          platform: "pinterest",
          containerType: "board",
          containerKey: `board-${String(i).padStart(2, "0")}`,
          containerName: `Board ${i}`,
          providerItemId: String(duplicate),
          firstObservedAt: 1,
          lastObservedAt: 1,
        });
  });
  await expect(
    t.query(api.referenceOrigins.listContainers, {
      accessKey: "wrong",
      platform: "pinterest",
    }),
  ).rejects.toThrow();
  const first = await t.query(api.referenceOrigins.listContainers, {
    accessKey: "fixture-owner",
    platform: "pinterest",
  });
  const next = await t.query(api.referenceOrigins.listContainers, {
    accessKey: "fixture-owner",
    platform: "pinterest",
    after: first.after!,
  });
  expect(first.items).toHaveLength(24);
  expect(next.items).toHaveLength(3);
  expect(next.after).toBeNull();
});

it("round-trips source collection keys while preserving search and sort-view identity", () => {
  const query = setSourceFilter(
    "blue tag:lighting source:x",
    "origin",
    "board/hands and poses",
    "include",
  );
  expect(readSourceFilters(query).origins).toEqual(["board/hands and poses"]);
  expect(setSourceFilter(query, "source", "x", "exclude")).toContain(
    "-source:x",
  );
  expect(setSourceFilter(query, "source", "x", "all")).toContain(
    "blue tag:lighting",
  );
  expect(visibleSearchText(query)).toBe("blue tag:lighting");
  expect(readSourceFilters(replaceVisibleSearchText(query, "hands"))).toEqual(
    readSourceFilters(query),
  );
  expect(visibleSearchText(replaceVisibleSearchText(query, "hands "))).toBe(
    "hands ",
  );
});
