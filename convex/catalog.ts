import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOwnerAccess } from "./lib/privateAccess";
import {
  catalogFields,
  defaultCatalogFields,
  projectCatalogRow,
  type CatalogField,
} from "./lib/catalogProjection";

export const find = query({
  args: {
    accessKey: v.string(),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    fields: v.optional(v.array(v.string())),
    sessionKey: v.optional(v.string()),
    platform: v.optional(v.string()),
    collection: v.optional(
      v.union(
        v.literal("inbox"),
        v.literal("library"),
        v.literal("later"),
        v.literal("archive"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(args.accessKey);
    const limit = args.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new Error("Choose a page size from 1 to 50.");
    const fields = args.fields ?? defaultCatalogFields;
    if (
      fields.length > catalogFields.length ||
      fields.some((field) => !catalogFields.includes(field as CatalogField))
    ) {
      throw new Error("Unknown or excessive catalog fields.");
    }
    if (
      (args.sessionKey?.length ?? 0) > 256 ||
      (args.platform?.length ?? 0) > 32
    )
      throw new Error("Filter is too long.");
    const filters = {
      sessionKey: args.sessionKey || null,
      platform: args.platform || null,
      collection: args.collection ?? null,
    };
    const selectedFields = catalogFields.filter((field) =>
      fields.includes(field),
    );
    const signature = JSON.stringify({ filters, fields: selectedFields });
    let cursor: string | null = null;
    if (args.cursor) {
      if (args.cursor.length > 16384)
        throw new Error("Invalid catalog cursor.");
      let envelope;
      try {
        envelope = JSON.parse(args.cursor);
      } catch {
        throw new Error("Invalid catalog cursor.");
      }
      if (
        envelope?.version !== 1 ||
        envelope.signature !== signature ||
        typeof envelope.cursor !== "string"
      ) {
        throw new Error("Filters changed. Start a new catalog query.");
      }
      cursor = envelope.cursor;
    }
    const scan = filters.sessionKey
      ? ctx.db
          .query("references")
          .withIndex("by_capture_session", (q) =>
            q.eq("captureSessionId", filters.sessionKey!),
          )
      : ctx.db.query("references").withIndex("by_captured_at");
    // Filter one bounded scan page in memory. Empty pages may still have a cursor.
    const page = await scan
      .order("desc")
      .paginate({ numItems: limit, cursor, maximumRowsRead: 50 });
    const rows = page.page
      .filter((reference) => {
        if (
          reference.deleted ||
          (filters.platform && reference.platform !== filters.platform)
        )
          return false;
        if (!filters.collection) return true;
        if (filters.collection === "archive") return reference.archived;
        if (reference.archived) return false;
        return (
          (reference.triageState ?? "inbox") ===
          ({ inbox: "inbox", library: "kept", later: "later" } as const)[
            filters.collection
          ]
        );
      })
      .map((reference) => projectCatalogRow(reference, selectedFields));
    return {
      schemaVersion: 1,
      mode: "live-projection" as const,
      filters,
      fields: selectedFields,
      rows,
      scanned: page.page.length,
      returned: rows.length,
      hasMore: !page.isDone,
      nextCursor: page.isDone
        ? null
        : JSON.stringify({
            version: 1,
            signature,
            cursor: page.continueCursor,
          }),
    };
  },
});
