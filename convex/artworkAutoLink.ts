import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOwnerAccess } from "./lib/privateAccess";

const maxAssetsPerReference = 64;
const maxRepresentationsPerHash = 12;

export const reconcileCapturedReference = mutation({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    return await reconcileCapturedReferenceCore(ctx, args.referenceId);
  },
});

export const reconcileCapturedReferenceInternal = internalMutation({
  args: {
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) =>
    await reconcileCapturedReferenceCore(ctx, args.referenceId),
});

export async function reconcileCapturedReferenceCore(
  ctx: MutationCtx,
  referenceId: Id<"references">,
) {
  const reference = await ctx.db.get(referenceId);
  if (!reference) {
    return result("missing_reference", "Reference not found.");
  }

  const existing = await ctx.db
    .query("artworkPublications")
    .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
    .take(maxAssetsPerReference + 1);
  if (existing.length > 0) {
    return {
      ...result("already_linked", "Publication already has an explicit artwork link."),
      artworkIds: Array.from(new Set(existing.map((row) => String(row.artworkId)))),
    };
  }

  const assets = await ctx.db
    .query("assets")
    .withIndex("by_reference", (q) => q.eq("referenceId", referenceId))
    .take(maxAssetsPerReference + 1);
  if (assets.length === 0) {
    return result("no_assets", "Captured reference has no assets to reconcile.");
  }
  if (assets.length > maxAssetsPerReference) {
    return result(
      "review",
      `Captured reference has more than ${maxAssetsPerReference} assets; review manually.`,
    );
  }

  const completeness = completeAssetSet(assets);
  if (!completeness.complete) {
    return {
      ...result("review", completeness.message),
      assetCount: assets.length,
      ...(completeness.expectedAssetCount !== undefined
        ? { expectedAssetCount: completeness.expectedAssetCount }
        : {}),
    };
  }

  const usable = assets.filter(
    (asset) =>
      Boolean(asset.contentHash?.trim()) &&
      (asset.storageProvider === "google_drive" || asset.storageProvider === "convex"),
  );
  if (usable.length !== assets.length) {
    return {
      ...result(
        "review",
        "Every captured asset must be durably stored and have an exact content hash before automatic linking.",
      ),
      assetCount: assets.length,
      expectedAssetCount: completeness.expectedAssetCount,
      hashedDurableAssetCount: usable.length,
    };
  }

  const byHash = new Map<string, typeof usable>();
  for (const asset of usable) {
    const hash = asset.contentHash!.trim();
    const rows = byHash.get(hash) ?? [];
    rows.push(asset);
    byHash.set(hash, rows);
  }

  let candidateArtworkId: Id<"artworks"> | undefined;
  const evidence: Array<{
    contentHash: string;
    assetCount: number;
    artworkId?: string;
    representationCount: number;
  }> = [];

  for (const [contentHash, matchingAssets] of byHash) {
    const representations = await ctx.db
      .query("artworkRepresentations")
      .withIndex("by_content_hash", (q) => q.eq("contentHash", contentHash))
      .take(maxRepresentationsPerHash + 1);
    if (representations.length === 0) {
      return {
        ...result("unmatched", "At least one captured asset hash has no canonical representation match."),
        assetCount: assets.length,
        expectedAssetCount: completeness.expectedAssetCount,
        unmatchedContentHash: contentHash,
        evidence,
      };
    }
    if (representations.length > maxRepresentationsPerHash) {
      return {
        ...result("review", "A content hash has too many representation matches for automatic linking."),
        assetCount: assets.length,
        expectedAssetCount: completeness.expectedAssetCount,
        evidence,
      };
    }

    const artworkIds = Array.from(
      new Set(representations.map((row) => String(row.artworkId))),
    );
    if (artworkIds.length !== 1) {
      return {
        ...result("ambiguous", "A captured asset hash maps to more than one artwork."),
        assetCount: assets.length,
        expectedAssetCount: completeness.expectedAssetCount,
        ambiguousContentHash: contentHash,
        artworkIds,
        evidence,
      };
    }

    const artworkId = representations[0]!.artworkId;
    evidence.push({
      contentHash,
      assetCount: matchingAssets.length,
      artworkId: String(artworkId),
      representationCount: representations.length,
    });
    if (candidateArtworkId && candidateArtworkId !== artworkId) {
      return {
        ...result(
          "ambiguous",
          "Different assets in this publication resolve to different artworks.",
        ),
        assetCount: assets.length,
        expectedAssetCount: completeness.expectedAssetCount,
        artworkIds: [String(candidateArtworkId), String(artworkId)],
        evidence,
      };
    }
    candidateArtworkId = artworkId;
  }

  if (!candidateArtworkId) {
    return result("unmatched", "No exact artwork representation match was found.");
  }
  if (!(await ctx.db.get(candidateArtworkId))) {
    return result("unmatched", "Matched artwork no longer exists.");
  }

  const publicationId = await linkPublication(
    ctx,
    candidateArtworkId,
    referenceId,
  );
  return {
    ...result("linked", "Exact captured bytes uniquely identify one artwork."),
    artworkId: String(candidateArtworkId),
    publicationId: String(publicationId),
    assetCount: assets.length,
    expectedAssetCount: completeness.expectedAssetCount,
    evidence,
  };
}

function completeAssetSet(
  assets: Array<{ sourceIndex?: number; sourceCount?: number }>,
) {
  const counts = new Set(
    assets.map((asset) => asset.sourceCount).filter((value): value is number =>
      Number.isInteger(value),
    ),
  );
  if (counts.size !== 1) {
    return {
      complete: false as const,
      message:
        "Captured assets do not agree on one source asset count; wait for a complete publication bundle or review manually.",
    };
  }
  const expectedAssetCount = Array.from(counts)[0]!;
  if (
    expectedAssetCount < 1 ||
    expectedAssetCount > maxAssetsPerReference
  ) {
    return {
      complete: false as const,
      expectedAssetCount,
      message: "Captured source asset count is outside the automatic-link limit.",
    };
  }
  if (assets.length !== expectedAssetCount) {
    return {
      complete: false as const,
      expectedAssetCount,
      message: `Captured publication is incomplete: ${assets.length}/${expectedAssetCount} assets are present.`,
    };
  }

  const indexes = assets.map((asset) => asset.sourceIndex);
  if (
    indexes.some(
      (value) =>
        !Number.isInteger(value) || value! < 0 || value! >= expectedAssetCount,
    )
  ) {
    return {
      complete: false as const,
      expectedAssetCount,
      message: "Captured publication has missing or invalid source asset indexes.",
    };
  }
  const uniqueIndexes = new Set(indexes as number[]);
  if (uniqueIndexes.size !== expectedAssetCount) {
    return {
      complete: false as const,
      expectedAssetCount,
      message: "Captured publication has duplicate or missing source asset indexes.",
    };
  }
  for (let index = 0; index < expectedAssetCount; index += 1) {
    if (!uniqueIndexes.has(index)) {
      return {
        complete: false as const,
        expectedAssetCount,
        message: "Captured publication is missing one or more source asset indexes.",
      };
    }
  }
  return { complete: true as const, expectedAssetCount };
}

async function linkPublication(
  ctx: MutationCtx,
  artworkId: Id<"artworks">,
  referenceId: Id<"references">,
) {
  const existing = await ctx.db
    .query("artworkPublications")
    .withIndex("by_artwork_id_and_reference_id", (q) =>
      q.eq("artworkId", artworkId).eq("referenceId", referenceId),
    )
    .unique();
  if (existing) return existing._id;

  const now = Date.now();
  const publicationId = await ctx.db.insert("artworkPublications", {
    artworkId,
    referenceId,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(artworkId, { updatedAt: now });
  return publicationId;
}

function result(status: string, message: string) {
  return { status, message, changed: status === "linked" };
}
