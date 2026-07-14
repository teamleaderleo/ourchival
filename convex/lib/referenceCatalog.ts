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
  lane: ReferenceLane;
  favoritesOnly: boolean;
  query: string;
};

const statsKey = "global";
const linkKinds = new Set(["link", "article", "page"]);

export async function listReferencePage(ctx: any, request: Request) {
  const url = new URL(request.url);
  const options = parseReferenceListOptions(url);
  const origin = url.origin;
  const references: Array<{ reference: any; snapshot: any | null | undefined }> = [];
  let cursor = options.cursor;
  let isDone = false;
  let scanned = 0;
  const scanBatchSize = Math.max(options.pageSize, 48);
  const maxScanned = Math.max(options.pageSize * 8, 384);

  while (!isDone && references.length < options.pageSize && scanned < maxScanned) {
    const page = await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .order("desc")
      .paginate({ numItems: scanBatchSize, cursor });

    cursor = page.continueCursor;
    isDone = page.isDone;
    scanned += page.page.length;

    const candidates = page.page.filter((reference: any) =>
      matchesReferenceFilters(reference, options),
    );

    if (!options.query) {
      references.push(
        ...candidates.map((reference: any) => ({
          reference,
          snapshot: undefined,
        })),
      );
      continue;
    }

    const searchable = await Promise.all(
      candidates.map(async (reference: any) => ({
        reference,
        snapshot: await getLatestSnapshot(ctx, reference._id),
      })),
    );

    references.push(
      ...searchable.filter(({ reference, snapshot }) =>
        matchesSearch(reference, snapshot, options.query),
      ),
    );
  }

  const hydrated = await Promise.all(
    references.map(({ reference, snapshot }) =>
      hydrateReference(ctx, origin, reference, snapshot),
    ),
  );
  const counts = await getReferenceCounts(ctx);

  return {
    references: hydrated,
    continueCursor: isDone ? null : cursor,
    hasMore: !isDone,
    scanned,
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
  return await rebuildReferenceStats(ctx);
}

export async function hydrateReference(
  ctx: any,
  origin: string,
  reference: any,
  knownSnapshot: any | null | undefined = undefined,
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

  const assetsWithUrls = await Promise.all(
    assets.map(async (asset: any) => ({
      ...asset,
      storedUrl: asset.driveFileId
        ? `${origin}/drive-file?id=${encodeURIComponent(asset.driveFileId)}`
        : asset.originalStorageId
          ? await ctx.storage.getUrl(asset.originalStorageId)
          : null,
    })),
  );

  return {
    ...reference,
    assets: assetsWithUrls,
    ...(snapshot ? { sourceSnapshot: sourceSnapshotPayload(snapshot) } : {}),
  };
}

export function sourceSnapshotPayload(snapshot: any) {
  return {
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
  };
}

async function rebuildReferenceStats(ctx: any): Promise<ReferenceCounts> {
  const counts = emptyCounts();
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const page = await ctx.db
      .query("references")
      .withIndex("by_captured_at")
      .order("desc")
      .paginate({ numItems: 256, cursor });

    cursor = page.continueCursor;
    isDone = page.isDone;
    for (const reference of page.page) {
      for (const key of referenceFacetKeys(reference)) counts[key] += 1;
    }
  }

  const existing = await getReferenceStatsDocument(ctx);
  const payload = { ...sanitizeCounts(counts), updatedAt: Date.now() };
  if (existing) await ctx.db.patch(existing._id, payload);
  else await ctx.db.insert("referenceStats", { key: statsKey, ...payload });

  return counts;
}

async function getReferenceStatsDocument(ctx: any) {
  return await ctx.db
    .query("referenceStats")
    .withIndex("by_key", (q: any) => q.eq("key", statsKey))
    .unique();
}

async function getLatestSnapshot(ctx: any, referenceId: any) {
  return await ctx.db
    .query("sourceSnapshots")
    .withIndex("by_reference", (q: any) => q.eq("referenceId", referenceId))
    .order("desc")
    .first();
}

function parseReferenceListOptions(url: URL): ReferenceListOptions {
  const requestedPageSize = Number(url.searchParams.get("limit") ?? 48);
  const collection = url.searchParams.get("collection");
  const lane = url.searchParams.get("lane");

  return {
    cursor: url.searchParams.get("cursor") || null,
    pageSize: Number.isFinite(requestedPageSize)
      ? Math.min(96, Math.max(12, Math.floor(requestedPageSize)))
      : 48,
    collection: isCollection(collection) ? collection : "inbox",
    lane: isLane(lane) ? lane : "all",
    favoritesOnly: url.searchParams.get("favorites") === "true",
    query: normalizeSearchText(url.searchParams.get("query") ?? ""),
  };
}

function matchesReferenceFilters(reference: any, options: ReferenceListOptions) {
  if (referenceCollection(reference) !== options.collection) return false;
  if (options.lane !== "all" && referenceLane(reference.kind) !== options.lane) {
    return false;
  }
  if (options.favoritesOnly && !reference.favorite) return false;
  return true;
}

function matchesSearch(reference: any, snapshot: any | null, query: string) {
  return [
    reference.title,
    reference.notes,
    reference.sourceUrl,
    reference.canonicalUrl,
    reference.platform,
    reference.kind,
    reference.authorName,
    reference.authorHandle,
    reference.postId,
    snapshot?.pageTitle,
    snapshot?.postText,
    snapshot?.altText,
    snapshot?.selectedText,
    snapshot?.description,
    snapshot?.siteName,
    snapshot?.pageAuthor,
    snapshot?.canonicalUrl,
    snapshot?.contentType,
  ]
    .filter((value) => typeof value === "string")
    .some((value) => normalizeSearchText(value).includes(query));
}

function referenceFacetKeys(reference: any | null | undefined): ReferenceCountKey[] {
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