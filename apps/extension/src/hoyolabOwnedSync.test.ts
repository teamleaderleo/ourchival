import { describe, expect, it } from "vitest";
import {
  hoyolabOwnedPost,
  hoyolabPostPublisherIdentity,
} from "./hoyolabOwnedPost";
import {
  buildHoYoLabOwnedPayloads,
  unknownHoYoLabCandidates,
} from "./hoyolabOwnedSync";

const identity = {
  postId: "25790234",
  sourceUrl: "https://www.hoyolab.com/article/25790234",
};

function response(uid = "123456789") {
  return {
    retcode: 0,
    data: {
      post: {
        post: {
          post_id: identity.postId,
          uid,
          subject: "Wyrmtrail Silhouette",
          content: "Skin concept",
          created_at: 1720000000,
          is_deleted: 0,
        },
        user: { uid, nickname: "Teamleaderleo" },
        topics: [{ name: "Fan Art" }],
        image_list: [
          {
            url: "https://upload-os-bbs.hoyolab.com/upload/a.png",
            width: 1600,
            height: 2200,
          },
          {
            url: "https://upload-os-bbs.hoyolab.com/upload/b.png",
            width: 1600,
            height: 2200,
          },
        ],
      },
    },
  };
}

describe("HoYoLAB seed publisher identity", () => {
  it("derives a stable UID/nickname from the seed post before related-post checks", () => {
    expect(hoyolabPostPublisherIdentity(response(), identity)).toEqual({
      uid: "123456789",
      nickname: "Teamleaderleo",
    });
  });

  it("rejects conflicting post/user UIDs", () => {
    const value = response();
    value.data.post.user.uid = "999";
    expect(() => hoyolabPostPublisherIdentity(value, identity)).toThrow(
      "conflicting UIDs",
    );
  });
});

describe("buildHoYoLabOwnedPayloads", () => {
  it("keeps ordered article media as publication copies with post provenance", () => {
    const item = hoyolabOwnedPost(response(), identity, "123456789");
    const payloads = buildHoYoLabOwnedPayloads(
      item,
      "2026-09-07T13:00:00.000Z",
    );
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      kind: "image",
      sourceUrl: identity.sourceUrl,
      postId: identity.postId,
      assetIndex: 0,
      assetCount: 2,
      pageTitle: "Wyrmtrail Silhouette",
      authorName: "Teamleaderleo",
      postText: "Skin concept",
      tags: ["HoYoLAB creator works", "Fan Art"],
    });
    expect(payloads[0]).not.toHaveProperty("promoteOriginal");
    expect(JSON.parse(payloads[0]!.rawMetadata ?? "{}")).toMatchObject({
      sourceKind: "hoyolab_owned_profile",
      feedContext: "related_creator_articles",
      mediaIndex: 0,
      mediaCount: 2,
    });
  });

  it("does not manufacture media for text-only posts", () => {
    const item = hoyolabOwnedPost(
      {
        retcode: 0,
        data: {
          post: {
            post: {
              post_id: identity.postId,
              uid: "123456789",
              subject: "Text",
              content: "No image",
              is_deleted: 0,
            },
            user: { uid: "123456789", nickname: "Teamleaderleo" },
          },
        },
      },
      identity,
      "123456789",
    );
    expect(buildHoYoLabOwnedPayloads(item)).toEqual([]);
  });
});

describe("unknownHoYoLabCandidates", () => {
  it("drops already archived article URLs before metadata work", () => {
    const candidates = [
      { postId: "1", sourceUrl: "https://www.hoyolab.com/article/1" },
      { postId: "2", sourceUrl: "https://www.hoyolab.com/article/2" },
    ];
    expect(
      unknownHoYoLabCandidates(
        candidates,
        new Set(["https://www.hoyolab.com/article/1"]),
      ),
    ).toEqual([candidates[1]]);
  });
});
