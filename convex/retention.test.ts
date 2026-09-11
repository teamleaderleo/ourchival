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
    expect(result).toEqual({ observations: 1, jobs: 1 });

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
});
