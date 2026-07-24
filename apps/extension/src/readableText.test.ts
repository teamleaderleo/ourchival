import { describe, expect, it } from "vitest";
import { normalizeReadableText } from "./readableText";

describe("readable page text", () => {
  it("normalizes browser whitespace while preserving paragraphs", () => {
    expect(
      normalizeReadableText("  First\t line \r\n\r\n\r\n Second   line  "),
    ).toBe("First line\n\nSecond line");
  });

  it("collapses non-breaking spaces", () => {
    expect(normalizeReadableText("one\u00a0\u00a0two")).toBe("one two");
  });
});
