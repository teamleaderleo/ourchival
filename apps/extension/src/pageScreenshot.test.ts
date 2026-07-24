import { describe, expect, it } from "vitest";
import {
  isScreenshotUrl,
  screenshotFile,
  sha256Hex,
} from "./pageScreenshot";

describe("page screenshot helpers", () => {
  it("accepts public web pages and rejects protected schemes", () => {
    expect(isScreenshotUrl("https://example.com/page")).toBe(true);
    expect(isScreenshotUrl("http://localhost:3000/page")).toBe(true);
    expect(isScreenshotUrl("chrome://extensions")).toBe(false);
    expect(isScreenshotUrl("edge://settings")).toBe(false);
    expect(isScreenshotUrl(undefined)).toBe(false);
  });

  it("turns an image data URL into an uploadable file", async () => {
    const file = await screenshotFile("data:image/jpeg;base64,SGVsbG8=");
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(5);
  });

  it("rejects non-image data", async () => {
    await expect(
      screenshotFile("data:text/plain;base64,SGVsbG8="),
    ).rejects.toThrow("JPEG, PNG, or WebP");
  });

  it("produces stable SHA-256 hashes", async () => {
    const bytes = new TextEncoder().encode("ourchival screenshot");
    expect(await sha256Hex(bytes.buffer)).toBe(
      "43cfd93070699834eb80aad74129affdc5e3d7945ed0f81e9bc5a2236a91f8c6",
    );
  });
});
