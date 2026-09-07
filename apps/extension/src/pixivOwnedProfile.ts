import { pixivBody, pixivOriginalUrl, type JsonRequest } from "./artworkIntake";
import type { SourceIntakeItem } from "./sourceIntake";

type ObjectValue = Record<string, any>;

export type PixivOwnedProfileContext = {
  userId: string;
  sourceUrl: string;
  label: string;
};

export function detectPixivOwnedProfile(value: string | undefined) {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!/(^|\.)pixiv\.net$/i.test(url.hostname)) return undefined;
  const match = url.pathname.match(/^\/(?:en\/)?users\/(\d+)(?:\/artworks)?\/?$/i);
  if (!match?.[1]) return undefined;
  const userId = match[1];
  return {
    userId,
    sourceUrl: `https://www.pixiv.net/en/users/${userId}/artworks`,
    label: "Pixiv creator works",
  } satisfies PixivOwnedProfileContext;
}

export function pixivOwnedProfileWorkIds(value: unknown, maximum = 300) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 2_000) {
    throw new Error("Pixiv owned-profile limit must be between 1 and 2000.");
  }
  const body = pixivBody(value);
  const ids = new Set<string>();
  for (const collection of [body.illusts, body.manga]) {
    if (collection === undefined || collection === null) continue;
    if (typeof collection !== "object" || Array.isArray(collection)) {
      throw new Error("Pixiv profile work index is malformed.");
    }
    for (const id of Object.keys(collection)) {
      if (!/^\d+$/.test(id)) throw new Error("Pixiv profile returned an invalid artwork ID.");
      ids.add(id);
    }
  }
  return Array.from(ids)
    .sort((left, right) => compareNumericIdsDescending(left, right))
    .slice(0, maximum);
}

export async function pixivOwnedArtwork(
  providerId: string,
  context: PixivOwnedProfileContext,
  ordinal: number,
  request: JsonRequest,
): Promise<SourceIntakeItem> {
  if (!/^\d+$/.test(providerId)) throw new Error("Pixiv artwork ID is invalid.");
  const item: SourceIntakeItem = {
    providerId,
    sourceUrl: `https://www.pixiv.net/en/artworks/${providerId}`,
    ordinal,
    sensitive: "unknown",
    metadata: {
      ordinal,
      provenance: {
        platform: "pixiv",
        containerType: "owned_profile",
        containerKey: context.userId,
        containerUrl: context.sourceUrl,
        containerName: context.label,
      },
    },
  };

  try {
    const detail = pixivBody(await request(`/ajax/illust/${providerId}`));
    const detailId = String(detail.id ?? detail.illustId ?? "");
    if (detailId !== providerId) throw new Error("Pixiv artwork metadata identity mismatch.");
    if (String(detail.userId ?? "") !== context.userId) {
      throw new Error("Pixiv artwork publisher does not match the owned profile.");
    }
    if (!Number.isSafeInteger(detail.pageCount) || detail.pageCount < 1) {
      throw new Error("Pixiv artwork page count is unavailable.");
    }
    if (![0, 1, 2].includes(detail.xRestrict)) {
      throw new Error("Pixiv artwork sensitivity metadata is unavailable.");
    }

    item.pageCount = detail.pageCount;
    item.title = detail.title ?? detail.illustTitle;
    item.authorName = detail.userName;
    item.authorUrl = `https://www.pixiv.net/en/users/${context.userId}`;
    item.sensitive = Number(detail.xRestrict) > 0 ? "explicit" : "general";
    item.publishedAt = detail.createDate;
    item.tags = (detail.tags?.tags ?? [])
      .map((tag: ObjectValue) => tag.tag)
      .filter((tag: unknown): tag is string => typeof tag === "string");

    Object.assign(item.metadata!, {
      title: item.title,
      artistId: context.userId,
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
      width: detail.width,
      height: detail.height,
    });

    if (detail.illustType === 2) {
      throw new Error("Pixiv ugoira needs frame-archive preservation; unresolved.");
    }

    const envelope = asObject(await request(`/ajax/illust/${providerId}/pages`));
    if (envelope.error || !Array.isArray(envelope.body)) {
      throw new Error("Pixiv image-page manifest is unavailable.");
    }
    if (envelope.body.length !== item.pageCount) {
      throw new Error("Pixiv image-page count differs from artwork metadata.");
    }

    const pages = envelope.body.map((raw: unknown, sourceIndex: number) => {
      const entry = asObject(raw);
      const url = pixivOriginalUrl(entry.urls?.original);
      if (
        !Number.isSafeInteger(entry.width) ||
        entry.width <= 0 ||
        !Number.isSafeInteger(entry.height) ||
        entry.height <= 0
      ) {
        throw new Error("Pixiv original page dimensions are unavailable.");
      }
      return {
        url,
        width: entry.width,
        height: entry.height,
        sourceIndex,
        sourceCount: item.pageCount!,
      };
    });

    if (new Set(pages.map((page) => page.url)).size !== item.pageCount) {
      throw new Error("Pixiv profile returned duplicate original image pages.");
    }
    item.assetUrls = pages.map((page) => page.url);
    item.metadata!.imagePages = pages;
    item.metadata!.availability = "available";
  } catch (error) {
    item.gap = error instanceof Error ? error.message : "Pixiv artwork metadata unavailable.";
    item.metadata!.availability = "unresolved";
    item.metadata!.error = item.gap;
  }

  return item;
}

function asObject(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Pixiv provider response.");
  }
  return value as ObjectValue;
}

function compareNumericIdsDescending(left: string, right: string) {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue === rightValue ? 0 : leftValue > rightValue ? -1 : 1;
}
