import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { decodeTagSet } from "./tagSetCodec";

type Ctx = QueryCtx | MutationCtx;
export async function expandCommunity(
  ctx: Ctx,
  match: Doc<"communityMatches">,
  limit = 512,
) {
  const [asset, post] = await Promise.all([
    ctx.db.get(match.assetId),
    ctx.db.get(match.postSnapshotId),
  ]);
  const current =
    !!asset &&
    (match.inputStorageId
      ? [asset.originalStorageId, asset.previewStorageId].includes(
          match.inputStorageId,
        )
      : !!match.inputDriveFileId &&
        asset.driveFileId === match.inputDriveFileId &&
        asset.contentHash === match.inputSha256) &&
    (asset.contentHash ?? null) === match.originalContentHash;
  if (!post) throw new Error("Missing community source receipt");
  const codes = decodeTagSet(post.tagPayload);
  const tags = await Promise.all(
    codes.slice(0, limit).map(async (code) => {
      const term = await ctx.db
        .query("communityTerms")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      if (!term) throw new Error("Missing community term");
      return { name: term.name, category: term.category };
    }),
  );
  return {
    assetId: match.assetId,
    provider: post.provider,
    postId: post.postId,
    postUrl: `https://danbooru.donmai.us/posts/${post.postId}`,
    sourceUrl: post.sourceUrl,
    pixivId: post.pixivId,
    sourceUpdatedAt: post.sourceUpdatedAt,
    retrievedAt: match.retrievedAt,
    evidence: match.evidence,
    state: current ? ("current" as const) : ("stale" as const),
    tags,
    tagCount: codes.length,
    truncated: codes.length > limit,
  };
}

export async function communityForSearch(
  ctx: Ctx,
  referenceId: Id<"references">,
) {
  const rows = await ctx.db
    .query("communityMatches")
    .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
    .take(9);
  const expanded = await Promise.all(
    rows.slice(0, 8).map((row) => expandCommunity(ctx, row, 64)),
  );
  return {
    items: expanded.filter((row) => row.state === "current"),
    truncated: rows.length > 8 || expanded.some((row) => row.truncated),
  };
}
