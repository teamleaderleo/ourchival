import { describe, expect, it } from "vitest";
import { deriveSuggestedTags } from "./suggestedTags";

describe("deriveSuggestedTags", () => {
  it("prioritizes art-reference concepts", () => {
    expect(
      deriveSuggestedTags({
        title: "Blue-hour rim light pose study",
        notes: "Keep the shoulder gesture and cool palette",
      }).map((candidate) => candidate.normalizedValue),
    ).toEqual(
      expect.arrayContaining(["lighting", "pose", "anatomy", "color"]),
    );
  });

  it("removes existing tags and common words", () => {
    const suggestions = deriveSuggestedTags({
      title: "Costume folds and fabric texture",
      notes: "Costume reference for jacket folds",
      existingSlugs: ["clothing"],
    });
    expect(suggestions.map((candidate) => candidate.normalizedValue)).not.toContain(
      "clothing",
    );
    expect(suggestions.map((candidate) => candidate.normalizedValue)).not.toContain(
      "reference",
    );
    expect(suggestions.map((candidate) => candidate.normalizedValue)).toContain(
      "costume",
    );
  });

  it("deduplicates normalized candidates and respects the limit", () => {
    const suggestions = deriveSuggestedTags(
      {
        title: "Architecture architecture architecture perspective",
        description: "Architecture perspective cityscape street",
      },
      3,
    );
    expect(suggestions).toHaveLength(3);
    expect(new Set(suggestions.map((candidate) => candidate.normalizedValue)).size).toBe(3);
  });
});
