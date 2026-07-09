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
  assets: ReferenceAsset[];
};

export type ReferenceLane = "all" | "images" | "links";

export type ReferenceFilterOptions = {
  query?: string;
  favoritesOnly?: boolean;
  lane?: ReferenceLane;
};

export function filterReferences(
  references: SavedReference[],
  options: ReferenceFilterOptions = {},
) {
  let list = references;

  if (options.lane && options.lane !== "all") {
    list = list.filter((reference) => referenceMode(reference.kind) === options.lane);
  }

  if (options.favoritesOnly) {
    list = list.filter((reference) => reference.favorite);
  }

  const needle = options.query?.trim().toLowerCase();
  if (!needle) return list;

  return list.filter((reference) =>
    [reference.title, reference.notes, reference.sourceUrl, reference.platform, reference.kind]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(needle)),
  );
}

export function getSelectedReference(
  visibleReferences: SavedReference[],
  selectedId: string | null,
) {
  if (!visibleReferences.length) return undefined;

  return visibleReferences.find((reference) => reference._id === selectedId) ?? visibleReferences[0];
}

export function assetLabel(asset: ReferenceAsset | undefined, kind?: string) {
  if (!asset) return referenceMode(kind ?? "") === "links" ? "Link only" : "Page only";
  if (asset.storageProvider === "google_drive") return "Google Drive original";
  if (asset.storageProvider === "convex") return "Convex fallback original";
  if (asset.storageProvider === "linked") return "Linked source URL";
  if (asset.storedUrl) return "Stored original";
  if (asset.originalUrl) return "Linked URL";
  return referenceMode(kind ?? "") === "links" ? "Link only" : "Page only";
}

export function referenceMode(kind: string): Exclude<ReferenceLane, "all"> {
  if (kind === "link" || kind === "article" || kind === "page") return "links";
  return "images";
}

export function referenceKindLabel(kind: string) {
  if (kind === "link") return "Link";
  if (kind === "article") return "Article";
  if (kind === "page") return "Page";
  if (kind === "image") return "Image";
  if (kind === "post") return "Post";
  return "Reference";
}
