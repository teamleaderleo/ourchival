import { describe, expect, it } from "vitest";
import { masonryWindow } from "./masonryWindow";
describe("windowed masonry", () => {
  it("mounts a bounded window in a ten-thousand-image column", () => {
    const result = masonryWindow(
      Array.from({ length: 10000 }, () => 300),
      1500000,
      900,
    );
    expect(result.end - result.start).toBeLessThan(12);
    expect(result.total).toBe(3000000);
    expect(result.start).toBeGreaterThan(4900);
  });
  it("keeps earlier offsets stable when another page is appended", () => {
    const before = masonryWindow([120, 500, 80], 0, 400);
    const after = masonryWindow([120, 500, 80, 900, 200], 0, 400);
    expect(after.offsets.slice(0, before.offsets.length)).toEqual(
      before.offsets,
    );
  });
  it("handles empty lists and scrolling past the end", () => {
    expect(masonryWindow([], 0, 900)).toMatchObject({
      start: 0,
      end: 0,
      total: 0,
    });
    expect(masonryWindow([200], 9000, 900)).toMatchObject({
      start: 1,
      end: 1,
      total: 200,
    });
  });
});
