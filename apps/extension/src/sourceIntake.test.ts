import { describe, expect, it } from "vitest";
import {
  detectSourceIntakeContext,
  reconcilePinterestQueue,
  selectSourceIntakeState,
  sourceIntakePayload,
} from "./sourceIntake";

describe("detectSourceIntakeContext", () => {
  it("keeps Pixiv pagination separate from stable filter identity", () => {
    expect(
      detectSourceIntakeContext(
        "https://www.pixiv.net/en/users/17656036/bookmarks/artworks?p=2&rest=show&mode=all",
      ),
    ).toMatchObject({
      provider: "pixiv_bookmarks",
      scope: "bookmarks",
      sourceUrl:
        "https://www.pixiv.net/en/users/17656036/bookmarks/artworks?rest=show&mode=all",
      currentUrl:
        "https://www.pixiv.net/en/users/17656036/bookmarks/artworks?rest=show&mode=all&p=2",
      cursor: "page:2",
      sensitiveDefault: false,
    });
  });

  it("seals private Pixiv bookmarks by default", () => {
    expect(
      detectSourceIntakeContext(
        "https://www.pixiv.net/en/users/17656036/bookmarks/artworks?rest=hide&mode=all",
      ),
    ).toMatchObject({
      provider: "pixiv_bookmarks",
      sensitiveDefault: true,
      label: "Private Pixiv bookmarks",
    });
  });

  it("recognizes Pinterest profiles and boards but not pin pages", () => {
    expect(
      detectSourceIntakeContext(
        "https://ca.pinterest.com/teamleaderleo/anime-art/",
      ),
    ).toMatchObject({
      provider: "pinterest_board",
      scope: "board",
      cursor: "scroll:0",
    });
    expect(
      detectSourceIntakeContext("https://ca.pinterest.com/teamleaderleo/"),
    ).toMatchObject({
      provider: "pinterest_board",
      scope: "profile",
      label: "Pinterest boards",
      cursor: "boards:index",
    });
    expect(
      detectSourceIntakeContext("https://ca.pinterest.com/pin/123/"),
    ).toBeUndefined();
  });
});

describe("reconcilePinterestQueue", () => {
  it("fans a profile out across boards and advances after each board", () => {
    const discovered = [
      "https://ca.pinterest.com/teamleaderleo/anime-art/",
      "https://ca.pinterest.com/teamleaderleo/lighting/",
    ];
    const first = reconcilePinterestQueue({
      discoveredUrls: discovered,
      currentUrl: "https://ca.pinterest.com/teamleaderleo/",
      exhausted: true,
    });
    expect(first).toEqual({
      pendingUrls: discovered,
      nextUrl: discovered[0],
    });

    const second = reconcilePinterestQueue({
      pendingUrls: first.pendingUrls,
      currentUrl: `${discovered[0]}?foo=bar`,
      exhausted: true,
    });
    expect(second).toEqual({
      pendingUrls: [discovered[1]],
      nextUrl: discovered[1],
    });
  });
});

describe("selectSourceIntakeState", () => {
  it("does not hide the current source behind another running import", () => {
    const pixiv = {
      provider: "pixiv_bookmarks" as const,
      sourceUrl:
        "https://www.pixiv.net/en/users/17656036/bookmarks/artworks?rest=show&mode=all",
      running: true,
      updatedAt: "2026-09-05T18:00:00.000Z",
    };
    const pinterest = detectSourceIntakeContext(
      "https://ca.pinterest.com/teamleaderleo/",
    );
    expect(selectSourceIntakeState(pinterest, [pixiv])).toBeUndefined();
  });
});

describe("sourceIntakePayload", () => {
  it("keeps a public preview visible", () => {
    const payload = sourceIntakePayload(
      {
        providerId: "123",
        sourceUrl: "https://www.pixiv.net/en/artworks/123",
        title: "Study",
        previewImageUrl: "https://i.pximg.net/example.jpg",
      },
      {
        provider: "pixiv_bookmarks",
        importId: "source-import:test",
        ordinal: 4,
        sensitiveDefault: false,
      },
    );
    expect(payload.previewImageUrl).toBe("https://i.pximg.net/example.jpg");
    expect(payload.tags).toEqual(["Pixiv bookmarks"]);
  });

  it("keeps a sealed preview out of ordinary preview fields", () => {
    const payload = sourceIntakePayload(
      {
        providerId: "123",
        sourceUrl: "https://www.pixiv.net/en/artworks/123",
        previewImageUrl: "https://i.pximg.net/private.jpg",
        sensitive: "explicit",
      },
      {
        provider: "pixiv_bookmarks",
        importId: "source-import:test",
        ordinal: 0,
        sensitiveDefault: false,
      },
    );
    expect(payload.previewImageUrl).toBeUndefined();
    expect(payload.tags).toEqual(["Pixiv bookmarks", "Sealed"]);
    expect(payload.rawMetadata).toContain("sealedPreviewImageUrl");
  });

  it("seals every private-bookmark preview even before classification", () => {
    const payload = sourceIntakePayload(
      {
        providerId: "456",
        sourceUrl: "https://www.pixiv.net/en/artworks/456",
        previewImageUrl: "https://i.pximg.net/unclassified.jpg",
        sensitive: "unknown",
      },
      {
        provider: "pixiv_bookmarks",
        importId: "source-import:private",
        ordinal: 1,
        sensitiveDefault: true,
      },
    );
    expect(payload.previewImageUrl).toBeUndefined();
    expect(payload.tags).toContain("Sealed");
  });
});
