import { describe, expect, it } from "vitest";
import type { BatchCaptureState } from "./storage";
import { captureSessionReport, convexMutationUrl } from "./sessionReporting";

function batchState(overrides: Partial<BatchCaptureState> = {}): BatchCaptureState {
  return {
    jobId: "capture-session-1",
    source: "window",
    running: true,
    startedAt: "2026-07-24T00:00:00.000Z",
    total: 3,
    completed: 1,
    nextIndex: 1,
    saved: 1,
    duplicates: 0,
    failed: 0,
    skipped: 0,
    items: [
      { url: "https://example.com/one", title: "One" },
      { url: "https://example.com/two", title: "Two" },
      { url: "https://example.com/three", title: "Three" },
    ],
    successfulTabIds: [],
    failures: [],
    ...overrides,
  };
}

describe("capture session reporting", () => {
  it("derives the public Convex mutation endpoint from a capture endpoint", () => {
    expect(convexMutationUrl("https://quiet-otter-123.convex.site/capture")).toBe(
      "https://quiet-otter-123.convex.cloud/api/mutation",
    );
    expect(convexMutationUrl("http://127.0.0.1:3211/capture")).toBe(
      "http://127.0.0.1:3210/api/mutation",
    );
    expect(convexMutationUrl("https://example.com/capture")).toBeUndefined();
  });

  it("reports live import progress with durable counts", () => {
    expect(captureSessionReport(batchState())).toEqual({
      sessionKey: "capture-session-1",
      source: "window",
      kind: "import",
      label: "3 tabs from browser window",
      expectedCount: 3,
      completedCount: 1,
      savedCount: 1,
      duplicateCount: 0,
      skippedCount: 0,
      failedCount: 0,
      status: "running",
      startedAt: Date.parse("2026-07-24T00:00:00.000Z"),
    });
  });

  it("reports creative bundles and completed sessions", () => {
    expect(
      captureSessionReport(
        batchState({
          source: "x_post",
          running: false,
          completedAt: "2026-07-24T00:01:00.000Z",
          completed: 3,
          saved: 2,
          duplicates: 1,
          items: [
            {
              url: "https://x.com/artist/status/1",
              title: "Artist post",
              payload: {
                kind: "image",
                sourceUrl: "https://x.com/artist/status/1",
                assetUrl: "https://pbs.twimg.com/media/example.jpg",
                capturedAt: "2026-07-24T00:00:00.000Z",
              },
            },
          ],
        }),
      ),
    ).toMatchObject({
      source: "x_post",
      kind: "bundle",
      label: "Artist post",
      sourceUrl: "https://x.com/artist/status/1",
      completedCount: 3,
      savedCount: 2,
      duplicateCount: 1,
      status: "completed",
      completedAt: Date.parse("2026-07-24T00:01:00.000Z"),
    });
  });
});
