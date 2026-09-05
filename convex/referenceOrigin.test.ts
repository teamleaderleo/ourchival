/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { recordReferenceOrigin } from "./lib/referenceOrigin";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("reference origins", () => {
  it("keeps one membership per source container and refreshes its observation", async () => {
    const t = convexTest(schema, modules);
    const referenceId = await t.run((ctx) =>
      ctx.db.insert("references", {
        kind: "post",
        sourceUrl: "https://ca.pinterest.com/pin/987/",
        canonicalUrl: "https://ca.pinterest.com/pin/987/",
        platform: "pinterest",
        capturedAt: 90,
        boardIds: [],
        tagIds: [],
        favorite: false,
        archived: false,
        deleted: false,
      }),
    );
    const rawMetadata = JSON.stringify({
      providerId: "987",
      ordinal: 18,
      source: {
        provenance: {
          platform: "pinterest",
          containerType: "board",
          containerKey: "teamleaderleo/anime-art",
          containerUrl: "https://ca.pinterest.com/teamleaderleo/anime-art/",
          containerName: "Anime art",
        },
      },
    });

    await t.run((ctx) =>
      recordReferenceOrigin(ctx, {
        referenceId,
        rawMetadata,
        captureSessionId: "import:first",
        observedAt: 100,
      }),
    );
    await t.run((ctx) =>
      recordReferenceOrigin(ctx, {
        referenceId,
        rawMetadata,
        captureSessionId: "import:again",
        observedAt: 200,
      }),
    );

    const origins = await t.run((ctx) =>
      ctx.db.query("referenceOrigins").collect(),
    );
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatchObject({
      referenceId,
      platform: "pinterest",
      containerType: "board",
      containerKey: "teamleaderleo/anime-art",
      containerName: "Anime art",
      providerItemId: "987",
      firstObservedAt: 100,
      lastObservedAt: 200,
      captureSessionId: "import:again",
      ordinal: 18,
    });
  });

  it("keeps the same item separately when it appears in another board", async () => {
    const t = convexTest(schema, modules);
    const referenceId = await t.run((ctx) =>
      ctx.db.insert("references", {
        kind: "post",
        sourceUrl: "https://ca.pinterest.com/pin/987/",
        platform: "pinterest",
        capturedAt: 90,
        boardIds: [],
        tagIds: [],
        favorite: false,
        archived: false,
        deleted: false,
      }),
    );
    for (const containerKey of [
      "teamleaderleo/anime-art",
      "teamleaderleo/style",
    ]) {
      await t.run((ctx) =>
        recordReferenceOrigin(ctx, {
          referenceId,
          rawMetadata: {
            providerId: "987",
            source: {
              provenance: {
                platform: "pinterest",
                containerType: "board",
                containerKey,
              },
            },
          },
          observedAt: 100,
        }),
      );
    }
    expect(
      await t.run((ctx) => ctx.db.query("referenceOrigins").collect()),
    ).toHaveLength(2);
  });
});
