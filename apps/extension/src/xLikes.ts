import { parseXSnapshot, type XDomSnapshot } from "@ourchival/parsers";
import type { CapturePayload } from "@ourchival/shared";

const xLikeTag = "X Likes";

export function isXLikesUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host !== "x.com" && host !== "twitter.com") return false;
    return /^\/[A-Za-z0-9_]{1,15}\/likes\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function buildXLikePayloads(
  snapshots: XDomSnapshot[],
  capturedAt = new Date().toISOString(),
) {
  const payloads: CapturePayload[] = [];
  const seen = new Set<string>();

  for (const snapshot of snapshots) {
    const source = parseXSnapshot(snapshot);
    if (!source.postId || !/\/status\/\d+$/i.test(source.sourceUrl)) continue;
    if (seen.has(source.sourceUrl)) continue;
    seen.add(source.sourceUrl);

    const assetUrl = source.mediaUrls[0];
    payloads.push({
      kind: assetUrl ? "image" : "post",
      sourceUrl: source.sourceUrl,
      canonicalUrl: source.canonicalUrl ?? source.sourceUrl,
      ...(assetUrl ? { assetUrl, previewImageUrl: assetUrl } : {}),
      ...(source.title ? { pageTitle: source.title } : {}),
      ...(source.authorName ? { authorName: source.authorName } : {}),
      ...(source.authorHandle ? { authorHandle: source.authorHandle } : {}),
      ...(source.authorUrl ? { authorUrl: source.authorUrl } : {}),
      postId: source.postId,
      ...(source.postText ? { postText: source.postText } : {}),
      ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
      ...(assetUrl && source.altTexts?.[assetUrl]
        ? { altText: source.altTexts[assetUrl] }
        : {}),
      rawMetadata: JSON.stringify({
        provenance: "ourchival-clipper:x-likes",
        sourceKind: "x_like",
        mediaUrls: source.mediaUrls,
        snapshot,
      }),
      tags: [xLikeTag],
      capturedAt,
    });
  }

  return payloads;
}
