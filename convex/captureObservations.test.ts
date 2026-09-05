/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("capture observations", () => {
  it("advances durable receipt counts without double-counting repeats", async () => {
    const t = convexTest(schema, modules);
    const base = {
      sessionKey: "x-likes-test",
      source: "x_likes",
      updatedAt: 100,
    };

    await t.mutation(internal.captureObservations.record, {
      ...base,
      observations: [
        { providerId: "1", status: "discovered", observedAt: 90 },
        { providerId: "2", status: "discovered", observedAt: 90 },
      ],
    });
    const rendered = await t.mutation(internal.captureObservations.record, {
      ...base,
      updatedAt: 110,
      observations: [
        {
          providerId: "1",
          sourceUrl: "https://x.com/artist/status/1",
          status: "rendered",
          observedAt: 105,
        },
      ],
    });
    expect(rendered).toMatchObject({
      networkPosts: 2,
      observedPosts: 1,
      vaultPosts: 0,
      networkMissingInDom: 1,
      domMissingInVault: 1,
    });

    const archived = await t.mutation(internal.captureObservations.record, {
      ...base,
      updatedAt: 120,
      observations: [
        {
          providerId: "1",
          sourceUrl: "https://x.com/artist/status/1",
          status: "archived",
          observedAt: 115,
        },
        {
          providerId: "1",
          sourceUrl: "https://x.com/artist/status/1",
          status: "archived",
          observedAt: 115,
        },
      ],
    });
    expect(archived).toMatchObject({
      status: "gaps",
      networkPosts: 2,
      observedPosts: 1,
      vaultPosts: 1,
      networkMissingInDom: 1,
      domMissingInVault: 0,
    });
    expect(
      await t.query(internal.captureObservations.listGaps, {
        sessionKey: "x-likes-test",
        limit: 20,
      }),
    ).toEqual([
      expect.objectContaining({ providerId: "2", status: "discovered" }),
    ]);
  });

  it("never downgrades an archived observation", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.captureObservations.record, {
      sessionKey: "x-likes-archived",
      source: "x_likes",
      updatedAt: 100,
      observations: [
        {
          providerId: "9",
          sourceUrl: "https://x.com/artist/status/9",
          status: "archived",
          observedAt: 90,
        },
      ],
    });
    const receipt = await t.mutation(internal.captureObservations.record, {
      sessionKey: "x-likes-archived",
      source: "x_likes",
      updatedAt: 110,
      observations: [
        { providerId: "9", status: "failed", error: "late", observedAt: 105 },
      ],
    });
    expect(receipt).toMatchObject({
      status: "verified",
      networkPosts: 1,
      observedPosts: 1,
      vaultPosts: 1,
    });
  });
});
