// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

test("pipeline status reports migration, mirror counts, and yield state", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const idle = await t.query(internal.httpDb.pipelineStatus, {});
    expect(idle.migration).toBeNull();
    expect(idle.drive).toMatchObject({ queued: 0, running: 0, succeeded: 0, failed: 0 });
    expect(idle.backgroundYielding).toBe(false);
    expect(typeof idle.driveConfigured).toBe("boolean");

    await t.mutation(internal.previewMigration.start, {});
    await t.mutation(internal.httpDb.touchFeedActivity, {});
    const active = await t.query(internal.httpDb.pipelineStatus, {});
    expect(active.migration).toMatchObject({ status: "running", scanned: 0 });
    expect(active.backgroundYielding).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally { vi.useRealTimers(); }
});
