import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearReferenceCache,
  loadCachedReferencePage,
  saveCachedReferencePage,
} from "./referenceLocalCache";
import { createCachedReferencePage } from "./referenceCacheModel";

const counts = {
  inbox: 0,
  all: 0,
  images: 0,
  links: 0,
  favorites: 0,
  later: 0,
  archive: 0,
  trash: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reference local cache", () => {
  it("degrades to a cache miss when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(
      loadCachedReferencePage({ view: "all", query: "" }),
    ).resolves.toBeUndefined();
    await expect(
      saveCachedReferencePage(
        createCachedReferencePage({
          view: "all",
          query: "",
          references: [],
          counts,
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(clearReferenceCache()).resolves.toBeUndefined();
  });

  it("treats an IndexedDB open failure as a cache miss", async () => {
    vi.stubGlobal("indexedDB", {
      open() {
        const request: Record<string, unknown> = {};
        queueMicrotask(() => {
          const handler = request.onerror as (() => void) | undefined;
          handler?.();
        });
        return Object.assign(request, {
          error: new Error("blocked"),
        });
      },
    });

    await expect(
      loadCachedReferencePage({ view: "images", query: "blue" }),
    ).resolves.toBeUndefined();
  });
});
