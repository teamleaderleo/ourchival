// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";

// Production history showed most revisions of these documents changed only a
// timestamp. These tests pin that such writes are skipped (or throttled).

const modules = import.meta.glob("./**/*.ts");
const accessKey = "timestamp-only-owner";
const minute = 60_000;
const hour = 60 * minute;
const start = Date.UTC(2026, 8, 1);

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", accessKey);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("referenceSearchState", () => {
  async function rebuildingState(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      for (let n = 0; n < 12; n++)
        await ctx.db.insert("references", reference({ title: `Ref ${n}` }));
      const id = await ctx.db.insert("referenceSearchState", {
        key: "catalog-v1",
        generation: 1,
        ready: false,
        rebuilding: true,
        dirty: false,
        updatedAt: start,
      });
      return id;
    });
  }
  const updatedAt = (t: ReturnType<typeof convexTest>, id: string) =>
    t.run(async (ctx) => {
      const state = await ctx.db
        .query("referenceSearchState")
        .withIndex("by_key", (q) => q.eq("key", "catalog-v1"))
        .unique();
      expect(state?._id).toBe(id);
      return state!.updatedAt;
    });

  it("does not rewrite the heartbeat on every rebuild page", async () => {
    const t = convexTest(schema, modules);
    const id = await rebuildingState(t);
    vi.setSystemTime(start + 5_000);
    await t.mutation(internal.archiveSearch.rebuildPage, {
      generation: 1,
      cursor: null,
    });
    expect(await updatedAt(t, id)).toBe(start);
  });

  it("still beats once the heartbeat resolution has elapsed", async () => {
    const t = convexTest(schema, modules);
    const id = await rebuildingState(t);
    vi.setSystemTime(start + 2 * minute);
    await t.mutation(internal.archiveSearch.rebuildPage, {
      generation: 1,
      cursor: null,
    });
    expect(await updatedAt(t, id)).toBe(start + 2 * minute);
  });
});

describe("captureSessions", () => {
  const session = (t: ReturnType<typeof convexTest>, sessionKey: string) =>
    t.run((ctx) =>
      ctx.db
        .query("captureSessions")
        .withIndex("by_session_key", (q) => q.eq("sessionKey", sessionKey))
        .unique(),
    );

  it("skips updatedAt-only bumps when observations are re-reported", async () => {
    const t = convexTest(schema, modules);
    const report = (updatedAt: number) =>
      t.mutation(internal.captureObservations.record, {
        sessionKey: "x-likes-repeat",
        source: "x_likes",
        updatedAt,
        observations: [
          { providerId: "1", status: "discovered", observedAt: start },
        ],
      });
    await report(start);
    await report(start + 5 * minute);
    expect(await session(t, "x-likes-repeat")).toMatchObject({
      discoveredCount: 1,
      updatedAt: start,
    });
    // Hourly heartbeat keeps retention's TTL anchored to recent reports.
    await report(start + hour);
    expect((await session(t, "x-likes-repeat"))?.updatedAt).toBe(start + hour);
    // A real count change always writes.
    await t.mutation(internal.captureObservations.record, {
      sessionKey: "x-likes-repeat",
      source: "x_likes",
      updatedAt: start + hour + minute,
      observations: [
        { providerId: "2", status: "discovered", observedAt: start },
      ],
    });
    expect(await session(t, "x-likes-repeat")).toMatchObject({
      discoveredCount: 2,
      updatedAt: start + hour + minute,
    });
  });

  it("skips updatedAt-only bumps when progress is re-posted unchanged", async () => {
    const t = convexTest(schema, modules);
    const post = (updatedAt: number, completedCount = 3) =>
      t.mutation(internal.httpDb.upsertCaptureSession, {
        sessionKey: "pixiv-progress",
        source: "pixiv",
        label: "Pixiv bookmarks",
        receiptJson: '{"version":2}',
        expectedCount: 10,
        completedCount,
        savedCount: 2,
        duplicateCount: 1,
        skippedCount: 0,
        failedCount: 0,
        status: "running",
        startedAt: start,
        updatedAt,
      });
    await post(start);
    const unchanged = await post(start + minute);
    expect(unchanged?.updatedAt).toBe(start);
    expect((await session(t, "pixiv-progress"))?.updatedAt).toBe(start);
    await post(start + 2 * minute, 4);
    expect(await session(t, "pixiv-progress")).toMatchObject({
      completedCount: 4,
      updatedAt: start + 2 * minute,
    });
  });

  it("does not rewrite reconciled sessions on sync or same-state review", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "references",
        reference({ captureSessionId: "bundle-1", capturedAt: 5 }),
      );
    });
    await t.mutation(api.captureSessions.syncRecent, { accessKey });
    const synced = await session(t, "bundle-1");
    expect(synced?.updatedAt).toBe(start);

    vi.setSystemTime(start + hour);
    expect(
      await t.mutation(api.captureSessions.syncRecent, { accessKey }),
    ).toMatchObject({ created: 0, updated: 0 });
    await t.mutation(api.captureSessions.setReviewState, {
      accessKey,
      sessionId: synced!._id,
      reviewState: "unreviewed",
    });
    expect((await session(t, "bundle-1"))?.updatedAt).toBe(start);

    await t.mutation(api.captureSessions.setReviewState, {
      accessKey,
      sessionId: synced!._id,
      reviewState: "completed",
    });
    expect(await session(t, "bundle-1")).toMatchObject({
      reviewState: "completed",
      updatedAt: start + hour,
    });
  });
});

describe("artworks", () => {
  const artworkRow = (t: ReturnType<typeof convexTest>, id: string) =>
    t.run((ctx) => ctx.db.get(id as Doc<"artworks">["_id"]));

  it("ignores unchanged edits", async () => {
    const t = convexTest(schema, modules);
    const artwork = await t.mutation(api.artworks.create, {
      accessKey,
      title: "Pink Navia",
      status: "wip",
    });
    vi.setSystemTime(start + hour);
    await t.mutation(api.artworks.update, {
      accessKey,
      artworkId: artwork!._id,
      title: "Pink Navia",
      status: "wip",
    });
    expect((await artworkRow(t, artwork!._id))?.updatedAt).toBe(start);
    await t.mutation(api.artworks.update, {
      accessKey,
      artworkId: artwork!._id,
      status: "finished",
    });
    expect(await artworkRow(t, artwork!._id)).toMatchObject({
      status: "finished",
      updatedAt: start + hour,
    });
  });

  it("collapses a burst of child links into one parent touch", async () => {
    const t = convexTest(schema, modules);
    const artwork = await t.mutation(api.artworks.create, {
      accessKey,
      title: "Burst",
    });
    const [first, second, third] = await t.run(async (ctx) => [
      await ctx.db.insert("references", reference({ sourceUrl: "https://a.test/1" })),
      await ctx.db.insert("references", reference({ sourceUrl: "https://a.test/2" })),
      await ctx.db.insert("references", reference({ sourceUrl: "https://a.test/3" })),
    ]);
    vi.setSystemTime(start + hour);
    await t.mutation(api.artworks.linkPublication, {
      accessKey,
      artworkId: artwork!._id,
      referenceId: first,
    });
    expect((await artworkRow(t, artwork!._id))?.updatedAt).toBe(start + hour);
    vi.setSystemTime(start + hour + minute);
    await t.mutation(api.artworks.linkPublication, {
      accessKey,
      artworkId: artwork!._id,
      referenceId: second,
    });
    expect((await artworkRow(t, artwork!._id))?.updatedAt).toBe(start + hour);
    vi.setSystemTime(start + 2 * hour);
    await t.mutation(api.artworks.linkPublication, {
      accessKey,
      artworkId: artwork!._id,
      referenceId: third,
    });
    expect((await artworkRow(t, artwork!._id))?.updatedAt).toBe(start + 2 * hour);
  });
});
