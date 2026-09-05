import { describe, expect, it } from "vitest";
import type { XDomSnapshot } from "@ourchival/parsers";
import {
  buildXLikePayloads,
  classifyAssetStorage,
  classifyXLikeCapture,
  isXLikesUrl,
} from "./xLikes";

describe("isXLikesUrl", () => {
  it("accepts profile and authenticated History Likes pages only", () => {
    expect(isXLikesUrl("https://x.com/teamleaderleo/likes")).toBe(true);
    expect(isXLikesUrl("https://twitter.com/teamleaderleo/likes/")).toBe(true);
    expect(isXLikesUrl("https://x.com/i/history/likes")).toBe(true);
    expect(isXLikesUrl("https://x.com/i/history/likes/")).toBe(true);
    expect(isXLikesUrl("https://x.com/home")).toBe(false);
    expect(isXLikesUrl("https://x.com/i/history/bookmarks")).toBe(false);
    expect(isXLikesUrl("https://example.com/teamleaderleo/likes")).toBe(false);
  });
});

describe("buildXLikePayloads", () => {
  it("builds visual-first, tagged captures and deduplicates posts", () => {
    const snapshot: XDomSnapshot = {
      pageUrl: "https://x.com/teamleaderleo/likes",
      pageTitle: "Likes / X",
      articleText: "Color and motion study",
      textLanguage: "en",
      userNameText: "Artist Name\n@artist",
      timestamp: "2026-08-30T12:00:00.000Z",
      engagementLabels: ["3 replies, 5 reposts, 8 likes, 13 views"],
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
      assetIndex: 0,
      assetCount: 1,
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
      textLanguage: "en",
      engagement: { replies: 3, reposts: 5, likes: 8, views: 13 },
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

  it("keeps every original-sized asset from a multi-image post", () => {
    const payloads = buildXLikePayloads([
      {
        pageUrl: "https://x.com/teamleaderleo/likes",
        links: [{ href: "https://x.com/artist/status/789" }],
        images: [
          { src: "https://pbs.twimg.com/media/one?format=jpg&name=small" },
          { src: "https://pbs.twimg.com/media/two?format=png&name=medium" },
        ],
      },
    ]);

    expect(payloads).toHaveLength(2);
    expect(payloads.map((payload) => payload.assetUrl)).toEqual([
      "https://pbs.twimg.com/media/one?format=jpg&name=orig",
      "https://pbs.twimg.com/media/two?format=png&name=orig",
    ]);
    expect(payloads.map((payload) => payload.assetIndex)).toEqual([0, 1]);
    expect(payloads.map((payload) => payload.assetCount)).toEqual([2, 2]);
    expect(JSON.parse(payloads[1]!.rawMetadata!)).toMatchObject({
      feedContext: "likes",
      mediaIndex: 1,
      mediaCount: 2,
    });
  });
});

describe("classifyXLikeCapture", () => {
  const payload = {
    kind: "image" as const,
    sourceUrl: "https://x.com/artist/status/123",
    assetUrl: "https://pbs.twimg.com/media/example?format=jpg&name=orig",
    capturedAt: "2026-08-31T00:00:00.000Z",
  };

  it("distinguishes an attached image from an existing post or asset", () => {
    expect(
      classifyXLikeCapture(payload, {
        alreadySaved: true,
        assetId: "asset-2",
        duplicateReason: "canonical_url",
      }),
    ).toBe("attached");
    expect(
      classifyXLikeCapture(payload, {
        alreadySaved: true,
        assetId: "asset-1",
        duplicateReason: "asset_url",
      }),
    ).toBe("duplicate");
    expect(classifyXLikeCapture(payload, { alreadySaved: false })).toBe(
      "saved",
    );
  });
});

describe("classifyAssetStorage", () => {
  it("prefers the structured storage provider", () => {
    expect(
      classifyAssetStorage({
        storageProvider: "google_drive",
        storageStatus: "an unrelated status",
      }),
    ).toBe("stored");
    expect(classifyAssetStorage({ storageProvider: "convex" })).toBe(
      "stored",
    );
    expect(classifyAssetStorage({ storageProvider: "linked" })).toBe(
      "linked",
    );
  });

  it("understands older server status strings", () => {
    expect(
      classifyAssetStorage({
        storageStatus: "stored original asset in Google Drive",
      }),
    ).toBe("stored");
    expect(
      classifyAssetStorage({
        storageStatus:
          "Google Drive env vars are missing; stored original asset in Convex Storage fallback",
      }),
    ).toBe("stored");
    expect(
      classifyAssetStorage({ storageStatus: "fetch failed: 403" }),
    ).toBe("linked");
    expect(
      classifyAssetStorage({ storageStatus: "already saved" }),
    ).toBeUndefined();
  });
});
