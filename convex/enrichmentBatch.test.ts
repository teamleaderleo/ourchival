import { describe, expect, it } from "vitest";
import { isLinkKind } from "./enrichmentBatch";

describe("bulk source metadata eligibility", () => {
  it("accepts link-like references", () => {
    expect(isLinkKind("link")).toBe(true);
    expect(isLinkKind("page")).toBe(true);
    expect(isLinkKind("article")).toBe(true);
  });

  it("skips visual and file references", () => {
    expect(isLinkKind("image")).toBe(false);
    expect(isLinkKind("post")).toBe(false);
    expect(isLinkKind("file")).toBe(false);
  });
});
