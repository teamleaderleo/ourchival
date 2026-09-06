import { expect, it, vi } from "vitest";
import { createPreviewCache } from "./privatePreviewCache";

it("shares in-flight downloads and reuses a preview after a tile remounts", async () => {
  let finish!: (blob: Blob) => void;
  const load = vi.fn(() => new Promise<Blob>(resolve => { finish = resolve; }));
  const cache = createPreviewCache(load);
  const first = cache.get("private-image");
  expect(cache.get("private-image")).toBe(first);
  finish(new Blob(["pixels"]));
  await first;
  await cache.get("private-image");
  expect(load).toHaveBeenCalledTimes(1);
});

it("bounds retained bytes and clears private previews when access changes", async () => {
  const load = vi.fn(async () => new Blob(["1234"]));
  const cache = createPreviewCache(load, 6, 4);
  await cache.get("a");
  await cache.get("b");
  await cache.get("a");
  expect(load).toHaveBeenCalledTimes(3);
  cache.clear();
  await cache.get("a");
  expect(load).toHaveBeenCalledTimes(4);
});

it("retries failures and does not repopulate a cleared cache from a late response", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(new Blob(["ok"]));
  const cache = createPreviewCache(load);
  await expect(cache.get("a")).rejects.toThrow("offline");
  const pending = cache.get("a");
  cache.clear();
  await pending;
  await cache.get("a");
  expect(load).toHaveBeenCalledTimes(3);
});
