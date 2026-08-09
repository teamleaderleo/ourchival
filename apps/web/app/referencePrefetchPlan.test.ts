import { describe, expect, it } from "vitest";
import { planReferencePrefetch } from "./referencePrefetchPlan";

const items = Array.from({ length: 10 }, (_, index) => ({
  id: `r${index}`,
  thumbnailUrl: `https://thumb/${index}`,
  previewUrl: `https://preview/${index}`,
}));

describe("planReferencePrefetch", () => {
  it("warms thumbnails immediately beyond the visible range", () => {
    expect(
      planReferencePrefetch({
        items,
        visibleStart: 2,
        visibleEnd: 4,
        thumbnailAhead: 3,
        previewRadius: 0,
      }).thumbnails,
    ).toEqual([
      { id: "r5", url: "https://thumb/5" },
      { id: "r6", url: "https://thumb/6" },
      { id: "r7", url: "https://thumb/7" },
    ]);
  });

  it("warms previews around the selected item", () => {
    expect(
      planReferencePrefetch({
        items,
        visibleStart: 0,
        visibleEnd: 3,
        selectedId: "r6",
        previewRadius: 2,
      }).previews,
    ).toEqual([
      { id: "r4", url: "https://preview/4" },
      { id: "r5", url: "https://preview/5" },
      { id: "r6", url: "https://preview/6" },
      { id: "r7", url: "https://preview/7" },
      { id: "r8", url: "https://preview/8" },
    ]);
  });

  it("falls back to the visible start when nothing is selected", () => {
    expect(
      planReferencePrefetch({
        items,
        visibleStart: 3,
        visibleEnd: 5,
        previewRadius: 1,
      }).previews,
    ).toEqual([
      { id: "r2", url: "https://preview/2" },
      { id: "r3", url: "https://preview/3" },
      { id: "r4", url: "https://preview/4" },
    ]);
  });

  it("clamps ranges and removes duplicate/missing URLs", () => {
    const sparse = [
      { id: "a", thumbnailUrl: "https://same", previewUrl: "https://p/a" },
      { id: "b", thumbnailUrl: "https://same", previewUrl: null },
      { id: "c", thumbnailUrl: null, previewUrl: "https://p/c" },
    ];
    const plan = planReferencePrefetch({
      items: sparse,
      visibleStart: -100,
      visibleEnd: 0,
      thumbnailAhead: 10,
      previewRadius: 10,
    });

    expect(plan.thumbnails).toEqual([{ id: "b", url: "https://same" }]);
    expect(plan.previews).toEqual([
      { id: "a", url: "https://p/a" },
      { id: "c", url: "https://p/c" },
    ]);
  });
});
