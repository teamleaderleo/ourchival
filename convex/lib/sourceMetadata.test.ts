import { describe, expect, it } from "vitest";
import { metadataSummary } from "./sourceMetadata";

describe("metadataSummary", () => {
  it("lists the useful fields that were refreshed", () => {
    expect(
      metadataSummary({
        title: "Color notes",
        description: "A palette study",
        previewImageUrl: "https://example.com/preview.jpg",
        metadataStatus: "ready",
        metadataFetchedAt: 1,
      }),
    ).toBe("Updated title, description, preview.");
  });

  it("describes sparse and failed results", () => {
    expect(
      metadataSummary({
        metadataStatus: "missing",
        metadataFetchedAt: 1,
      }),
    ).toBe("Source returned sparse metadata.");
    expect(
      metadataSummary({
        metadataStatus: "failed",
        metadataFetchedAt: 1,
        error: "HTTP 403",
      }),
    ).toBe("HTTP 403");
  });
});
