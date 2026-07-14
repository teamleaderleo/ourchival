import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  duplicatePairKey,
  groupExactDuplicates,
  mergeOrganizationIds,
} from "./lib/duplicateGroups";
import { applyReferenceStatsDelta } from "./lib/referenceCatalog";

export const listGroups = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(30, Math.max(1, Math.floor(args.limit ?? 12)));
    const decisions = await ctx.db.query("duplicateDecisions").collect();
    const decidedPairs = new Set(decisions.map((decision) => decision.pairKey));
    const assets: Array<{
      _id: string;
      referenceId: string;
      perceptualHash?: string;
    }> = [];
    let cursor: string | null = null;
    let isDone = false;
    let scanned = 0;

    while (!isDone && scanned < 20_000) {
      const page = await ctx.db
        .query("assets")
        .paginate({ numItems: 512, cursor });
      cursor = page.continueCursor;
      isDone = page.isDone;
      scanned += page.page.length;
      for (const asset of page.page) {
        assets.push({
          _id: String(asset._id),
          referenceId: String(asset.referenceId),
          perceptualHash: asset.perceptualHash,
        });
      }
    }

    const grouped = groupExactDuplicates(assets, decidedPairs);
    const groups = [];
    for (const group of grouped) {
      if (groups.length >= limit) break;
      const references = [];
      for (const referenceId of group.referenceIds.slice(0, 12)) {
        const reference = await ctx.db.get(referenceId as any);
        if (!reference || reference.deleted || reference.archived) continue;
        const referenceAssets = await ctx.db
          .query("assets")
          .withIndex("by_reference", (q) =>
            q.eq("referenceId", reference._id),
          )
          .collect();
        const matchingAsset = referenceAssets.find(
          (asset) =>
            asset.perceptualHash?.toLocaleLowerCase() === group.perceptualHash,
        );
        if (!matchingAsset) continue;
        const snapshot = await ctx.db
          .query("sourceSnapshots")
          .withIndex("by_reference", (q) =>
            q.eq("referenceId", reference._id),
          )
          .order("desc")
          .first();
        const storedUrl = matchingAsset.originalStorageId
          ? await ctx.storage.getUrl(matchingAsset.originalStorageId)
          : null;
        references.push({
          _id: reference._id,
          title: reference.title,
          sourceUrl: reference.sourceUrl,
          platform: reference.platform,
          capturedAt: reference.capturedAt,
          favorite: reference.favorite,
          tagCount: reference.tagIds.length,
          boardCount: reference.boardIds.length,
          previewUrl:
            storedUrl ??
            matchingAsset.driveThumbnailLink ??
            matchingAsset.originalUrl ??
            snapshot?.previewImageUrl ??
            null,
        });
      }
      if (references.length >= 2) {
        groups.push({
          perceptualHash: group.perceptualHash,
          references,
          hiddenCount: Math.max(0, group.referenceIds.length - references.length),
        });
      }
    }

    return {
      groups,
      scanned,
      truncated: !isDone,
    };
  },
});

export const dismissGroup = mutation({
  args: {
    perceptualHash: v.string(),
    referenceIds: v.array(v.id("references")),
  },
  handler: async (ctx, args) => {
    const perceptualHash = normalizeHash(args.perceptualHash);
    const referenceIds = uniqueReferenceIds(args.referenceIds).slice(0, 20);
    if (referenceIds.length < 2) {
      throw new Error("At least two references are required.");
    }
    await assertExactHash(ctx, perceptualHash, referenceIds);

    let recorded = 0;
    for (let left = 0; left < referenceIds.length; left += 1) {
      for (let right = left + 1; right < referenceIds.length; right += 1) {
        await recordDecision(ctx, {
          leftReferenceId: referenceIds[left]!,
          rightReferenceId: referenceIds[right]!,
          perceptualHash,
          status: "dismissed",
        });
        recorded += 1;
      }
    }
    return { recorded };
  },
});

export const mergeGroup = mutation({
  args: {
    perceptualHash: v.string(),
    keepReferenceId: v.id("references"),
    duplicateReferenceIds: v.array(v.id("references")),
  },
  handler: async (ctx, args) => {
    const perceptualHash = normalizeHash(args.perceptualHash);
    const duplicateReferenceIds = uniqueReferenceIds(args.duplicateReferenceIds)
      .filter((referenceId) => referenceId !== args.keepReferenceId)
      .slice(0, 19);
    if (duplicateReferenceIds.length === 0) {
      throw new Error("Choose at least one duplicate to merge.");
    }
    const allReferenceIds = [args.keepReferenceId, ...duplicateReferenceIds];
    await assertExactHash(ctx, perceptualHash, allReferenceIds);

    const keepReference = await ctx.db.get(args.keepReferenceId);
    if (!keepReference || keepReference.deleted) {
      throw new Error("Keeper reference not found.");
    }

    let tagIds = keepReference.tagIds.map(String);
    let boardIds = keepReference.boardIds.map(String);
    let favorite = keepReference.favorite;
    const keptUses = await ctx.db
      .query("projectReferences")
      .withIndex("by_reference", (q) =>
        q.eq("referenceId", keepReference._id),
      )
      .collect();
    const useByProject = new Map(
      keptUses.map((use) => [String(use.projectId), use]),
    );
    let projectsTransferred = 0;
    let merged = 0;

    for (const duplicateReferenceId of duplicateReferenceIds) {
      const duplicate = await ctx.db.get(duplicateReferenceId);
      if (!duplicate || duplicate.deleted) continue;
      tagIds = mergeOrganizationIds(tagIds, duplicate.tagIds.map(String));
      boardIds = mergeOrganizationIds(boardIds, duplicate.boardIds.map(String));
      favorite = favorite || duplicate.favorite;

      const duplicateUses = await ctx.db
        .query("projectReferences")
        .withIndex("by_reference", (q) =>
          q.eq("referenceId", duplicate._id),
        )
        .collect();
      for (const use of duplicateUses) {
        const key = String(use.projectId);
        const existing = useByProject.get(key);
        if (existing) {
          const patch: Record<string, unknown> = {};
          if (!existing.reason && use.reason) patch.reason = use.reason;
          if (!existing.notes && use.notes) patch.notes = use.notes;
          if (Object.keys(patch).length > 0) {
            patch.updatedAt = Date.now();
            await ctx.db.patch(existing._id, patch);
          }
        } else {
          const now = Date.now();
          const useId = await ctx.db.insert("projectReferences", {
            projectId: use.projectId,
            referenceId: keepReference._id,
            ...(use.reason ? { reason: use.reason } : {}),
            ...(use.notes ? { notes: use.notes } : {}),
            createdAt: now,
            updatedAt: now,
          });
          const inserted = await ctx.db.get(useId);
          if (inserted) useByProject.set(key, inserted);
          projectsTransferred += 1;
        }
        await ctx.db.delete(use._id);
      }

      const afterDuplicate = {
        ...duplicate,
        archived: true,
        deleted: true,
        reviewedAt: Date.now(),
      };
      await ctx.db.patch(duplicate._id, {
        archived: true,
        deleted: true,
        reviewedAt: afterDuplicate.reviewedAt,
      });
      await applyReferenceStatsDelta(ctx, duplicate, afterDuplicate);
      await recordDecision(ctx, {
        leftReferenceId: keepReference._id,
        rightReferenceId: duplicate._id,
        perceptualHash,
        status: "merged",
        keptReferenceId: keepReference._id,
      });
      merged += 1;
    }

    await ctx.db.patch(keepReference._id, {
      tagIds: tagIds as any,
      boardIds: boardIds as any,
      favorite,
    });

    return {
      merged,
      projectsTransferred,
      tagCount: tagIds.length,
      boardCount: boardIds.length,
      favorite,
    };
  },
});

async function assertExactHash(
  ctx: any,
  perceptualHash: string,
  referenceIds: any[],
) {
  for (const referenceId of referenceIds) {
    const reference = await ctx.db.get(referenceId);
    if (!reference || reference.deleted) {
      throw new Error("A duplicate reference is missing or already deleted.");
    }
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_reference", (q: any) => q.eq("referenceId", referenceId))
      .collect();
    if (
      !assets.some(
        (asset: any) =>
          asset.perceptualHash?.toLocaleLowerCase() === perceptualHash,
      )
    ) {
      throw new Error("References no longer share the reviewed perceptual hash.");
    }
  }
}

async function recordDecision(
  ctx: any,
  args: {
    leftReferenceId: any;
    rightReferenceId: any;
    perceptualHash: string;
    status: "merged" | "dismissed";
    keptReferenceId?: any;
  },
) {
  const pairKey = duplicatePairKey(
    String(args.leftReferenceId),
    String(args.rightReferenceId),
  );
  const existing = await ctx.db
    .query("duplicateDecisions")
    .withIndex("by_pair_key", (q: any) => q.eq("pairKey", pairKey))
    .unique();
  const [leftReferenceId, rightReferenceId] = [
    args.leftReferenceId,
    args.rightReferenceId,
  ].sort((left, right) => String(left).localeCompare(String(right)));
  const now = Date.now();
  const payload = {
    leftReferenceId,
    rightReferenceId,
    pairKey,
    perceptualHash: args.perceptualHash,
    status: args.status,
    ...(args.keptReferenceId
      ? { keptReferenceId: args.keptReferenceId }
      : {}),
    updatedAt: now,
  };
  if (existing) await ctx.db.patch(existing._id, payload);
  else await ctx.db.insert("duplicateDecisions", { ...payload, createdAt: now });
}

function uniqueReferenceIds(referenceIds: any[]) {
  return Array.from(new Map(referenceIds.map((id) => [String(id), id])).values());
}

function normalizeHash(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!/^[0-9a-f]{16}$/.test(normalized)) {
    throw new Error("Perceptual hash must be 16 hexadecimal characters.");
  }
  return normalized;
}
