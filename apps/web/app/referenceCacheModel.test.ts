import { describe, expect, it } from "vitest";
import {
  createCachedReferencePage,
  isUsableCachedReferencePage,
  normalizeCacheQuery,
  referenceCacheKey,
} from "./referenceCacheModel";

const counts = {
  inbox: 1,
  all: 10,
  images: 8,
  links: 2,
  favorites: 3,
  later: 1,
  archive: 4,
  trash: 0,
};

const reference = {
  _id: "reference-1",
  kind: "image",
  sourceUrl: "https://example.com/source",
  capturedAt: 1,
  platform: "generic",
  favorite: false,
  archived: false,
  deleted: false,
  assets: [],
  tags: [],
  tagIds: [],
  boardIds: [],
  projectIds: [],
} as never;

describe("reference cache model", () => {
  it("normalizes whitespace into one stable cache identity", () => {
    expect(normalizeCacheQuery("  blue   armor  ")).toBe("blue armor");
    expect(referenceCacheKey("images", " blue   armor ")).toBe(
      "images:blue armor",
    );
  });

  it("creates a bounded page snapshot for one view/query", () => {
    expect(
      createCachedReferencePage({
        view: "images",
        query: " blue   armor ",
        savedAt: 100,
        references: [reference],
        counts,
        continueCursor: "older",
        hasMore: true,
      }),
    ).toMatchObject({
      version: 1,
      key: "images:blue armor",
      view: "images",
      query: "blue armor",
      savedAt: 100,
      references: [reference],
      counts,
      continueCursor: "older",
      hasMore: true,
    });
  });

  it("accepts a fresh matching snapshot", () => {
    const page = createCachedReferencePage({
      view: "all",
      query: "",
      savedAt: 1_000,
      references: [reference],
      counts,
    });
    expect(
      isUsableCachedReferencePage(page, {
        view: "all",
        query: "",
        now: 2_000,
        maxAgeMs: 5_000,
      }),
    ).toBe(true);
  });

  it("rejects stale, future, mismatched, and version-skewed snapshots", () => {
    const page = createCachedReferencePage({
      view: "images",
      query: "blue",
      savedAt: 1_000,
      references: [reference],
      counts,
    });

    expect(
      isUsableCachedReferencePage(page, {
        view: "images",
        query: "blue",
        now: 10_000,
        maxAgeMs: 5_000,
      }),
    ).toBe(false);
    expect(
      isUsableCachedReferencePage(page, {
        view: "images",
        query: "blue",
        now: 500,
      }),
    ).toBe(false);
    expect(
      isUsableCachedReferencePage(page, {
        view: "images",
        query: "red",
        now: 2_000,
      }),
    ).toBe(false);
    expect(
      isUsableCachedReferencePage({ ...page, version: 99 }, {
        view: "images",
        query: "blue",
        now: 2_000,
      }),
    ).toBe(false);
  });
});
