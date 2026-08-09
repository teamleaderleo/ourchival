import type { CapturePayload } from "@ourchival/shared";
import { describe, expect, it } from "vitest";
import {
  MAX_CREATIVE_CAPTURE_QUEUE_BYTES,
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

  it("refreshes a queued source while preserving its stable queue identity", () => {
    const first = item("first", "x:123");
    const replacement = createCreativeCaptureQueueItem({
      id: "replacement",
      sourceKey: "x:123",
      source: "x_post",
      payloads: [{ ...payload, postText: "new snapshot" }],
      queuedAt: "2026-08-09T01:00:00.000Z",
    });
    const next = appendCreativeCaptureQueueItem([first], replacement);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "first",
      sourceKey: "x:123",
      queuedAt: first.queuedAt,
      attempts: 0,
    });
    expect(next[0]?.payloads[0]).toMatchObject({ postText: "new snapshot" });
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

  it("still refreshes the same source when the queue is full", () => {
    const queue = Array.from({ length: MAX_CREATIVE_CAPTURE_QUEUE_ITEMS }, (_, index) =>
      item(String(index)),
    );
    const replacement = createCreativeCaptureQueueItem({
      id: "replacement",
      sourceKey: "x:0",
      source: "x_post",
      payloads: [{ ...payload, postText: "updated" }],
    });
    const next = appendCreativeCaptureQueueItem(queue, replacement);
    expect(next).toHaveLength(MAX_CREATIVE_CAPTURE_QUEUE_ITEMS);
    expect(next.at(-1)).toMatchObject({ id: "0", sourceKey: "x:0" });
    expect(next.at(-1)?.payloads[0]).toMatchObject({ postText: "updated" });
  });

  it("rejects a queue that would exceed the storage byte budget", () => {
    const oversized = createCreativeCaptureQueueItem({
      id: "oversized",
      sourceKey: "x:oversized",
      source: "x_post",
      payloads: [
        {
          ...payload,
          rawMetadata: "x".repeat(MAX_CREATIVE_CAPTURE_QUEUE_BYTES),
        },
      ],
    });
    expect(() => appendCreativeCaptureQueueItem([], oversized)).toThrow(
      /storage budget/i,
    );
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
