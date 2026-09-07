import { describe, expect, it } from "vitest";
import {
  detectHoYoLabArticle,
  hoyolabFullPostEndpoint,
  hoyolabOwnedPost,
} from "./hoyolabOwnedPost";

describe("detectHoYoLabArticle", () => {
  it("normalizes public article URLs", () => {
    expect(
      detectHoYoLabArticle("https://www.hoyolab.com/article/25790234?lang=en-us"),
    ).toEqual({
      postId: "25790234",
      sourceUrl: "https://www.hoyolab.com/article/25790234",
    });
  });

  it("ignores non-article and foreign URLs", () => {
    expect(
      detectHoYoLabArticle("https://www.hoyolab.com/accountCenter/postList?id=123"),
    ).toBeUndefined();
    expect(
      detectHoYoLabArticle("https://example.com/article/25790234"),
    ).toBeUndefined();
  });
});

describe("hoyolabOwnedPost", () => {
  const identity = {
    postId: "25790234",
    sourceUrl: "https://www.hoyolab.com/article/25790234",
  };

  it("verifies publisher identity and keeps ordered post images", () => {
    const item = hoyolabOwnedPost(
      {
        retcode: 0,
        message: "OK",
        data: {
          post: {
            post: {
              post_id: "25790234",
              uid: "123456789",
              subject: "Wyrmtrail Silhouette",
              content: "Skin concept",
              created_at: 1720000000,
              view_type: 2,
              is_original: 1,
              is_deleted: 0,
            },
            user: { uid: "123456789", nickname: "TeamLeaderLeo" },
            forum: { id: 1, name: "Genshin Impact" },
            topics: [{ id: 5, name: "Fan Art" }],
            stat: { view_num: 1200, like_num: 85 },
            image_list: [
              {
                url: "https://upload-os-bbs.hoyolab.com/upload/2026/09/07/a.png",
                width: 1800,
                height: 2400,
                image_id: "a",
              },
              {
                url: "https://upload-os-bbs.hoyolab.com/upload/2026/09/07/b.png",
                width: 1800,
                height: 2400,
                image_id: "b",
              },
            ],
          },
        },
      },
      identity,
      "123456789",
    );

    expect(item).toMatchObject({
      providerId: "25790234",
      sourceUrl: "https://www.hoyolab.com/article/25790234",
      title: "Wyrmtrail Silhouette",
      authorName: "TeamLeaderLeo",
      tags: ["Fan Art"],
      assetUrls: [
        "https://upload-os-bbs.hoyolab.com/upload/2026/09/07/a.png",
        "https://upload-os-bbs.hoyolab.com/upload/2026/09/07/b.png",
      ],
    });
    expect(item.metadata).toMatchObject({
      availability: "available",
      provenance: {
        platform: "hoyolab",
        containerType: "owned_profile_post",
        containerKey: "123456789",
      },
    });
  });

  it("refuses another publisher and untrusted image hosts", () => {
    expect(() =>
      hoyolabOwnedPost(
        {
          retcode: 0,
          data: {
            post: {
              post: {
                post_id: "25790234",
                uid: "999",
                is_deleted: 0,
              },
              user: { uid: "999", nickname: "Other" },
            },
          },
        },
        identity,
        "123456789",
      ),
    ).toThrow("publisher does not match");

    expect(() =>
      hoyolabOwnedPost(
        {
          retcode: 0,
          data: {
            post: {
              post: {
                post_id: "25790234",
                uid: "123456789",
                is_deleted: 0,
              },
              user: { uid: "123456789", nickname: "TeamLeaderLeo" },
              image_list: [{ url: "https://evil.example/image.png" }],
            },
          },
        },
        identity,
        "123456789",
      ),
    ).toThrow("image host is not trusted");
  });
});

describe("hoyolabFullPostEndpoint", () => {
  it("builds the observed public full-post endpoint", () => {
    expect(hoyolabFullPostEndpoint("25790234")).toBe(
      "https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=25790234",
    );
  });
});
