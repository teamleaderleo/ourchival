// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  refreshReferenceSearch,
  scheduleReferenceSearch,
} from "./lib/searchIndex";
import { updateReferenceTags } from "./lib/tags";

const modules = import.meta.glob("./**/*.ts");
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

type Test = ReturnType<typeof convexTest>;

async function refreshJobs(t: Test, kind?: string) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) =>
        job.name.includes("refreshReference") &&
        (kind === undefined || job.state.kind === kind),
    ),
  );
}

async function searchDocument(t: Test, referenceId: Id<"references">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("referenceSearchDocuments")
      .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
      .unique(),
  );
}

async function markers(t: Test) {
  return await t.run(async (ctx) =>
    ctx.db.query("referenceSearchRefreshes").collect(),
  );
}

async function addTag(t: Test, referenceId: Id<"references">, name: string) {
  await t.run(async (ctx: MutationCtx) => {
    await updateReferenceTags(ctx, referenceId, { addNames: [name] });
  });
}

describe("reference search refresh coalescing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("many writes to one reference schedule a single refresh", async () => {
    const t = convexTest(schema, modules);
    const [first, second] = await t.run(async (ctx) => [
      await ctx.db.insert("references", reference({ title: "First" })),
      await ctx.db.insert("references", reference({ title: "Second" })),
    ]);
    // Several writes inside one mutation...
    await t.run(async (ctx: MutationCtx) => {
      for (const name of ["alpha", "beta", "gamma"])
        await updateReferenceTags(ctx, first, { addNames: [name] });
      await scheduleReferenceSearch(ctx, first);
    });
    // ...and several more in quick succession.
    await addTag(t, first, "delta");
    await addTag(t, first, "epsilon");
    await addTag(t, second, "zeta");

    const pending = await refreshJobs(t, "pending");
    expect(pending.map((job) => job.args[0].referenceId).sort()).toEqual(
      [first, second].sort(),
    );

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const doc = await searchDocument(t, first);
    for (const name of ["alpha", "beta", "gamma", "delta", "epsilon"])
      expect(doc?.text).toContain(name);
    expect((await searchDocument(t, second))?.text).toContain("zeta");
    expect(await markers(t)).toHaveLength(0);
  });

  test("a write after a refresh starts still ends with a fresh document", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) =>
      ctx.db.insert("references", reference({ title: "Racing" })),
    );
    await addTag(t, id, "before");
    expect(await refreshJobs(t, "pending")).toHaveLength(1);

    // The refresh commits (clearing the marker) before the next write lands.
    await t.mutation(internal.archiveSearch.refreshReference, {
      referenceId: id,
    });
    expect(await markers(t)).toHaveLength(0);
    await addTag(t, id, "after");
    // The earlier job is still queued, and the new write queued another.
    expect(await refreshJobs(t, "pending")).toHaveLength(2);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const doc = await searchDocument(t, id);
    expect(doc?.text).toContain("before");
    expect(doc?.text).toContain("after");
    expect(await markers(t)).toHaveLength(0);
  });

  test("a marker whose job no longer runs does not block refreshes", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) =>
      ctx.db.insert("references", reference({ title: "Stale" })),
    );
    await addTag(t, id, "first");
    await t.run(async (ctx) => {
      const [marker] = await ctx.db.query("referenceSearchRefreshes").collect();
      await ctx.scheduler.cancel(marker.jobId);
    });
    await addTag(t, id, "second");
    expect(await refreshJobs(t, "pending")).toHaveLength(1);
    expect(await refreshJobs(t, "canceled")).toHaveLength(1);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await searchDocument(t, id))?.text).toContain("second");
  });

  test("a deleted reference drops its search document and marker", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) =>
      ctx.db.insert("references", reference({ title: "Doomed" })),
    );
    await t.run(async (ctx) => refreshReferenceSearch(ctx, id));
    expect(await searchDocument(t, id)).not.toBeNull();
    await addTag(t, id, "gone");
    await t.run(async (ctx) => ctx.db.delete(id));

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await searchDocument(t, id)).toBeNull();
    expect(await markers(t)).toHaveLength(0);
  });

  test("an identical rebuild does not rewrite the search document", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) =>
      ctx.db.insert("references", reference({ title: "Steady" })),
    );
    await t.run(async (ctx) => refreshReferenceSearch(ctx, id));
    const before = await searchDocument(t, id);

    vi.advanceTimersByTime(60_000);
    await t.run(async (ctx) => refreshReferenceSearch(ctx, id));
    expect(await searchDocument(t, id)).toEqual(before);

    // A real change is still written.
    vi.advanceTimersByTime(60_000);
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { title: "Changed" });
      await refreshReferenceSearch(ctx, id);
    });
    const after = await searchDocument(t, id);
    expect(after?._id).toBe(before?._id);
    expect(after?.text).toContain("changed");
    expect(after?.indexedAt).toBeGreaterThan(before!.indexedAt);
  });
});
