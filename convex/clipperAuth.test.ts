/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("clipper authentication", () => {
  it("records last use at 10-minute resolution instead of on every request", async () => {
    const t = convexTest(schema, modules);
    const deviceId = await t.run((ctx) =>
      ctx.db.insert("clipperDevices", {
        name: "Edge",
        tokenHash: "hash",
        createdAt: 0,
      }),
    );
    const lastUsedAt = () =>
      t.run(async (ctx) => (await ctx.db.get(deviceId))?.lastUsedAt);

    await t.mutation(internal.httpDb.authenticateClipper, { tokenHash: "hash", usedAt: 1_000 });
    expect(await lastUsedAt()).toBe(1_000);

    await t.mutation(internal.httpDb.authenticateClipper, { tokenHash: "hash", usedAt: 61_000 });
    expect(await lastUsedAt()).toBe(1_000);

    await t.mutation(internal.httpDb.authenticateClipper, { tokenHash: "hash", usedAt: 601_000 });
    expect(await lastUsedAt()).toBe(601_000);
  });
});
