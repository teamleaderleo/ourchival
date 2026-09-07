import type { CapturePayload } from "@ourchival/shared";
import type { SourceIntakeItem } from "./sourceIntake";
import type { HoYoLabArticleIdentity } from "./hoyolabOwnedPost";

export function buildHoYoLabOwnedPayloads(
  item: SourceIntakeItem,
  capturedAt = new Date().toISOString(),
) {
  const assetUrls = item.assetUrls ?? [];
  if (assetUrls.length === 0) return [] as CapturePayload[];
  const postText = metadataString(item.metadata, ["post", "content"]);
  return assetUrls.map((assetUrl, assetIndex) => ({
    kind: "image" as const,
    sourceUrl: item.sourceUrl,
    canonicalUrl: item.sourceUrl,
    assetUrl,
    assetIndex,
    assetCount: assetUrls.length,
    previewImageUrl: assetUrl,
    ...(item.title ? { pageTitle: item.title } : {}),
    ...(item.authorName ? { authorName: item.authorName } : {}),
    postId: item.providerId,
    ...(postText ? { postText } : {}),
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    rawMetadata: JSON.stringify({
      provenance: "ourchival-clipper:hoyolab-owned-seed",
      sourceKind: "hoyolab_owned_profile",
      feedContext: "related_creator_articles",
      source: item.metadata ?? null,
      mediaIndex: assetIndex,
      mediaCount: assetUrls.length,
    }),
    tags: ["HoYoLAB creator works", ...(item.tags ?? [])],
    capturedAt,
  }));
}

export function unknownHoYoLabCandidates(
  identities: HoYoLabArticleIdentity[],
  indexedSourceUrls: Set<string>,
) {
  return identities.filter((identity) => !indexedSourceUrls.has(identity.sourceUrl));
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  path: string[],
) {
  let value: unknown = metadata;
  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
