import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOwnerAccess } from "./lib/privateAccess";
import { researchOutcome } from "./lib/missingWorkSchema";
import { researchLinks } from "./lib/researchLinks";

export const list = query({
  args: { accessKey: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const page = await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(48, Math.max(1, args.paginationOpts.numItems)),
      });
    const candidates = await Promise.all(
      page.page.map(async (ref) => {
        if (
          ref.deleted ||
          !["pixiv", "x", "pinterest"].includes(ref.platform) ||
          !["image", "post"].includes(ref.kind)
        )
          return null;
        const [assets, owned] = await Promise.all([
          ctx.db
            .query("assets")
            .withIndex("by_reference", (q) => q.eq("referenceId", ref._id))
            .take(65),
          ctx.db
            .query("artworkPublications")
            .withIndex("by_reference_id", (q) => q.eq("referenceId", ref._id))
            .first(),
        ]);
        if (owned) return null;
        const durable = assets.filter(
          (a) => a.driveFileId || a.originalStorageId,
        );
        const expected = Math.max(0, ...assets.map((a) => a.sourceCount ?? 0));
        if (
          durable.length === assets.length &&
          assets.length > 0 &&
          durable.length >= expected
        )
          return null;
        const lastCheck = await ctx.db
          .query("missingWorkChecks")
          .withIndex("by_reference", (q) => q.eq("referenceId", ref._id))
          .order("desc")
          .first();
        return {
          id: ref._id,
          title: ref.title,
          sourceUrl: ref.sourceUrl,
          platform: ref.platform,
          artist: ref.authorName ?? ref.authorHandle,
          artistUrl: ref.authorUrl,
          durablePages: durable.length,
          expectedPages: expected || null,
          lastOutcome: lastCheck?.outcome ?? null,
        };
      }),
    );
    return {
      items: candidates.filter((x) => x !== null),
      cursor: page.continueCursor,
      done: page.isDone,
      scanned: page.page.length,
    };
  },
});

export const detail = query({
  args: { accessKey: v.string(), referenceId: v.id("references") },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const ref = await ctx.db.get(args.referenceId);
    if (!ref || ref.deleted) throw new Error("Reference unavailable.");
    const [snapshots, checks] = await Promise.all([
      ctx.db
        .query("sourceSnapshots")
        .withIndex("by_reference", (q) => q.eq("referenceId", ref._id))
        .order("desc")
        .take(9),
      ctx.db
        .query("missingWorkChecks")
        .withIndex("by_reference", (q) => q.eq("referenceId", ref._id))
        .order("desc")
        .take(101),
    ]);
    return {
      sourceUrl: ref.sourceUrl,
      title: ref.title,
      artist: ref.authorName ?? ref.authorHandle,
      artistUrl: ref.authorUrl,
      searchLinks: researchLinks(ref.sourceUrl, ref.authorName ?? ref.authorHandle),
      snapshots: snapshots
        .slice(0, 8)
        .map((s) => ({
          title: s.pageTitle,
          description: s.description,
          capturedAt: s.createdAt,
        })),
      moreSnapshots: snapshots.length > 8,
      checks: checks.slice(0, 100),
      moreChecks: checks.length > 100,
    };
  },
});

export const recordCheck = mutation({
  args: {
    accessKey: v.string(),
    referenceId: v.id("references"),
    url: v.string(),
    outcome: researchOutcome,
    evidence: v.string(),
    relationship: v.optional(v.union(v.literal("same_artist"), v.literal("possible_same_image"), v.literal("archived_page"))),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const ref = await ctx.db.get(args.referenceId);
    if (!ref || ref.deleted) throw new Error("Reference unavailable.");
    if (args.url.length > 2048) throw new Error("Use a shorter source URL.");
    const url = new URL(args.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      throw new Error("Use an HTTP or HTTPS source link without credentials.");
    if (
      Array.from(url.searchParams.keys()).some((k) =>
        /token|password|secret|auth|cookie/i.test(k),
      )
    )
      throw new Error("Remove private access parameters from the link.");
    const evidence = args.evidence.trim();
    if (!evidence || evidence.length > 4000)
      throw new Error("Describe the evidence in 1–4000 characters.");
    const previous = await ctx.db
      .query("missingWorkChecks")
      .withIndex("by_reference", (q) => q.eq("referenceId", args.referenceId))
      .order("desc")
      .first();
    if (
      previous?.url === url.href &&
      previous.outcome === args.outcome &&
      previous.relationship === args.relationship &&
      previous.evidence === evidence
    )
      return previous._id;
    // Research is append-only. It never replaces source identity or claims image recovery.
    return await ctx.db.insert("missingWorkChecks", {
      referenceId: args.referenceId,
      url: url.href,
      outcome: args.outcome,
      evidence,
      ...(args.relationship ? { relationship: args.relationship } : {}),
      createdAt: Date.now(),
    });
  },
});
