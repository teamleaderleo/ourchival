import type { ParsedSource } from "@ourchival/shared";

export type DanbooruTagCategory =
  | "general"
  | "artist"
  | "copyright"
  | "character"
  | "meta"
  | "unknown";

export type DanbooruSourceTag = {
  name: string;
  category: DanbooruTagCategory;
};

export type DanbooruDomSnapshot = {
  pageUrl: string;
  postId?: string;
  sourceUrl?: string;
  mediaUrl?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  rating?: string;
  uploaderName?: string;
  uploaderUrl?: string;
  artistNames?: string[];
  tags?: Array<{
    name: string;
    category?: DanbooruTagCategory;
  }>;
  poolIds?: string[];
  parentId?: string;
  childIds?: string[];
  createdAt?: string;
};

export type ParsedDanbooruSource = ParsedSource & {
  platform: "danbooru";
  originalSourceUrl?: string;
  dimensions?: { width: number; height: number };
  rating?: string;
  sourceTags?: DanbooruSourceTag[];
  poolIds?: string[];
  parentId?: string;
  childIds?: string[];
};

export function parseDanbooruSnapshot(
  snapshot: DanbooruDomSnapshot,
): ParsedDanbooruSource {
  const postId = cleanId(snapshot.postId) ?? postIdFromUrl(snapshot.pageUrl);
  const sourceUrl = postId
    ? `https://danbooru.donmai.us/posts/${postId}`
    : cleanWebUrl(snapshot.pageUrl) ?? snapshot.pageUrl;
  const mediaUrl = cleanWebUrl(snapshot.mediaUrl) ?? cleanWebUrl(snapshot.previewUrl);
  const originalSourceUrl = cleanWebUrl(snapshot.sourceUrl);
  const sourceTags = normalizeTags(snapshot.tags);
  const artistNames = uniqueText(snapshot.artistNames);
  const title = artistNames.length
    ? artistNames.join(", ")
    : postId
      ? `Danbooru post ${postId}`
      : "Danbooru post";
  const poolIds = uniqueIds(snapshot.poolIds);
  const childIds = uniqueIds(snapshot.childIds);
  const parentId = cleanId(snapshot.parentId);
  const width = positiveInteger(snapshot.width);
  const height = positiveInteger(snapshot.height);

  return {
    platform: "danbooru",
    sourceUrl,
    canonicalUrl: sourceUrl,
    title,
    ...(artistNames[0] ? { authorName: artistNames[0] } : {}),
    ...(postId ? { postId } : {}),
    ...(cleanText(snapshot.createdAt) ? { publishedAt: cleanText(snapshot.createdAt) } : {}),
    mediaUrls: mediaUrl ? [mediaUrl] : [],
    ...(originalSourceUrl ? { originalSourceUrl } : {}),
    ...(width && height ? { dimensions: { width, height } } : {}),
    ...(cleanText(snapshot.rating) ? { rating: cleanText(snapshot.rating) } : {}),
    ...(sourceTags.length ? { sourceTags } : {}),
    ...(poolIds.length ? { poolIds } : {}),
    ...(parentId ? { parentId } : {}),
    ...(childIds.length ? { childIds } : {}),
  };
}

function normalizeTags(tags: DanbooruDomSnapshot["tags"]) {
  const result: DanbooruSourceTag[] = [];
  const seen = new Set<string>();
  for (const tag of tags ?? []) {
    const name = cleanText(tag.name);
    if (!name) continue;
    const category = tag.category ?? "unknown";
    const key = `${category}:${name.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name, category });
  }
  return result;
}

function postIdFromUrl(value: string) {
  try {
    const url = new URL(value, "https://danbooru.donmai.us");
    return cleanId(url.pathname.match(/\/posts\/(\d+)/i)?.[1]);
  } catch {
    return undefined;
  }
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

function uniqueIds(values: string[] | undefined) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const cleaned = cleanId(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

function cleanId(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned && /^\d+$/.test(cleaned) ? cleaned : undefined;
}

function positiveInteger(value: number | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function cleanText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

function cleanWebUrl(value: string | undefined) {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
