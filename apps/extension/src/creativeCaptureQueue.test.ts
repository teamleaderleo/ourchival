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

  it("bounds the queue to the newest items", () => {
    let queue = [] as ReturnType<typeof item>[];
    for (let index = 0; index <= MAX_CREATIVE_CAPTURE_QUEUE_ITEMS; index += 1) {
      queue = appendCreativeCaptureQueueItem(queue, item(String(index)));
    }
    expect(queue).toHaveLength(MAX_CREATIVE_CAPTURE_QUEUE_ITEMS);
    expect(queue[0]?.id).toBe("1");
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
