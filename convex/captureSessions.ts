import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOwnerAccess } from "./lib/privateAccess";
import { applyReferenceStatsDelta } from "./lib/referenceCatalog";
import {
  captureSessionReviewPatch,
  isPendingCaptureSessionReference,
} from "./lib/captureSessionReview";

const reviewState = v.union(
  v.literal("unreviewed"),
  v.literal("reviewing"),
  v.literal("completed"),
  v.literal("deferred"),
);

const reviewDestination = v.union(
  v.literal("inbox"),
  v.literal("keep"),
  v.literal("later"),
  v.literal("archive"),
  v.literal("trash"),
);

export const listRecent = query({
  args: {
    accessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 24)));
    return await ctx.db
      .query("captureSessions")
      .withIndex("by_updated_at")
      .order("desc")
      .take(limit);
  },
});

export const syncRecent = mutation({
  args: {
    accessKey: v.string(),
    referenceLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const referenceLimit = Math.min(
      10_000,
      Math.max(1, Math.floor(args.referenceLimit ?? 4096)),
    );
    const references = await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .order("desc")
      .take(referenceLimit);
    const grouped = new Map<string, any[]>();

    for (const reference of references) {
      if (!reference.captureSessionId || reference.deleted) continue;
      const items = grouped.get(reference.captureSessionId) ?? [];
      items.push(reference);
      grouped.set(reference.captureSessionId, items);
    }

    let created = 0;
    let updated = 0;
    for (const [sessionKey, items] of grouped) {
      const existing = await ctx.db
        .query("captureSessions")
        .withIndex("by_session_key", (q) => q.eq("sessionKey", sessionKey))
        .unique();
      const inferred = inferSession(items);
      const startedAt = Math.min(...items.map((item) => item.capturedAt));
      const completedAt = Math.max(...items.map((item) => item.capturedAt));
      const patch = {
        source: existing?.source ?? inferred.source,
        kind: existing?.kind ?? inferred.kind,
        label: existing?.label ?? inferred.label,
        sourceUrl: existing?.sourceUrl ?? inferred.sourceUrl,
        expectedCount: Math.max(existing?.expectedCount ?? 0, items.length),
        completedCount: Math.max(existing?.completedCount ?? 0, items.length),
        savedCount: Math.max(existing?.savedCount ?? 0, items.length),
        duplicateCount: existing?.duplicateCount ?? 0,
        skippedCount: existing?.skippedCount ?? 0,
        failedCount: existing?.failedCount ?? 0,
        status: existing?.status === "running" ? "running" : "completed" as const,
        reviewState: existing?.reviewState ?? "unreviewed" as const,
        startedAt: existing?.startedAt ?? startedAt,
        completedAt: existing?.completedAt ?? completedAt,
        updatedAt: Date.now(),
      };

      if (existing) {
        await ctx.db.patch(existing._id, patch);
        updated += 1;
      } else {
        await ctx.db.insert("captureSessions", {
          sessionKey,
          ...patch,
          createdAt: Date.now(),
        });
        created += 1;
      }
    }

    return { created, updated, scanned: references.length };
  },
});

export const getReferences = query({
  args: {
    accessKey: v.string(),
    sessionKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const limit = Math.min(500, Math.max(1, Math.floor(args.limit ?? 200)));
    const references = await ctx.db
      .query("references")
      .withIndex("by_capture_session", (q) => q.eq("captureSessionId", args.sessionKey))
      .order("desc")
      .take(limit);

    return await Promise.all(
      references.map(async (reference) => {
        const [snapshot, asset] = await Promise.all([
          ctx.db
            .query("sourceSnapshots")
            .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
            .order("desc")
            .first(),
          ctx.db
            .query("assets")
            .withIndex("by_reference", (q) => q.eq("referenceId", reference._id))
            .first(),
        ]);
        const [thumbUrl, previewUrl, originalStorageUrl] = await Promise.all([
          asset?.thumbStorageId ? ctx.storage.getUrl(asset.thumbStorageId) : null,
          asset?.previewStorageId ? ctx.storage.getUrl(asset.previewStorageId) : null,
          asset?.originalStorageId ? ctx.storage.getUrl(asset.originalStorageId) : null,
        ]);

        return {
          _id: reference._id,
          kind: reference.kind,
          title: reference.title,
          sourceUrl: reference.sourceUrl,
          authorName: reference.authorName,
          authorHandle: reference.authorHandle,
          capturedAt: reference.capturedAt,
          triageState: reference.triageState,
          reviewedAt: reference.reviewedAt,
          archived: reference.archived,
          deleted: reference.deleted,
          favorite: reference.favorite,
          previewUrl:
            thumbUrl ??
            previewUrl ??
            originalStorageUrl ??
            asset?.driveThumbnailLink ??
            asset?.originalUrl ??
            snapshot?.previewImageUrl ??
            null,
          description: snapshot?.description ?? snapshot?.postText ?? null,
          siteName: snapshot?.siteName ?? null,
        };
      }),
    );
  },
});

export const reviewReference = mutation({
  args: {
    accessKey: v.string(),
    sessionKey: v.string(),
    referenceId: v.id("references"),
    destination: v.optional(reviewDestination),
    favorite: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    if (!args.destination && typeof args.favorite !== "boolean") {
      throw new Error("Choose a review destination or favorite state.");
    }

    const reference = await ctx.db.get(args.referenceId);
    if (!reference || reference.captureSessionId !== args.sessionKey) {
      throw new Error("Capture session reference not found.");
    }

    const patch = {
      ...(args.destination
        ? captureSessionReviewPatch(args.destination, Date.now())
        : {}),
      ...(typeof args.favorite === "boolean" ? { favorite: args.favorite } : {}),
    };
    const updated = { ...reference, ...patch };
    await ctx.db.patch(reference._id, patch);
    await applyReferenceStatsDelta(ctx, reference, updated);

    const sessionReferences = await ctx.db
      .query("references")
      .withIndex("by_capture_session", (q) => q.eq("captureSessionId", args.sessionKey))
      .collect();
    const remainingCount = sessionReferences.filter((item) =>
      isPendingCaptureSessionReference(item._id === reference._id ? updated : item),
    ).length;

    const session = await ctx.db
      .query("captureSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    let nextReviewState = session?.reviewState ?? "unreviewed";
    if (args.destination) {
      nextReviewState = remainingCount === 0 ? "completed" : "reviewing";
      if (session && session.reviewState !== nextReviewState) {
        await ctx.db.patch(session._id, {
          reviewState: nextReviewState,
          updatedAt: Date.now(),
        });
      }
    }

    return {
      reference: {
        _id: updated._id,
        triageState: updated.triageState,
        reviewedAt: updated.reviewedAt,
        archived: updated.archived,
        deleted: updated.deleted,
        favorite: updated.favorite,
      },
      remainingCount,
      reviewState: nextReviewState,
    };
  },
});

export const setReviewState = mutation({
  args: {
    accessKey: v.string(),
    sessionId: v.id("captureSessions"),
    reviewState,
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Capture session not found.");
    await ctx.db.patch(session._id, {
      reviewState: args.reviewState,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(session._id);
  },
});

function inferSession(items: any[]) {
  const sourceUrls = new Set(items.map((item) => item.sourceUrl));
  const imageLike = items.every(
    (item) => item.kind === "image" || item.kind === "post",
  );
  const kind = imageLike && sourceUrls.size === 1 ? "bundle" as const : "import" as const;
  const first = items[0];
  const creator = first.authorHandle || first.authorName;
  const label =
    kind === "bundle"
      ? creator
        ? `${creator} · ${items.length} images`
        : `${first.title || domainLabel(first.sourceUrl)} · ${items.length} images`
      : `${items.length} imported references`;

  return {
    kind,
    source: kind === "bundle" ? first.platform || "bundle" : "import",
    label,
    sourceUrl: kind === "bundle" ? first.sourceUrl : undefined,
  };
}

function domainLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Captured bundle";
  }
}
