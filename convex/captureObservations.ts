import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const observationStatus = v.union(
  v.literal("discovered"),
  v.literal("rendered"),
  v.literal("archived"),
  v.literal("failed"),
);

export const record = internalMutation({
  args: {
    sessionKey: v.string(),
    source: v.string(),
    observations: v.array(
      v.object({
        providerId: v.string(),
        sourceUrl: v.optional(v.string()),
        status: observationStatus,
        error: v.optional(v.string()),
        observedAt: v.number(),
      }),
    ),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    let discoveredDelta = 0;
    let renderedDelta = 0;
    let archivedDelta = 0;

    for (const observation of args.observations) {
      const existing = await ctx.db
        .query("captureObservations")
        .withIndex("by_session_key_and_provider_id", (q) =>
          q
            .eq("sessionKey", args.sessionKey)
            .eq("providerId", observation.providerId),
        )
        .unique();
      const nextStatus = advanceObservationStatus(
        existing?.status,
        observation.status,
      );

      if (!existing) {
        discoveredDelta += 1;
        if (isRendered(nextStatus)) renderedDelta += 1;
        if (nextStatus === "archived") archivedDelta += 1;
        await ctx.db.insert("captureObservations", {
          sessionKey: args.sessionKey,
          source: args.source,
          providerId: observation.providerId,
          ...(observation.sourceUrl
            ? { sourceUrl: observation.sourceUrl }
            : {}),
          status: nextStatus,
          ...(nextStatus === "failed" && observation.error
            ? { error: observation.error }
            : {}),
          discoveredAt: observation.observedAt,
          ...(isRendered(nextStatus)
            ? { renderedAt: observation.observedAt }
            : {}),
          ...(nextStatus === "archived"
            ? { archivedAt: observation.observedAt }
            : {}),
          updatedAt: args.updatedAt,
        });
        continue;
      }

      if (!isRendered(existing.status) && isRendered(nextStatus)) {
        renderedDelta += 1;
      }
      if (existing.status !== "archived" && nextStatus === "archived") {
        archivedDelta += 1;
      }
      await ctx.db.patch(existing._id, {
        ...(observation.sourceUrl && !existing.sourceUrl
          ? { sourceUrl: observation.sourceUrl }
          : {}),
        status: nextStatus,
        ...(isRendered(nextStatus) && !existing.renderedAt
          ? { renderedAt: observation.observedAt }
          : {}),
        ...(nextStatus === "archived" && !existing.archivedAt
          ? { archivedAt: observation.observedAt }
          : {}),
        error:
          nextStatus === "failed"
            ? (observation.error ?? existing.error)
            : undefined,
        updatedAt: args.updatedAt,
      });
    }

    let session = await ctx.db
      .query("captureSessions")
      .withIndex("by_session_key", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    if (!session) {
      const sessionId = await ctx.db.insert("captureSessions", {
        sessionKey: args.sessionKey,
        source: args.source,
        kind: "import",
        expectedCount: 0,
        completedCount: 0,
        savedCount: 0,
        duplicateCount: 0,
        skippedCount: 0,
        failedCount: 0,
        discoveredCount: 0,
        renderedCount: 0,
        archivedCount: 0,
        status: "running",
        reviewState: "unreviewed",
        startedAt: args.updatedAt,
        createdAt: args.updatedAt,
        updatedAt: args.updatedAt,
      });
      session = await ctx.db.get(sessionId);
    }
    if (!session) throw new Error("Could not create capture session.");

    const discoveredCount = (session.discoveredCount ?? 0) + discoveredDelta;
    const renderedCount = (session.renderedCount ?? 0) + renderedDelta;
    const archivedCount = (session.archivedCount ?? 0) + archivedDelta;
    await ctx.db.patch(session._id, {
      discoveredCount,
      renderedCount,
      archivedCount,
      updatedAt: args.updatedAt,
    });
    return receipt(discoveredCount, renderedCount, archivedCount);
  },
});

export const listGaps = internalQuery({
  args: {
    sessionKey: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(400, Math.max(1, Math.floor(args.limit)));
    const [discovered, rendered, failed] = await Promise.all([
      ctx.db
        .query("captureObservations")
        .withIndex("by_session_key_and_status", (q) =>
          q.eq("sessionKey", args.sessionKey).eq("status", "discovered"),
        )
        .take(limit),
      ctx.db
        .query("captureObservations")
        .withIndex("by_session_key_and_status", (q) =>
          q.eq("sessionKey", args.sessionKey).eq("status", "rendered"),
        )
        .take(limit),
      ctx.db
        .query("captureObservations")
        .withIndex("by_session_key_and_status", (q) =>
          q.eq("sessionKey", args.sessionKey).eq("status", "failed"),
        )
        .take(limit),
    ]);
    return [...discovered, ...rendered, ...failed]
      .sort((left, right) => left.discoveredAt - right.discoveredAt)
      .slice(0, limit)
      .map((item) => ({
        providerId: item.providerId,
        sourceUrl: item.sourceUrl,
        status: item.status,
        error: item.error,
        discoveredAt: item.discoveredAt,
        updatedAt: item.updatedAt,
      }));
  },
});

function advanceObservationStatus(
  current: "discovered" | "rendered" | "archived" | "failed" | undefined,
  incoming: "discovered" | "rendered" | "archived" | "failed",
) {
  if (!current) return incoming;
  const rank = { discovered: 0, rendered: 1, failed: 2, archived: 3 } as const;
  return rank[incoming] > rank[current] ? incoming : current;
}

function isRendered(status: "discovered" | "rendered" | "archived" | "failed") {
  return status !== "discovered";
}

function receipt(discovered: number, rendered: number, archived: number) {
  const networkMissingInDom = Math.max(0, discovered - rendered);
  const domMissingInVault = Math.max(0, rendered - archived);
  return {
    status:
      networkMissingInDom || domMissingInVault
        ? ("gaps" as const)
        : ("verified" as const),
    networkPosts: discovered,
    observedPosts: rendered,
    vaultPosts: archived,
    networkMissingInDom,
    domMissingInVault,
  };
}
