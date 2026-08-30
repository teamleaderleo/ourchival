import { describe, expect, it } from "vitest";
import {
  preferenceSnapshotJson,
  reviewPreferenceFromReference,
} from "./reviewPreferences";

const baseReference = {
  _id: "reference-1",
  sourceUrl: "https://example.com/art/1",
  canonicalUrl: "https://example.com/art/1",
  title: "ZZZReview · Promeia · Moon",
  authorName: "Miyano Haruto",
  authorHandle: "@miyano",
  platform: "generic" as const,
  reviewedAt: 1_788_000_000_000,
  archived: false,
  deleted: false,
};

describe("reviewPreferenceFromReference", () => {
  it("maps the review lanes to Yes, Maybe and No without image metadata", () => {
    const snapshot = {
      jsonMetadata: JSON.stringify({
        previewImageUrl: "https://images.example/preview.jpg",
        rawMetadata: {
          character: "Promeia",
          artist: "ignored because the reference has an author",
          sourceKind: "fan-art-mirror",
          accessToken: "must not escape",
        },
      }),
    };

    expect(
      reviewPreferenceFromReference(
        { ...baseReference, triageState: "kept" as const },
        snapshot,
      ),
    ).toEqual({
      referenceId: "reference-1",
      decision: "yes",
      triageState: "kept",
      reviewedAt: 1_788_000_000_000,
      title: "ZZZReview · Promeia · Moon",
      sourceUrl: "https://example.com/art/1",
      canonicalUrl: "https://example.com/art/1",
      character: "Promeia",
      authorName: "Miyano Haruto",
      authorHandle: "@miyano",
      platform: "generic",
      sourceKind: "fan-art-mirror",
    });

    expect(
      reviewPreferenceFromReference(
        { ...baseReference, triageState: "later" as const },
        snapshot,
      )?.decision,
    ).toBe("maybe");
    expect(
      reviewPreferenceFromReference(
        { ...baseReference, triageState: "inbox" as const, archived: true },
        snapshot,
      ),
    ).toMatchObject({ decision: "no", triageState: "archived" });
  });

  it("omits inbox, trash and unreviewed references", () => {
    expect(
      reviewPreferenceFromReference(
        { ...baseReference, triageState: "inbox" as const },
        null,
      ),
    ).toBeUndefined();
    expect(
      reviewPreferenceFromReference(
        { ...baseReference, triageState: "kept" as const, deleted: true },
        null,
      ),
    ).toBeUndefined();
    expect(
      reviewPreferenceFromReference(
        { ...baseReference, triageState: "kept" as const, reviewedAt: undefined },
        null,
      ),
    ).toBeUndefined();
  });
});

describe("preferenceSnapshotJson", () => {
  it("contains only the compact review contract", () => {
    const item = reviewPreferenceFromReference(
      { ...baseReference, triageState: "kept" as const },
      { jsonMetadata: JSON.stringify({ rawMetadata: { character: "Promeia" } }) },
    );
    const json = preferenceSnapshotJson(item ? [item] : [], 1_788_000_000_100);
    const parsed = JSON.parse(json);

    expect(parsed).toMatchObject({
      schemaVersion: 1,
      updatedAt: 1_788_000_000_100,
      items: [
        {
          referenceId: "reference-1",
          decision: "yes",
          artist: "Miyano Haruto",
          handle: "@miyano",
        },
      ],
    });
    expect(parsed.items[0]).not.toHaveProperty("authorName");
    expect(parsed.items[0]).not.toHaveProperty("authorHandle");
    expect(json).not.toMatch(/previewImageUrl|accessToken|image bytes/i);
  });
});
