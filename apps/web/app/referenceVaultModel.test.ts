import { describe, expect, it } from "vitest";
import {
  assetLabel,
  filterReferences,
  getSelectedReference,
  referenceMode,
  type SavedReference,
} from "./referenceVaultModel";

const references: SavedReference[] = [
  {
    _id: "pose-study",
    kind: "image",
    title: "Pose study",
    notes: "hands and gesture for the comic panel",
    favorite: true,
    sourceUrl: "https://x.com/artist/status/1",
    platform: "x",
    capturedAt: 1,
    boardIds: ["board-anatomy"],
    tagIds: ["tag-gesture"],
    assets: [{ _id: "asset-1", storageProvider: "google_drive" }],
  },
  {
    _id: "color-article",
    kind: "article",
    title: "Color theory notes",
    notes: "palette and value grouping",
    favorite: false,
    sourceUrl: "https://example.com/color-theory",
    platform: "generic",
    capturedAt: 2,
    assets: [],
  },
  {
    _id: "fabric-ref",
    kind: "image",
    title: "Jacket folds",
    notes: "fabric tension around elbows",
    favorite: false,
    sourceUrl: "https://example.com/fabric.jpg",
    platform: "generic",
    capturedAt: 3,
    assets: [{ _id: "asset-2", originalUrl: "https://example.com/fabric.jpg" }],
  },
];

describe("filterReferences", () => {
  it("searches title, notes, URL, platform, and kind", () => {
    expect(filterReferences(references, { query: "hands" }).map((item) => item._id)).toEqual([
      "pose-study",
    ]);
    expect(filterReferences(references, { query: "color-theory" }).map((item) => item._id)).toEqual([
      "color-article",
    ]);
    expect(filterReferences(references, { query: "generic" }).map((item) => item._id)).toEqual([
      "color-article",
      "fabric-ref",
    ]);
  });

  it("filters by board and tag membership", () => {
    expect(
      filterReferences(references, { boardId: "board-anatomy" }).map((item) => item._id),
    ).toEqual(["pose-study"]);
    expect(filterReferences(references, { tagId: "tag-gesture" }).map((item) => item._id)).toEqual([
      "pose-study",
    ]);
    expect(filterReferences(references, { boardId: "board-missing" })).toEqual([]);
  });

  it("matches tag names in search when a resolver is provided", () => {
    const tagNameFor = (tagId: string) =>
      tagId === "tag-gesture" ? "figure drawing" : undefined;

    expect(
      filterReferences(references, { query: "figure drawing", tagNameFor }).map((item) => item._id),
    ).toEqual(["pose-study"]);
    expect(filterReferences(references, { query: "figure drawing" })).toEqual([]);
  });

  it("filters favorites without losing search behavior", () => {
    expect(filterReferences(references, { favoritesOnly: true }).map((item) => item._id)).toEqual([
      "pose-study",
    ]);
    expect(
      filterReferences(references, { favoritesOnly: true, query: "fabric" }).map((item) => item._id),
    ).toEqual([]);
  });
});

describe("getSelectedReference", () => {
  it("uses the explicit selected item when it is visible", () => {
    expect(getSelectedReference(references, "fabric-ref")?._id).toBe("fabric-ref");
  });

  it("falls back to the first visible item when the selection is hidden", () => {
    const visible = filterReferences(references, { query: "color" });
    expect(getSelectedReference(visible, "pose-study")?._id).toBe("color-article");
  });

  it("returns undefined when nothing is visible", () => {
    expect(getSelectedReference([], "pose-study")).toBeUndefined();
  });
});

describe("assetLabel", () => {
  it("labels Drive, Convex, linked, and empty states", () => {
    expect(assetLabel({ _id: "1", storageProvider: "google_drive" })).toBe("Google Drive original");
    expect(assetLabel({ _id: "2", storageProvider: "convex" })).toBe("Convex fallback original");
    expect(assetLabel({ _id: "3", storageProvider: "linked" })).toBe("Linked source URL");
    expect(assetLabel(undefined)).toBe("Page only");
  });
});

describe("referenceMode", () => {
  it("keeps link-like items in the links lane and visual items in images", () => {
    expect(referenceMode("link")).toBe("links");
    expect(referenceMode("article")).toBe("links");
    expect(referenceMode("page")).toBe("links");
    expect(referenceMode("image")).toBe("images");
  });
});
