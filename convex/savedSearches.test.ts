import { describe, expect, it } from "vitest";
import {
  cleanSavedSearchName,
  cleanSavedSearchQuery,
} from "./savedSearches";

describe("saved search normalization", () => {
  it("trims and collapses names", () => {
    expect(cleanSavedSearchName("  Cool   lighting  ")).toBe("Cool lighting");
  });

  it("keeps filter tokens while collapsing query whitespace", () => {
    expect(
      cleanSavedSearchQuery(
        "  rim light   tag:lighting   project:project-123  ",
      ),
    ).toBe("rim light tag:lighting project:project-123");
  });
});
