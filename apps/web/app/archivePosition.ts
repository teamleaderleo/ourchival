import {
  isArchiveSort,
  type ArchiveSort,
} from "../../../packages/shared/src/archiveSort";

export type BrowsePosition = {
  version: 1;
  referenceId: string;
  cursor: string;
  viewportTop: number;
  savedAt: number;
};
export type BrowseView = {
  view: string;
  query: string;
  sort: ArchiveSort;
  imagesOnly: boolean;
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const prefix = "ourchival:browse:v1:";
export function browseViewKey(origin: string, view: BrowseView) {
  return JSON.stringify([
    origin,
    view.view,
    view.query.trim(),
    view.sort,
    view.imagesOnly,
  ]);
}
export function readPosition(store: Store, key: string): BrowsePosition | null {
  try {
    const p = JSON.parse(store.getItem(prefix + key) ?? "null");
    return p?.version === 1 &&
      typeof p.referenceId === "string" &&
      p.referenceId.length < 256 &&
      typeof p.cursor === "string" &&
      p.cursor.startsWith("archive-order-v1:") &&
      p.cursor.length <= 32000 &&
      Number.isFinite(p.viewportTop) &&
      Math.abs(p.viewportTop) < 100000 &&
      Number.isFinite(p.savedAt)
      ? p
      : null;
  } catch {
    return null;
  }
}
export function savePosition(
  store: Store,
  key: string,
  position: BrowsePosition,
) {
  try {
    const indexKey = prefix + "index";
    const raw = JSON.parse(store.getItem(indexKey) ?? "[]");
    const keys = Array.isArray(raw)
      ? raw.filter((k): k is string => typeof k === "string" && k !== key)
      : [];
    keys.push(key);
    while (keys.length > 30) store.removeItem(prefix + keys.shift());
    store.setItem(prefix + key, JSON.stringify(position));
    store.setItem(indexKey, JSON.stringify(keys));
    return true;
  } catch {
    return false;
  }
}
export function clearPosition(store: Store, key: string) {
  try {
    store.removeItem(prefix + key);
  } catch {
    /* Storage can be disabled. */
  }
}
export function readBrowseView(
  store: Store,
  origin: string,
): BrowseView | null {
  try {
    const v = JSON.parse(store.getItem(prefix + "view:" + origin) ?? "null");
    return v &&
      [
        "inbox",
        "all",
        "images",
        "links",
        "favorites",
        "later",
        "archive",
        "trash",
      ].includes(v.view) &&
      typeof v.query === "string" &&
      v.query.length <= 2000 &&
      isArchiveSort(v.sort) &&
      typeof v.imagesOnly === "boolean"
      ? v
      : null;
  } catch {
    return null;
  }
}
export function saveBrowseView(store: Store, origin: string, view: BrowseView) {
  try {
    store.setItem(prefix + "view:" + origin, JSON.stringify(view));
  } catch {
    /* Optional browser persistence. */
  }
}
