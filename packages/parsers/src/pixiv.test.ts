import { describe, expect, it } from "vitest";
import { parsePixivSnapshot } from "./pixiv";

describe("parsePixivSnapshot", () => {
  it("normalizes artwork and artist identity while preserving ordered media", () => {
    const parsed = parsePixivSnapshot({
      pageUrl: "https://www.pixiv.net/en/artworks/12345?foo=bar",
      title: "  Blue Hour  ",
      description: " Lighting   study ",
      artistName: " Moon Painter ",
      artistUrl: "https://www.pixiv.net/en/users/6789",
      publishedAt: "2026-08-01T02:03:04.000Z",
      tags: ["original", "Blue", "original", " blue "],
      images: [
        { src: "https://i.pximg.net/img-master/a_p0.jpg", alt: " first page " },
        { src: "https://i.pximg.net/img-master/a_p1.jpg" },
        { src: "https://i.pximg.net/img-master/a_p0.jpg" },
      ],
    });

    expect(parsed).toMatchObject({
      platform: "pixiv",
      sourceUrl: "https://www.pixiv.net/en/artworks/12345",
      canonicalUrl: "https://www.pixiv.net/en/artworks/12345",
      title: "Blue Hour",
      authorName: "Moon Painter",
      authorUrl: "https://www.pixiv.net/en/users/6789",
      postId: "12345",
      postText: "Lighting study",
      description: "Lighting study",
      publishedAt: "2026-08-01T02:03:04.000Z",
      sourceTags: ["original", "Blue"],
    });
    expect(parsed.mediaUrls).toEqual([
      "https://i.pximg.net/img-master/a_p0.jpg",
      "https://i.pximg.net/img-master/a_p1.jpg",
    ]);
    expect(parsed.altTexts).toEqual({
      "https://i.pximg.net/img-master/a_p0.jpg": "first page",
    });
  });

  it("prefers explicit numeric IDs over incidental URLs", () => {
    const parsed = parsePixivSnapshot({
      pageUrl: "https://www.pixiv.net/en/artworks/111",
      canonicalUrl: "https://www.pixiv.net/en/artworks/222",
      artworkId: "333",
      artistId: "444",
      artistUrl: "https://www.pixiv.net/en/users/555",
      images: [],
    });

    expect(parsed.sourceUrl).toBe("https://www.pixiv.net/en/artworks/333");
    expect(parsed.authorUrl).toBe("https://www.pixiv.net/en/users/444");
  });

  it("keeps an observed web URL when artwork identity is unavailable", () => {
    const parsed = parsePixivSnapshot({
      pageUrl: "https://www.pixiv.net/en/discovery",
      canonicalUrl: "https://www.pixiv.net/en/discovery#works",
      images: [],
    });

    expect(parsed.sourceUrl).toBe("https://www.pixiv.net/en/discovery");
    expect(parsed.postId).toBeUndefined();
  });
});
