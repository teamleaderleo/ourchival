import { visualResultCurrent } from "./visualMetadata";
import { refreshDiscoveryReference } from "./discoveryIndex";
import { expandVisual } from "./compactVisual";
import { communityForSearch } from "./communityMetadata";
import { getSourceContext } from "./sourceContext";
import { internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";
import {
  buildSearchDocument,
  collectionOf,
  laneOf,
  indexQuery,
  searchMatchReasons,
  type VisualSearchInput,
  type SearchMatch,
} from "./searchDocument";

/**
 * Request a search refresh, coalescing with a refresh that has not started yet.
 *
 * The marker row is deleted in the same transaction as the refresh runs, so a
 * write that commits after the refresh starts finds no marker and schedules
 * another one; a write that commits before it is seen by the refresh (Convex
 * mutations are serializable). A marker whose job is no longer pending or
 * running (failed, canceled, missing) is treated as stale and replaced.
 */
export async function scheduleReferenceSearch(
  ctx: MutationCtx,
  referenceId: Id<"references">,
): Promise<void> {
  const marker = await ctx.db
    .query("referenceSearchRefreshes")
    .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
    .first();
  if (marker) {
    const job = await ctx.db.system.get(marker.jobId);
    if (
      job &&
      (job.state.kind === "pending" || job.state.kind === "inProgress")
    )
      return;
  }
  const jobId = await ctx.scheduler.runAfter(
    0,
    internal.archiveSearch.refreshReference,
    { referenceId },
  );
  const payload = { referenceId, jobId, scheduledAt: Date.now() };
  if (marker) await ctx.db.replace(marker._id, payload);
  else await ctx.db.insert("referenceSearchRefreshes", payload);
}

/** Clear the pending-refresh marker so later writes schedule a new refresh. */
export async function clearReferenceSearchMarker(
  ctx: MutationCtx,
  referenceId: Id<"references">,
): Promise<void> {
  const markers = await ctx.db
    .query("referenceSearchRefreshes")
    .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
    .take(8);
  for (const marker of markers) await ctx.db.delete(marker._id);
}

type SearchDocumentPayload = Omit<
  Doc<"referenceSearchDocuments">,
  "_id" | "_creationTime"
>;

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }
  if (typeof a !== "object" || Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set(
    [...Object.keys(left), ...Object.keys(right)].filter(
      (key) => left[key] !== undefined || right[key] !== undefined,
    ),
  );
  for (const key of keys) if (!sameValue(left[key], right[key])) return false;
  return true;
}

/** Compare search content, ignoring system fields and the indexedAt stamp. */
export function sameSearchDocument(
  existing: Doc<"referenceSearchDocuments">,
  next: SearchDocumentPayload,
): boolean {
  // sameValue skips undefined keys, so blanking a field excludes it.
  const ignored = {
    _id: undefined,
    _creationTime: undefined,
    indexedAt: undefined,
  };
  return sameValue({ ...existing, ...ignored }, { ...next, ...ignored });
}

export async function refreshReferenceSearch(
  ctx: MutationCtx,
  referenceId: Id<"references">,
): Promise<void> {
  await refreshDiscoveryReference(ctx, referenceId);
  const [reference, existing] = await Promise.all([
    ctx.db.get(referenceId),
    ctx.db
      .query("referenceSearchDocuments")
      .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
      .unique(),
  ]);
  if (!reference) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  const [snapshot, tags, boards, uses, visualRows, assets] = await Promise.all([
    getSourceContext(ctx, referenceId),
    Promise.all(reference.tagIds.slice(0, 64).map((id) => ctx.db.get(id))),
    Promise.all(reference.boardIds.slice(0, 32).map((id) => ctx.db.get(id))),
    ctx.db
      .query("projectReferences")
      .withIndex("by_reference", (q) => q.eq("referenceId", referenceId))
      .take(33),
    ctx.db
      .query("visualEnrichments")
      .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
      .take(33),
    ctx.db
      .query("assets")
      .withIndex("by_reference", (q) => q.eq("referenceId", referenceId))
      .take(33),
  ]);
  const hydratedUses = await Promise.all(
    uses.slice(0, 32).map(async (use) => ({
      ...use,
      project: await ctx.db.get(use.projectId),
    })),
  );
  const assetTagIds = [
    ...new Set(assets.slice(0, 32).flatMap((asset) => asset.tagIds ?? [])),
  ];
  const assetTags = await Promise.all(
    assetTagIds.slice(0, 64).map((id) => ctx.db.get(id)),
  );
  const assetTagMap = new Map(
    assetTags
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map((t) => [t._id, t]),
  );
  const visual: VisualSearchInput[] = [];
  for (const row of visualRows.slice(0, 32)) {
    const [asset, correction] = await Promise.all([
      ctx.db.get(row.assetId),
      ctx.db
        .query("visualCorrections")
        .withIndex("by_asset_id", (q) => q.eq("assetId", row.assetId))
        .unique(),
    ]);
    if (!asset || !visualResultCurrent(asset, row)) continue;
    visual.push({
      assetId: String(row.assetId),
      tags: (await expandVisual(ctx, row)).tags,
      ocrText: row.ocrText,
      caption: row.caption,
      rejectedTags: correction?.rejectedTags,
      hideOcr: correction?.hideOcr,
      hideCaption: correction?.hideCaption,
    });
  }
  const community = await communityForSearch(ctx, referenceId);
  const document = buildSearchDocument(reference, snapshot, {
    community: community.items,
    tags: tags.filter((t): t is NonNullable<typeof t> => t !== null),
    boards: boards.filter((b): b is NonNullable<typeof b> => b !== null),
    uses: hydratedUses,
    visual,
    assets: assets.slice(0, 32).map((asset) => ({
      assetId: String(asset._id),
      notes: asset.notes,
      altText: asset.altText,
      tags: (asset.tagIds ?? [])
        .slice(0, 64)
        .flatMap((id) => (assetTagMap.has(id) ? [assetTagMap.get(id)!] : [])),
    })),
  });
  const payload: SearchDocumentPayload = {
    referenceId,
    ...document,
    collection: collectionOf(reference),
    lane: laneOf(reference.kind),
    favorite: reference.favorite,
    kind: reference.kind,
    indexedAt: Date.now(),
    truncated:
      document.truncated ||
      community.truncated ||
      reference.tagIds.length > 64 ||
      reference.boardIds.length > 32 ||
      uses.length > 32 ||
      visualRows.length > 32 ||
      assets.length > 32 ||
      assetTagIds.length > 64,
  };
  if (existing) {
    // Rebuilding an unchanged reference must not rewrite the search document.
    if (!sameSearchDocument(existing, payload))
      await ctx.db.replace(existing._id, payload);
  } else await ctx.db.insert("referenceSearchDocuments", payload);
}

/** Rare board/project renames request a coalesced, paginated rebuild. */
export async function startSearchRebuild(
  ctx: MutationCtx,
  restart = false,
): Promise<number> {
  const state = await ctx.db
    .query("referenceSearchState")
    .withIndex("by_key", (q) => q.eq("key", "catalog-v1"))
    .unique();
  if (
    state?.rebuilding &&
    !restart &&
    Date.now() - state.updatedAt < 30 * 60_000
  ) {
    await ctx.db.patch(state._id, { dirty: true });
    return state.generation;
  }
  const generation = (state?.generation ?? 0) + 1;
  const payload = {
    key: "catalog-v1",
    generation,
    ready: state?.ready ?? false,
    rebuilding: true,
    dirty: false,
    updatedAt: Date.now(),
  };
  if (state) await ctx.db.replace(state._id, payload);
  else await ctx.db.insert("referenceSearchState", payload);
  await ctx.scheduler.runAfter(0, internal.archiveSearch.rebuildPage, {
    generation,
    cursor: null,
  });
  return generation;
}

const cursorPrefix = "ourchival-index-v1:";
type SearchOptions = {
  includeUnreviewed?: boolean;
  query: string;
  collection: string;
  lane: string;
  favoritesOnly: boolean;
  sourceType: string;
  domain: string;
  tagSlug: string;
  boardId: string;
  projectId: string;
  pageSize: number;
  cursor: string | null;
};
/** Preserve full-text matching (including machine terms) during a chronological scan. */
export async function chronologicalSearchMatches(
  ctx: QueryCtx,
  referenceId: Id<"references">,
  query: string,
): Promise<SearchMatch[] | null> {
  const text = indexQuery(query);
  if (!text) return [];
  const rows = await ctx.db
    .query("referenceSearchDocuments")
    .withSearchIndex("search_text", (q) =>
      q.search("text", text).eq("referenceId", referenceId),
    )
    .take(1);
  if (rows[0]) return searchMatchReasons(rows[0].fields, text);
  const existing = await ctx.db
    .query("referenceSearchDocuments")
    .withIndex("by_reference_id", (q) => q.eq("referenceId", referenceId))
    .unique();
  // Legacy rows not yet indexed retain the existing source-text fallback.
  return existing ? [] : null;
}

export async function indexedReferencePage(
  ctx: QueryCtx,
  options: SearchOptions,
): Promise<{
  page: Doc<"references">[];
  isDone: boolean;
  continueCursor: string;
  matches: Map<string, SearchMatch[]>;
} | null> {
  const query = indexQuery(options.query);
  if (!query) return null;
  const state = await ctx.db
    .query("referenceSearchState")
    .withIndex("by_key", (q) => q.eq("key", "catalog-v1"))
    .unique();
  if (!state?.ready) return null;
  // Finish a pre-index browsing page chain when a rebuild completes mid-request.
  if (options.cursor && !options.cursor.startsWith(cursorPrefix)) return null;
  const scope = JSON.stringify([
    query,
    options.collection,
    !!options.includeUnreviewed,
    options.lane,
    options.favoritesOnly,
    options.sourceType,
    options.domain,
    options.tagSlug,
    options.boardId,
    options.projectId,
  ]);
  let cursor: string | null = null;
  if (options.cursor) {
    if (options.cursor.length > 16_384)
      throw new Error("Search cursor is too long.");
    const parsed = JSON.parse(
      decodeURIComponent(options.cursor.slice(cursorPrefix.length)),
    ) as { scope?: unknown; cursor?: unknown };
    if (parsed.scope === scope && typeof parsed.cursor === "string")
      cursor = parsed.cursor;
  }
  const result = await ctx.db
    .query("referenceSearchDocuments")
    .withSearchIndex("search_text", (q) => {
      let search = q.search("text", query);
      // Active Library includes inbox/later; ordinary collection filtering still
      // applies after hydration so archived and trashed references stay excluded.
      if (!(options.collection === "library" && options.includeUnreviewed))
        search = search.eq("collection", options.collection);
      if (options.lane !== "all") search = search.eq("lane", options.lane);
      if (options.favoritesOnly) search = search.eq("favorite", true);
      if (options.sourceType) search = search.eq("kind", options.sourceType);
      return search;
    })
    .paginate({ numItems: options.pageSize, cursor });
  const references = await Promise.all(
    result.page.map((row) => ctx.db.get(row.referenceId)),
  );
  return {
    page: references.filter((r): r is Doc<"references"> => r !== null),
    isDone: result.isDone,
    continueCursor:
      cursorPrefix +
      encodeURIComponent(
        JSON.stringify({ scope, cursor: result.continueCursor }),
      ),
    matches: new Map(
      result.page.map((row) => [
        String(row.referenceId),
        searchMatchReasons(row.fields, query),
      ]),
    ),
  };
}
