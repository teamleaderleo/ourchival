export type ReferenceAsset = {
  _id: string;
  originalUrl?: string;
  storedUrl?: string | null;
  storageProvider?: "google_drive" | "convex" | "linked";
  driveFileId?: string;
  driveWebViewLink?: string;
};

export type SavedReference = {
  _id: string;
  kind: string;
  title?: string;
  notes?: string;
  favorite?: boolean;
  sourceUrl: string;
  platform: string;
  capturedAt: number;
  boardIds?: string[];
  tagIds?: string[];
  assets: ReferenceAsset[];
};

export type ReferenceFilterOptions = {
  query?: string;
  favoritesOnly?: boolean;
  boardId?: string | null;
  tagId?: string | null;
  /** Resolves a tag id to its display name so search can match tag names. */
  tagNameFor?: (tagId: string) => string | undefined;
};

export function filterReferences<T extends SavedReference>(
  references: T[],
  options: ReferenceFilterOptions = {},
): T[] {
  let list = references;

  if (options.boardId) {
    list = list.filter((reference) => reference.boardIds?.includes(options.boardId!));
  }

  if (options.tagId) {
    list = list.filter((reference) => reference.tagIds?.includes(options.tagId!));
  }

  if (options.favoritesOnly) {
    list = list.filter((reference) => reference.favorite);
  }

  const needle = options.query?.trim().toLowerCase();
  if (!needle) return list;

  return list.filter((reference) => {
    const tagNames = options.tagNameFor
      ? (reference.tagIds ?? []).map((tagId) => options.tagNameFor!(tagId))
      : [];

    return [
      reference.title,
      reference.notes,
      reference.sourceUrl,
      reference.platform,
      reference.kind,
      ...tagNames,
    ]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(needle));
  });
}

export function getSelectedReference<T extends SavedReference>(
  visibleReferences: T[],
  selectedId: string | null,
): T | undefined {
  if (!visibleReferences.length) return undefined;

  return visibleReferences.find((reference) => reference._id === selectedId) ?? visibleReferences[0];
}

export function assetLabel(asset: ReferenceAsset | undefined) {
  if (!asset) return "Page only";
  if (asset.storageProvider === "google_drive") return "Google Drive original";
  if (asset.storageProvider === "convex") return "Convex fallback original";
  if (asset.storageProvider === "linked") return "Linked source URL";
  if (asset.storedUrl) return "Stored original";
  if (asset.originalUrl) return "Linked URL";
  return "Page only";
}

export function referenceMode(kind: string) {
  if (kind === "link" || kind === "article" || kind === "page") return "links";
  return "images";
}
