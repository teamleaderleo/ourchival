import type { ParsedSource } from "@ourchival/shared";

export type XDomSnapshot = {
  pageUrl: string;
  pageTitle?: string;
  articleText?: string;
  userNameText?: string;
  clickedImageUrl?: string;
  timestamp?: string;
  links: Array<{ href: string; text?: string }>;
  images: Array<{ src: string; alt?: string }>;
};

export type ParsedXSource = ParsedSource & {
  clickedAssetUrl?: string;
};

export function parseXSnapshot(snapshot: XDomSnapshot): ParsedXSource {
  const status = findStatus(snapshot.links, snapshot.pageUrl);
  const handle = status?.handle;
  const authorHandle = handle ? `@${handle}` : findHandle(snapshot.userNameText);
  const normalizedHandle = authorHandle?.replace(/^@/, "");
  const sourceUrl = status?.url ?? canonicalizeXUrl(snapshot.pageUrl);
  const authorName = findDisplayName(snapshot.userNameText, authorHandle);
  const media = collectMedia(snapshot.images);
  const clickedAssetUrl = snapshot.clickedImageUrl
    ? normalizeXMediaUrl(snapshot.clickedImageUrl)
    : undefined;

  return {
    platform: "x",
    sourceUrl,
    canonicalUrl: sourceUrl,
    title: authorName
      ? `${authorName}${authorHandle ? ` (${authorHandle})` : ""} on X`
      : authorHandle
        ? `${authorHandle} on X`
        : snapshot.pageTitle,
    ...(authorName ? { authorName } : {}),
    ...(authorHandle ? { authorHandle } : {}),
    ...(normalizedHandle
      ? { authorUrl: `https://x.com/${encodeURIComponent(normalizedHandle)}` }
      : {}),
    ...(status?.postId ? { postId: status.postId } : {}),
    ...(snapshot.articleText?.trim()
      ? { postText: snapshot.articleText.trim() }
      : {}),
    ...(snapshot.timestamp ? { publishedAt: snapshot.timestamp } : {}),
    mediaUrls: media.urls,
    ...(Object.keys(media.altTexts).length ? { altTexts: media.altTexts } : {}),
    ...(clickedAssetUrl ? { clickedAssetUrl } : {}),
  };
}

export function normalizeXMediaUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== "pbs.twimg.com" || !url.pathname.startsWith("/media/")) {
      return value;
    }

    url.protocol = "https:";
    url.searchParams.set("name", "orig");
    sortSearchParameters(url);
    return url.toString();
  } catch {
    return value;
  }
}

function findStatus(links: XDomSnapshot["links"], pageUrl: string) {
  const candidates = [
    ...links.map((link) => link.href),
    pageUrl,
  ];

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, pageUrl);
      const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/i);
      if (!match) continue;
      const handle = decodeURIComponent(match[1] ?? "");
      const postId = match[2];
      if (!handle || !postId) continue;
      return {
        handle,
        postId,
        url: `https://x.com/${encodeURIComponent(handle)}/status/${postId}`,
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

function canonicalizeXUrl(value: string) {
  try {
    const url = new URL(value);
    url.protocol = "https:";
    url.hostname = "x.com";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function findHandle(value: string | undefined) {
  return value?.match(/@[A-Za-z0-9_]{1,15}/)?.[0];
}

function findDisplayName(value: string | undefined, handle: string | undefined) {
  if (!value) return undefined;

  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== handle)
    .filter((line) => !line.startsWith("@"))
    .filter((line) => !/^(verified|follows you)$/i.test(line));

  return lines[0];
}

function collectMedia(images: XDomSnapshot["images"]) {
  const urls: string[] = [];
  const altTexts: Record<string, string> = {};
  const seen = new Set<string>();

  for (const image of images) {
    if (!isXMediaUrl(image.src)) continue;
    const url = normalizeXMediaUrl(image.src);
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (image.alt?.trim()) altTexts[url] = image.alt.trim();
  }

  return { urls, altTexts };
}

function isXMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/media/");
  } catch {
    return false;
  }
}

function sortSearchParameters(url: URL) {
  const entries = Array.from(url.searchParams.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  url.search = "";
  for (const [key, value] of entries) url.searchParams.append(key, value);
}
