import { describe, expect, it } from "vitest";
import { filterReviewTags, referenceTagGroups } from "./referenceTagGroups";

const tag = (name: string, category = "general", rejected = false) => ({
  name,
  category,
  rejected,
  confidence: 0.8,
});

describe("reference detail review", () => {
  it("groups visible details without promoting identity predictions or mutating saved tags", () => {
    const tags = [
      tag("heart_hands"),
      tag("from_below"),
      tag("unknown_term"),
      tag("sitting", "character"),
    ];
    const before = structuredClone(tags);
    expect(
      referenceTagGroups(tags).map((g) => [g.name, g.tags.map((t) => t.name)]),
    ).toEqual([
      ["Pose and gesture", ["heart_hands"]],
      ["Viewpoint and depth", ["from_below"]],
    ]);
    expect(tags).toEqual(before);
    expect(filterReviewTags(tags, "")).toEqual(tags);
  });
  it("keeps rejected details available for restoration", () => {
    const rejected = tag("heart_hands", "general", true);
    expect(referenceTagGroups([rejected])[0]?.tags).toEqual([rejected]);
  });
  it("finds raw terms by readable spelling or category", () => {
    const tags = [tag("heart_hands"), tag("sample_artist", "artist")];
    expect(filterReviewTags(tags, " HEART HANDS ")).toEqual([tags[0]]);
    expect(filterReviewTags(tags, "heart_hands")).toEqual([tags[0]]);
    expect(filterReviewTags(tags, "artist")).toEqual([tags[1]]);
    expect(filterReviewTags(tags, "missing")).toEqual([]);
  });
});
