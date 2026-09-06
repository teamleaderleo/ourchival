import type { QueryCtx } from "../_generated/server";
import { isArchiveSort } from "../../packages/shared/src/archiveSort";

type Cursor = {
  version: 1;
  scope: string;
  cutoff: number;
  phase: "known" | "unknown";
  cursor: string | null;
};
const prefix = "archive-order-v1:";
export function orderScope(url: URL) {
  const params = new URLSearchParams(url.search);
  params.delete("cursor");
  params.delete("limit");
  params.sort();
  return params.toString();
}
export function decodeOrderCursor(value: string | null, scope: string): Cursor {
  if (!value)
    return {
      version: 1,
      scope,
      cutoff: Date.now(),
      phase: "known",
      cursor: null,
    };
  try {
    if (!value.startsWith(prefix) || value.length > 32000) throw new Error();
    const cursor = JSON.parse(
      decodeURIComponent(value.slice(prefix.length)),
    ) as Cursor;
    if (
      cursor.version !== 1 ||
      cursor.scope !== scope ||
      !Number.isFinite(cursor.cutoff) ||
      !["known", "unknown"].includes(cursor.phase) ||
      !(cursor.cursor === null || typeof cursor.cursor === "string")
    )
      throw new Error();
    return cursor;
  } catch {
    throw new Error(
      "This saved position does not match the current view. Start this view again.",
    );
  }
}
export function encodeOrderCursor(cursor: Cursor) {
  return prefix + encodeURIComponent(JSON.stringify(cursor));
}

/** Database ordering precedes filtering/pagination. Unknown publication dates come last. */
export async function chronologicalPage(
  ctx: QueryCtx,
  url: URL,
  numItems: number,
) {
  const sort = url.searchParams.get("sort");
  if (!isArchiveSort(sort)) throw new Error("Unsupported archive sort.");
  const state = decodeOrderCursor(
    url.searchParams.get("cursor"),
    orderScope(url),
  );
  const direction = sort.endsWith("asc") ? "asc" : "desc";
  const published = sort.startsWith("published");
  const query = published
    ? ctx.db
        .query("references")
        .withIndex("by_published_at", (q) =>
          state.phase === "known"
            ? q.gt("publishedAt", undefined)
            : q.eq("publishedAt", undefined),
        )
    : ctx.db.query("references").withIndex("by_captured_at");
  const page = await query
    .order(direction)
    .paginate({ numItems, cursor: state.cursor });
  const next =
    published && state.phase === "known" && page.isDone
      ? { ...state, phase: "unknown" as const, cursor: null }
      : { ...state, cursor: page.continueCursor };
  const isDone = page.isDone && (!published || state.phase === "unknown");
  return {
    ...page,
    cutoff: state.cutoff,
    startCursor: encodeOrderCursor(state),
    isDone,
    continueCursor: isDone ? "" : encodeOrderCursor(next),
  };
}
