import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { startVisiblePolling } from "./visiblePolling";
let stop: (() => void) | undefined;
beforeEach(() => {
  const page = new EventTarget();
  Object.defineProperty(page, "visibilityState", { configurable: true, get: () => "visible" });
  const network = {};
  Object.defineProperty(network, "onLine", { configurable: true, get: () => true });
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", network);
});
afterEach(() => { stop?.(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function visibility(value: "visible" | "hidden") {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(value);
  document.dispatchEvent(new Event("visibilitychange"));
}
test("hidden and offline pages make no requests, and return refreshes immediately", async () => {
  vi.useFakeTimers();
  visibility("hidden");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const task = vi.fn(async () => {});
  stop = startVisiblePolling(task, () => 1000, 0);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(task).not.toHaveBeenCalled();
  visibility("visible");
  await vi.advanceTimersByTimeAsync(0);
  expect(task).toHaveBeenCalledTimes(1);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  window.dispatchEvent(new Event("offline"));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(task).toHaveBeenCalledTimes(1);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(task).toHaveBeenCalledTimes(2);
});
test("slow requests never overlap and hiding aborts the active request", async () => {
  vi.useFakeTimers();
  visibility("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  let finish!: () => void;
  let signal!: AbortSignal;
  const task = vi.fn((s: AbortSignal) => { signal = s; return new Promise<void>(resolve => { finish = resolve; }); });
  stop = startVisiblePolling(task, () => 1000, 0);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(task).toHaveBeenCalledTimes(1);
  visibility("hidden");
  expect(signal.aborted).toBe(true);
  finish();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(task).toHaveBeenCalledTimes(1);
  stop();
  visibility("visible");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(task).toHaveBeenCalledTimes(1);
});
