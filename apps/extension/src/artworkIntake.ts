import type { SourceIntakeContext, SourceIntakeItem } from "./sourceIntake";

export type JsonRequest = (path: string) => Promise<unknown>;
type ObjectValue = Record<string, any>;
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid provider response");
  return value as ObjectValue;
};

export function pixivBody(value: unknown): ObjectValue {
  const envelope = object(value);
  if (envelope.error || !envelope.body)
    throw new Error(String(envelope.message || "Pixiv metadata unavailable"));
  return object(envelope.body);
}

export function pixivOriginalUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Missing Pixiv original URL");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !/(^|\.)pximg\.net$/.test(url.hostname) ||
    !url.pathname.startsWith("/img-original/")
  )
    throw new Error("Pixiv page is not an original image");
  return url.toString();
}

export async function pixivArtwork(
  bookmark: ObjectValue,
  context: SourceIntakeContext,
  ordinal: number,
  page: number,
  request: JsonRequest,
): Promise<SourceIntakeItem> {
  const id = String(bookmark.id);
  if (!/^\d+$/.test(id))
    throw new Error("Bookmark has no recoverable artwork ID");
  const visibility = context.sensitiveDefault ? "private" : "public";
  const item: SourceIntakeItem = {
    providerId: id,
    sourceUrl: `https://www.pixiv.net/en/artworks/${id}`,
    ordinal,
    title: bookmark.title,
    authorName: bookmark.userName,
    ...(bookmark.userId
      ? { authorUrl: `https://www.pixiv.net/en/users/${bookmark.userId}` }
      : {}),
    sensitive: Number(bookmark.xRestrict) > 0 ? "explicit" : "unknown",
    metadata: {
      page,
      ordinal,
      visibility,
      bookmarkId: bookmark.bookmarkData?.id ?? null,
      bookmark: {
        title: bookmark.title ?? null,
        userId: bookmark.userId ?? null,
        userName: bookmark.userName ?? null,
        xRestrict: bookmark.xRestrict ?? null,
      },
      provenance: {
        platform: "pixiv",
        containerType: "bookmarks",
        containerKey: `${new URL(context.sourceUrl).pathname.match(/users\/(\d+)/)?.[1]}:${visibility}`,
        containerUrl: context.sourceUrl,
        containerName: `${visibility} Pixiv bookmarks`,
        visibility,
      },
    },
  };
  try {
    const detail = pixivBody(await request(`/ajax/illust/${id}`));
    if (String(detail.id ?? detail.illustId) !== id)
      throw new Error("Artwork metadata identity mismatch");
    if (!Number.isSafeInteger(detail.pageCount) || detail.pageCount < 1)
      throw new Error("Missing artwork page count");
    if (![0, 1, 2].includes(detail.xRestrict))
      throw new Error("Artwork sensitivity metadata unavailable");
    item.pageCount = detail.pageCount;
    item.title = detail.title ?? detail.illustTitle;
    item.authorName = detail.userName;
    item.authorUrl = `https://www.pixiv.net/en/users/${detail.userId}`;
    item.sensitive = Number(detail.xRestrict) > 0 ? "explicit" : "general";
    item.publishedAt = detail.createDate;
    item.tags = (detail.tags?.tags ?? [])
      .map((tag: ObjectValue) => tag.tag)
      .filter((tag: unknown) => typeof tag === "string");
    Object.assign(item.metadata!, {
      title: item.title,
      artistId: detail.userId,
      artistName: detail.userName,
      artistUrl: item.authorUrl,
      tags: detail.tags,
      createDate: detail.createDate,
      uploadDate: detail.uploadDate,
      description: detail.description,
      xRestrict: detail.xRestrict,
      restrict: detail.restrict,
      illustType: detail.illustType,
      pageCount: detail.pageCount,
    });
    if (detail.illustType === 2)
      throw new Error(
        "Ugoira animation requires frame-archive preservation; unresolved",
      );
    const envelope = object(await request(`/ajax/illust/${id}/pages`));
    if (envelope.error || !Array.isArray(envelope.body))
      throw new Error("Image-page manifest unavailable");
    if (envelope.body.length !== item.pageCount)
      throw new Error("Image-page count differs from artwork metadata");
    const pages = envelope.body.map((raw: unknown, sourceIndex: number) => {
      const entry = object(raw);
      const url = pixivOriginalUrl(entry.urls?.original);
      if (
        !Number.isSafeInteger(entry.width) ||
        entry.width <= 0 ||
        !Number.isSafeInteger(entry.height) ||
        entry.height <= 0
      ) {
        throw new Error("Original page dimensions unavailable");
      }
      return {
        url,
        width: entry.width,
        height: entry.height,
        sourceIndex,
        sourceCount: item.pageCount,
      };
    });
    if (
      new Set(pages.map((p: { url: string }) => p.url)).size !== item.pageCount
    )
      throw new Error("Duplicate image pages in manifest");
    item.assetUrls = pages.map((p: { url: string }) => p.url);
    item.metadata!.imagePages = pages;
    item.metadata!.availability = "available";
  } catch (error) {
    item.gap =
      error instanceof Error ? error.message : "Artwork metadata unavailable";
    item.metadata!.availability = "unresolved";
    item.metadata!.error = item.gap;
  }
  return item;
}

/** Match the requested pin, never a recommendation or the first original-looking URL. */
export function pinterestOriginalFromState(
  value: unknown,
  pinId: string,
): string | undefined {
  const pending: unknown[] = [value];
  for (let visited = 0; pending.length && visited < 50_000; visited++) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    const record = current as ObjectValue;
    if (
      String(record.id) === pinId &&
      typeof record.images?.orig?.url === "string"
    ) {
      const url = new URL(record.images.orig.url);
      if (
        url.protocol === "https:" &&
        /(^|\.)pinimg\.com$/.test(url.hostname) &&
        url.pathname.startsWith("/originals/")
      )
        return url.toString();
    }
    pending.push(...Object.values(current));
  }
  return undefined;
}
