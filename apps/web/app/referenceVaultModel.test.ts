import { describe, expect, it } from "vitest";
import {
  assetLabel,
  filterReferences,
  getSelectedReference,
  referenceKindLabel,
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

  it("filters favorites without losing search behavior", () => {
    expect(filterReferences(references, { favoritesOnly: true }).map((item) => item._id)).toEqual([
      "pose-study",
    ]);
    expect(
      filterReferences(references, { favoritesOnly: true, query: "fabric" }).map((item) => item._id),
    ).toEqual([]);
  });

  it("filters by all, images, and links lanes", () => {
    expect(filterReferences(references, { lane: "all" }).map((item) => item._id)).toEqual([
      "pose-study",
      "color-article",
      "fabric-ref",
    ]);
    expect(filterReferences(references, { lane: "images" }).map((item) => item._id)).toEqual([
      "pose-study",
      "fabric-ref",
    ]);
    expect(filterReferences(references, { lane: "links" }).map((item) => item._id)).toEqual([
      "color-article",
    ]);
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
    expect(assetLabel(undefined, "link")).toBe("Link only");
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

describe("referenceKindLabel", () => {
  it("labels the reference kind for compact UI badges", () => {
    expect(referenceKindLabel("link")).toBe("Link");
    expect(referenceKindLabel("article")).toBe("Article");
    expect(referenceKindLabel("image")).toBe("Image");
    expect(referenceKindLabel("something-else")).toBe("Reference");
  });
});
