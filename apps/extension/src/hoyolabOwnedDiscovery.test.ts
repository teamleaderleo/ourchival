import { describe, expect, it } from "vitest";
import {
  discoverHoYoLabArticleIdentities,
  hoyolabDiscoveryReceipt,
  mergeHoYoLabDiscoveryQueue,
} from "./hoyolabOwnedDiscovery";

describe("discoverHoYoLabArticleIdentities", () => {
  it("keeps only unique HoYoLAB article links in DOM order", () => {
    expect(
      discoverHoYoLabArticleIdentities([
        "https://www.hoyolab.com/article/25652294",
        "https://www.hoyolab.com/article/32486327?lang=en-us",
        "https://www.hoyolab.com/article/25652294?floor=2",
        "https://www.hoyolab.com/circles",
        "https://example.com/article/1",
      ]),
    ).toEqual([
      {
        postId: "25652294",
        sourceUrl: "https://www.hoyolab.com/article/25652294",
      },
      {
        postId: "32486327",
        sourceUrl: "https://www.hoyolab.com/article/32486327",
      },
    ]);
  });

  it("is explicitly bounded", () => {
    const links = Array.from(
      { length: 20 },
      (_, index) => `https://www.hoyolab.com/article/${1000 + index}`,
    );
    expect(discoverHoYoLabArticleIdentities(links, 3)).toHaveLength(3);
    expect(() => discoverHoYoLabArticleIdentities(links, 0)).toThrow(
      "between 1 and 500",
    );
  });
});

describe("mergeHoYoLabDiscoveryQueue", () => {
  it("preserves pending work, removes already-seen/current posts, and adds new DOM discoveries", () => {
    expect(
      mergeHoYoLabDiscoveryQueue({
        currentPostId: "100",
        seenPostIds: ["101"],
        pendingPostIds: ["102", "103"],
        discovered: [
          { postId: "100", sourceUrl: "https://www.hoyolab.com/article/100" },
          { postId: "103", sourceUrl: "https://www.hoyolab.com/article/103" },
          { postId: "104", sourceUrl: "https://www.hoyolab.com/article/104" },
        ],
      }),
    ).toEqual(["102", "103", "104"]);
  });
});

describe("hoyolabDiscoveryReceipt", () => {
  it("records the DOM-discovery strategy separately from UID acceptance", () => {
    expect(
      hoyolabDiscoveryReceipt({
        observedLinks: 30,
        articleCandidates: 12,
        ownedAccepted: 8,
        foreignRejected: 2,
        failedMetadata: 1,
        pending: 1,
      }),
    ).toEqual({
      version: 1,
      strategy: "dom_article_links_with_uid_verified_full_post",
      observedLinks: 30,
      articleCandidates: 12,
      ownedAccepted: 8,
      foreignRejected: 2,
      failedMetadata: 1,
      pending: 1,
    });
  });
});
