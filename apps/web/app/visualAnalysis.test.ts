import { describe, expect, it } from "vitest";
import {
  averageHashFromRgba,
  dominantColorsFromRgba,
  hammingDistanceHex,
} from "./visualAnalysis";

function rgbaPixels(colors: Array<[number, number, number, number]>) {
  return new Uint8ClampedArray(colors.flat());
}

describe("averageHashFromRgba", () => {
  it("returns a stable 64-bit hexadecimal hash", () => {
    const colors = Array.from({ length: 64 }, (_, index) => {
      const value = index < 32 ? 0 : 255;
      return [value, value, value, 255] as [number, number, number, number];
    });
    expect(averageHashFromRgba(rgbaPixels(colors))).toBe("00000000ffffffff");
  });
});

describe("dominantColorsFromRgba", () => {
  it("quantizes repeated colors and ignores transparent pixels", () => {
    const pixels = rgbaPixels([
      [250, 10, 10, 255],
      [245, 15, 15, 255],
      [10, 20, 245, 255],
      [0, 0, 0, 0],
    ]);
    const colors = dominantColorsFromRgba(pixels, 2);
    expect(colors[0]).toMatch(/^#f[0-9a-f]{5}$/i);
    expect(colors[1]).toMatch(/^#[0-9a-f]{4}f[0-9a-f]$/i);
  });
});

describe("hammingDistanceHex", () => {
  it("counts differing bits", () => {
    expect(hammingDistanceHex("0000", "0000")).toBe(0);
    expect(hammingDistanceHex("0000", "ffff")).toBe(16);
    expect(hammingDistanceHex("0f", "00")).toBe(4);
  });
});
