import { describe, expect, it } from "vitest";
import {
  browseViewKey,
  readPosition,
  savePosition,
  clearPosition,
  readBrowseView,
  saveBrowseView,
} from "./archivePosition";

const store = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
};
const view = {
  view: "inbox",
  query: "pose",
  sort: "saved-desc" as const,
  imagesOnly: true,
};
const marker = {
  version: 1 as const,
  referenceId: "image-a",
  cursor: "archive-order-v1:opaque",
  viewportTop: -37,
  savedAt: 123,
};
describe("durable archive positions", () => {
  it("remembers anchors independently by origin, collection, filters, and sort", () => {
    const storage = store();
    const key = browseViewKey("local", view);
    expect(savePosition(storage, key, marker)).toBe(true);
    expect(readPosition(storage, key)).toEqual(marker);
    for (const other of [
      { ...view, sort: "saved-asc" as const },
      { ...view, query: "lighting" },
      { ...view, imagesOnly: false },
      { ...view, view: "later" },
    ])
      expect(readPosition(storage, browseViewKey("local", other))).toBeNull();
    expect(readPosition(storage, browseViewKey("other", view))).toBeNull();
    clearPosition(storage, key);
    expect(readPosition(storage, key)).toBeNull();
  });
  it("bounds remembered views and tolerates disabled storage", () => {
    const storage = store();
    for (let i = 0; i < 31; i++) savePosition(storage, String(i), marker);
    expect(readPosition(storage, "0")).toBeNull();
    expect(readPosition(storage, "30")).toEqual(marker);
    const broken = {
      getItem: () => {
        throw new Error();
      },
      setItem: () => {
        throw new Error();
      },
      removeItem: () => {},
    };
    expect(readPosition(broken, "x")).toBeNull();
    expect(savePosition(broken, "x", marker)).toBe(false);
  });
  it("restores the last view after a reload and rejects invalid sort state", () => {
    const storage = store();
    saveBrowseView(storage, "local", view);
    expect(readBrowseView(storage, "local")).toEqual(view);
    storage.setItem(
      "ourchival:browse:v1:view:local",
      JSON.stringify({ ...view, sort: "bogus" }),
    );
    expect(readBrowseView(storage, "local")).toBeNull();
  });
});
