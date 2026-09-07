import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOwnerAccess } from "./lib/privateAccess";
import { slugifyTagName } from "./lib/tags";

const ownedSourceTagNames = [
  "X authored media",
  "Pixiv creator works",
  "HoYoLAB creator works",
] as const;
const defaultLimit = 60;
const maxLimit = 120;
const scanMultiplier = 10;
const maxAssetsPerReference = 24;

export const listUnlinkedOwnedPublications = query({
  args: {
    accessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const limit = normalizeLimit(args.limit);
    const scanLimit = Math.min(1_200, limit * scanMultiplier);

    const ownedTags = (
      await Promise.all(
        ownedSourceTagNames.map((name) =>
          ctx.db
            .query("tags")
            .withIndex("by_slug", (q) => q.eq("slug", slugifyTagName(name)))
            .unique(),
        ),
      )
    ).filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
    const ownedTagNamesById = new Map(
      ownedTags.map((tag) => [String(tag._id), tag.name]),
    );
    const ownedTagIds = new Set(ownedTagNamesById.keys());

    if (ownedTagIds.size === 0) {
      return {
        items: [],
        scanned: 0,
        candidatesSeen: 0,
        hasMore: false,
        ownedSourceTags: ownedSourceTagNames,
      };
    }

    const recent = await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .order("desc")
      .take(scanLimit + 1);
    const hasMoreRecent = recent.length > scanLimit;
    const bounded = recent.slice(0, scanLimit);
    const items = [];
    let candidatesSeen = 0;

    for (const reference of bounded) {
      if (items.length >= limit) break;
      if (reference.deleted) continue;
      const sourceTagId = reference.tagIds.find((tagId) =>
        ownedTagIds.has(String(tagId)),
      );
      if (!sourceTagId) continue;
      candidatesSeen += 1;

      const linked = await ctx.db
        .query("artworkPublications")
        .withIndex("by_reference_id", (q) => q.eq("referenceId", reference._id))
        .first();
      if (linked) continue;

      const [assets, snapshots] = await Promise.all([
        ctx.db
          .query("assets")
          .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
          .take(maxAssetsPerReference + 1),
        ctx.db
          .query("sourceSnapshots")
          .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
          .collect(),
      ]);
      const assetsTruncated = assets.length > maxAssetsPerReference;
      const boundedAssets = assets
        .slice(0, maxAssetsPerReference)
        .sort(
          (left, right) =>
            (left.sourceIndex ?? Number.MAX_SAFE_INTEGER) -
            (right.sourceIndex ?? Number.MAX_SAFE_INTEGER),
        );
      const newestSnapshot = snapshots.sort(
        (left, right) => right.createdAt - left.createdAt,
      )[0];
      const firstAsset = boundedAssets[0];

      items.push({
        referenceId: String(reference._id),
        sourceKind: ownedTagNamesById.get(String(sourceTagId)) ?? "Owned source",
        title: reference.title ?? newestSnapshot?.pageTitle ?? null,
        sourceUrl: reference.sourceUrl,
        canonicalUrl: reference.canonicalUrl ?? null,
        platform: reference.platform,
        authorName: reference.authorName ?? null,
        authorHandle: reference.authorHandle ?? null,
        postId: reference.postId ?? null,
        capturedAt: reference.capturedAt,
        publishedAt: reference.publishedAt ?? null,
        captureSessionId: reference.captureSessionId ?? null,
        postText: truncateText(newestSnapshot?.postText, 320),
        previewImageUrl: newestSnapshot?.previewImageUrl ?? null,
        assetCount: boundedAssets.length,
        assetsTruncated,
        firstAsset: firstAsset
          ? {
              assetId: String(firstAsset._id),
              sourceIndex: firstAsset.sourceIndex ?? null,
              sourceCount: firstAsset.sourceCount ?? null,
              mimeType: firstAsset.mimeType ?? null,
              width: firstAsset.width ?? null,
              height: firstAsset.height ?? null,
              storageProvider: firstAsset.storageProvider,
              hasContentHash: Boolean(firstAsset.contentHash),
              derivativeStatus: firstAsset.derivativeStatus ?? null,
            }
          : null,
      });
    }

    return {
      items,
      scanned: bounded.length,
      candidatesSeen,
      hasMore:
        items.length >= limit ||
        hasMoreRecent ||
        (bounded.length === scanLimit && candidatesSeen > items.length),
      ownedSourceTags: ownedSourceTagNames,
    };
  },
});

function normalizeLimit(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultLimit;
  return Math.min(maxLimit, Math.max(1, Math.floor(value)));
}

function truncateText(value: string | undefined, limit: number) {
  const cleaned = value?.trim();
  if (!cleaned) return null;
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit - 1)}…`;
}
