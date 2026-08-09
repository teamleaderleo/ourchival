import type { ParsedSource } from "@ourchival/shared";

export type PixivDomSnapshot = {
  pageUrl: string;
  canonicalUrl?: string;
  artworkId?: string;
  title?: string;
  description?: string;
  artistName?: string;
  artistId?: string;
  artistUrl?: string;
  publishedAt?: string;
  tags?: string[];
  images: Array<{
    src: string;
    alt?: string;
  }>;
};

export type ParsedPixivSource = ParsedSource & {
  platform: "pixiv";
  description?: string;
  sourceTags?: string[];
};

export function parsePixivSnapshot(snapshot: PixivDomSnapshot): ParsedPixivSource {
  const artworkId =
    cleanId(snapshot.artworkId) ??
    artworkIdFromUrl(snapshot.canonicalUrl) ??
    artworkIdFromUrl(snapshot.pageUrl);
  const sourceUrl = artworkId
    ? `https://www.pixiv.net/en/artworks/${artworkId}`
    : cleanWebUrl(snapshot.canonicalUrl) ?? cleanWebUrl(snapshot.pageUrl) ?? snapshot.pageUrl;
  const artistId =
    cleanId(snapshot.artistId) ??
    artistIdFromUrl(snapshot.artistUrl);
  const authorUrl = artistId
    ? `https://www.pixiv.net/en/users/${artistId}`
    : cleanWebUrl(snapshot.artistUrl);
  const media = collectMedia(snapshot.images);
  const sourceTags = uniqueText(snapshot.tags);

  return {
    platform: "pixiv",
    sourceUrl,
    canonicalUrl: sourceUrl,
    ...(cleanText(snapshot.title) ? { title: cleanText(snapshot.title) } : {}),
    ...(cleanText(snapshot.artistName)
      ? { authorName: cleanText(snapshot.artistName) }
      : {}),
    ...(authorUrl ? { authorUrl } : {}),
    ...(artworkId ? { postId: artworkId } : {}),
    ...(cleanText(snapshot.description)
      ? {
          postText: cleanText(snapshot.description),
          description: cleanText(snapshot.description),
        }
      : {}),
    ...(cleanText(snapshot.publishedAt)
      ? { publishedAt: cleanText(snapshot.publishedAt) }
      : {}),
    mediaUrls: media.urls,
    ...(Object.keys(media.altTexts).length ? { altTexts: media.altTexts } : {}),
    ...(sourceTags.length ? { sourceTags } : {}),
  };
}

function artworkIdFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://www.pixiv.net");
    return cleanId(url.pathname.match(/\/artworks\/(\d+)/i)?.[1]);
  } catch {
    return undefined;
  }
}

function artistIdFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://www.pixiv.net");
    return cleanId(url.pathname.match(/\/users\/(\d+)/i)?.[1]);
  } catch {
    return undefined;
  }
}

function collectMedia(images: PixivDomSnapshot["images"]) {
  const urls: string[] = [];
  const altTexts: Record<string, string> = {};
  const seen = new Set<string>();

  for (const image of images) {
    const url = cleanWebUrl(image.src);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    const alt = cleanText(image.alt);
    if (alt) altTexts[url] = alt;
  }

  return { urls, altTexts };
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

function cleanId(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned && /^\d+$/.test(cleaned) ? cleaned : undefined;
}

function cleanText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

function cleanWebUrl(value: string | undefined) {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  try {
    const url = new URL(cleaned, "https://www.pixiv.net");
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
