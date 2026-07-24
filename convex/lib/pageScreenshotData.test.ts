import { describe, expect, it } from "vitest";
import {
  decodeScreenshotDataUrl,
  isPageLike,
  positiveInteger,
  sha256Hex,
  validTimestamp,
} from "./pageScreenshotData";

describe("page screenshot data", () => {
  it("decodes supported image data URLs", () => {
    const decoded = decodeScreenshotDataUrl("data:image/jpeg;base64,SGVsbG8=");
    expect(decoded.mimeType).toBe("image/jpeg");
    expect(Array.from(decoded.bytes)).toEqual([72, 101, 108, 108, 111]);
  });

  it("rejects unsupported and malformed data URLs", () => {
    expect(() =>
      decodeScreenshotDataUrl("data:text/plain;base64,SGVsbG8="),
    ).toThrow("JPEG, PNG, or WebP");
    expect(() =>
      decodeScreenshotDataUrl("data:image/jpeg,not-base64"),
    ).toThrow("JPEG, PNG, or WebP");
  });

  it("produces stable SHA-256 content hashes", async () => {
    const bytes = new TextEncoder().encode("ourchival screenshot");
    expect(await sha256Hex(bytes)).toBe(
      "43cfd93070699834eb80aad74129affdc5e3d7945ed0f81e9bc5a2236a91f8c6",
    );
  });

  it("normalizes optional dimensions and timestamps", () => {
    expect(positiveInteger(800.9)).toBe(800);
    expect(positiveInteger(0)).toBeUndefined();
    expect(positiveInteger(Number.NaN)).toBeUndefined();
    expect(validTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(validTimestamp(-1)).toBeUndefined();
  });

  it("limits screenshots to page-like references", () => {
    expect(isPageLike("page")).toBe(true);
    expect(isPageLike("link")).toBe(true);
    expect(isPageLike("article")).toBe(true);
    expect(isPageLike("image")).toBe(false);
  });
});
