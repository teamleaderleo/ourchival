import { describe, expect, it } from "vitest";
import {
  pixivOwnedProfileOffsetUrl,
  profileOffset,
  scanPixivOwnedProfile,
} from "./pixivOwnedProfileReader";

const context = {
  userId: "17656036",
  sourceUrl: "https://www.pixiv.net/en/users/17656036/artworks",
  label: "Pixiv creator works",
};

function provider(ids: string[]) {
  return async (path: string) => {
    if (path.includes("/profile/all")) {
      return {
        error: false,
        body: { illusts: Object.fromEntries(ids.map((id) => [id, null])) },
      };
    }
    const id = path.match(/illust\/(\d+)/)?.[1]!;
    if (path.endsWith("/pages")) {
      return {
        error: false,
        body: [
          {
            width: 1600,
            height: 2200,
            urls: {
              original: `https://i.pximg.net/img-original/img/2026/09/07/00/00/00/${id}_p0.png`,
            },
          },
        ],
      };
    }
    return {
      error: false,
      body: {
        id,
        userId: context.userId,
        userName: "TeamLeaderLeo",
        title: `Work ${id}`,
        createDate: "2026-09-07T12:00:00+00:00",
        xRestrict: 0,
        illustType: 0,
        pageCount: 1,
        tags: { tags: [] },
      },
    };
  };
}

describe("Pixiv owned-profile checkpoints", () => {
  it("round-trips bounded internal offsets", () => {
    expect(pixivOwnedProfileOffsetUrl(context.sourceUrl, 40)).toBe(
      "https://www.pixiv.net/en/users/17656036/artworks?ourchival_offset=40",
    );
    expect(
      profileOffset(
        "https://www.pixiv.net/en/users/17656036/artworks?ourchival_offset=40",
      ),
    ).toBe(40);
    expect(profileOffset(context.sourceUrl)).toBe(0);
  });

  it("rejects malformed offsets", () => {
    expect(() =>
      profileOffset(`${context.sourceUrl}?ourchival_offset=nope`),
    ).toThrow("invalid");
    expect(() => pixivOwnedProfileOffsetUrl(context.sourceUrl, -1)).toThrow(
      "non-negative",
    );
  });
});

describe("scanPixivOwnedProfile", () => {
  it("returns a bounded newest-first chunk with a continuation checkpoint", async () => {
    const ids = Array.from({ length: 55 }, (_, index) => String(1000 + index));
    const chunk = await scanPixivOwnedProfile({
      context,
      currentUrl: context.sourceUrl,
      request: provider(ids),
      chunkSize: 10,
    });
    expect(chunk.provider).toBe("pixiv_owned_profile");
    expect(chunk.items).toHaveLength(10);
    expect(chunk.items.map((item) => item.providerId)).toEqual(
      [...ids].sort((a, b) => Number(b) - Number(a)).slice(0, 10),
    );
    expect(chunk.cursor).toBe("works:10");
    expect(chunk.reportedCount).toBe(55);
    expect(chunk.exhausted).toBe(false);
    expect(chunk.nextUrl).toContain("ourchival_offset=10");
  });

  it("continues from an offset and reaches the source end", async () => {
    const ids = ["5", "4", "3", "2", "1"];
    const chunk = await scanPixivOwnedProfile({
      context,
      currentUrl: `${context.sourceUrl}?ourchival_offset=3`,
      request: provider(ids),
      chunkSize: 10,
    });
    expect(chunk.items.map((item) => item.providerId)).toEqual(["2", "1"]);
    expect(chunk.cursor).toBe("works:5");
    expect(chunk.exhausted).toBe(true);
    expect(chunk.nextUrl).toBeUndefined();
  });

  it("stops sync at a conservative known boundary without fetching known works", async () => {
    const ids = Array.from({ length: 30 }, (_, index) => String(100 + index));
    const ordered = [...ids].sort((a, b) => Number(b) - Number(a));
    const known = new Set(ordered.slice(3, 15));
    const requested: string[] = [];
    const base = provider(ids);
    const chunk = await scanPixivOwnedProfile({
      context,
      currentUrl: context.sourceUrl,
      known,
      request: async (path) => {
        requested.push(path);
        return base(path);
      },
      chunkSize: 30,
    });
    expect(chunk.items.map((item) => item.providerId)).toEqual(ordered.slice(0, 3));
    expect(chunk.exhausted).toBe(true);
    expect(chunk.nextUrl).toBeUndefined();
    for (const id of known) {
      expect(requested.some((path) => path.includes(`/illust/${id}`))).toBe(false);
    }
  });

  it("fails replay-safely when stopped mid-chunk", async () => {
    let checks = 0;
    await expect(
      scanPixivOwnedProfile({
        context,
        currentUrl: context.sourceUrl,
        request: provider(["3", "2", "1"]),
        stopped: () => ++checks > 1,
      }),
    ).rejects.toThrow("replayed");
  });
});
