import { readSourceFilters, matchesSourcePlatform } from "../../packages/shared/src/sourceFilters";
import { getSourceContext } from "./sourceContext";
import {
  findReferenceSearchMatches,
  type ReferenceSearchContext,
  type SearchMatch,
} from "./searchMatches";
import type { QueryCtx } from "../_generated/server";
import { slugifyTagName } from "./tags";
import {
  indexedReferencePage,
  scheduleReferenceSearch,
  chronologicalSearchMatches,
} from "./searchIndex";
import { chronologicalPage } from "./archiveOrder";

type ReferenceCollection = "inbox" | "library" | "later" | "archive" | "trash";
type ReferenceLane = "all" | "images" | "links";
type ReferenceCountKey =
  | "inbox"
  | "library"
  | "later"
  | "archive"
  | "trash"
  | "images"
  | "links"
  | "favorites";

type ReferenceCounts = Record<ReferenceCountKey, number>;

type ReferenceListOptions = {
  cursor: string | null;
  pageSize: number;
  collection: ReferenceCollection;
  includeUnreviewed: boolean;
  lane: ReferenceLane;
  favoritesOnly: boolean;
  query: string;
  domain: string;
  sourceType: string;
  tagSlug: string;
  tagId: any | null;
  boardId: string;
  projectId: string;
  projectReferenceIds: Set<string> | null;
};

type SearchCaches = {
  tags: Map<string, Promise<any | null>>;
  boards: Map<string, Promise<any | null>>;
  projects: Map<string, Promise<any | null>>;
};

const statsKey = "global";
const linkKinds = new Set(["link", "article", "page"]);

export async function listReferencePage(ctx: any, request: Request | string) {
  const url = new URL(typeof request === "string" ? request : request.url);
  const options = parseReferenceListOptions(url);
  if (options.tagSlug) {
    const tag = await ctx.db
      .query("tags")
      .withIndex("by_slug", (q: any) => q.eq("slug", options.tagSlug))
      .unique();
    options.tagId = tag?._id ?? null;
  }
  if (options.projectId) {
    const projects = await ctx.db.query("projects").collect();
    const project = projects.find(
      (candidate: any) => String(candidate._id) === options.projectId,
    );
    if (project) {
      const uses = await ctx.db
        .query("projectReferences")
        .withIndex("by_project", (q: any) => q.eq("projectId", project._id))
        .collect();
      options.projectReferenceIds = new Set(
        uses.map((use: any) => String(use.referenceId)),
      );
    } else {
      options.projectReferenceIds = new Set();
    }
  }

  const origin = url.origin;
  const searchCaches = createSearchCaches();
  const references: Array<{
    reference: any;
    snapshot: any | null | undefined;
    searchMatches: SearchMatch[];
  }> = [];
  const chronological = url.searchParams.has("sort");
  const indexedPage =
    options.query && !chronological && !options.includeUnreviewed
      ? await indexedReferencePage(ctx, options)
      : null;
  const page =
    indexedPage ??
    (chronological
      ? await chronologicalPage(ctx, url, options.pageSize)
      : await ctx.db
          .query("references")
          .withIndex("by_captured_at")
          .order("desc")
          .paginate({ numItems: options.pageSize, cursor: options.cursor }));
  let candidates = page.page.filter(
    (reference: any) =>
      (!("cutoff" in page) || reference._creationTime <= Number(page.cutoff)) &&
      matchesReferenceFilters(reference, options),
  );

  const sourceFilters = readSourceFilters(url.searchParams.get("query") ?? "");
  candidates = candidates.filter((reference: any) => matchesSourcePlatform(reference.platform, sourceFilters));
  if (sourceFilters.origins.length || sourceFilters.excludedOrigins.length) {
    if (sourceFilters.origins.length + sourceFilters.excludedOrigins.length > 32) throw new Error("Choose at most 32 source collections.");
    const matching = await Promise.all(candidates.map(async (reference: any) => {
      const has = async (key: string) => Boolean(await ctx.db.query("referenceOrigins").withIndex("by_reference_id_and_container_key", (q: any) => q.eq("referenceId", reference._id).eq("containerKey", key)).first());
      const included = await Promise.all(sourceFilters.origins.map(has));
      const excluded = await Promise.all(sourceFilters.excludedOrigins.map(has));
      return (!included.length || included.some(Boolean)) && !excluded.some(Boolean);
    }));
    candidates = candidates.filter((_: any, i: number) => matching[i]);
  }

  if (!options.query) {
    references.push(
      ...candidates.map((reference: any) => ({
        reference,
        snapshot: undefined,
        searchMatches: [],
      })),
    );
  } else if (indexedPage) {
    references.push(
      ...candidates.map((reference: any) => ({
        reference,
        snapshot: undefined,
        searchMatches: indexedPage.matches.get(String(reference._id)) ?? [],
      })),
    );
  } else {
    const searchable = await Promise.all(
      candidates.map(async (reference: any) => {
        if (chronological) {
          const matches = await chronologicalSearchMatches(
            ctx,
            reference._id,
            options.query,
          );
          if (matches !== null)
            return { reference, snapshot: undefined, searchMatches: matches };
        }
        const [snapshot, context] = await Promise.all([
          getLatestSnapshot(ctx, reference._id),
          getReferenceSearchContext(ctx, reference, searchCaches),
        ]);
        return {
          reference,
          snapshot,
          searchMatches: findReferenceSearchMatches(
            reference,
            snapshot,
            context,
            options.query,
          ),
        };
      }),
    );

    references.push(
      ...searchable.filter(({ searchMatches }) => searchMatches.length > 0),
    );
  }

  const hydrated = await Promise.all(
    references.map(({ reference, snapshot, searchMatches }) =>
      hydrateReference(ctx, origin, reference, snapshot, searchMatches),
    ),
  );
  const counts = await getReferenceCounts(ctx);

  return {
    references:
      "startCursor" in page
        ? hydrated.map((reference) => ({
            ...reference,
            browseCursor: page.startCursor,
          }))
        : hydrated,
    continueCursor: page.isDone ? null : page.continueCursor,
    hasMore: !page.isDone,
    searchMode: options.query
      ? indexedPage
        ? "indexed"
        : "page_scan"
      : "browse",
    scanned: page.page.length,
    counts: {
      inbox: counts.inbox,
      all: counts.library,
      images: counts.images,
      links: counts.links,
      favorites: counts.favorites,
      later: counts.later,
      archive: counts.archive,
      trash: counts.trash,
    },
  };
}

export async function applyReferenceStatsDelta(
  ctx: any,
  before: any | null | undefined,
  after: any | null | undefined,
) {
  const referenceId = (after ?? before)?._id;
  if (after && after.browseLane !== referenceLane(after.kind)) {
    await ctx.db.patch(after._id, { browseLane: referenceLane(after.kind) });
  }
  if (referenceId) await scheduleReferenceSearch(ctx, referenceId);
  const stats = await getReferenceStatsDocument(ctx);
  if (!stats) {
    await rebuildReferenceStats(ctx);
    return;
  }

  const nextCounts = countsFromStats(stats);
  for (const key of referenceFacetKeys(before)) nextCounts[key] -= 1;
  for (const key of referenceFacetKeys(after)) nextCounts[key] += 1;

  await ctx.db.patch(stats._id, {
    ...sanitizeCounts(nextCounts),
    updatedAt: Date.now(),
  });
}

export async function getReferenceCounts(ctx: any): Promise<ReferenceCounts> {
  const stats = await getReferenceStatsDocument(ctx);
  if (stats) return countsFromStats(stats);
  return emptyCounts();
}

export async function ensureReferenceStats(ctx: any) {
  const stats = await getReferenceStatsDocument(ctx);
  if (stats) return countsFromStats(stats);
  return await rebuildReferenceStats(ctx);
}

export async function hydrateReference(
  ctx: any,
  origin: string,
  reference: any,
  knownSnapshot: any | null | undefined = undefined,
  knownSearchMatches: SearchMatch[] = [],
) {
  const [assets, snapshot] = await Promise.all([
    ctx.db
      .query("assets")
      .withIndex("by_reference", (q: any) => q.eq("referenceId", reference._id))
      .collect(),
    knownSnapshot === undefined
      ? getLatestSnapshot(ctx, reference._id)
      : Promise.resolve(knownSnapshot),
  ]);

  const sealed =
    reference.sealed === true ||
    (() => {
      try {
        const raw = JSON.parse(snapshot?.jsonMetadata ?? "{}");
        return (raw.rawMetadata ?? raw).sealed === true;
      } catch {
        return false;
      }
    })();
  const assetsWithUrls = await Promise.all(
    assets.map(async (asset: any) => {
      if (sealed)
        return {
          _id: asset._id,
          referenceId: asset.referenceId,
          sourceIndex: asset.sourceIndex,
          sourceCount: asset.sourceCount,
          width: asset.width,
          height: asset.height,
          quality: asset.quality,
          sealed: true,
        };

      const [originalStorageUrl, previewUrl, thumbUrl] = await Promise.all([
        asset.originalStorageId
          ? ctx.storage.getUrl(asset.originalStorageId)
          : null,
        asset.previewStorageId
          ? ctx.storage.getUrl(asset.previewStorageId)
          : null,
        asset.thumbStorageId ? ctx.storage.getUrl(asset.thumbStorageId) : null,
      ]);

      return {
        ...asset,
        storedUrl: asset.driveFileId
          ? `${origin}/drive-file?id=${encodeURIComponent(asset.driveFileId)}`
          : originalStorageUrl,
        previewUrl,
        thumbUrl,
      };
    }),
  );

  return {
    ...reference,
    sealed,
    assets: assetsWithUrls,
    ...(snapshot
      ? {
          sourceSnapshot: {
            ...sourceSnapshotPayload(snapshot),
            ...(sealed ? { previewImageUrl: undefined } : {}),
          },
        }
      : {}),
    ...(knownSearchMatches.length > 0
      ? { searchMatches: knownSearchMatches }
      : {}),
  };
}

export function sourceSnapshotPayload(snapshot: any) {
  const sourceMetadata = sourceMetadataPayload(snapshot.jsonMetadata);
  return {
    fieldSources: snapshot.fieldSources,
    pageTitle: snapshot.pageTitle,
    postText: snapshot.postText,
    altText: snapshot.altText,
    selectedText: snapshot.selectedText,
    description: snapshot.description,
    siteName: snapshot.siteName,
    faviconUrl: snapshot.faviconUrl,
    previewImageUrl: snapshot.previewImageUrl,
    pageAuthor: snapshot.pageAuthor,
    canonicalUrl: snapshot.canonicalUrl,
    contentType: snapshot.contentType,
    metadataStatus: snapshot.metadataStatus,
    httpStatus: snapshot.httpStatus,
    metadataFetchedAt: snapshot.metadataFetchedAt,
    createdAt: snapshot.createdAt,
    ...(sourceMetadata ? { sourceMetadata } : {}),
  };
}

export function sourceMetadataPayload(value: unknown) {
  const metadata = jsonObject(value);
  const rawMetadata = jsonObject(metadata?.rawMetadata);
  const rawSnapshot = jsonObject(rawMetadata?.snapshot) ?? rawMetadata;
  const engagement = engagementPayload(
    rawMetadata?.engagement ?? rawSnapshot?.engagement,
  );
  const payload = compactObject({
    provenance: stringValue(rawMetadata?.provenance),
    sourceKind: stringValue(rawMetadata?.sourceKind),
    feedContext: stringValue(rawMetadata?.feedContext),
    textLanguage: stringValue(
      rawMetadata?.textLanguage ?? rawSnapshot?.textLanguage,
    ),
    mediaIndex: nonNegativeNumber(rawMetadata?.mediaIndex),
    mediaCount: nonNegativeNumber(rawMetadata?.mediaCount),
    engagement,
  });
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function engagementPayload(value: unknown) {
  const metrics = jsonObject(value);
  if (!metrics) return undefined;
  const payload = compactObject({
    replies: nonNegativeNumber(metrics.replies),
    reposts: nonNegativeNumber(metrics.reposts),
    quotes: nonNegativeNumber(metrics.quotes),
    likes: nonNegativeNumber(metrics.likes),
    bookmarks: nonNegativeNumber(metrics.bookmarks),
    views: nonNegativeNumber(metrics.views),
  });
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return jsonObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 160)
    : undefined;
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

async function getReferenceSearchContext(
  ctx: any,
  reference: any,
  caches: SearchCaches,
): Promise<ReferenceSearchContext> {
  const [tags, boards, uses] = await Promise.all([
    Promise.all(
      reference.tagIds.map((tagId: any) =>
        getCachedDocument(ctx, caches.tags, tagId),
      ),
    ),
    Promise.all(
      reference.boardIds.map((boardId: any) =>
        getCachedDocument(ctx, caches.boards, boardId),
      ),
    ),
    ctx.db
      .query("projectReferences")
      .withIndex("by_reference", (q: any) => q.eq("referenceId", reference._id))
      .collect(),
  ]);

  const projectUses = await Promise.all(
    uses.map(async (use: any) => ({
      ...use,
      project: await getCachedDocument(ctx, caches.projects, use.projectId),
    })),
  );

  return {
    tags: tags.filter(Boolean),
    boards: boards.filter(Boolean),
    projectUses,
  };
}

function createSearchCaches(): SearchCaches {
  return {
    tags: new Map(),
    boards: new Map(),
    projects: new Map(),
  };
}

function getCachedDocument(
  ctx: any,
  cache: Map<string, Promise<any | null>>,
  id: any,
) {
  const key = String(id);
  const existing = cache.get(key);
  if (existing) return existing;
  const request = Promise.resolve(ctx.db.get(id)).then(
    (value) => value ?? null,
  );
  cache.set(key, request);
  return request;
}

async function rebuildReferenceStats(ctx: any): Promise<ReferenceCounts> {
  const counts = await scanReferenceCounts(ctx);
  const existing = await getReferenceStatsDocument(ctx);
  const payload = { ...sanitizeCounts(counts), updatedAt: Date.now() };
  if (existing) await ctx.db.patch(existing._id, payload);
  else await ctx.db.insert("referenceStats", { key: statsKey, ...payload });

  return counts;
}

async function scanReferenceCounts(ctx: QueryCtx): Promise<ReferenceCounts> {
  const counts = emptyCounts();
  // Bootstrap the existing counters in one query. Convex forbids calling
  // paginate more than once in a transaction, even with successive cursors.
  for await (const reference of ctx.db
    .query("references")
    .withIndex("by_captured_at")) {
    for (const key of referenceFacetKeys(reference)) counts[key] += 1;
  }

  return counts;
}

async function getReferenceStatsDocument(ctx: any) {
  return await ctx.db
    .query("referenceStats")
    .withIndex("by_key", (q: any) => q.eq("key", statsKey))
    .unique();
}

async function getLatestSnapshot(ctx: any, referenceId: any) {
  return await getSourceContext(ctx, referenceId);
}

function parseReferenceListOptions(url: URL): ReferenceListOptions {
  const requestedPageSize = Number(url.searchParams.get("limit") ?? 48);
  const collection = url.searchParams.get("collection");
  const lane = url.searchParams.get("lane");
  const queryFilters = parseReferenceFilterTokens(
    url.searchParams.get("query") ?? "",
  );

  return {
    cursor: url.searchParams.get("cursor") || null,
    pageSize: Number.isFinite(requestedPageSize)
      ? Math.min(96, Math.max(12, Math.floor(requestedPageSize)))
      : 48,
    collection: isCollection(collection) ? collection : "inbox",
    includeUnreviewed: url.searchParams.get("scope") === "active",
    lane: isLane(lane) ? lane : "all",
    favoritesOnly: url.searchParams.get("favorites") === "true",
    query: normalizeSearchText(queryFilters.query),
    domain: normalizeDomain(
      url.searchParams.get("domain") ?? queryFilters.domain,
    ),
    sourceType: normalizeSearchText(
      url.searchParams.get("sourceType") ?? queryFilters.sourceType,
    ),
    tagSlug: slugifyTagName(url.searchParams.get("tag") ?? queryFilters.tag),
    tagId: null,
    boardId: (url.searchParams.get("board") ?? queryFilters.board).trim(),
    projectId: (url.searchParams.get("project") ?? queryFilters.project).trim(),
    projectReferenceIds: null,
  };
}

export function parseReferenceFilterTokens(value: string) {
  const words: string[] = [];
  let domain = "";
  let sourceType = "";
  let tag = "";
  let board = "";
  let project = "";

  for (const token of value.trim().split(/\s+/).filter(Boolean)) {
    const separator = token.indexOf(":");
    if (separator <= 0) {
      words.push(token);
      continue;
    }

    const key = token.slice(0, separator).toLocaleLowerCase();
    const filterValue = token.slice(separator + 1).trim();
    if (!filterValue) continue;

    if (["source", "-source", "origin", "-origin"].includes(key)) continue;
    if (key === "site" || key === "domain") domain = filterValue;
    else if (key === "type" || key === "kind") sourceType = filterValue;
    else if (key === "tag") tag = filterValue;
    else if (key === "board") board = filterValue;
    else if (key === "project") project = filterValue;
    else words.push(token);
  }

  return { query: words.join(" "), domain, sourceType, tag, board, project };
}

function matchesReferenceFilters(
  reference: any,
  options: ReferenceListOptions,
) {
  if (options.collection === "library" && options.includeUnreviewed) {
    if (reference.deleted || reference.archived) return false;
  } else if (referenceCollection(reference) !== options.collection) return false;
  if (
    options.lane !== "all" &&
    referenceLane(reference.kind) !== options.lane
  ) {
    return false;
  }
  if (options.favoritesOnly && !reference.favorite) return false;
  if (
    options.sourceType &&
    normalizeSearchText(reference.kind) !== options.sourceType
  ) {
    return false;
  }
  if (options.domain && !matchesDomain(reference.sourceUrl, options.domain))
    return false;
  if (
    options.tagSlug &&
    (!options.tagId ||
      !reference.tagIds.some(
        (tagId: any) => String(tagId) === String(options.tagId),
      ))
  ) {
    return false;
  }
  if (
    options.boardId &&
    !reference.boardIds.some(
      (boardId: any) => String(boardId) === options.boardId,
    )
  ) {
    return false;
  }
  if (
    options.projectId &&
    !options.projectReferenceIds?.has(String(reference._id))
  ) {
    return false;
  }
  return true;
}

function matchesDomain(sourceUrl: string, domain: string) {
  try {
    const hostname = new URL(sourceUrl).hostname
      .toLocaleLowerCase()
      .replace(/^www\./, "");
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function referenceFacetKeys(
  reference: any | null | undefined,
): ReferenceCountKey[] {
  if (!reference) return [];
  const collection = referenceCollection(reference);
  const keys: ReferenceCountKey[] = [collection];

  if (collection === "library") {
    keys.push(referenceLane(reference.kind));
    if (reference.favorite) keys.push("favorites");
  }

  return keys;
}

function referenceCollection(reference: any): ReferenceCollection {
  if (reference.deleted) return "trash";
  if (reference.archived) return "archive";
  if (reference.triageState === "inbox") return "inbox";
  if (reference.triageState === "later") return "later";
  return "library";
}

function referenceLane(kind: string): "images" | "links" {
  return linkKinds.has(kind) ? "links" : "images";
}

function isCollection(value: string | null): value is ReferenceCollection {
  return (
    value === "inbox" ||
    value === "library" ||
    value === "later" ||
    value === "archive" ||
    value === "trash"
  );
}

function isLane(value: string | null): value is ReferenceLane {
  return value === "all" || value === "images" || value === "links";
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

function normalizeDomain(value: string) {
  const normalized =
    normalizeSearchText(value)
      .replace(/^https?:\/\//, "")
      .split("/")[0] ?? "";
  return normalized.replace(/^www\./, "").replace(/\.$/, "");
}

function emptyCounts(): ReferenceCounts {
  return {
    inbox: 0,
    library: 0,
    later: 0,
    archive: 0,
    trash: 0,
    images: 0,
    links: 0,
    favorites: 0,
  };
}

function countsFromStats(stats: any): ReferenceCounts {
  return {
    inbox: stats.inbox,
    library: stats.library,
    later: stats.later,
    archive: stats.archive,
    trash: stats.trash,
    images: stats.images,
    links: stats.links,
    favorites: stats.favorites,
  };
}

function sanitizeCounts(counts: ReferenceCounts): ReferenceCounts {
  return {
    inbox: Math.max(0, counts.inbox),
    library: Math.max(0, counts.library),
    later: Math.max(0, counts.later),
    archive: Math.max(0, counts.archive),
    trash: Math.max(0, counts.trash),
    images: Math.max(0, counts.images),
    links: Math.max(0, counts.links),
    favorites: Math.max(0, counts.favorites),
  };
}
