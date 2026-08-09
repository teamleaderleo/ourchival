import type { ParsedXSource } from "@ourchival/parsers";
import { describe, expect, it } from "vitest";
import { buildXInlinePayloads, inlineXSourceKey } from "./inlineCapture";

function source(overrides: Partial<ParsedXSource> = {}) {
  return {
    platform: "x",
    sourceUrl: "https://x.com/artist/status/123",
    title: "Artist post",
    authorName: "Artist",
    authorHandle: "artist",
    authorUrl: "https://x.com/artist",
    postId: "123",
    postText: "reference post",
    publishedAt: "2026-08-09T00:00:00.000Z",
    mediaUrls: [
      "https://pbs.twimg.com/media/one.jpg",
      "https://pbs.twimg.com/media/two.jpg",
    ],
    altTexts: {
      "https://pbs.twimg.com/media/one.jpg": "first image",
    },
    ...overrides,
  } as ParsedXSource;
}

describe("inlineXSourceKey", () => {
  it("prefers the stable post ID", () => {
    expect(inlineXSourceKey(source())).toBe("x:123");
  });

  it("falls back to the canonical source URL", () => {
    expect(inlineXSourceKey(source({ postId: undefined }))).toBe(
      "x:https://x.com/artist/status/123",
    );
  });
});

describe("buildXInlinePayloads", () => {
  it("preserves source order and provenance for multi-image posts", () => {
    const payloads = buildXInlinePayloads(
      source(),
      '{"adapter":"x.dom"}',
      "Fallback page title",
      "2026-08-09T01:02:03.000Z",
    );

    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      kind: "image",
      assetUrl: "https://pbs.twimg.com/media/one.jpg",
      altText: "first image",
      sourceUrl: "https://x.com/artist/status/123",
      pageTitle: "Artist post",
      authorName: "Artist",
      authorHandle: "artist",
      authorUrl: "https://x.com/artist",
      postId: "123",
      postText: "reference post",
      publishedAt: "2026-08-09T00:00:00.000Z",
      rawMetadata: '{"adapter":"x.dom"}',
      capturedAt: "2026-08-09T01:02:03.000Z",
    });
    expect(payloads[1]).toMatchObject({
      kind: "image",
      assetUrl: "https://pbs.twimg.com/media/two.jpg",
      sourceUrl: "https://x.com/artist/status/123",
    });
    expect(payloads[1]).not.toHaveProperty("altText");
  });

  it("captures source-only posts when no visual media is present", () => {
    expect(
      buildXInlinePayloads(
        source({ mediaUrls: [], altTexts: {} }),
        "{}",
        "Fallback page title",
        "2026-08-09T01:02:03.000Z",
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "post",
        sourceUrl: "https://x.com/artist/status/123",
        pageTitle: "Artist post",
      }),
    ]);
  });
});
