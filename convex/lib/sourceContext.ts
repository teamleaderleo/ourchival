import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export const sourceTextFields = [
  "pageTitle",
  "postText",
  "altText",
  "selectedText",
  "description",
  "siteName",
  "pageAuthor",
  "canonicalUrl",
  "contentType",
] as const;
export type SourceFieldOrigin = {
  snapshotId: Id<"sourceSnapshots">;
  capturedAt: number;
};

/** A display/search view; raw capture and refresh snapshots remain immutable. */
export function composeSourceContext(
  original: Doc<"sourceSnapshots"> | null,
  latest: Doc<"sourceSnapshots"> | null,
) {
  if (!latest) return null;
  const fields: Partial<Record<(typeof sourceTextFields)[number], string>> = {};
  const fieldSources: Record<string, SourceFieldOrigin> = {};
  for (const key of sourceTextFields) {
    const chosen = latest[key]?.trim()
      ? latest
      : original?.[key]?.trim()
        ? original
        : null;
    if (!chosen) continue;
    fields[key] = chosen[key]!;
    fieldSources[key] = chosen.inheritedFields?.[key] ?? {
      snapshotId: chosen._id,
      capturedAt: chosen.createdAt,
    };
  }
  return { ...latest, ...fields, fieldSources };
}

export async function getSourceContext(
  ctx: Pick<QueryCtx, "db">,
  referenceId: Id<"references">,
) {
  const source = () =>
    ctx.db
      .query("sourceSnapshots")
      .withIndex("by_reference", (q) => q.eq("referenceId", referenceId));
  const [original, latest] = await Promise.all([
    source().order("asc").first(),
    source().order("desc").first(),
  ]);
  return composeSourceContext(original, latest);
}
