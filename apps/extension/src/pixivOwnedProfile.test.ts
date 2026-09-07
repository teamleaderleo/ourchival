import { describe, expect, it } from "vitest";
import {
  detectPixivOwnedProfile,
  pixivOwnedArtwork,
  pixivOwnedProfileWorkIds,
} from "./pixivOwnedProfile";
import {
  detectSourceIntakeContext,
  sourceIntakePayload,
} from "./sourceIntake";

describe("detectPixivOwnedProfile", () => {
  it("normalizes supported creator profile URLs", () => {
    expect(
      detectPixivOwnedProfile("https://www.pixiv.net/en/users/17656036"),
    ).toEqual({
      userId: "17656036",
      sourceUrl: "https://www.pixiv.net/en/users/17656036/artworks",
      label: "Pixiv creator works",
    });
    expect(
      detectPixivOwnedProfile("https://www.pixiv.net/users/17656036/artworks/"),
    ).toMatchObject({ userId: "17656036" });
  });

  it("does not treat bookmarks or individual artworks as owned profiles", () => {
    expect(
      detectPixivOwnedProfile(
        "https://www.pixiv.net/en/users/17656036/bookmarks/artworks",
      ),
    ).toBeUndefined();
    expect(
      detectPixivOwnedProfile("https://www.pixiv.net/en/artworks/123456"),
    ).toBeUndefined();
  });
});

describe("Pixiv owned-profile source intake", () => {
  it("normalizes a creator profile separately from bookmark intake", () => {
    expect(
      detectSourceIntakeContext("https://www.pixiv.net/en/users/17656036"),
    ).toEqual({
      provider: "pixiv_owned_profile",
      scope: "profile",
      sourceUrl: "https://www.pixiv.net/en/users/17656036/artworks",
      currentUrl: "https://www.pixiv.net/en/users/17656036/artworks",
      cursor: "works:0",
      sensitiveDefault: false,
      label: "Pixiv creator works",
    });
    expect(
      detectSourceIntakeContext(
        "https://www.pixiv.net/en/users/17656036/bookmarks/artworks",
      )?.provider,
    ).toBe("pixiv_bookmarks");
  });

  it("labels captured profile work distinctly from bookmarks", () => {
    const payload = sourceIntakePayload(
      {
        providerId: "500",
        sourceUrl: "https://www.pixiv.net/en/artworks/500",
        title: "Costume study",
      },
      {
        provider: "pixiv_owned_profile",
        importId: "source-import:owned-pixiv",
        ordinal: 0,
        sensitiveDefault: false,
      },
    );
    expect(payload.tags).toEqual(["Pixiv creator works"]);
    expect(JSON.parse(payload.rawMetadata ?? "{}")).toMatchObject({
      provider: "pixiv_owned_profile",
      providerId: "500",
    });
  });
});

describe("pixivOwnedProfileWorkIds", () => {
  it("combines illustration and manga IDs newest-first with a bounded limit", () => {
    expect(
      pixivOwnedProfileWorkIds(
        {
          error: false,
          body: {
            illusts: { "100": null, "300": null },
            manga: { "250": null, "300": null, "400": null },
          },
        },
        3,
      ),
    ).toEqual(["400", "300", "250"]);
  });

  it("fails closed on malformed IDs and unreasonable limits", () => {
    expect(() =>
      pixivOwnedProfileWorkIds({
        error: false,
        body: { illusts: { nope: null } },
      }),
    ).toThrow("invalid artwork ID");
    expect(() =>
      pixivOwnedProfileWorkIds({ error: false, body: {} }, 0),
    ).toThrow("between 1 and 2000");
  });
});

describe("pixivOwnedArtwork", () => {
  const context = {
    userId: "17656036",
    sourceUrl: "https://www.pixiv.net/en/users/17656036/artworks",
    label: "Pixiv creator works",
  };

  it("verifies publisher identity and preserves ordered original pages", async () => {
    const requests: string[] = [];
    const item = await pixivOwnedArtwork("500", context, 7, async (path) => {
      requests.push(path);
      if (path.endsWith("/pages")) {
        return {
          error: false,
          body: [
            {
              width: 2048,
              height: 3072,
              urls: {
                original:
                  "https://i.pximg.net/img-original/img/2026/09/07/00/00/00/500_p0.png",
              },
            },
            {
              width: 2048,
              height: 3072,
              urls: {
                original:
                  "https://i.pximg.net/img-original/img/2026/09/07/00/00/00/500_p1.png",
              },
            },
          ],
        };
      }
      return {
        error: false,
        body: {
          id: "500",
          userId: "17656036",
          userName: "TeamLeaderLeo",
          title: "Costume study",
          description: "A finished illustration",
          createDate: "2026-09-07T12:00:00+00:00",
          uploadDate: "2026-09-07T12:30:00+00:00",
          xRestrict: 0,
          restrict: 0,
          illustType: 0,
          pageCount: 2,
          width: 2048,
          height: 3072,
          tags: { tags: [{ tag: "Genshin" }, { tag: "Navia" }] },
        },
      };
    });

    expect(requests).toEqual(["/ajax/illust/500", "/ajax/illust/500/pages"]);
    expect(item).toMatchObject({
      providerId: "500",
      sourceUrl: "https://www.pixiv.net/en/artworks/500",
      title: "Costume study",
      authorName: "TeamLeaderLeo",
      authorUrl: "https://www.pixiv.net/en/users/17656036",
      publishedAt: "2026-09-07T12:00:00+00:00",
      pageCount: 2,
      sensitive: "general",
      tags: ["Genshin", "Navia"],
    });
    expect(item.assetUrls).toEqual([
      "https://i.pximg.net/img-original/img/2026/09/07/00/00/00/500_p0.png",
      "https://i.pximg.net/img-original/img/2026/09/07/00/00/00/500_p1.png",
    ]);
    expect(item.metadata).toMatchObject({
      availability: "available",
      provenance: {
        platform: "pixiv",
        containerType: "owned_profile",
        containerKey: "17656036",
      },
    });
  });

  it("refuses to classify a work from another Pixiv user as owned", async () => {
    const item = await pixivOwnedArtwork("501", context, 0, async () => ({
      error: false,
      body: {
        id: "501",
        userId: "999",
        userName: "Someone else",
        pageCount: 1,
        xRestrict: 0,
      },
    }));
    expect(item.assetUrls).toBeUndefined();
    expect(item.metadata).toMatchObject({ availability: "unresolved" });
    expect(item.gap).toContain("publisher does not match");
  });
});
