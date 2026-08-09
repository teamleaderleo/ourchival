import { describe, expect, it } from "vitest";
import { parsePinterestSnapshot } from "./pinterest";

describe("parsePinterestSnapshot", () => {
  it("preserves pin identity and the outbound original source", () => {
    const parsed = parsePinterestSnapshot({
      pageUrl: "https://www.pinterest.com/pin/123456789/?foo=bar",
      title: "  Cathedral lighting  ",
      description: " Blue   hour reference ",
      creatorName: " Curator ",
      creatorUrl: "https://www.pinterest.com/curator/",
      outboundUrl: "https://artist.example/gallery/work#detail",
      boardName: " Architecture ",
      boardUrl: "https://www.pinterest.com/curator/architecture/",
      mediaUrl: "https://i.pinimg.com/originals/a/b/c/image.jpg",
      altText: " tall gothic interior ",
      topics: ["Lighting", "architecture", " lighting "],
    });

    expect(parsed).toMatchObject({
      platform: "pinterest",
      sourceUrl: "https://www.pinterest.com/pin/123456789/",
      canonicalUrl: "https://www.pinterest.com/pin/123456789/",
      title: "Cathedral lighting",
      authorName: "Curator",
      authorUrl: "https://www.pinterest.com/curator/",
      postId: "123456789",
      postText: "Blue hour reference",
      outboundSourceUrl: "https://artist.example/gallery/work",
      boardName: "Architecture",
      boardUrl: "https://www.pinterest.com/curator/architecture/",
      sourceTags: ["Lighting", "architecture"],
    });
    expect(parsed.mediaUrls).toEqual([
      "https://i.pinimg.com/originals/a/b/c/image.jpg",
    ]);
    expect(parsed.altTexts).toEqual({
      "https://i.pinimg.com/originals/a/b/c/image.jpg": "tall gothic interior",
    });
  });

  it("does not mistake another Pinterest URL for the outbound original source", () => {
    const parsed = parsePinterestSnapshot({
      pageUrl: "https://www.pinterest.com/pin/1/",
      outboundUrl: "https://www.pinterest.com/another/pin/2/",
    });

    expect(parsed.outboundSourceUrl).toBeUndefined();
  });

  it("prefers explicit pin identity over incidental page URLs", () => {
    const parsed = parsePinterestSnapshot({
      pageUrl: "https://www.pinterest.com/pin/111/",
      canonicalUrl: "https://www.pinterest.com/pin/222/",
      pinId: "333",
    });

    expect(parsed.sourceUrl).toBe("https://www.pinterest.com/pin/333/");
    expect(parsed.postId).toBe("333");
  });
});
