import { describe, expect, it } from "vitest";
import {
  buildXOwnedProfilePayloads,
  classifyXOwnedProfileSnapshot,
  type XOwnedProfileSnapshot,
} from "./xOwnedProfile";

const owner = "TeamLeaderLeo";

function snapshot(args: {
  links: string[];
  images?: Array<{ src: string; alt?: string; href?: string }>;
  text?: string;
}): XOwnedProfileSnapshot {
  return {
    pageUrl: "https://x.com/TeamLeaderLeo",
    pageTitle: "TeamLeaderLeo / X",
    articleText: args.text ?? "art post",
    userNameText: "Leo\n@TeamLeaderLeo",
    timestamp: "2026-09-07T12:00:00.000Z",
    links: args.links.map((href) => ({ href })),
    images: args.images ?? [],
  };
}

const media = (id: string) => `https://pbs.twimg.com/media/${id}?format=jpg&name=small`;

describe("classifyXOwnedProfileSnapshot", () => {
  it("accepts direct authored media only when its media link points to the outer status", () => {
    const result = classifyXOwnedProfileSnapshot(
      snapshot({
        links: ["https://x.com/TeamLeaderLeo/status/100"],
        images: [
          {
            src: media("mine"),
            alt: "finished illustration",
            href: "https://x.com/TeamLeaderLeo/status/100/photo/1",
          },
        ],
      }),
      owner,
    );
    expect(result.disposition).toBe("authored_media");
    expect(result.outerStatus).toMatchObject({
      handle: "TeamLeaderLeo",
      postId: "100",
    });
    expect(result.ownedMedia).toHaveLength(1);
    expect(result.ownedMedia[0]?.url).toContain("name=orig");
  });

  it("excludes a plain repost whose canonical status belongs to another author", () => {
    const result = classifyXOwnedProfileSnapshot(
      snapshot({
        links: ["https://x.com/OtherArtist/status/200"],
        images: [
          {
            src: media("other"),
            href: "https://x.com/OtherArtist/status/200/photo/1",
          },
        ],
      }),
      owner,
    );
    expect(result.disposition).toBe("not_authored");
    expect(result.ownedMedia).toEqual([]);
  });

  it("keeps an authored reply with its own attached media", () => {
    const result = classifyXOwnedProfileSnapshot(
      snapshot({
        links: [
          "https://x.com/Someone/status/299",
          "https://x.com/TeamLeaderLeo/status/300",
        ],
        images: [
          {
            src: media("reply"),
            href: "https://x.com/TeamLeaderLeo/status/300/photo/1",
          },
        ],
      }),
      owner,
    );
    expect(result.disposition).toBe("authored_media");
    expect(result.outerStatus?.postId).toBe("300");
  });

  it("keeps outer quote-post media while excluding quoted-author media", () => {
    const result = classifyXOwnedProfileSnapshot(
      snapshot({
        links: [
          "https://x.com/TeamLeaderLeo/status/400",
          "https://x.com/OtherArtist/status/399",
        ],
        images: [
          {
            src: media("mine-quote"),
            href: "https://x.com/TeamLeaderLeo/status/400/photo/1",
          },
          {
            src: media("quoted"),
            href: "https://x.com/OtherArtist/status/399/photo/1",
          },
        ],
      }),
      owner,
    );
    expect(result.disposition).toBe("authored_media");
    expect(result.ownedMedia).toHaveLength(1);
    expect(result.foreignMedia).toHaveLength(1);
    expect(result.ownedMedia[0]?.url).toContain("mine-quote");
  });

  it("does not turn a quote containing only another author's image into owned art", () => {
    const result = classifyXOwnedProfileSnapshot(
      snapshot({
        links: [
          "https://x.com/TeamLeaderLeo/status/500",
          "https://x.com/OtherArtist/status/499",
        ],
        images: [
          {
            src: media("quoted-only"),
            href: "https://x.com/OtherArtist/status/499/photo/1",
          },
        ],
      }),
      owner,
    );
    expect(result.disposition).toBe("quoted_media_only");
    expect(result.ownedMedia).toEqual([]);
    expect(result.foreignMedia).toHaveLength(1);
  });

  it("preserves ordered multi-image authored posts", () => {
    const result = classifyXOwnedProfileSnapshot(
      snapshot({
        links: ["https://x.com/TeamLeaderLeo/status/600"],
        images: [
          {
            src: media("one"),
            href: "https://x.com/TeamLeaderLeo/status/600/photo/1",
          },
          {
            src: media("two"),
            href: "https://x.com/TeamLeaderLeo/status/600/photo/2",
          },
        ],
      }),
      owner,
    );
    expect(result.ownedMedia.map((value) => value.mediaIndex)).toEqual([0, 1]);
    expect(result.ownedMedia.map((value) => value.url)).toEqual([
      expect.stringContaining("one"),
      expect.stringContaining("two"),
    ]);
  });

  it("fails closed when publication media has no status-link ownership evidence", () => {
    const result = classifyXOwnedProfileSnapshot(
      snapshot({
        links: ["https://x.com/TeamLeaderLeo/status/700"],
        images: [{ src: media("ambiguous") }],
      }),
      owner,
    );
    expect(result.disposition).toBe("ambiguous_media");
    expect(result.ownedMedia).toEqual([]);
    expect(result.ambiguousMedia).toHaveLength(1);
  });

  it("classifies an authored text-only status without manufacturing artwork media", () => {
    const result = classifyXOwnedProfileSnapshot(
      snapshot({ links: ["https://x.com/TeamLeaderLeo/status/800"], images: [] }),
      owner,
    );
    expect(result.disposition).toBe("text_only");
  });
});

describe("buildXOwnedProfilePayloads", () => {
  it("emits only proven outer-status media with publication provenance", () => {
    const result = buildXOwnedProfilePayloads(
      snapshot({
        links: [
          "https://x.com/TeamLeaderLeo/status/900",
          "https://x.com/OtherArtist/status/899",
        ],
        images: [
          {
            src: media("owned"),
            alt: "alt text",
            href: "https://x.com/TeamLeaderLeo/status/900/photo/1",
          },
          {
            src: media("foreign"),
            href: "https://x.com/OtherArtist/status/899/photo/1",
          },
        ],
      }),
      owner,
      "2026-09-07T13:00:00.000Z",
    );
    expect(result.payloads).toHaveLength(1);
    expect(result.payloads[0]).toMatchObject({
      kind: "image",
      sourceUrl: "https://x.com/TeamLeaderLeo/status/900",
      postId: "900",
      assetIndex: 0,
      assetCount: 1,
      altText: "alt text",
      tags: ["X authored media"],
    });
    expect(JSON.parse(result.payloads[0]!.rawMetadata ?? "{}")).toMatchObject({
      sourceKind: "x_owned_profile",
      feedContext: "profile",
      excludedForeignMedia: 1,
      ambiguousMedia: 0,
    });
  });

  it("emits nothing for plain reposts or ambiguous-only media", () => {
    expect(
      buildXOwnedProfilePayloads(
        snapshot({ links: ["https://x.com/Other/status/1"] }),
        owner,
      ).payloads,
    ).toEqual([]);
    expect(
      buildXOwnedProfilePayloads(
        snapshot({
          links: ["https://x.com/TeamLeaderLeo/status/2"],
          images: [{ src: media("ambiguous") }],
        }),
        owner,
      ).payloads,
    ).toEqual([]);
  });
});
