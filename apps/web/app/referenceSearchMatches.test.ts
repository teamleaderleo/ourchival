import { describe, expect, it } from "vitest";
import { filterReferences, type SavedReference } from "./referenceVaultModel";

const reference: SavedReference = {
  _id: "reference-1",
  kind: "image",
  title: "Pose study",
  sourceUrl: "https://example.com/pose",
  platform: "generic",
  capturedAt: 1,
  assets: [],
  searchMatches: [
    {
      field: "projectNotes",
      label: "Project notes",
      excerpt: "Borrow the silhouette for the confrontation",
    },
  ],
};

describe("organization search matches", () => {
  it("keeps server matches that are absent from core client fields", () => {
    expect(
      filterReferences([reference], { query: "silhouette" }).map((item) => item._id),
    ).toEqual(["reference-1"]);
  });
});
