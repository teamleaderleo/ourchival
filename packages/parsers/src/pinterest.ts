import type { ParsedSource } from "@ourchival/shared";

export type PinterestDomSnapshot = {
  pageUrl: string;
  canonicalUrl?: string;
  pinId?: string;
  title?: string;
  description?: string;
  creatorName?: string;
  creatorUrl?: string;
  outboundUrl?: string;
  boardName?: string;
  boardUrl?: string;
  mediaUrl?: string;
  altText?: string;
  publishedAt?: string;
  topics?: string[];
};

export type ParsedPinterestSource = ParsedSource & {
  platform: "pinterest";
  outboundSourceUrl?: string;
  boardName?: string;
  boardUrl?: string;
  sourceTags?: string[];
};

export function parsePinterestSnapshot(
  snapshot: PinterestDomSnapshot,
): ParsedPinterestSource {
  const pinId =
    cleanPinId(snapshot.pinId) ??
    pinIdFromUrl(snapshot.canonicalUrl) ??
    pinIdFromUrl(snapshot.pageUrl);
  const sourceUrl = pinId
    ? `https://www.pinterest.com/pin/${pinId}/`
    : cleanWebUrl(snapshot.canonicalUrl) ?? cleanWebUrl(snapshot.pageUrl) ?? snapshot.pageUrl;
  const mediaUrl = cleanWebUrl(snapshot.mediaUrl);
  const outboundSourceUrl = cleanOutboundUrl(snapshot.outboundUrl);
  const boardUrl = cleanWebUrl(snapshot.boardUrl);
  const sourceTags = uniqueText(snapshot.topics);
  const description = cleanText(snapshot.description);
  const altText = cleanText(snapshot.altText);

  return {
    platform: "pinterest",
    sourceUrl,
    canonicalUrl: sourceUrl,
    ...(cleanText(snapshot.title) ? { title: cleanText(snapshot.title) } : {}),
    ...(cleanText(snapshot.creatorName)
      ? { authorName: cleanText(snapshot.creatorName) }
      : {}),
    ...(cleanWebUrl(snapshot.creatorUrl)
      ? { authorUrl: cleanWebUrl(snapshot.creatorUrl) }
      : {}),
    ...(pinId ? { postId: pinId } : {}),
    ...(description ? { postText: description } : {}),
    ...(cleanText(snapshot.publishedAt)
      ? { publishedAt: cleanText(snapshot.publishedAt) }
      : {}),
    mediaUrls: mediaUrl ? [mediaUrl] : [],
    ...(mediaUrl && altText ? { altTexts: { [mediaUrl]: altText } } : {}),
    ...(outboundSourceUrl ? { outboundSourceUrl } : {}),
    ...(cleanText(snapshot.boardName) ? { boardName: cleanText(snapshot.boardName) } : {}),
    ...(boardUrl ? { boardUrl } : {}),
    ...(sourceTags.length ? { sourceTags } : {}),
  };
}

function pinIdFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://www.pinterest.com");
    return cleanPinId(url.pathname.match(/\/pin\/([^/]+)/i)?.[1]);
  } catch {
    return undefined;
  }
}

function cleanPinId(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned && /^[A-Za-z0-9_-]+$/.test(cleaned) ? cleaned : undefined;
}

function uniqueText(values: string[] | undefined) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function cleanText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

function cleanOutboundUrl(value: string | undefined) {
  const url = cleanWebUrl(value);
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "pinterest.com" || host.endsWith(".pinterest.com")
      ? undefined
      : url;
  } catch {
    return undefined;
  }
}

function cleanWebUrl(value: string | undefined) {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  try {
    const url = new URL(cleaned, "https://www.pinterest.com");
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
