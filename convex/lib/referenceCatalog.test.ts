import { describe, expect, it } from "vitest";
import { parseReferenceFilterTokens } from "./referenceCatalog";

describe("parseReferenceFilterTokens", () => {
  it("extracts tag, domain, and kind filters from free text", () => {
    expect(
      parseReferenceFilterTokens(
        "rim light tag:artist-study site:example.com type:article",
      ),
    ).toEqual({
      query: "rim light",
      domain: "example.com",
      sourceType: "article",
      tag: "artist-study",
    });
  });

  it("keeps unknown tokens in the text query", () => {
    expect(parseReferenceFilterTokens("mood board:blue tag:color")).toEqual({
      query: "mood board:blue",
      domain: "",
      sourceType: "",
      tag: "color",
    });
  });
});
