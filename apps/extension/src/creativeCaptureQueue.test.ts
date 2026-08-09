import type { CapturePayload } from "@ourchival/shared";
import { describe, expect, it } from "vitest";
import {
  MAX_CREATIVE_CAPTURE_QUEUE_ITEMS,
  appendCreativeCaptureQueueItem,
  createCreativeCaptureQueueItem,
  recordCreativeCaptureFailure,
  removeCreativeCaptureQueueItem,
} from "./creativeCaptureQueue";

const payload: CapturePayload = {
  kind: "image",
  sourceUrl: "https://x.com/artist/status/1",
  assetUrl: "https://pbs.twimg.com/media/a.jpg",
  capturedAt: "2026-08-09T00:00:00.000Z",
};

function item(id: string, sourceKey = `x:${id}`) {
  return createCreativeCaptureQueueItem({
    id,
    sourceKey,
    source: "x_post",
    payloads: [payload],
    queuedAt: "2026-08-09T00:00:00.000Z",
  });
}

describe("creative capture queue", () => {
  it("starts queue items with zero attempts", () => {
    expect(item("one")).toMatchObject({
      id: "one",
      sourceKey: "x:one",
      attempts: 0,
      source: "x_post",
    });
  });

  it("replaces an older queued item for the same source", () => {
    const first = item("first", "x:123");
    const replacement = item("replacement", "x:123");
    expect(appendCreativeCaptureQueueItem([first], replacement)).toEqual([
      replacement,
    ]);
  });

  it("rejects a new distinct save when the queue is full", () => {
    const queue = Array.from({ length: MAX_CREATIVE_CAPTURE_QUEUE_ITEMS }, (_, index) =>
      item(String(index)),
    );
    expect(() =>
      appendCreativeCaptureQueueItem(queue, item("overflow")),
    ).toThrow(/queue is full/i);
    expect(queue[0]?.id).toBe("0");
  });

  it("still replaces the same source when the queue is full", () => {
    const queue = Array.from({ length: MAX_CREATIVE_CAPTURE_QUEUE_ITEMS }, (_, index) =>
      item(String(index)),
    );
    const replacement = item("replacement", "x:0");
    const next = appendCreativeCaptureQueueItem(queue, replacement);
    expect(next).toHaveLength(MAX_CREATIVE_CAPTURE_QUEUE_ITEMS);
    expect(next.some((entry) => entry.id === "0")).toBe(false);
    expect(next.at(-1)).toEqual(replacement);
  });

  it("records failures without dropping the queued capture", () => {
    const queue = recordCreativeCaptureFailure([item("one")], "offline");
    expect(queue[0]).toMatchObject({ attempts: 1, lastError: "offline" });
  });

  it("removes only the completed queue item", () => {
    expect(removeCreativeCaptureQueueItem([item("one"), item("two")], "one")).toEqual([
      item("two"),
    ]);
  });

  it("rejects empty payload groups", () => {
    expect(() =>
      createCreativeCaptureQueueItem({
        id: "empty",
        source: "x_post",
        payloads: [],
      }),
    ).toThrow(/at least one payload/i);
  });
});
