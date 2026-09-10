import { describe, expect, it } from "vitest";
import { sidebarFacets } from "./sidebarFacets";
import type { SavedReference } from "./referenceVaultModel";

const ref = (id: string, extra: Partial<SavedReference> = {}): SavedReference => ({
  _id: id, kind: "image", sourceUrl: "https://example.com/art", platform: "pixiv", capturedAt: 1,
  assets: [], ...extra,
});
const tag = { _id: "tag1", name: "lighting", slug: "lighting", createdAt: 1 };
describe("sidebar discovery shortcuts", () => {
  it("counts each reference once, ignoring duplicated memberships and tags", () => {
    const a = ref("a", { authorName: "Artist", authorUrl: "https://example.com/artist", tags: [tag, tag] });
    const result = sidebarFacets([a, a, ref("b", { authorName: "Artist", authorUrl: a.authorUrl, tags: [tag] })]);
    expect(result.artists[0]?.count).toBe(2);
    expect(result.tags[0]).toMatchObject({ count: 2, query: "tag:lighting" });
  });
  it("does not expose hidden private material or turn import labels into visual tags", () => {
    const result = sidebarFacets([
      ref("a", { sealed: true, authorName: "Private artist", tags: [tag] }),
      ref("b", { deleted: true, authorName: "Deleted artist" }),
      ref("c", { tags: [{ ...tag, name: "Pixiv bookmarks" }] }),
    ]);
    expect(result).toEqual({ artists: [], tags: [] });
    expect(sidebarFacets([ref("d", { sealed: true, previewsRevealed: true, tags: [tag] })]).tags).toHaveLength(1);
  });
  it("keeps same-name artists at distinct source identities separate and bounds output", () => {
    const result = sidebarFacets([ref("a", { authorName: "Same", authorUrl: "https://example.com/1" }), ref("b", { authorName: "Same", authorUrl: "https://example.com/2" })]);
    expect(result.artists).toHaveLength(2);
    expect(sidebarFacets([ref("a", { authorName: "A" }), ref("b", { authorName: "B" })], 1).artists).toHaveLength(1);
  });
});
