import { describe, expect, it } from "vitest";
import { normalizeSourceUrl, sourceUrlsMatch } from "./urls";

describe("normalizeSourceUrl", () => {
  it("removes fragments and common tracking parameters", () => {
    expect(
      normalizeSourceUrl(
        "https://example.com/article/?utm_source=newsletter&topic=color&fbclid=abc#section",
      ),
    ).toBe("https://example.com/article?topic=color");
  });

  it("sorts meaningful parameters for stable comparisons", () => {
    expect(normalizeSourceUrl("https://example.com/search?z=last&a=first")).toBe(
      "https://example.com/search?a=first&z=last",
    );
  });

  it("normalizes Twitter hosts and share parameters to x.com", () => {
    expect(
      normalizeSourceUrl("https://mobile.twitter.com/artist/status/123?s=20&t=token"),
    ).toBe("https://x.com/artist/status/123");
  });

  it("keeps invalid URL-like text stable instead of throwing", () => {
    expect(normalizeSourceUrl("  saved-note-without-a-url  ")).toBe(
      "saved-note-without-a-url",
    );
  });
});

describe("sourceUrlsMatch", () => {
  it("matches source variants after normalization", () => {
    expect(
      sourceUrlsMatch(
        "https://twitter.com/artist/status/123?s=20",
        "https://x.com/artist/status/123",
      ),
    ).toBe(true);
  });
});
