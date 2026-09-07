import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOwnerAccess } from "./lib/privateAccess";

const maxAssetsPerReference = 32;
const maxRepresentationsPerHash = 12;

export const reconcileCapturedReference = mutation({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const reference = await ctx.db.get(args.referenceId);
    if (!reference) {
      return result("missing_reference", "Reference not found.");
    }

    const existing = await ctx.db
      .query("artworkPublications")
      .withIndex("by_reference_id", (q) => q.eq("referenceId", args.referenceId))
      .take(maxAssetsPerReference + 1);
    if (existing.length > 0) {
      return {
        ...result("already_linked", "Publication already has an explicit artwork link."),
        artworkIds: Array.from(new Set(existing.map((row) => String(row.artworkId)))),
      };
    }

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_reference", (q) => q.eq("referenceId", args.referenceId))
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
          unmatchedContentHash: contentHash,
          evidence,
        };
      }
      if (representations.length > maxRepresentationsPerHash) {
        return {
          ...result("review", "A content hash has too many representation matches for automatic linking."),
          assetCount: assets.length,
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
      args.referenceId,
    );
    return {
      ...result("linked", "Exact captured bytes uniquely identify one artwork."),
      artworkId: String(candidateArtworkId),
      publicationId: String(publicationId),
      assetCount: assets.length,
      evidence,
    };
  },
});

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
