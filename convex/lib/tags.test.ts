import { describe, expect, it } from "vitest";
import { normalizeTagName, slugifyTagName } from "./tags";

describe("tag helpers", () => {
  it("normalizes whitespace and caps names", () => {
    expect(normalizeTagName("  artist   study  ")).toBe("artist study");
    expect(normalizeTagName("x".repeat(60))).toHaveLength(48);
  });

  it("creates stable readable slugs", () => {
    expect(slugifyTagName("Artist Study")).toBe("artist-study");
    expect(slugifyTagName("Clothing / Fabric")).toBe("clothing-fabric");
    expect(slugifyTagName("Café Lighting")).toBe("cafe-lighting");
    expect(slugifyTagName("  --  ")).toBe("");
  });
});
