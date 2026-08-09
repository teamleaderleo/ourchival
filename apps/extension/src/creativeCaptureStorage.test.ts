import { afterEach, describe, expect, it, vi } from "vitest";
import { CREATIVE_CAPTURE_QUEUE_KEY, getCreativeCaptureQueue } from "./storage";

const payload = {
  kind: "image" as const,
  sourceUrl: "https://x.com/artist/status/1",
  assetUrl: "https://pbs.twimg.com/media/a.jpg",
  capturedAt: "2026-08-09T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("creative capture queue storage migration", () => {
  it("normalizes legacy x_post records to the X platform", async () => {
    stubStoredQueue([
      {
        id: "legacy",
        sourceKey: "x:1",
        source: "x_post",
        payloads: [payload],
        queuedAt: "2026-08-09T00:00:00.000Z",
        attempts: 2,
        lastError: "offline",
      },
    ]);

    expect(await getCreativeCaptureQueue()).toEqual([
      expect.objectContaining({
        id: "legacy",
        sourceKey: "x:1",
        platform: "x",
        source: "x_post",
        attempts: 2,
        lastError: "offline",
      }),
    ]);
  });

  it("preserves explicit modern creative platforms", async () => {
    stubStoredQueue([
      {
        id: "pixiv",
        sourceKey: "pixiv:1",
        platform: "pixiv",
        payloads: [{ ...payload, sourceUrl: "https://www.pixiv.net/artworks/1" }],
        queuedAt: "2026-08-09T00:00:00.000Z",
        attempts: 0,
      },
      {
        id: "danbooru",
        sourceKey: "danbooru:2",
        platform: "danbooru",
        payloads: [{ ...payload, sourceUrl: "https://danbooru.donmai.us/posts/2" }],
        queuedAt: "2026-08-09T00:00:01.000Z",
        attempts: 0,
      },
    ]);

    expect((await getCreativeCaptureQueue()).map((item) => item.platform)).toEqual([
      "pixiv",
      "danbooru",
    ]);
  });

  it("drops malformed persisted entries instead of poisoning the drain", async () => {
    stubStoredQueue([
      null,
      { id: "missing-payloads", queuedAt: "2026-08-09T00:00:00.000Z" },
      {
        id: "valid",
        platform: "x",
        payloads: [payload],
        queuedAt: "2026-08-09T00:00:00.000Z",
        attempts: 0,
      },
    ]);

    expect(await getCreativeCaptureQueue()).toEqual([
      expect.objectContaining({ id: "valid", platform: "x" }),
    ]);
  });
});

function stubStoredQueue(queue: unknown[]) {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async () => ({ [CREATIVE_CAPTURE_QUEUE_KEY]: queue })),
      },
    },
  });
}
