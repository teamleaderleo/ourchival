export type ReferenceAsset = {
  _id: string;
  originalUrl?: string;
  storedUrl?: string | null;
  storageProvider?: "google_drive" | "convex" | "linked";
  driveFileId?: string;
  driveWebViewLink?: string;
};

export type ReferenceSourceSnapshot = {
  pageTitle?: string;
  postText?: string;
  altText?: string;
  selectedText?: string;
  createdAt: number;
};

export type TriageState = "inbox" | "kept" | "later";
export type ReferenceCollection = "inbox" | "library" | "later" | "archive" | "trash";

export type SavedReference = {
  _id: string;
  kind: string;
  title?: string;
  notes?: string;
  favorite?: boolean;
  sourceUrl: string;
  platform: string;
  authorName?: string;
  authorHandle?: string;
  authorUrl?: string;
  postId?: string;
  capturedAt: number;
  publishedAt?: number;
  captureSessionId?: string;
  triageState?: TriageState;
  reviewedAt?: number;
  lastOpenedAt?: number;
  archived?: boolean;
  deleted?: boolean;
  assets: ReferenceAsset[];
  sourceSnapshot?: ReferenceSourceSnapshot;
};

export type ReferenceLane = "all" | "images" | "links";

export type ReferenceFilterOptions = {
  query?: string;
  favoritesOnly?: boolean;
  lane?: ReferenceLane;
  collection?: ReferenceCollection;
};

export function filterReferences(
  references: SavedReference[],
  options: ReferenceFilterOptions = {},
) {
  let list = references;

  if (options.collection) {
    list = list.filter(
      (reference) => referenceCollection(reference) === options.collection,
    );
  }

  if (options.lane && options.lane !== "all") {
    list = list.filter((reference) => referenceMode(reference.kind) === options.lane);
  }

  if (options.favoritesOnly) {
    list = list.filter((reference) => reference.favorite);
  }

  const needle = options.query?.trim().toLowerCase();
  if (!needle) return list;

  return list.filter((reference) =>
    [
      reference.title,
      reference.notes,
      reference.sourceUrl,
      reference.platform,
      reference.kind,
      reference.authorName,
      reference.authorHandle,
      reference.postId,
      reference.sourceSnapshot?.pageTitle,
      reference.sourceSnapshot?.postText,
      reference.sourceSnapshot?.altText,
      reference.sourceSnapshot?.selectedText,
    ]
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

export function referenceCollection(reference: SavedReference): ReferenceCollection {
  if (reference.deleted) return "trash";
  if (reference.archived) return "archive";
  if (reference.triageState === "inbox") return "inbox";
  if (reference.triageState === "later") return "later";
  return "library";
}

export function referenceCollectionLabel(reference: SavedReference) {
  const collection = referenceCollection(reference);
  if (collection === "inbox") return "Inbox";
  if (collection === "later") return "Later";
  if (collection === "archive") return "Archived";
  if (collection === "trash") return "Trash";
  return "Library";
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
