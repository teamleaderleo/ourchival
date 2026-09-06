import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";
import { communityTag } from "./lib/communitySchema";
import { allocateTagCode } from "./lib/tagIdentity";
import { encodeTagSet } from "./lib/tagSetCodec";
import { expandCommunity } from "./lib/communityMetadata";
import { refreshReferenceSearch } from "./lib/searchIndex";
import { storageSha256 } from "./lib/storageDigest";

export const workItem = query({
  args: { accessKey: v.string(), assetId: v.id("assets") },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const asset = await ctx.db.get(args.assetId);
    const reference = asset ? await ctx.db.get(asset.referenceId) : null;
    if (!asset || !reference || reference.deleted)
      throw new Error("Asset unavailable");
    const inputs = [];
    if (
      asset.driveFileId &&
      asset.contentHash &&
      /^[a-f0-9]{64}$/.test(asset.contentHash)
    )
      inputs.push({
        driveFileId: asset.driveFileId,
        sha256: asset.contentHash,
      });
    for (const storageId of [
      ...new Set([asset.originalStorageId, asset.previewStorageId]),
    ]) {
      if (!storageId) continue;
      const meta = await ctx.db.system.get(storageId);
      if (meta) inputs.push({ storageId, sha256: storageSha256(meta.sha256) });
    }
    return {
      referenceId: asset.referenceId,
      originalContentHash: asset.contentHash ?? null,
      inputs,
    };
  },
});

export const publish = mutation({
  args: {
    accessKey: v.string(),
    assetId: v.id("assets"),
    referenceId: v.id("references"),
    inputStorageId: v.optional(v.id("_storage")),
    inputDriveFileId: v.optional(v.string()),
    inputSha256: v.string(),
    originalContentHash: v.union(v.string(), v.null()),
    evidence: v.literal("exact_md5"),
    inputMd5: v.string(),
    postMd5: v.string(),
    postId: v.number(),
    sourceUpdatedAt: v.number(),
    retrievedAt: v.number(),
    sourceUrl: v.optional(v.string()),
    pixivId: v.optional(v.string()),
    tags: v.array(communityTag),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (
      !/^[a-f0-9]{32}$/.test(args.inputMd5) ||
      args.inputMd5 !== args.postMd5 ||
      !/^[a-f0-9]{64}$/.test(args.inputSha256) ||
      !Number.isSafeInteger(args.postId) ||
      args.postId <= 0
    )
      throw new Error("Invalid exact-image evidence");
    for (const time of [args.sourceUpdatedAt, args.retrievedAt])
      if (
        !Number.isSafeInteger(time) ||
        time <= 0 ||
        time > Date.now() + 300_000
      )
        throw new Error("Invalid source time");
    if (
      args.sourceUrl &&
      (args.sourceUrl.length > 2048 || !/^https?:\/\//.test(args.sourceUrl))
    )
      throw new Error("Invalid source URL");
    if (args.pixivId && !/^\d{1,20}$/.test(args.pixivId))
      throw new Error("Invalid Pixiv identity");
    if (
      !args.tags.length ||
      args.tags.length > 512 ||
      args.tags.some(
        (t) => !t.name || t.name.length > 200 || /[\s\p{Cc}]/u.test(t.name),
      )
    )
      throw new Error("Invalid community vocabulary");
    const tags = [...args.tags].sort((a, b) =>
      `${a.category}:${a.name}`.localeCompare(`${b.category}:${b.name}`),
    );
    if (
      new Set(tags.map((t) => `${t.category}:${t.name}`)).size !== tags.length
    )
      throw new Error("Duplicate community term");
    const [asset, reference, input] = await Promise.all([
      ctx.db.get(args.assetId),
      ctx.db.get(args.referenceId),
      args.inputStorageId ? ctx.db.system.get(args.inputStorageId) : null,
    ]);
    if (
      !asset ||
      !reference ||
      reference.deleted ||
      asset.referenceId !== reference._id ||
      (asset.contentHash ?? null) !== args.originalContentHash ||
      !!args.inputStorageId === !!args.inputDriveFileId ||
      (args.inputStorageId
        ? ![asset.originalStorageId, asset.previewStorageId].includes(
            args.inputStorageId,
          ) ||
          !input ||
          storageSha256(input.sha256) !== args.inputSha256
        : !args.inputDriveFileId ||
          asset.driveFileId !== args.inputDriveFileId ||
          asset.contentHash !== args.inputSha256)
    )
      throw new Error("Asset input changed or does not match the receipt");
    const existing = await ctx.db
      .query("communityMatches")
      .withIndex("by_asset_id_and_post_id", (q) =>
        q.eq("assetId", args.assetId).eq("postId", args.postId),
      )
      .unique();
    const signature = JSON.stringify([
      args.postId,
      args.postMd5,
      args.sourceUpdatedAt,
      args.sourceUrl ?? null,
      args.pixivId ?? null,
      tags,
    ]);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(signature),
    );
    const fingerprint = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const previous = existing
      ? await ctx.db.get(existing.postSnapshotId)
      : null;
    if (
      previous &&
      previous.fingerprint !== fingerprint &&
      previous.sourceUpdatedAt >= args.sourceUpdatedAt
    )
      throw new Error("Older or conflicting source revision");
    if (
      existing &&
      previous?.fingerprint === fingerprint &&
      existing?.inputStorageId === args.inputStorageId &&
      existing?.inputDriveFileId === args.inputDriveFileId &&
      existing.inputSha256 === args.inputSha256 &&
      existing.originalContentHash === args.originalContentHash
    )
      return { replayed: true, tagCount: tags.length, matchId: existing._id };
    if (
      !existing &&
      (
        await ctx.db
          .query("communityMatches")
          .withIndex("by_asset_id_and_post_id", (q) =>
            q.eq("assetId", args.assetId),
          )
          .take(4)
      ).length >= 4
    )
      throw new Error("Asset source limit reached; review existing matches");
    let post = await ctx.db
      .query("communityPosts")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
      .unique();
    if (!post) {
      const codes = [];
      for (const tag of tags) {
        let term = await ctx.db
          .query("communityTerms")
          .withIndex("by_category_and_name", (q) =>
            q.eq("category", tag.category).eq("name", tag.name),
          )
          .unique();
        if (!term) {
          const id = await ctx.db.insert("communityTerms", {
            ...tag,
            code: await allocateTagCode(ctx),
          });
          term = (await ctx.db.get(id))!;
        }
        codes.push(term.code);
      }
      const id = await ctx.db.insert("communityPosts", {
        provider: "danbooru",
        postId: args.postId,
        fingerprint,
        md5: args.postMd5,
        sourceUpdatedAt: args.sourceUpdatedAt,
        sourceUrl: args.sourceUrl,
        pixivId: args.pixivId,
        tagPayload: encodeTagSet(codes),
      });
      post = (await ctx.db.get(id))!;
    }
    const link = {
      assetId: asset._id,
      referenceId: reference._id,
      postId: args.postId,
      postSnapshotId: post._id,
      inputStorageId: args.inputStorageId,
      inputDriveFileId: args.inputDriveFileId,
      inputSha256: args.inputSha256,
      originalContentHash: args.originalContentHash,
      evidence: args.evidence,
      retrievedAt: args.retrievedAt,
    };
    let matchId = existing?._id;
    if (matchId) await ctx.db.replace(matchId, link);
    else matchId = await ctx.db.insert("communityMatches", link);
    await refreshReferenceSearch(ctx, reference._id);
    return { replayed: false, tagCount: tags.length, matchId };
  },
});

export const inspect = query({
  args: { accessKey: v.string(), assetId: v.id("assets") },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const asset = await ctx.db.get(args.assetId);
    const reference = asset ? await ctx.db.get(asset.referenceId) : null;
    if (!asset || !reference || reference.deleted)
      throw new Error("Asset unavailable");
    const rows = await ctx.db
      .query("communityMatches")
      .withIndex("by_asset_id_and_post_id", (q) =>
        q.eq("assetId", args.assetId),
      )
      .take(5);
    return {
      items: await Promise.all(
        rows.slice(0, 4).map((row) => expandCommunity(ctx, row)),
      ),
      truncated: rows.length > 4,
    };
  },
});
