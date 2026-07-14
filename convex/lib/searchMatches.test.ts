import { describe, expect, it } from "vitest";
import { findReferenceSearchMatches } from "./searchMatches";

const reference = {
  title: "Blue-hour pose study",
  notes: "Keep the shoulder rhythm",
  sourceUrl: "https://example.com/reference",
  platform: "generic",
  kind: "image",
};

const snapshot = {
  description: "A rim-lit character under cool evening light",
};

const context = {
  tags: [{ name: "Lighting", slug: "lighting" }],
  boards: [{ name: "Chapter 4", description: "Final rooftop sequence" }],
  projectUses: [
    {
      reason: "Use for the confrontation pose",
      notes: "Borrow the silhouette, not the costume",
      project: {
        name: "Moon Comic",
        description: "Long-form character story",
        status: "active",
      },
    },
  ],
};

describe("findReferenceSearchMatches", () => {
  it("reports core and source metadata fields", () => {
    expect(
      findReferenceSearchMatches(reference, snapshot, context, "rim-lit").map(
        (match) => match.label,
      ),
    ).toEqual(["Description"]);
    expect(
      findReferenceSearchMatches(reference, snapshot, context, "shoulder").map(
        (match) => match.label,
      ),
    ).toEqual(["Notes"]);
  });

  it("searches tags, boards, projects, and project reuse metadata", () => {
    expect(
      findReferenceSearchMatches(reference, snapshot, context, "lighting").map(
        (match) => match.label,
      ),
    ).toEqual(["Tag", "Tag slug"]);
    expect(
      findReferenceSearchMatches(reference, snapshot, context, "rooftop").map(
        (match) => match.label,
      ),
    ).toEqual(["Board description"]);
    expect(
      findReferenceSearchMatches(reference, snapshot, context, "moon comic").map(
        (match) => match.label,
      ),
    ).toEqual(["Project"]);
    expect(
      findReferenceSearchMatches(reference, snapshot, context, "silhouette").map(
        (match) => match.label,
      ),
    ).toEqual(["Project notes"]);
  });
});
