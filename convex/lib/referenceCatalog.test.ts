import { describe, expect, it } from "vitest";
import { parseReferenceFilterTokens } from "./referenceCatalog";

describe("parseReferenceFilterTokens", () => {
  it("extracts tag, board, domain, and kind filters from free text", () => {
    expect(
      parseReferenceFilterTokens(
        "rim light tag:artist-study board:board-123 site:example.com type:article",
      ),
    ).toEqual({
      query: "rim light",
      domain: "example.com",
      sourceType: "article",
      tag: "artist-study",
      board: "board-123",
    });
  });

  it("keeps unknown tokens in the text query", () => {
    expect(parseReferenceFilterTokens("mood palette:blue tag:color")).toEqual({
      query: "mood palette:blue",
      domain: "",
      sourceType: "",
      tag: "color",
      board: "",
    });
  });
});
