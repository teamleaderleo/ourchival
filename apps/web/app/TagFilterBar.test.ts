import { describe, expect, it } from "vitest";
import { tagChoices } from "./TagFilterBar";

const tags = [
  { slug: "artist-study", name: "Artist Study" },
  { slug: "blue-lighting", name: "Blue Lighting" },
  { slug: "composition", name: "Composition" },
  { slug: "costume-design", name: "Costume Design" },
  { slug: "rim-light", name: "Rim Light" },
];

describe("tagChoices", () => {
  it("filters the tag catalog by name or slug without case sensitivity", () => {
    expect(tagChoices(tags, "LIGHT", "", 12).map((tag) => tag.slug)).toEqual([
      "blue-lighting",
      "rim-light",
    ]);
    expect(tagChoices(tags, "costume-design", "", 12).map((tag) => tag.slug)).toEqual([
      "costume-design",
    ]);
  });

  it("keeps the active tag visible first while searching another part of the catalog", () => {
    expect(
      tagChoices(tags, "blue", "composition", 12).map((tag) => tag.slug),
    ).toEqual(["composition", "blue-lighting"]);
  });

  it("respects the visible chip limit", () => {
    expect(tagChoices(tags, "", "", 3)).toHaveLength(3);
  });
});
