import { describe, expect, it } from "vitest";
import {
  duplicatePairKey,
  groupExactDuplicates,
  mergeOrganizationIds,
} from "./duplicateGroups";

describe("groupExactDuplicates", () => {
  const assets = [
    { _id: "asset-a", referenceId: "reference-a", perceptualHash: "aaaaaaaaaaaaaaaa" },
    { _id: "asset-b", referenceId: "reference-b", perceptualHash: "aaaaaaaaaaaaaaaa" },
    { _id: "asset-c", referenceId: "reference-c", perceptualHash: "aaaaaaaaaaaaaaaa" },
    { _id: "asset-d", referenceId: "reference-d", perceptualHash: "bbbbbbbbbbbbbbbb" },
  ];

  it("groups unique reference IDs by exact hash", () => {
    expect(groupExactDuplicates(assets)).toEqual([
      {
        perceptualHash: "aaaaaaaaaaaaaaaa",
        referenceIds: ["reference-a", "reference-b", "reference-c"],
      },
    ]);
  });

  it("splits groups across dismissed false-positive pairs", () => {
    const dismissed = new Set([
      duplicatePairKey("reference-a", "reference-b"),
      duplicatePairKey("reference-a", "reference-c"),
    ]);
    expect(groupExactDuplicates(assets, dismissed)).toEqual([
      {
        perceptualHash: "aaaaaaaaaaaaaaaa",
        referenceIds: ["reference-b", "reference-c"],
      },
    ]);
  });
});

describe("mergeOrganizationIds", () => {
  it("unions organization IDs without duplicates", () => {
    expect(mergeOrganizationIds(["a", "b"], ["b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
