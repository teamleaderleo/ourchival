import {
  normalizeXMediaUrl,
  parseXSnapshot,
  type ParsedXSource,
  type XDomSnapshot,
} from "@ourchival/parsers";
import type { CapturePayload } from "@ourchival/shared";

export type XOwnedProfileSnapshot = Omit<XDomSnapshot, "images"> & {
  images: Array<{ src: string; alt?: string; href?: string }>;
};

export type XOwnedMedia = {
  url: string;
  alt?: string;
  href: string;
  mediaIndex: number;
};

export type XOwnedProfileClassification = {
  disposition:
    | "authored_media"
    | "not_authored"
    | "text_only"
    | "quoted_media_only"
    | "ambiguous_media"
    | "unresolved_status";
  source?: ParsedXSource;
  outerStatus?: { handle: string; postId: string; sourceUrl: string };
  ownedMedia: XOwnedMedia[];
  foreignMedia: Array<{ url: string; href?: string }>;
  ambiguousMedia: Array<{ url: string; href?: string }>;
};

export function classifyXOwnedProfileSnapshot(
  snapshot: XOwnedProfileSnapshot,
  expectedHandle: string,
): XOwnedProfileClassification {
  const owner = normalizeHandle(expectedHandle);
  if (!owner) throw new Error("X owned-profile handle is invalid.");

  const outerCandidates = uniqueStatuses(snapshot.links)
    .filter((status) => status.handle.toLowerCase() === owner.toLowerCase());
  if (outerCandidates.length > 1) {
    return emptyClassification("unresolved_status");
  }
  if (outerCandidates.length === 0) {
    return {
      ...emptyClassification(
        uniqueStatuses(snapshot.links).length > 0
          ? "not_authored"
          : "unresolved_status",
      ),
      source: parseXSnapshot(snapshot),
    };
  }

  const outer = outerCandidates[0]!;
  const parsed = parseXSnapshot({
    ...snapshot,
    pageUrl: outer.sourceUrl,
    links: [
      { href: outer.sourceUrl },
      ...snapshot.links.filter((link) => link.href !== outer.sourceUrl),
    ],
  });
  const ownedMedia: XOwnedMedia[] = [];
  const foreignMedia: Array<{ url: string; href?: string }> = [];
  const ambiguousMedia: Array<{ url: string; href?: string }> = [];
  const seen = new Set<string>();

  for (const image of snapshot.images) {
    if (!isXPublicationMedia(image.src)) continue;
    const url = normalizeXMediaUrl(image.src);
    if (seen.has(url)) continue;
    seen.add(url);
    const mediaStatus = image.href ? statusFromUrl(image.href) : undefined;
    if (!mediaStatus) {
      ambiguousMedia.push({ url, ...(image.href ? { href: image.href } : {}) });
      continue;
    }
    if (
      mediaStatus.postId === outer.postId &&
      mediaStatus.handle.toLowerCase() === owner.toLowerCase()
    ) {
      ownedMedia.push({
        url,
        ...(image.alt?.trim() ? { alt: image.alt.trim() } : {}),
        href: image.href!,
        mediaIndex: ownedMedia.length,
      });
    } else {
      foreignMedia.push({ url, href: image.href });
    }
  }

  const disposition =
    ownedMedia.length > 0
      ? "authored_media"
      : ambiguousMedia.length > 0
        ? "ambiguous_media"
        : foreignMedia.length > 0
          ? "quoted_media_only"
          : "text_only";

  return {
    disposition,
    source: {
      ...parsed,
      sourceUrl: outer.sourceUrl,
      canonicalUrl: outer.sourceUrl,
      authorHandle: `@${outer.handle}`,
      authorUrl: `https://x.com/${outer.handle}`,
      postId: outer.postId,
      mediaUrls: ownedMedia.map((media) => media.url),
      ...(ownedMedia.some((media) => media.alt)
        ? {
            altTexts: Object.fromEntries(
              ownedMedia
                .filter((media) => media.alt)
                .map((media) => [media.url, media.alt!]),
            ),
          }
        : { altTexts: undefined }),
    },
    outerStatus: outer,
    ownedMedia,
    foreignMedia,
    ambiguousMedia,
  };
}

export function buildXOwnedProfilePayloads(
  snapshot: XOwnedProfileSnapshot,
  expectedHandle: string,
  capturedAt = new Date().toISOString(),
) {
  const classification = classifyXOwnedProfileSnapshot(snapshot, expectedHandle);
  if (
    classification.disposition !== "authored_media" ||
    !classification.source ||
    !classification.outerStatus
  ) {
    return { classification, payloads: [] as CapturePayload[] };
  }

  const source = classification.source;
  const payloads = classification.ownedMedia.map((media, mediaIndex) => ({
    kind: "image" as const,
    sourceUrl: source.sourceUrl,
    canonicalUrl: source.canonicalUrl ?? source.sourceUrl,
    assetUrl: media.url,
    assetIndex: mediaIndex,
    assetCount: classification.ownedMedia.length,
    previewImageUrl: media.url,
    ...(source.title ? { pageTitle: source.title } : {}),
    ...(source.authorName ? { authorName: source.authorName } : {}),
    ...(source.authorHandle ? { authorHandle: source.authorHandle } : {}),
    ...(source.authorUrl ? { authorUrl: source.authorUrl } : {}),
    postId: source.postId,
    ...(source.postText ? { postText: source.postText } : {}),
    ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
    ...(media.alt ? { altText: media.alt } : {}),
    rawMetadata: JSON.stringify({
      provenance: "ourchival-clipper:x-owned-profile",
      sourceKind: "x_owned_profile",
      feedContext: "profile",
      outerStatus: classification.outerStatus,
      mediaHref: media.href,
      mediaIndex,
      mediaCount: classification.ownedMedia.length,
      excludedForeignMedia: classification.foreignMedia.length,
      ambiguousMedia: classification.ambiguousMedia.length,
      ...(source.textLanguage ? { textLanguage: source.textLanguage } : {}),
      ...(source.engagement ? { engagement: source.engagement } : {}),
    }),
    tags: ["X authored media"],
    capturedAt,
  }));

  return { classification, payloads };
}

function emptyClassification(
  disposition: XOwnedProfileClassification["disposition"],
): XOwnedProfileClassification {
  return {
    disposition,
    ownedMedia: [],
    foreignMedia: [],
    ambiguousMedia: [],
  };
}

function uniqueStatuses(links: XDomSnapshot["links"]) {
  const statuses = new Map<string, { handle: string; postId: string; sourceUrl: string }>();
  for (const link of links) {
    const status = statusFromUrl(link.href);
    if (!status) continue;
    statuses.set(`${status.handle.toLowerCase()}:${status.postId}`, status);
  }
  return Array.from(statuses.values());
}

function statusFromUrl(value: string) {
  try {
    const url = new URL(value, "https://x.com");
    if (!isXHost(url.hostname)) return undefined;
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/|$)/i);
    if (!match?.[1] || !match[2]) return undefined;
    const handle = match[1];
    const postId = match[2];
    return {
      handle,
      postId,
      sourceUrl: `https://x.com/${handle}/status/${postId}`,
    };
  } catch {
    return undefined;
  }
}

function isXPublicationMedia(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/media/");
  } catch {
    return false;
  }
}

function isXHost(value: string) {
  const host = value.toLowerCase();
  return host === "x.com" || host === "twitter.com";
}

function normalizeHandle(value: string) {
  const normalized = value.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(normalized) ? normalized : undefined;
}
