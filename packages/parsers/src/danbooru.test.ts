import { describe, expect, it } from "vitest";
import { parseDanbooruSnapshot } from "./danbooru";

describe("parseDanbooruSnapshot", () => {
  it("preserves native tags, source identity, relationships, and dimensions", () => {
    const parsed = parseDanbooruSnapshot({
      pageUrl: "https://danbooru.donmai.us/posts/12345?foo=bar",
      sourceUrl: "https://artist.example/original/abc",
      mediaUrl: "https://cdn.donmai.us/original.jpg#fragment",
      width: 3200,
      height: 2400,
      rating: "sensitive",
      artistNames: [" artist_a ", "Artist A", "artist_b"],
      tags: [
        { name: " blue_hair ", category: "general" },
        { name: "artist_a", category: "artist" },
        { name: "blue_hair", category: "general" },
        { name: "series_name", category: "copyright" },
      ],
      poolIds: [" 9 ", "9", "10"],
      parentId: " 100 ",
      childIds: ["101", "101", "102"],
      createdAt: "2026-08-01T03:04:05.000Z",
    });

    expect(parsed).toMatchObject({
      platform: "danbooru",
      sourceUrl: "https://danbooru.donmai.us/posts/12345",
      canonicalUrl: "https://danbooru.donmai.us/posts/12345",
      title: "artist_a, artist_b",
      authorName: "artist_a",
      postId: "12345",
      originalSourceUrl: "https://artist.example/original/abc",
      dimensions: { width: 3200, height: 2400 },
      rating: "sensitive",
      poolIds: ["9", "10"],
      parentId: "100",
      childIds: ["101", "102"],
      publishedAt: "2026-08-01T03:04:05.000Z",
    });
    expect(parsed.mediaUrls).toEqual([
      "https://cdn.donmai.us/original.jpg",
    ]);
    expect(parsed.sourceTags).toEqual([
      { name: "blue_hair", category: "general" },
      { name: "artist_a", category: "artist" },
      { name: "series_name", category: "copyright" },
    ]);
  });

  it("prefers an explicit post ID and falls back to preview media", () => {
    const parsed = parseDanbooruSnapshot({
      pageUrl: "https://danbooru.donmai.us/posts/111",
      postId: "222",
      previewUrl: "https://cdn.donmai.us/preview.jpg",
      images: undefined as never,
    } as never);

    expect(parsed.sourceUrl).toBe("https://danbooru.donmai.us/posts/222");
    expect(parsed.mediaUrls).toEqual(["https://cdn.donmai.us/preview.jpg"]);
  });

  it("rejects non-web source URLs and incomplete dimensions", () => {
    const parsed = parseDanbooruSnapshot({
      pageUrl: "https://danbooru.donmai.us/posts/3",
      sourceUrl: "javascript:alert(1)",
      width: 100,
      height: 0,
    });

    expect(parsed.originalSourceUrl).toBeUndefined();
    expect(parsed.dimensions).toBeUndefined();
  });
});
