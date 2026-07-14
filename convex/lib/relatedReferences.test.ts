import { describe, expect, it } from "vitest";
import {
  meaningfulKeywords,
  scoreRelatedReference,
  type RelatedReferenceInput,
} from "./relatedReferences";

const target: RelatedReferenceInput = {
  _id: "target",
  tagIds: ["lighting", "pose"],
  boardIds: ["chapter-four"],
  projectIds: ["moon-comic"],
  title: "Blue-hour rooftop pose",
  notes: "Keep the shoulder silhouette",
  authorHandle: "@moon_artist",
  sourceUrl: "https://x.com/moon_artist/status/1",
  platform: "x",
  kind: "image",
};

it("ranks shared projects, tags, boards, and authors explicitly", () => {
  const candidate: RelatedReferenceInput = {
    ...target,
    _id: "candidate",
    tagIds: ["lighting"],
    title: "Rooftop silhouette study",
    sourceUrl: "https://x.com/moon_artist/status/2",
  };
  const result = scoreRelatedReference(target, candidate, {
    tags: { lighting: "Lighting" },
    boards: { "chapter-four": "Chapter 4" },
    projects: { "moon-comic": "Moon Comic" },
  });

  expect(result.score).toBeGreaterThan(20);
  expect(result.reasons.map((reason) => reason.label)).toEqual(
    expect.arrayContaining([
      "Shared project",
      "Shared tag",
      "Shared board",
      "Same author",
      "Same source",
      "Shared phrase",
    ]),
  );
});

it("keeps weak platform-only matches below meaningful overlaps", () => {
  const weak: RelatedReferenceInput = {
    _id: "weak",
    tagIds: [],
    boardIds: [],
    projectIds: [],
    title: "Unrelated object",
    sourceUrl: "https://example.com/object",
    platform: "x",
    kind: "image",
  };
  const strong: RelatedReferenceInput = {
    ...weak,
    _id: "strong",
    tagIds: ["lighting"],
    projectIds: ["moon-comic"],
  };

  expect(scoreRelatedReference(target, strong).score).toBeGreaterThan(
    scoreRelatedReference(target, weak).score,
  );
});

describe("meaningfulKeywords", () => {
  it("removes common archive words and deduplicates useful phrases", () => {
    expect(
      meaningfulKeywords("Keep this rooftop rooftop silhouette reference"),
    ).toEqual(["rooftop", "silhouette"]);
  });
});
