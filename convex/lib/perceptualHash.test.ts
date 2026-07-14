import { describe, expect, it } from "vitest";
import {
  hammingDistanceHex,
  sharedPaletteColors,
} from "./perceptualHash";

describe("perceptual hash similarity", () => {
  it("counts hexadecimal bit differences", () => {
    expect(hammingDistanceHex("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistanceHex("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistanceHex("000000000000000f", "0000000000000000")).toBe(4);
  });

  it("finds normalized shared palette colors", () => {
    expect(
      sharedPaletteColors(["#AABBCC", "#112233"], ["#aabbcc", "#445566"]),
    ).toEqual(["#aabbcc"]);
  });
});
