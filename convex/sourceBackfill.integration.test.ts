/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { hydrateReference } from "./lib/referenceCatalog";

const modules = import.meta.glob("./**/*.ts");
it("backfills multiple Pixiv assets on one sealed reference and replays without duplication", async () => {
  const t = convexTest(schema, modules);
  const sourceUrl = "https://www.pixiv.net/en/artworks/42";
  const referenceId = await t.run((ctx) =>
    ctx.db.insert("references", {
      kind: "post",
      sourceUrl,
      platform: "pixiv",
      capturedAt: 1,
      tagIds: [],
      boardIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    }),
  );
  const rawMetadata = JSON.stringify({
    providerId: "42",
    ordinal: 7,
    sealed: true,
    source: {
      provenance: {
        platform: "pixiv",
        containerType: "bookmarks",
        containerKey: "123:private",
        containerUrl:
          "https://www.pixiv.net/en/users/123/bookmarks/artworks?rest=hide",
      },
    },
  });
  for (const index of [0, 1, 0, 1]) {
    const url = `https://i.pximg.net/img-original/42_p${index}.png`;
    await t.mutation(internal.httpDb.saveDuplicateCapture, {
      referenceId,
      reason: "source_url",
      assetUrl: url,
      storedAsset: {
        storageProvider: "google_drive",
        driveFileId: `drive-${index}`,
        fetchedUrl: url,
        width: 2000,
        height: 3000,
      },
      body: { kind: "post" },
      tagNames: ["Sealed"],
      details: { assetIndex: index, assetCount: 2, rawMetadata },
    });
  }
  const result = await t.run(async (ctx) => {
    const reference = await ctx.db.get(referenceId);
    return {
      reference,
      assets: await ctx.db.query("assets").collect(),
      origins: await ctx.db.query("referenceOrigins").collect(),
      hydrated: await hydrateReference(ctx, "http://localhost:3211", reference),
      revealed: await hydrateReference(ctx, "http://localhost:3211", reference, undefined, [], true),
    };
  });
  expect(result.reference?.sealed).toBe(true);
  expect(result.assets).toHaveLength(2);
  expect(result.assets.map((a) => [a.sourceIndex, a.sourceCount])).toEqual([
    [0, 2],
    [1, 2],
  ]);
  expect(result.origins).toHaveLength(1);
  expect(result.origins[0]).toMatchObject({
    providerItemId: "42",
    containerKey: "123:private",
    ordinal: 7,
  });
  expect(
    result.hydrated.assets.every(
      (a: { originalUrl?: string; storedUrl?: string }) =>
        !a.originalUrl && !a.storedUrl,
    ),
  ).toBe(true);
  expect(result.assets.every((a) => Boolean(a.driveFileId))).toBe(true);
  expect(result.revealed.sealed).toBe(true);
  expect(result.revealed.previewsRevealed).toBe(true);
  expect(result.revealed.assets.every((a: { storedUrl?: string }) => a.storedUrl?.startsWith("http://localhost:3211/drive-file?id="))).toBe(true);
});
