import { describe, expect, it } from "vitest";
import { pixivArtwork, pinterestOriginalFromState } from "./artworkIntake";
import {
  detectSourceIntakeContext,
  sourceIntakePayloads,
} from "./sourceIntake";
import { referenceOriginFromRawMetadata } from "../../../convex/lib/referenceOrigin";

const context = detectSourceIntakeContext(
  "https://www.pixiv.net/en/users/123/bookmarks/artworks?rest=hide",
)!;
const detail = {
  id: "42",
  title: "原題 — étude",
  userId: "9",
  userName: "作者",
  pageCount: 2,
  createDate: "2020-01-02T03:04:05+09:00",
  xRestrict: 1,
  illustType: 0,
  tags: { tags: [{ tag: "原語" }, { tag: "R-18" }] },
  description: "Original wording",
};
const pages = [0, 1].map((i) => ({
  width: 2000,
  height: 3000,
  urls: {
    original: `https://i.pximg.net/img-original/img/2020/01/02/03/04/05/42_p${i}.png`,
  },
}));

describe("Pixiv artwork manifests", () => {
  it("keeps one reference identity with every full-resolution page and private origin", async () => {
    const paths: string[] = [];
    const item = await pixivArtwork(
      { id: "42", bookmarkData: { id: "77" } },
      context,
      44,
      2,
      async (path) => {
        paths.push(path);
        return { error: false, body: path.endsWith("/pages") ? pages : detail };
      },
    );
    const payloads = sourceIntakePayloads(item, {
      provider: "pixiv_bookmarks",
      importId: "test",
      ordinal: 0,
      sensitiveDefault: true,
    });
    expect(paths).toEqual(["/ajax/illust/42", "/ajax/illust/42/pages"]);
    expect(payloads).toHaveLength(2);
    expect(new Set(payloads.map((p) => p.sourceUrl)).size).toBe(1);
    expect(payloads.map((p) => [p.assetIndex, p.assetCount])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(payloads[0]).toMatchObject({
      pageTitle: detail.title,
      authorName: "作者",
      authorUrl: "https://www.pixiv.net/en/users/9",
      publishedAt: detail.createDate,
    });
    const raw = JSON.parse(payloads[0]!.rawMetadata!);
    expect(raw).toMatchObject({
      sealed: true,
      ordinal: 44,
      pageCount: 2,
      source: { page: 2, tags: detail.tags },
    });
    expect(referenceOriginFromRawMetadata(raw)).toMatchObject({
      platform: "pixiv",
      containerKey: "123:private",
      providerItemId: "42",
      ordinal: 44,
    });
    expect(payloads[0]!.previewImageUrl).toBeUndefined();
  });

  it.each(["deleted", "partial", "preview", "duplicate", "ugoira"])(
    "retains %s as an explicit unresolved artwork",
    async (failure) => {
      const item = await pixivArtwork(
        { id: "42", title: "Saved title" },
        context,
        8,
        1,
        async (path) => {
          if (failure === "deleted")
            return { error: true, message: "Unavailable" };
          if (!path.endsWith("/pages"))
            return {
              body: {
                ...detail,
                ...(failure === "ugoira" ? { illustType: 2 } : {}),
              },
            };
          return {
            body:
              failure === "partial"
                ? pages.slice(0, 1)
                : failure === "duplicate"
                  ? [pages[0], pages[0]]
                  : failure === "preview"
                    ? pages.map((p) => ({
                        ...p,
                        urls: {
                          original: p.urls.original.replace(
                            "img-original",
                            "img-master",
                          ),
                        },
                      }))
                    : pages,
          };
        },
      );
      expect(item.gap).toBeTruthy();
      expect(item.assetUrls).toBeUndefined();
      expect(item.metadata?.availability).toBe("unresolved");
      expect(
        sourceIntakePayloads(item, {
          provider: "pixiv_bookmarks",
          importId: "test",
          ordinal: 8,
          sensitiveDefault: true,
        })[0]?.sourceUrl,
      ).toContain("/artworks/42");
    },
  );
});

describe("Pinterest authoritative rendition", () => {
  it("uses the requested pin's PNG original, ignoring JPEG guesses and recommendations", () => {
    const state = {
      pins: {
        42: {
          id: "42",
          images: { orig: { url: "https://i.pinimg.com/originals/a/b/c.png" } },
        },
        99: {
          id: "99",
          images: { orig: { url: "https://i.pinimg.com/originals/other.jpg" } },
        },
      },
    };
    expect(pinterestOriginalFromState(state, "42")).toBe(
      "https://i.pinimg.com/originals/a/b/c.png",
    );
    expect(pinterestOriginalFromState(state, "missing")).toBeUndefined();
  });
});
