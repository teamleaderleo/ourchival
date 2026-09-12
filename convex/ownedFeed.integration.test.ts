// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");

it("excludes tagged and linked own publications only when the feed requests it", async () => {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    const tag = await ctx.db.insert("tags", { name: "X authored media", slug: "x-authored-media", createdAt: 1 });
    const artwork = await ctx.db.insert("artworks", { title: "Mine", status: "finished", createdAt: 1, updatedAt: 1 });
    for (let i = 0; i < 3; i++) {
      const id = await ctx.db.insert("references", { kind: "image", platform: "x", sourceUrl: `https://x.com/artist/status/${i}`, capturedAt: i, boardIds: [], tagIds: i === 0 ? [tag] : [], favorite: false, archived: false, deleted: false });
      if (i === 1) await ctx.db.insert("artworkPublications", { artworkId: artwork, referenceId: id, createdAt: 1, updatedAt: 1 });
    }
  });
  const browse = (suffix: string) => t.query(internal.httpDb.listReferences, { url: `https://example.com/references?collection=library&scope=active${suffix}` });
  expect((await browse("")).references).toHaveLength(3);
  const feed = await browse("&excludeOwned=true");
  expect(feed.references).toHaveLength(1);
  expect(feed.references[0].sourceUrl).toBe("https://x.com/artist/status/2");
  expect((await browse("")).references).toHaveLength(3);
});
