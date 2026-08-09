import { describe, expect, it } from "vitest";
import { normalizeXMediaUrl, parseXSnapshot } from "./x";

describe("parseXSnapshot", () => {
  it("extracts canonical post, artist, text, time, and media", () => {
    const parsed = parseXSnapshot({
      pageUrl: "https://twitter.com/artist/status/123/photo/1",
      pageTitle: "Artist on X",
      userNameText: "Moon Painter\n@moon_painter\nVerified",
      articleText: "A blue-hour lighting study",
      timestamp: "2026-07-01T04:05:06.000Z",
      primaryStatusUrl: "https://x.com/moon_painter/status/123",
      clickedImageUrl: "https://pbs.twimg.com/media/ABC?format=jpg&name=small",
      links: [
        { href: "https://x.com/moon_painter", text: "Moon Painter @moon_painter" },
        { href: "https://x.com/moon_painter/status/123/analytics" },
      ],
      images: [
        {
          src: "https://pbs.twimg.com/media/ABC?name=small&format=jpg",
          alt: "Character lit by a blue sunset",
          href: "https://x.com/moon_painter/status/123/photo/1",
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
      publishedAt: "2026-07-01T04:05:06.000Z",
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

  it("prefers the timestamp status link over unrelated status links", () => {
    const parsed = parseXSnapshot({
      pageUrl: "https://x.com/home",
      primaryStatusUrl: "https://x.com/outer/status/123",
      userNameText: "Outer Artist\n@outer",
      links: [
        { href: "https://x.com/quoted/status/999" },
        { href: "https://x.com/outer/status/123" },
      ],
      images: [],
    });

    expect(parsed.sourceUrl).toBe("https://x.com/outer/status/123");
    expect(parsed.postId).toBe("123");
    expect(parsed.authorHandle).toBe("@outer");
  });

  it("uses the visible author to recover when the preferred status URL is quoted", () => {
    const parsed = parseXSnapshot({
      pageUrl: "https://x.com/home",
      primaryStatusUrl: "https://x.com/quoted/status/999",
      userNameText: "Outer Artist\n@outer",
      links: [
        { href: "https://x.com/quoted/status/999" },
        { href: "https://x.com/outer/status/123" },
      ],
      images: [],
    });

    expect(parsed.sourceUrl).toBe("https://x.com/outer/status/123");
    expect(parsed.postId).toBe("123");
    expect(parsed.authorHandle).toBe("@outer");
  });

  it("excludes media linked to a different quoted post", () => {
    const parsed = parseXSnapshot({
      pageUrl: "https://x.com/home",
      primaryStatusUrl: "https://x.com/outer/status/123",
      userNameText: "Outer Artist\n@outer",
      articleText: "Look at this reference",
      links: [
        { href: "https://x.com/outer/status/123" },
        { href: "https://x.com/quoted/status/999" },
      ],
      images: [
        {
          src: "https://pbs.twimg.com/media/OUTER?format=jpg&name=small",
          href: "https://x.com/outer/status/123/photo/1",
        },
        {
          src: "https://pbs.twimg.com/media/QUOTED?format=jpg&name=small",
          href: "https://x.com/quoted/status/999/photo/1",
        },
      ],
    });

    expect(parsed.sourceUrl).toBe("https://x.com/outer/status/123");
    expect(parsed.mediaUrls).toEqual([
      "https://pbs.twimg.com/media/OUTER?format=jpg&name=orig",
    ]);
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
