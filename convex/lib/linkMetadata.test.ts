import { describe, expect, it } from "vitest";
import {
  isSafePublicUrl,
  parseLinkMetadataHtml,
} from "./linkMetadata";

describe("parseLinkMetadataHtml", () => {
  it("parses Open Graph, canonical, author, favicon, and relative image URLs", () => {
    const metadata = parseLinkMetadataHtml(
      `<!doctype html>
      <html>
        <head>
          <title>Fallback title</title>
          <link rel="canonical" href="/articles/color-study?utm_source=test">
          <link rel="shortcut icon" href="/favicon.ico">
          <meta property="og:title" content="Color &amp; Light">
          <meta property="og:description" content="A practical value study.">
          <meta property="og:site_name" content="Painter Notes">
          <meta property="og:image" content="/images/card.jpg">
          <meta name="author" content="A. Artist">
        </head>
      </html>`,
      "https://example.com/source/page",
    );

    expect(metadata).toMatchObject({
      canonicalUrl: "https://example.com/articles/color-study?utm_source=test",
      title: "Color & Light",
      description: "A practical value study.",
      siteName: "Painter Notes",
      faviconUrl: "https://example.com/favicon.ico",
      previewImageUrl: "https://example.com/images/card.jpg",
      author: "A. Artist",
      metadataStatus: "ready",
    });
  });

  it("falls back to document title and reports sparse pages", () => {
    expect(
      parseLinkMetadataHtml(
        "<html><head><title>  Gesture   Archive  </title></head></html>",
        "https://example.com/gesture",
      ),
    ).toMatchObject({
      canonicalUrl: "https://example.com/gesture",
      title: "Gesture Archive",
      metadataStatus: "ready",
    });

    expect(
      parseLinkMetadataHtml("<html><body>Plain page</body></html>", "https://example.com/plain"),
    ).toMatchObject({
      canonicalUrl: "https://example.com/plain",
      metadataStatus: "missing",
    });
  });
});

describe("isSafePublicUrl", () => {
  it("accepts public HTTP URLs", () => {
    expect(isSafePublicUrl("https://example.com/article")).toBe(true);
    expect(isSafePublicUrl("http://203.0.113.20/reference")).toBe(true);
  });

  it("blocks local, credentialed, and private network targets", () => {
    expect(isSafePublicUrl("http://localhost:3000")).toBe(false);
    expect(isSafePublicUrl("http://127.0.0.1/admin")).toBe(false);
    expect(isSafePublicUrl("http://192.168.1.2/image")).toBe(false);
    expect(isSafePublicUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafePublicUrl("https://user:secret@example.com")).toBe(false);
    expect(isSafePublicUrl("file:///tmp/private")).toBe(false);
  });
});