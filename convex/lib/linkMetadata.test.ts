import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLinkMetadata,
  fetchPublicResponse,
  isSafePublicUrl,
  parseLinkMetadataHtml,
  parseHoyolabPostMetadata,
} from "./linkMetadata";

afterEach(() => {
  vi.restoreAllMocks();
});

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
      parseLinkMetadataHtml(
        "<html><body>Plain page</body></html>",
        "https://example.com/plain",
      ),
    ).toMatchObject({
      canonicalUrl: "https://example.com/plain",
      metadataStatus: "missing",
    });
  });
});

describe("parseHoyolabPostMetadata", () => {
  it("uses the actual HoYoLAB post image instead of the generic app shell", () => {
    expect(
      parseHoyolabPostMetadata(
        {
          retcode: 0,
          data: {
            post: {
              post: {
                subject: "Velina Airgid graphic",
                desc: "graphic by me",
              },
              user: { nickname: "_caiserr" },
              image_list: [
                {
                  url: "https://upload-os-bbs.hoyolab.com/upload/velina.png",
                },
              ],
            },
          },
        },
        "https://www.hoyolab.com/article/45947723",
        123,
      ),
    ).toEqual({
      canonicalUrl: "https://www.hoyolab.com/article/45947723",
      title: "Velina Airgid graphic",
      description: "graphic by me",
      siteName: "HoYoLAB",
      faviconUrl: "https://www.hoyolab.com/favicon.ico",
      previewImageUrl:
        "https://upload-os-bbs.hoyolab.com/upload/velina.png",
      author: "_caiserr",
      contentType: "text/html",
      httpStatus: 200,
      metadataStatus: "ready",
      metadataFetchedAt: 123,
    });
  });

  it("routes HoYoLAB article URLs through the first-party post API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        retcode: 0,
        data: {
          post: {
            post: { subject: "Character study" },
            user: { nickname: "Artist" },
            image_list: [
              { url: "https://upload-os-bbs.hoyolab.com/upload/study.png" },
            ],
          },
        },
      }),
    );

    const metadata = await fetchLinkMetadata(
      "https://www.hoyolab.com/article/45947723",
    );

    expect(metadata).toMatchObject({
      title: "Character study",
      author: "Artist",
      previewImageUrl:
        "https://upload-os-bbs.hoyolab.com/upload/study.png",
      metadataStatus: "ready",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=45947723",
    );
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
    expect(isSafePublicUrl("http://169.254.169.254/latest/meta-data")).toBe(
      false,
    );
    expect(isSafePublicUrl("https://user:secret@example.com")).toBe(false);
    expect(isSafePublicUrl("file:///tmp/private")).toBe(false);
  });
});

describe("fetchPublicResponse", () => {
  it("blocks redirects to private network targets before requesting them", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      }),
    );

    await expect(
      fetchPublicResponse("https://example.com/image"),
    ).rejects.toThrow("blocked for a local or private URL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/image",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("follows a bounded public redirect and reports the final URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "/original.jpg" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("image", {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );

    const result = await fetchPublicResponse("https://example.com/preview.jpg");
    expect(result.finalUrl).toBe("https://example.com/original.jpg");
    expect(result.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
