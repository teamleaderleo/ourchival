import { describe, expect, it } from "vitest";
import type { XDomSnapshot } from "@ourchival/parsers";
import { buildXLikePayloads, isXLikesUrl } from "./xLikes";

describe("isXLikesUrl", () => {
  it("accepts profile Likes pages only", () => {
    expect(isXLikesUrl("https://x.com/teamleaderleo/likes")).toBe(true);
    expect(isXLikesUrl("https://twitter.com/teamleaderleo/likes/")).toBe(true);
    expect(isXLikesUrl("https://x.com/home")).toBe(false);
    expect(isXLikesUrl("https://example.com/teamleaderleo/likes")).toBe(false);
  });
});

describe("buildXLikePayloads", () => {
  it("builds visual-first, tagged captures and deduplicates posts", () => {
    const snapshot: XDomSnapshot = {
      pageUrl: "https://x.com/teamleaderleo/likes",
      pageTitle: "Likes / X",
      articleText: "Color and motion study",
      userNameText: "Artist Name\n@artist",
      timestamp: "2026-08-30T12:00:00.000Z",
      links: [{ href: "https://x.com/artist/status/123/photo/1" }],
      images: [
        {
          src: "https://pbs.twimg.com/media/example?format=jpg&name=small",
          alt: "Illustration",
        },
      ],
    };

    const payloads = buildXLikePayloads(
      [snapshot, snapshot],
      "2026-08-31T00:00:00.000Z",
    );
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      kind: "image",
      sourceUrl: "https://x.com/artist/status/123",
      canonicalUrl: "https://x.com/artist/status/123",
      assetUrl: "https://pbs.twimg.com/media/example?format=jpg&name=orig",
      authorName: "Artist Name",
      authorHandle: "@artist",
      postId: "123",
      postText: "Color and motion study",
      tags: ["X Likes"],
      capturedAt: "2026-08-31T00:00:00.000Z",
    });
    expect(JSON.parse(payloads[0]!.rawMetadata!)).toMatchObject({
      provenance: "ourchival-clipper:x-likes",
      sourceKind: "x_like",
    });
  });

  it("keeps liked text posts as sourced post references", () => {
    const payloads = buildXLikePayloads([
      {
        pageUrl: "https://x.com/teamleaderleo/likes",
        links: [{ href: "https://x.com/writer/status/456" }],
        images: [],
        articleText: "Useful thread",
        userNameText: "Writer\n@writer",
      },
    ]);

    expect(payloads[0]).toMatchObject({
      kind: "post",
      sourceUrl: "https://x.com/writer/status/456",
      tags: ["X Likes"],
    });
  });
});
