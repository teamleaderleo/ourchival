import { describe, expect, it } from "vitest";
import { detectPlatform } from "./platform";

describe("detectPlatform", () => {
  it("detects the primary creative source hosts", () => {
    expect(detectPlatform("https://x.com/artist/status/1")).toBe("x");
    expect(detectPlatform("https://www.pixiv.net/en/artworks/1")).toBe("pixiv");
    expect(detectPlatform("https://www.pinterest.com/pin/1/")).toBe("pinterest");
    expect(detectPlatform("https://danbooru.donmai.us/posts/1")).toBe("danbooru");
  });

  it("keeps unrelated donmai hosts generic", () => {
    expect(detectPlatform("https://donmai.us/example")).toBe("generic");
  });

  it("falls back to generic for malformed and unrelated URLs", () => {
    expect(detectPlatform("not a URL")).toBe("generic");
    expect(detectPlatform("https://example.com/art")).toBe("generic");
  });
});
