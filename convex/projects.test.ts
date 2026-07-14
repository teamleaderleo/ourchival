import { describe, expect, it } from "vitest";
import { cleanProjectName } from "./projects";

describe("cleanProjectName", () => {
  it("normalizes whitespace and caps long names", () => {
    expect(cleanProjectName("  Character   sheet  ")).toBe("Character sheet");
    expect(cleanProjectName("x".repeat(120))).toHaveLength(100);
  });
});
