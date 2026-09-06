import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { normalizeSourceUrl } from "./lib/urls";
import { applyReferenceStatsDelta } from "./lib/referenceCatalog";

/** Restore link-only rows from an owner-held export without overwriting local work. */
export const restoreLinks = internalMutation({
  args: {
    rows: v.array(
      v.object({ reference: v.any(), snapshots: v.array(v.any()) }),
    ),
  },
  handler: async (ctx, { rows }) => {
    if (rows.length > 20)
      throw new Error("Restore at most 20 links per batch.");
    const receipt = [];
    for (const { reference, snapshots } of rows) {
      if (
        reference.kind !== "link" ||
        reference.tagIds?.length ||
        reference.boardIds?.length ||
        snapshots.length > 10
      )
        throw new Error("Expected an unassigned link-only export.");
      const canonicalUrl = normalizeSourceUrl(reference.sourceUrl);
      const existing =
        (await ctx.db
          .query("references")
          .withIndex("by_canonical_url", (q) =>
            q.eq("canonicalUrl", canonicalUrl),
          )
          .first()) ??
        (await ctx.db
          .query("references")
          .withIndex("by_source_url", (q) =>
            q.eq("sourceUrl", reference.sourceUrl),
          )
          .first());
      if (existing) {
        receipt.push({
          sourceId: reference._id,
          referenceId: existing._id,
          restored: false,
        });
        continue;
      }
      const { _id, _creationTime, captureSessionId, ...fields } = reference;
      const referenceId = await ctx.db.insert("references", {
        ...fields,
        canonicalUrl,
        browseLane: "links",
        boardIds: [],
        tagIds: [],
      });
      for (const snapshot of snapshots) {
        const {
          _id: oldId,
          _creationTime: oldCreated,
          referenceId: oldReference,
          ...payload
        } = snapshot;
        await ctx.db.insert("sourceSnapshots", { ...payload, referenceId });
      }
      await applyReferenceStatsDelta(ctx, null, await ctx.db.get(referenceId));
      receipt.push({ sourceId: _id, referenceId, restored: true });
    }
    return receipt;
  },
});

/** Idempotent bounded backfill. The caller persists the returned cursor. */
export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("references")
      .paginate({ cursor, numItems: 200 });
    let changed = 0;
    let links = 0;
    for (const reference of page.page) {
      const browseLane = ["link", "article", "page"].includes(reference.kind)
        ? ("links" as const)
        : ("images" as const);
      if (browseLane === "links") links++;
      if (reference.browseLane !== browseLane) {
        await ctx.db.patch(reference._id, { browseLane });
        changed++;
      }
    }
    return {
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
      observed: page.page.length,
      changed,
      links,
    };
  },
});
