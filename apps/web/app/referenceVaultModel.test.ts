import { describe, expect, it } from "vitest";
import {
  assetLabel,
  filterReferences,
  getSelectedReference,
  referenceCollection,
  referenceDisplayTitle,
  referenceKindLabel,
  referenceMetadataLabel,
  referenceMode,
  searchTextOnly,
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
    authorName: "Moon Painter",
    authorHandle: "@moon_painter",
    capturedAt: 1,
    sourceSnapshot: {
      postText: "A blue-hour lighting study",
      altText: "Character with a rim-lit silhouette",
      selectedText: "Keep this palette relationship",
      createdAt: 1,
    },
    assets: [{ _id: "asset-1", storageProvider: "google_drive" }],
  },
  {
    _id: "color-article",
    kind: "article",
    title: "Color theory notes",
    notes: "palette and value grouping",
    favorite: false,
    sourceUrl: "https://example.com/color-theory",
    canonicalUrl: "https://example.com/lessons/color",
    platform: "generic",
    capturedAt: 2,
    sourceSnapshot: {
      pageTitle: "Color and value grouping",
      description: "A practical guide to temperature shifts and focal contrast",
      siteName: "Painter Notes",
      pageAuthor: "A. Artist",
      canonicalUrl: "https://example.com/lessons/color",
      contentType: "text/html",
      metadataStatus: "ready",
      metadataFetchedAt: 2,
      createdAt: 2,
    },
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

const triageReferences: SavedReference[] = [
  { ...references[0]!, _id: "inbox", triageState: "inbox" },
  { ...references[0]!, _id: "kept", triageState: "kept" },
  { ...references[0]!, _id: "legacy" },
  { ...references[0]!, _id: "later", triageState: "later" },
  { ...references[0]!, _id: "archive", archived: true },
  { ...references[0]!, _id: "trash", archived: true, deleted: true },
];

describe("filterReferences", () => {
  it("searches title, notes, URL, platform, kind, and source attribution", () => {
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
    expect(filterReferences(references, { query: "moon_painter" }).map((item) => item._id)).toEqual([
      "pose-study",
    ]);
  });

  it("searches post text, alt text, and selected quotations", () => {
    expect(filterReferences(references, { query: "blue-hour" }).map((item) => item._id)).toEqual([
      "pose-study",
    ]);
    expect(filterReferences(references, { query: "rim-lit" }).map((item) => item._id)).toEqual([
      "pose-study",
    ]);
    expect(filterReferences(references, { query: "palette relationship" }).map((item) => item._id)).toEqual([
      "pose-study",
    ]);
  });

  it("searches rich link description, site, author, canonical URL, and content type", () => {
    for (const query of [
      "temperature shifts",
      "Painter Notes",
      "A. Artist",
      "lessons/color",
      "text/html",
    ]) {
      expect(filterReferences(references, { query }).map((item) => item._id)).toEqual([
        "color-article",
      ]);
    }
  });

  it("ignores site and type tokens after the server applies them", () => {
    expect(searchTextOnly("site:example.com type:article")).toBe("");
    expect(
      filterReferences([references[1]!], {
        query: "site:example.com type:article",
      }).map((item) => item._id),
    ).toEqual(["color-article"]);
    expect(searchTextOnly("site:example.com type:article palette")).toBe("palette");
    expect(
      filterReferences(references, {
        query: "site:example.com type:article palette",
      }).map((item) => item._id),
    ).toEqual(["pose-study", "color-article"]);
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

  it("filters Inbox, Library, Later, Archive, and Trash independently", () => {
    expect(filterReferences(triageReferences, { collection: "inbox" }).map((item) => item._id)).toEqual([
      "inbox",
    ]);
    expect(filterReferences(triageReferences, { collection: "library" }).map((item) => item._id)).toEqual([
      "kept",
      "legacy",
    ]);
    expect(filterReferences(triageReferences, { collection: "later" }).map((item) => item._id)).toEqual([
      "later",
    ]);
    expect(filterReferences(triageReferences, { collection: "archive" }).map((item) => item._id)).toEqual([
      "archive",
    ]);
    expect(filterReferences(triageReferences, { collection: "trash" }).map((item) => item._id)).toEqual([
      "trash",
    ]);
  });
});

describe("referenceCollection", () => {
  it("treats pre-triage references as kept Library items", () => {
    expect(referenceCollection(references[0]!)).toBe("library");
  });

  it("gives Trash and Archive precedence over triage state", () => {
    expect(referenceCollection({ ...references[0]!, triageState: "inbox", archived: true })).toBe(
      "archive",
    );
    expect(
      referenceCollection({
        ...references[0]!,
        triageState: "inbox",
        archived: true,
        deleted: true,
      }),
    ).toBe("trash");
  });
});

describe("link display helpers", () => {
  it("uses captured page metadata as a title fallback", () => {
    const reference = {
      ...references[1]!,
      title: undefined,
    };
    expect(referenceDisplayTitle(reference)).toBe("Color and value grouping");
  });

  it("labels ready, sparse, failed, and pending metadata", () => {
    expect(referenceMetadataLabel(references[1]!)).toBe("Metadata ready");
    expect(
      referenceMetadataLabel({
        ...references[1]!,
        sourceSnapshot: {
          metadataStatus: "missing",
          createdAt: 3,
        },
      }),
    ).toBe("Sparse metadata");
    expect(
      referenceMetadataLabel({
        ...references[1]!,
        sourceSnapshot: {
          metadataStatus: "failed",
          httpStatus: 404,
          createdAt: 4,
        },
      }),
    ).toBe("HTTP 404");
    expect(referenceMetadataLabel(references[2]!)).toBe("Metadata pending");
  });
});

describe("getSelectedReference", () => {
  it("leaves the archive canvas unselected until the user chooses a reference", () => {
    expect(getSelectedReference(references, null)).toBeUndefined();
  });

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
