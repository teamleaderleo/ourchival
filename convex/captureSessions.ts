import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hashSecret, requireOwnerAccess } from "./lib/privateAccess";
import { applyReferenceStatsDelta } from "./lib/referenceCatalog";
import {
  captureSessionReviewPatch,
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

const sessionKind = v.union(v.literal("bundle"), v.literal("import"));
const sessionStatus = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("interrupted"),
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

export const reportFromClipper = mutation({
  args: {
    deviceToken: v.string(),
    sessionKey: v.string(),
    source: v.string(),
    kind: sessionKind,
    label: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    expectedCount: v.number(),
    completedCount: v.number(),
    savedCount: v.number(),
    duplicateCount: v.number(),
    skippedCount: v.number(),
    failedCount: v.number(),
    status: sessionStatus,
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deviceToken = args.deviceToken.trim();
    if (!deviceToken) throw new Error("Clipper device token is required.");
    const tokenHash = await hashSecret(deviceToken);
    const device = await ctx.db
      .query("clipperDevices")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!device) throw new Error("This Clipper credential is invalid.");
    if (device.revokedAt) throw new Error("This Clipper was revoked.");

    const sessionKey = cleanReportText(args.sessionKey, 160);
    if (!sessionKey) throw new Error("Capture session key is required.");
    const source = cleanReportText(args.source, 80) || "import";
    const label = cleanReportText(args.label, 240);
    const sourceUrl = cleanReportText(args.sourceUrl, 2_048);
    const now = Date.now();
    const startedAt = validTimestamp(args.startedAt) ?? now;
    const completedAt = validTimestamp(args.completedAt);
    const existing = await ctx.db
      .query("captureSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", sessionKey))
      .unique();
    const status =
      existing?.status === "completed" && args.status === "running"
        ? "completed"
        : args.status;
    const patch = {
      source,
      kind: args.kind,
      ...(label ? { label } : existing?.label ? { label: existing.label } : {}),
      ...(sourceUrl
        ? { sourceUrl }
        : existing?.sourceUrl
          ? { sourceUrl: existing.sourceUrl }
          : {}),
      expectedCount: Math.max(
        existing?.expectedCount ?? 0,
        boundedCount(args.expectedCount),
      ),
      completedCount: Math.max(
        existing?.completedCount ?? 0,
        boundedCount(args.completedCount),
      ),
      savedCount: Math.max(existing?.savedCount ?? 0, boundedCount(args.savedCount)),
      duplicateCount: Math.max(
        existing?.duplicateCount ?? 0,
        boundedCount(args.duplicateCount),
      ),
      skippedCount: Math.max(
        existing?.skippedCount ?? 0,
        boundedCount(args.skippedCount),
      ),
      failedCount: Math.max(existing?.failedCount ?? 0, boundedCount(args.failedCount)),
      status,
      reviewState: existing?.reviewState ?? "unreviewed" as const,
      startedAt: Math.min(existing?.startedAt ?? startedAt, startedAt),
      ...((status === "completed" || status === "interrupted")
        ? { completedAt: completedAt ?? existing?.completedAt ?? now }
        : existing?.completedAt
          ? { completedAt: existing.completedAt }
          : {}),
      updatedAt: now,
    };

    let sessionId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      sessionId = await ctx.db.insert("captureSessions", {
        sessionKey,
        ...patch,
        createdAt: now,
      });
    }
    await ctx.db.patch(device._id, { lastUsedAt: now });
    return { sessionId: sessionId!, created: !existing };
  },
});

export const getReferences = query({
  args: {
    accessKey: v.string(),
    sessionKey: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const limit = Math.min(200, Math.max(1, Math.floor(args.limit ?? 96)));
    const page = await ctx.db
      .query("references")
      .withIndex("by_capture_session", (q) => q.eq("captureSessionId", args.sessionKey))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: limit });

    const references = await Promise.all(
      page.page.map(async (reference) => {
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

    return {
      references,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
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

    const remainingReference = args.destination
      ? await ctx.db
          .query("references")
          .withIndex("by_capture_session", (q) =>
            q.eq("captureSessionId", args.sessionKey),
          )
          .filter((q) =>
            q.and(
              q.eq(q.field("triageState"), "inbox"),
              q.eq(q.field("archived"), false),
              q.eq(q.field("deleted"), false),
            ),
          )
          .first()
      : undefined;
    const hasRemaining = Boolean(remainingReference);

    const session = await ctx.db
      .query("captureSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    let nextReviewState = session?.reviewState ?? "unreviewed";
    if (args.destination) {
      nextReviewState = hasRemaining ? "reviewing" : "completed";
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
      hasRemaining,
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

function boundedCount(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1_000_000, Math.max(0, Math.floor(value)));
}

function validTimestamp(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function cleanReportText(value: string | undefined, maxLength: number) {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function domainLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Captured bundle";
  }
}
