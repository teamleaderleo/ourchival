import { describe, expect, it } from "vitest";
import { isCapturableUrl, parseBookmarksHtml, parseUrlList } from "./imports";

describe("parseUrlList", () => {
  it("parses raw URL lines", () => {
    expect(parseUrlList("https://example.com/one\nhttps://example.com/two")).toEqual([
      { url: "https://example.com/one" },
      { url: "https://example.com/two" },
    ]);
  });

  it("parses OneTab URL-first and title-first lines", () => {
    expect(
      parseUrlList(
        "https://example.com/art | Gesture reference\nColor notes | https://example.com/color",
      ),
    ).toEqual([
      { url: "https://example.com/art", title: "Gesture reference" },
      { url: "https://example.com/color", title: "Color notes" },
    ]);
  });

  it("deduplicates URLs and ignores browser-internal text", () => {
    expect(
      parseUrlList(
        "https://example.com/art\nhttps://example.com/art\nedge://favorites\nplain text",
      ),
    ).toEqual([{ url: "https://example.com/art" }]);
  });
});

describe("parseBookmarksHtml", () => {
  it("extracts titles and decoded URLs from browser exports", () => {
    const html = `
      <!DOCTYPE NETSCAPE-Bookmark-file-1>
      <DL><p>
        <DT><A HREF="https://example.com/search?a=1&amp;b=2">Color &amp; Value</A>
        <DT><A HREF="https://x.com/artist/status/1"><b>Artist post</b></A>
      </DL><p>
    `;

    expect(parseBookmarksHtml(html)).toEqual([
      { url: "https://example.com/search?a=1&b=2", title: "Color & Value" },
      { url: "https://x.com/artist/status/1", title: "Artist post" },
    ]);
  });

  it("deduplicates bookmarks and skips browser-internal pages", () => {
    const html = `
      <A HREF="https://example.com/art">Art</A>
      <A HREF="https://example.com/art">Art copy</A>
      <A HREF="edge://favorites">Favorites</A>
    `;

    expect(parseBookmarksHtml(html)).toEqual([
      { url: "https://example.com/art", title: "Art" },
    ]);
  });
});

describe("isCapturableUrl", () => {
  it("accepts HTTP sources and rejects browser pages", () => {
    expect(isCapturableUrl("https://x.com/artist/status/1")).toBe(true);
    expect(isCapturableUrl("http://localhost:3000")).toBe(true);
    expect(isCapturableUrl("edge://newtab")).toBe(false);
    expect(isCapturableUrl("chrome-extension://example/popup.html")).toBe(false);
  });
});
