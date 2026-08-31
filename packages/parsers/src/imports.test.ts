import { describe, expect, it } from "vitest";
import { oneTabFixtureChunks } from "./importFixture";
import { digestImport, parseImport, type ImportSourceKind } from "./imports";

async function* chunks(...values: string[]) {
  yield* values;
}

async function collect(source: ImportSourceKind, ...values: string[]) {
  const records = [];
  for await (const record of parseImport(source, chunks(...values)))
    records.push(record);
  return records;
}

describe("resumable import parsers", () => {
  it("preserves duplicate OneTab occurrences and title pipes", async () => {
    await expect(
      collect(
        "onetab",
        "https://example.test/a | First | detail\nhttps://example.test/a | Copy\n",
      ),
    ).resolves.toEqual([
      {
        ordinal: 0,
        submittedUrl: "https://example.test/a",
        submittedTitle: "First | detail",
      },
      {
        ordinal: 1,
        submittedUrl: "https://example.test/a",
        submittedTitle: "Copy",
      },
    ]);
  });

  it("keeps malformed source rows so the server can acknowledge them as skipped", async () => {
    await expect(
      collect(
        "url_list",
        "plain text\nchrome://bookmarks\nhttps://example.test/a\n",
      ),
    ).resolves.toEqual([
      { ordinal: 0, submittedUrl: "plain text" },
      { ordinal: 1, submittedUrl: "chrome://bookmarks" },
      { ordinal: 2, submittedUrl: "https://example.test/a" },
    ]);
  });

  it("is invariant to line and UTF-8 chunk boundaries", async () => {
    const whole = await collect(
      "onetab",
      "https://example.test/a | Café\r\nhttps://example.test/b\n",
    );
    const split = await collect(
      "onetab",
      "https://example.test/a | Caf",
      "é\r",
      "\nhttps://example.test/b",
      "\n",
    );
    expect(split).toEqual(whole);
  });

  it("streams bookmarks with decoded titles and folder breadcrumbs", async () => {
    const records = await collect(
      "bookmarks",
      '<DL><DT><H3>Art &amp; notes</H3><DL><DT><A HREF="https://example.test/a?x=1&amp;y=2">A ',
      "title</A></DL></DL>",
    );
    expect(records).toEqual([
      {
        ordinal: 0,
        submittedUrl: "https://example.test/a?x=1&y=2",
        submittedTitle: "A title",
        sourceGroup: "Art & notes",
      },
    ]);
  });

  it("decodes bookmark title and folder entities at every text boundary", async () => {
    const html =
      '<DL><DT><H3>Art &#x26; notes</H3><DL><DT><A HREF="https://example.test/a">Color &#38; value</A></DL></DL>';
    const expected = [
      {
        ordinal: 0,
        submittedUrl: "https://example.test/a",
        submittedTitle: "Color & value",
        sourceGroup: "Art & notes",
      },
    ];

    for (let boundary = 1; boundary < html.length; boundary += 1) {
      expect(
        await collect(
          "bookmarks",
          html.slice(0, boundary),
          html.slice(boundary),
        ),
      ).toEqual(expected);
    }
    expect(
      await collect(
        "bookmarks",
        "<DL><DT><H3>Art &am",
        'p; notes</H3><DL><DT><A HREF="https://example.test/a">Color &am',
        "p; value</A></DL></DL>",
      ),
    ).toEqual(expected);
  });

  it("regenerates the deterministic 50,000-link identity", async () => {
    const result = await digestImport(
      "onetab",
      parseImport("onetab", oneTabFixtureChunks()),
    );
    expect(result.count).toBe(50_000);
    expect(result.digest).toBe(
      "e6f133f7b662864fcb70e7766fbe1af493510dc4d467f3261249774942a8580e",
    );
  }, 30_000);
});
