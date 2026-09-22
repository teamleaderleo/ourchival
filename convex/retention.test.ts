// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const old = 1;
const recent = Date.now();
const session = (overrides: Record<string, unknown>) => ({
  sessionKey: "s-key",
  source: "clipper",
  kind: "import" as const,
  expectedCount: 1,
  completedCount: 1,
  savedCount: 1,
  duplicateCount: 0,
  skippedCount: 0,
  failedCount: 0,
  status: "completed" as const,
  reviewState: "unreviewed" as const,
  startedAt: old,
  createdAt: old,
  updatedAt: old,
  ...overrides,
});
const observation = (overrides: Record<string, unknown>) => ({
  sessionKey: "s-key",
  source: "clipper",
  providerId: "p-1",
  status: "archived" as const,
  discoveredAt: old,
  updatedAt: old,
  ...overrides,
});
const job = (overrides: Record<string, unknown>) => ({
  referenceId: undefined as never,
  type: "media_derivatives" as const,
  status: "succeeded" as const,
  attempts: 1,
  requestedAt: old,
  createdAt: old,
  updatedAt: old,
  ...overrides,
});

describe("retention sweep", () => {
  it("deletes aged terminal history and keeps receipts plus live work", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", {
        kind: "image",
        platform: "manual",
        sourceUrl: "https://example.com/r",
        capturedAt: 1,
        boardIds: [],
        tagIds: [],
        favorite: false,
        archived: false,
        deleted: false,
      });
      await ctx.db.insert("captureSessions", session({}));
      await ctx.db.insert(
        "captureSessions",
        session({ sessionKey: "s-running", status: "running", updatedAt: recent }),
      );
      await ctx.db.insert(
        "captureSessions",
        session({ sessionKey: "s-fresh", updatedAt: recent }),
      );
      const oldObservation = await ctx.db.insert("captureObservations", observation({}));
      const runningObservation = await ctx.db.insert(
        "captureObservations",
        observation({ sessionKey: "s-running", updatedAt: recent }),
      );
      const freshObservation = await ctx.db.insert(
        "captureObservations",
        observation({ sessionKey: "s-fresh", updatedAt: recent }),
      );
      const oldJob = await ctx.db.insert(
        "enrichmentJobs",
        job({ referenceId }),
      );
      const liveJob = await ctx.db.insert(
        "enrichmentJobs",
        job({ referenceId, status: "running", updatedAt: recent }),
      );
      const freshJob = await ctx.db.insert(
        "enrichmentJobs",
        job({ referenceId, updatedAt: recent }),
      );
      return { oldObservation, runningObservation, freshObservation, oldJob, liveJob, freshJob };
    });

    const result = await t.mutation(internal.retention.sweep, {});
    expect(result).toMatchObject({ observations: 1, jobs: 1 });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(ids.oldObservation)).toBeNull();
      expect(await ctx.db.get(ids.runningObservation)).not.toBeNull();
      expect(await ctx.db.get(ids.freshObservation)).not.toBeNull();
      expect(await ctx.db.get(ids.oldJob)).toBeNull();
      expect(await ctx.db.get(ids.liveJob)).not.toBeNull();
      expect(await ctx.db.get(ids.freshJob)).not.toBeNull();
      // Session receipts are never deleted.
      expect((await ctx.db.query("captureSessions").collect()).length).toBe(3);
    });
  });

  it("reaches newer eligible sessions past long-running ones", async () => {
    const t = convexTest(schema, modules);
    const target = await t.run(async (ctx) => {
      // 60 ancient running sessions used to fill the 50-row batch forever.
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert(
          "captureSessions",
          session({ sessionKey: `running-${i}`, status: "running", updatedAt: old + i }),
        );
      }
      await ctx.db.insert(
        "captureSessions",
        session({ sessionKey: "eligible", status: "interrupted", updatedAt: 1000 }),
      );
      return await ctx.db.insert(
        "captureObservations",
        observation({ sessionKey: "eligible" }),
      );
    });

    const result = await t.mutation(internal.retention.sweep, {});
    expect(result).toMatchObject({ observations: 1 });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(target)).toBeNull();
    });
  });

  it("drops drained sessions so later runs make progress", async () => {
    const t = convexTest(schema, modules);
    const target = await t.run(async (ctx) => {
      // 60 aged, already-empty completed sessions are older than the one
      // that still has observations to sweep.
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert(
          "captureSessions",
          session({ sessionKey: `drained-${i}`, updatedAt: old + i }),
        );
      }
      await ctx.db.insert(
        "captureSessions",
        session({ sessionKey: "eligible", updatedAt: 1000 }),
      );
      return await ctx.db.insert(
        "captureObservations",
        observation({ sessionKey: "eligible" }),
      );
    });

    await t.mutation(internal.retention.sweep, {});
    await t.mutation(internal.retention.sweep, {});
    await t.run(async (ctx) => {
      expect(await ctx.db.get(target)).toBeNull();
      const sessions = await ctx.db.query("captureSessions").collect();
      expect(sessions).toHaveLength(61);
      expect(sessions.every((s) => s.observationsSweptAt !== undefined)).toBe(true);
      // Stamping the marker never moves the receipt's own timestamp.
      expect(sessions.find((s) => s.sessionKey === "eligible")?.updatedAt).toBe(1000);
    });
    // Nothing left to read: a third run touches no sessions.
    expect(await t.mutation(internal.retention.sweep, {})).toMatchObject({
      observations: 0,
      sessionsSwept: 0,
    });
  });

  it("reaches expired terminal jobs past old live jobs", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", {
        kind: "image",
        platform: "manual",
        sourceUrl: "https://example.com/r",
        capturedAt: 1,
        boardIds: [],
        tagIds: [],
        favorite: false,
        archived: false,
        deleted: false,
      });
      // 600 ancient non-terminal jobs used to fill the 500-row window forever.
      const live = [];
      for (let i = 0; i < 600; i++) {
        live.push(
          await ctx.db.insert(
            "enrichmentJobs",
            job({
              referenceId,
              status: i % 2 === 0 ? ("queued" as const) : ("running" as const),
              updatedAt: old + i,
            }),
          ),
        );
      }
      const expired = [];
      for (const status of ["succeeded", "failed", "dismissed"] as const) {
        expired.push(
          await ctx.db.insert(
            "enrichmentJobs",
            job({ referenceId, status, updatedAt: 10_000 }),
          ),
        );
      }
      const fresh = await ctx.db.insert(
        "enrichmentJobs",
        job({ referenceId, status: "failed", updatedAt: recent }),
      );
      return { live, expired, fresh };
    });

    expect(await t.mutation(internal.retention.sweep, {})).toMatchObject({ jobs: 3 });
    await t.run(async (ctx) => {
      for (const id of ids.expired) expect(await ctx.db.get(id)).toBeNull();
      expect(await ctx.db.get(ids.fresh)).not.toBeNull();
      for (const id of ids.live) expect(await ctx.db.get(id)).not.toBeNull();
    });
  });

  it("caps job deletions per run across terminal statuses", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const referenceId = await ctx.db.insert("references", {
        kind: "image",
        platform: "manual",
        sourceUrl: "https://example.com/r",
        capturedAt: 1,
        boardIds: [],
        tagIds: [],
        favorite: false,
        archived: false,
        deleted: false,
      });
      for (let i = 0; i < 300; i++) {
        await ctx.db.insert("enrichmentJobs", job({ referenceId, updatedAt: old + i }));
        await ctx.db.insert(
          "enrichmentJobs",
          job({ referenceId, status: "failed", updatedAt: old + i }),
        );
      }
    });

    expect(await t.mutation(internal.retention.sweep, {})).toMatchObject({ jobs: 500 });
    expect(await t.mutation(internal.retention.sweep, {})).toMatchObject({ jobs: 100 });
    expect(await t.mutation(internal.retention.sweep, {})).toMatchObject({ jobs: 0 });
  });

  it("re-arms a swept session when new observations arrive", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("captureSessions", session({ observationsSweptAt: 5 }));
    });
    await t.mutation(internal.captureObservations.record, {
      sessionKey: "s-key",
      source: "clipper",
      observations: [{ providerId: "late", status: "archived", observedAt: 2 }],
      updatedAt: 2,
    });
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("captureSessions").collect();
      expect(row.observationsSweptAt).toBeUndefined();
    });
    expect(await t.mutation(internal.retention.sweep, {})).toMatchObject({
      observations: 1,
      sessionsSwept: 1,
    });
  });
});
