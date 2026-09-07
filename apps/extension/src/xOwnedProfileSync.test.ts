import { describe, expect, it } from "vitest";
import {
  classifiedAuthoredMediaSourceUrls,
  detectXOwnedProfilePage,
  emptyXOwnedSyncState,
  processXOwnedRound,
  xOwnedKnownBoundary,
  xOwnedRecentWindow,
} from "./xOwnedProfileSync";
import type { XOwnedProfileSnapshot } from "./xOwnedProfile";

const owner = "TeamLeaderLeo";
const media = (id: string) => `https://pbs.twimg.com/media/${id}?format=png&name=small`;

function post(
  postId: number,
  options: {
    handle?: string;
    mediaOwner?: string;
    includeMedia?: boolean;
    ambiguous?: boolean;
  } = {},
): XOwnedProfileSnapshot {
  const handle = options.handle ?? owner;
  const mediaOwner = options.mediaOwner ?? handle;
  const includeMedia = options.includeMedia ?? true;
  return {
    pageUrl: `https://x.com/${owner}/media`,
    userNameText: `${handle}\n@${handle}`,
    articleText: `post ${postId}`,
    timestamp: "2026-09-07T12:00:00.000Z",
    links: [{ href: `https://x.com/${handle}/status/${postId}` }],
    images: includeMedia
      ? [
          {
            src: media(String(postId)),
            ...(!options.ambiguous
              ? {
                  href: `https://x.com/${mediaOwner}/status/${postId}/photo/1`,
                }
              : {}),
          },
        ]
      : [],
  };
}

describe("detectXOwnedProfilePage", () => {
  it("recognizes only the configured X profile and media routes", () => {
    expect(detectXOwnedProfilePage("https://x.com/TeamLeaderLeo")).toMatchObject({
      handle: owner,
      route: "profile",
      mediaUrl: "https://x.com/TeamLeaderLeo/media",
    });
    expect(
      detectXOwnedProfilePage("https://twitter.com/teamleaderleo/media"),
    ).toMatchObject({ route: "media" });
    expect(
      detectXOwnedProfilePage("https://x.com/TeamLeaderLeo/status/123"),
    ).toBeUndefined();
    expect(detectXOwnedProfilePage("https://x.com/OtherArtist/media")).toBeUndefined();
  });
});

describe("processXOwnedRound", () => {
  it("emits unseen authored media and skips reposts/text/foreign-only/ambiguous posts", () => {
    const authored = post(100);
    const repost = post(101, { handle: "OtherArtist" });
    const text = post(102, { includeMedia: false });
    const quoteOnly = post(103, { mediaOwner: "OtherArtist" });
    quoteOnly.links.push({ href: "https://x.com/OtherArtist/status/103" });
    const ambiguous = post(104, { ambiguous: true });
    const state = emptyXOwnedSyncState();
    const result = processXOwnedRound({
      snapshots: [authored, repost, text, quoteOnly, ambiguous],
      knownSourceUrls: new Set(),
      state,
      capturedAt: "2026-09-07T13:00:00.000Z",
    });

    expect(result.payloads).toHaveLength(1);
    expect(result.payloads[0]?.sourceUrl).toBe(
      "https://x.com/TeamLeaderLeo/status/100",
    );
    expect(result.state).toMatchObject({
      authoredMediaObserved: 1,
      newPosts: 1,
      existingPosts: 0,
      repostsSkipped: 1,
      textOnlySkipped: 1,
      quotedMediaOnlySkipped: 1,
      ambiguousPosts: 1,
    });
  });

  it("stops after a conservative consecutive-known authored-media boundary", () => {
    const snapshots = Array.from({ length: xOwnedKnownBoundary + 3 }, (_, index) =>
      post(200 + index),
    );
    const known = new Set(
      snapshots.map((_, index) => `https://x.com/TeamLeaderLeo/status/${200 + index}`),
    );
    const result = processXOwnedRound({
      snapshots,
      knownSourceUrls: known,
      state: emptyXOwnedSyncState(),
    });
    expect(result.knownBoundaryReached).toBe(true);
    expect(result.state.existingPosts).toBe(xOwnedKnownBoundary);
    expect(result.payloads).toEqual([]);
  });

  it("does not let text/reposts manufacture a known boundary", () => {
    const snapshots: XOwnedProfileSnapshot[] = [];
    for (let index = 0; index < xOwnedKnownBoundary * 2; index += 1) {
      snapshots.push(
        index % 2 === 0
          ? post(300 + index, { includeMedia: false })
          : post(300 + index, { handle: "OtherArtist" }),
      );
    }
    const result = processXOwnedRound({
      snapshots,
      knownSourceUrls: new Set(),
      state: emptyXOwnedSyncState(),
    });
    expect(result.knownBoundaryReached).toBe(false);
    expect(result.state.consecutiveKnown).toBe(0);
  });

  it("enforces the bounded recent authored-media window", () => {
    const state = emptyXOwnedSyncState();
    state.authoredMediaObserved = xOwnedRecentWindow - 1;
    const result = processXOwnedRound({
      snapshots: [post(500), post(501)],
      knownSourceUrls: new Set(),
      state,
    });
    expect(result.recentWindowReached).toBe(true);
    expect(result.state.authoredMediaObserved).toBe(xOwnedRecentWindow);
    expect(result.payloads).toHaveLength(1);
  });

  it("is idempotent across repeated virtualized DOM snapshots in one run", () => {
    const state = emptyXOwnedSyncState();
    const first = processXOwnedRound({
      snapshots: [post(600)],
      knownSourceUrls: new Set(),
      state,
    });
    const second = processXOwnedRound({
      snapshots: [post(600)],
      knownSourceUrls: new Set(),
      state: first.state,
    });
    expect(first.payloads).toHaveLength(1);
    expect(second.payloads).toEqual([]);
    expect(second.state.newPosts).toBe(1);
  });
});

describe("classifiedAuthoredMediaSourceUrls", () => {
  it("returns only statuses with proven owned media", () => {
    expect(
      classifiedAuthoredMediaSourceUrls([
        post(700),
        post(701, { handle: "OtherArtist" }),
        post(702, { ambiguous: true }),
      ]),
    ).toEqual(["https://x.com/TeamLeaderLeo/status/700"]);
  });
});
