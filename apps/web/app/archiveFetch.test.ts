import { afterEach, expect, it, vi } from "vitest";
import { fetchArchivePage } from "./archiveFetch";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("recovers one transient read failure", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(new Response("ok"));
  vi.stubGlobal("fetch", fetcher);
  const result = fetchArchivePage("/references", new AbortController().signal);
  await vi.runAllTimersAsync();
  expect((await result).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not retry authentication or application errors", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("denied", { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  expect((await fetchArchivePage("/references", new AbortController().signal)).status).toBe(401);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("cancels the pending retry when the user changes view", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetcher = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  const result = fetchArchivePage("/references", controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await rejected;
  await vi.runAllTimersAsync();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("stops after the second transient response", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response("busy", { status: 503 })));
  vi.stubGlobal("fetch", fetcher);
  const result = fetchArchivePage("/references", new AbortController().signal);
  await vi.runAllTimersAsync();
  expect((await result).status).toBe(503);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
