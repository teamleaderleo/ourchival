import { describe, expect, it } from "vitest";
import {
  normalizeCaptureEndpoint,
  normalizePairingEndpoint,
  normalizeSiteRoot,
  normalizeXLikesImportState,
} from "./storage";

describe("normalizeSiteRoot", () => {
  it("accepts HTTPS origins and strips known endpoint suffixes", () => {
    expect(normalizeSiteRoot("https://safe.convex.site/capture")).toBe(
      "https://safe.convex.site",
    );
    expect(normalizePairingEndpoint("https://safe.convex.site/capture")).toBe(
      "https://safe.convex.site/clipper-exchange",
    );
    expect(
      normalizeCaptureEndpoint("https://safe.convex.site/clipper-exchange"),
    ).toBe("https://safe.convex.site/capture");
  });

  it("allows local HTTP development endpoints", () => {
    expect(normalizeSiteRoot("http://localhost:3210/capture")).toBe(
      "http://localhost:3210",
    );
    expect(normalizeSiteRoot("http://127.0.0.1:3210")).toBe(
      "http://127.0.0.1:3210",
    );
  });

  it("rejects insecure public, credentialed, and decorated endpoints", () => {
    expect(normalizeSiteRoot("http://example.com/capture")).toBeUndefined();
    expect(normalizeSiteRoot("javascript:alert(1)")).toBeUndefined();
    expect(
      normalizeSiteRoot("https://user:secret@example.com/capture"),
    ).toBeUndefined();
    expect(
      normalizeSiteRoot("https://example.com/capture?token=secret"),
    ).toBeUndefined();
    expect(
      normalizeSiteRoot("https://example.com/capture#settings"),
    ).toBeUndefined();
  });
});

describe("normalizeXLikesImportState", () => {
  it("migrates legacy extra-image counts away from duplicates", () => {
    expect(
      normalizeXLikesImportState({
        importId: "likes-1",
        profileUrl: "https://x.com/i/history/likes",
        running: false,
        exhausted: true,
        startedAt: "2026-08-31T00:00:00.000Z",
        updatedAt: "2026-08-31T01:00:00.000Z",
        chunks: 57,
        discoveredPosts: 684,
        captureAttempts: 737,
        saved: 684,
        duplicates: 53,
        failed: 0,
        skipped: 0,
      }),
    ).toMatchObject({
      attachedMedia: 53,
      duplicates: 0,
    });
  });

  it("keeps legacy timeline-end checkpoints resumable", () => {
    expect(
      normalizeXLikesImportState({
        importId: "likes-stalled",
        profileUrl: "https://x.com/i/history/likes",
        running: false,
        exhausted: true,
        startedAt: "2026-08-31T00:00:00.000Z",
        updatedAt: "2026-08-31T01:00:00.000Z",
        completedAt: "2026-08-31T01:00:00.000Z",
        chunks: 324,
        discoveredPosts: 3888,
        captureAttempts: 4356,
        saved: 3370,
        attachedMedia: 157,
        refreshedPosts: 763,
        duplicates: 0,
        failed: 0,
        skipped: 0,
        stopReason: "timeline_end",
      }),
    ).toMatchObject({
      exhausted: false,
      completedAt: undefined,
      stopReason: "stalled",
    });
  });
});
