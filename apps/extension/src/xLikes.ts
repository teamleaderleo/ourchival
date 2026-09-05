import { parseXSnapshot, type XDomSnapshot } from "@ourchival/parsers";
import type { CapturePayload } from "@ourchival/shared";

const xLikeTag = "X Likes";

export type XLikeCaptureOutcome = {
  alreadySaved?: boolean;
  assetId?: string | null;
  duplicateReason?: "asset_url" | "canonical_url" | "source_url";
  storageProvider?: "google_drive" | "convex" | "linked";
  storageStatus?: string;
  storedBytes?: number;
};

export function classifyAssetStorage(result: XLikeCaptureOutcome) {
  const provider =
    result.storageProvider ?? inferStorageProvider(result.storageStatus);
  if (provider === "google_drive" || provider === "convex") {
    return "stored" as const;
  }
  if (provider === "linked") return "linked" as const;
  return undefined;
}

export function classifyXLikeCapture(
  payload: CapturePayload,
  result: XLikeCaptureOutcome,
) {
  if (!result.alreadySaved) return "saved" as const;
  if (
    payload.assetUrl &&
    result.assetId &&
    result.duplicateReason !== "asset_url"
  ) {
    return "attached" as const;
  }
  return "duplicate" as const;
}

function inferStorageProvider(status: string | undefined) {
  const normalized = status?.toLowerCase();
  if (!normalized || normalized === "already saved") return undefined;
  if (normalized.includes("google drive")) return "google_drive" as const;
  if (normalized.includes("convex storage")) return "convex" as const;
  if (
    normalized.includes("fetch failed") ||
    normalized.includes("too large") ||
    normalized.includes("linked") ||
    normalized.includes("remote asset")
  ) {
    return "linked" as const;
  }
  return undefined;
}

export function isXLikesUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host !== "x.com" && host !== "twitter.com") return false;
    return (
      /^\/[A-Za-z0-9_]{1,15}\/likes\/?$/i.test(url.pathname) ||
      /^\/i\/history\/likes\/?$/i.test(url.pathname)
    );
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

    const mediaUrls =
      source.mediaUrls.length > 0 ? source.mediaUrls : [undefined];
    for (const [mediaIndex, assetUrl] of mediaUrls.entries()) {
      payloads.push({
        kind: assetUrl ? "image" : "post",
        sourceUrl: source.sourceUrl,
        canonicalUrl: source.canonicalUrl ?? source.sourceUrl,
        ...(assetUrl
          ? {
              assetUrl,
              assetIndex: mediaIndex,
              assetCount: source.mediaUrls.length,
              previewImageUrl: assetUrl,
            }
          : {}),
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
          feedContext: "likes",
          ...(source.textLanguage ? { textLanguage: source.textLanguage } : {}),
          ...(source.engagement ? { engagement: source.engagement } : {}),
          mediaUrls: source.mediaUrls,
          mediaIndex: assetUrl ? mediaIndex : undefined,
          mediaCount: source.mediaUrls.length,
          snapshot,
        }),
        tags: [xLikeTag],
        capturedAt,
      });
    }
  }

  return payloads;
}
