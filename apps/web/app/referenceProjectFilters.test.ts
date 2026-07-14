import { describe, expect, it } from "vitest";
import { searchTextOnly } from "./referenceVaultModel";

describe("project query filters", () => {
  it("keeps project filters out of local free-text matching", () => {
    expect(searchTextOnly("project:project-123")).toBe("");
    expect(
      searchTextOnly(
        "rim light project:project-123 board:board-123 tag:lighting site:example.com type:image",
      ),
    ).toBe("rim light");
  });
});
