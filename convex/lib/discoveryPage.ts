import type { QueryCtx } from "../_generated/server";
import { discoveryFacet } from "../../packages/shared/src/discoveryFilter";
import { isArchiveSort } from "../../packages/shared/src/archiveSort";
import { decodeOrderCursor, encodeOrderCursor, orderScope } from "./archiveOrder";

export async function discoveryPage(ctx: QueryCtx, url: URL, numItems: number) {
  const raw = discoveryFacet(url.searchParams.get("query") ?? "");
  const facetId = ctx.db.normalizeId("archiveFacets", raw);
  if (!facetId) throw new Error("This artist or tag filter is no longer valid. Clear it and choose again.");
  const sort = url.searchParams.get("sort") || "saved-desc";
  if (!isArchiveSort(sort)) throw new Error("Unsupported archive sort.");
  const state = decodeOrderCursor(url.searchParams.get("cursor"), orderScope(url));
  const published = sort.startsWith("published");
  const rows = published
    ? ctx.db.query("archiveFacetMembers").withIndex("by_facet_id_and_published_at", q => state.phase === "known"
      ? q.eq("facetId", facetId).gt("publishedAt", undefined)
      : q.eq("facetId", facetId).eq("publishedAt", undefined))
    : ctx.db.query("archiveFacetMembers").withIndex("by_facet_id_and_captured_at", q => q.eq("facetId", facetId));
  const page = await rows.order(sort.endsWith("asc") ? "asc" : "desc").paginate({ cursor: state.cursor, numItems });
  const next = published && state.phase === "known" && page.isDone
    ? { ...state, phase: "unknown" as const, cursor: null }
    : { ...state, cursor: page.continueCursor };
  const isDone = page.isDone && (!published || state.phase === "unknown");
  const references = await Promise.all(page.page.map(member => ctx.db.get(member.referenceId)));
  return { page: references.filter((ref): ref is NonNullable<typeof ref> => ref !== null),
    cutoff: state.cutoff, startCursor: encodeOrderCursor(state), isDone,
    continueCursor: isDone ? "" : encodeOrderCursor(next) };
}
