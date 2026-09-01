import { describe, expect, it } from "vitest";
import {
  parseReferenceFilterTokens,
  sourceMetadataPayload,
} from "./referenceCatalog";

describe("parseReferenceFilterTokens", () => {
  it("extracts project, tag, board, domain, and kind filters from free text", () => {
    expect(
      parseReferenceFilterTokens(
        "rim light project:project-9 tag:artist-study board:board-123 site:example.com type:article",
      ),
    ).toEqual({
      query: "rim light",
      domain: "example.com",
      sourceType: "article",
      tag: "artist-study",
      board: "board-123",
      project: "project-9",
    });
  });

  it("keeps unknown tokens in the text query", () => {
    expect(parseReferenceFilterTokens("mood palette:blue tag:color")).toEqual({
      query: "mood palette:blue",
      domain: "",
      sourceType: "",
      tag: "color",
      board: "",
      project: "",
    });
  });
});

describe("sourceMetadataPayload", () => {
  it("exposes bounded classifier metadata without returning the raw snapshot", () => {
    expect(
      sourceMetadataPayload(
        JSON.stringify({
          rawMetadata: {
            provenance: "ourchival-clipper:x-likes",
            sourceKind: "x_like",
            feedContext: "likes",
            textLanguage: "en",
            mediaIndex: 1,
            mediaCount: 4,
            engagement: {
              replies: 2,
              reposts: 3,
              quotes: 4,
              likes: 5,
              bookmarks: 6,
              views: 7,
              ignored: "private implementation detail",
            },
            snapshot: { pageUrl: "https://x.com/i/history/likes" },
          },
        }),
      ),
    ).toEqual({
      provenance: "ourchival-clipper:x-likes",
      sourceKind: "x_like",
      feedContext: "likes",
      textLanguage: "en",
      mediaIndex: 1,
      mediaCount: 4,
      engagement: {
        replies: 2,
        reposts: 3,
        quotes: 4,
        likes: 5,
        bookmarks: 6,
        views: 7,
      },
    });
  });
});
