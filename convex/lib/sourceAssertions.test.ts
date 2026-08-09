import { describe, expect, it } from "vitest";
import {
  buildSourceAssertions,
  sourceAssertionIdentity,
} from "./sourceAssertions";

describe("buildSourceAssertions", () => {
  it("preserves source display values while deduplicating lookup-equivalent tags", () => {
    const assertions = buildSourceAssertions({
      platform: "pixiv",
      sourceUrl: "https://www.pixiv.net/en/artworks/123#detail",
      observedAt: 100,
      tags: [
        { name: " Blue   Hour " },
        { name: "blue hour" },
        { name: "Ｂｌｕｅ Ｈｏｕｒ" },
      ],
    });

    expect(assertions).toEqual([
      {
        origin: "source",
        platform: "pixiv",
        sourceUrl: "https://www.pixiv.net/en/artworks/123",
        evidence: "source_native_tag",
        field: "tag",
        value: "Blue Hour",
        normalizedValue: "blue hour",
        observedAt: 100,
      },
    ]);
  });

  it("keeps Danbooru tag categories as separate namespaces", () => {
    const assertions = buildSourceAssertions({
      platform: "danbooru",
      sourceUrl: "https://danbooru.donmai.us/posts/1",
      observedAt: 200,
      tags: [
        { name: "mercy", namespace: "character" },
        { name: "mercy", namespace: "general" },
        { name: "Artist_Name", namespace: "artist" },
      ],
    });

    expect(assertions).toHaveLength(3);
    expect(assertions.map(sourceAssertionIdentity)).toEqual([
      "danbooru:source_native_tag:tag:character:mercy",
      "danbooru:source_native_tag:tag:general:mercy",
      "danbooru:source_native_tag:tag:artist:artist_name",
    ]);
  });

  it("records source-native categorical facts independently from tags", () => {
    const assertions = buildSourceAssertions({
      platform: "danbooru",
      sourceUrl: "https://danbooru.donmai.us/posts/2",
      observedAt: 300,
      tags: [{ name: "night" }],
      categories: [
        { field: "rating", value: "sensitive" },
        { field: "rating", value: "Sensitive" },
      ],
    });

    expect(assertions).toEqual([
      expect.objectContaining({
        evidence: "source_native_tag",
        field: "tag",
        value: "night",
      }),
      expect.objectContaining({
        evidence: "source_native_category",
        field: "rating",
        value: "sensitive",
        normalizedValue: "sensitive",
      }),
    ]);
  });

  it("drops invalid source evidence instead of manufacturing assertions", () => {
    expect(
      buildSourceAssertions({
        platform: "generic",
        sourceUrl: "javascript:alert(1)",
        observedAt: 1,
        tags: [{ name: "tag" }],
      }),
    ).toEqual([]);

    expect(
      buildSourceAssertions({
        platform: "generic",
        sourceUrl: "https://example.com/source",
        observedAt: Number.NaN,
        tags: [{ name: "tag" }],
        categories: [{ field: "rating", value: "safe" }],
      }),
    ).toEqual([]);
  });
});
