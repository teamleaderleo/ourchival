import { describe, expect, it } from "vitest";
import {
  normalizeXMediaUrl,
  parseXEngagementLabels,
  parseXSnapshot,
} from "./x";

describe("parseXSnapshot", () => {
  it("extracts canonical post, artist, text, time, and media", () => {
    const parsed = parseXSnapshot({
      pageUrl: "https://twitter.com/artist/status/123/photo/1",
      pageTitle: "Artist on X",
      userNameText: "Moon Painter\n@moon_painter\nVerified",
      articleText: "A blue-hour lighting study",
      textLanguage: "EN",
      timestamp: "2026-07-01T04:05:06.000Z",
      engagementLabels: [
        "12 replies, 1.2K reposts, 34 quotes, 56,789 likes, 90 bookmarks, 1.5M views",
      ],
      clickedImageUrl: "https://pbs.twimg.com/media/ABC?format=jpg&name=small",
      links: [
        {
          href: "https://x.com/moon_painter",
          text: "Moon Painter @moon_painter",
        },
        { href: "https://x.com/moon_painter/status/123/analytics" },
      ],
      images: [
        {
          src: "https://pbs.twimg.com/media/ABC?name=small&format=jpg",
          alt: "Character lit by a blue sunset",
        },
        {
          src: "https://pbs.twimg.com/profile_images/avatar.jpg",
          alt: "Avatar",
        },
      ],
    });

    expect(parsed).toMatchObject({
      platform: "x",
      sourceUrl: "https://x.com/moon_painter/status/123",
      canonicalUrl: "https://x.com/moon_painter/status/123",
      title: "Moon Painter (@moon_painter) on X",
      authorName: "Moon Painter",
      authorHandle: "@moon_painter",
      authorUrl: "https://x.com/moon_painter",
      postId: "123",
      postText: "A blue-hour lighting study",
      textLanguage: "en",
      publishedAt: "2026-07-01T04:05:06.000Z",
      engagement: {
        replies: 12,
        reposts: 1200,
        quotes: 34,
        likes: 56789,
        bookmarks: 90,
        views: 1500000,
      },
    });
    expect(parsed.mediaUrls).toEqual([
      "https://pbs.twimg.com/media/ABC?format=jpg&name=orig",
    ]);
    expect(parsed.clickedAssetUrl).toBe(
      "https://pbs.twimg.com/media/ABC?format=jpg&name=orig",
    );
    expect(parsed.altTexts).toEqual({
      "https://pbs.twimg.com/media/ABC?format=jpg&name=orig":
        "Character lit by a blue sunset",
    });
  });

  it("falls back to the page URL when post links are missing", () => {
    const parsed = parseXSnapshot({
      pageUrl: "https://mobile.twitter.com/artist/status/999?s=20",
      links: [],
      images: [],
    });

    expect(parsed.sourceUrl).toBe("https://x.com/artist/status/999");
    expect(parsed.postId).toBe("999");
    expect(parsed.authorHandle).toBe("@artist");
  });
});

describe("parseXEngagementLabels", () => {
  it("merges the aggregate and per-action labels X exposes", () => {
    expect(
      parseXEngagementLabels([
        "2 Replies. Reply",
        "3 reposts. Repost",
        "4 Likes. Like",
        "5 Bookmarks. Bookmark",
        "6.7K Views. View post analytics",
      ]),
    ).toEqual({
      replies: 2,
      reposts: 3,
      likes: 4,
      bookmarks: 5,
      views: 6700,
    });
  });
});

describe("normalizeXMediaUrl", () => {
  it("requests the original rendition with stable query ordering", () => {
    expect(
      normalizeXMediaUrl(
        "https://pbs.twimg.com/media/XYZ?name=medium&format=png",
      ),
    ).toBe("https://pbs.twimg.com/media/XYZ?format=png&name=orig");
  });

  it("leaves unrelated image hosts untouched", () => {
    expect(normalizeXMediaUrl("https://example.com/image.jpg")).toBe(
      "https://example.com/image.jpg",
    );
  });
});
