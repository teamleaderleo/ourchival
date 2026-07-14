import { describe, expect, it } from "vitest";
import { filterReferences, searchTextOnly, type SavedReference } from "./referenceVaultModel";

const tagged: SavedReference = {
  _id: "tagged",
  kind: "image",
  sourceUrl: "https://example.com/reference",
  platform: "generic",
  capturedAt: 1,
  assets: [],
  tags: [
    { _id: "tag-1", name: "Artist Study", slug: "artist-study", createdAt: 1 },
    { _id: "tag-2", name: "Lighting", slug: "lighting", createdAt: 1 },
  ],
};

describe("reference tag search", () => {
  it("searches hydrated tag names and slugs", () => {
    expect(filterReferences([tagged], { query: "artist study" })).toEqual([tagged]);
    expect(filterReferences([tagged], { query: "artist-study" })).toEqual([tagged]);
  });

  it("leaves tag tokens to the server-side filter", () => {
    expect(searchTextOnly("tag:artist-study")).toBe("");
    expect(filterReferences([tagged], { query: "tag:artist-study" })).toEqual([tagged]);
    expect(searchTextOnly("tag:lighting rim light")).toBe("rim light");
  });
});
