import { describe, expect, it } from "vitest";
import {
  averageHashFromGrayscale,
  dominantColorsFromRgba,
} from "./imageAnalysis";

describe("averageHashFromGrayscale", () => {
  it("returns a stable 64-bit hexadecimal hash", () => {
    const pixels = Uint8Array.from(
      { length: 64 },
      (_, index) => (index % 8 < 4 ? 20 : 220),
    );

    expect(averageHashFromGrayscale(pixels)).toBe("0f0f0f0f0f0f0f0f");
  });

  it("rejects samples that are not 8 by 8", () => {
    expect(() => averageHashFromGrayscale(new Uint8Array(63))).toThrow(
      "8×8 grayscale",
    );
  });
});

describe("dominantColorsFromRgba", () => {
  it("ranks opaque color bins by frequency", () => {
    const pixels = new Uint8Array([
      250, 10, 10, 255,
      244, 12, 12, 255,
      246, 14, 14, 255,
      10, 20, 250, 255,
      255, 255, 255, 0,
    ]);

    expect(dominantColorsFromRgba(pixels, 2)).toEqual(["#f70c0c", "#0a14fa"]);
  });
});
