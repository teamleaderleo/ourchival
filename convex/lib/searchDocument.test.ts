import { describe, expect, it } from "vitest";
import {
  buildSearchDocument,
  collectionOf,
  indexQuery,
  laneOf,
  normalizedText,
  searchMatchReasons,
} from "./searchDocument";

const empty = () => ({ tags: [], boards: [], uses: [], visual: [] });
describe("search-first documents", () => {
  it("combines source, saved metadata and machine fields without changing the reference", () => {
    const reference = {
      title: "Blue study",
      notes: "lighting",
      sourceUrl: "https://example.com/1",
    };
    const before = JSON.stringify(reference);
    const result = buildSearchDocument(
      reference,
      { postText: "pose reference" },
      {
        ...empty(),
        visual: [
          {
            assetId: "a",
            tags: [{ name: "blue_hair", category: "general", confidence: 0.9 }],
            ocrText: "雨の日",
          },
        ],
      },
    );
    expect(result.text).toContain("blue hair");
    expect(result.text).toContain("雨の日");
    expect(result.fields.find((f) => f.field === "title")?.origin).toBe(
      "catalog",
    );
    expect(result.fields.find((f) => f.field === "notes")?.origin).toBe(
      "owner",
    );
    expect(
      result.fields.find((f) => f.field === "source.postText")?.origin,
    ).toBe("source");
    expect(result.fields.find((f) => f.field === "visual.a.ocr")?.origin).toBe(
      "machine",
    );
    expect(JSON.stringify(reference)).toBe(before);
  });
  it("respects human rejections across tag spelling normalization", () => {
    const result = buildSearchDocument({}, null, {
      ...empty(),
      visual: [
        {
          assetId: "a",
          rejectedTags: ["blue hair"],
          hideOcr: true,
          hideCaption: true,
          tags: [{ name: "blue_hair", category: "general", confidence: 0.9 }],
          ocrText: "hidden text",
          caption: "hidden caption",
        },
      ],
    });
    expect(result.text).toBe("");
  });
  it("excludes artist and rating predictions from retrieval tags", () => {
    const result = buildSearchDocument({}, null, {
      ...empty(),
      visual: [
        {
          assetId: "a",
          tags: [
            { name: "artist_guess", category: "artist", confidence: 0.99 },
            { name: "explicit", category: "rating", confidence: 0.99 },
          ],
        },
      ],
    });
    expect(result.text).toBe("");
  });
  it("explains terms found in separate fields", () => {
    const result = buildSearchDocument({ title: "Blue" }, null, {
      ...empty(),
      visual: [
        {
          assetId: "a",
          tags: [{ name: "raincoat", category: "general", confidence: 0.9 }],
        },
      ],
    });
    expect(searchMatchReasons(result.fields, "blue raincoat")).toHaveLength(2);
  });
  it("bounds search text and flags truncation", () => {
    const result = buildSearchDocument(
      { notes: "a".repeat(9000) },
      null,
      empty(),
    );
    expect(result.text).toHaveLength(8000);
    expect(result.truncated).toBe(true);
  });
  it("normalizes Unicode and caps query terms", () => {
    expect(normalizedText(" ＢＬＵＥ_hair  ")).toBe("blue hair");
    expect(indexQuery("blue_hair OR (raincoat) 日本語")).toBe(
      "blue hair or raincoat 日本語",
    );
    expect(
      indexQuery(
        Array.from({ length: 30 }, (_, i) => `term${i}`).join(" "),
      ).split(" "),
    ).toHaveLength(16);
  });
  it("keeps current collection precedence", () => {
    expect(collectionOf({ deleted: true, archived: true })).toBe("trash");
    expect(collectionOf({ archived: true, triageState: "inbox" })).toBe(
      "archive",
    );
    expect(collectionOf({ triageState: "later" })).toBe("later");
    expect(collectionOf({})).toBe("library");
    expect(laneOf("article")).toBe("links");
    expect(laneOf("image")).toBe("images");
  });
});
