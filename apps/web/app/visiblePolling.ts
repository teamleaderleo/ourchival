/** One request at a time; hidden/offline pages do not keep polling.
 * Consecutive task failures back off exponentially (×2 up to 5 minutes) so
 * a sick backend isn't hammered on a fixed cadence; success resets. */
const maxBackoffMs = 5 * 60_000;
export function startVisiblePolling(
  task: (signal: AbortSignal) => Promise<unknown>,
  interval: () => number,
  initialDelay?: number,
) {
  let stopped = false;
  let running = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const available = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!stopped && available()) timer = setTimeout(() => void run(), delay);
  };
  const backoff = (base: number) => Math.min(maxBackoffMs, base * 2 ** failures);
  async function run() {
    if (stopped || running || !available()) return;
    running = true;
    controller = new AbortController();
    try {
      await task(controller.signal);
      failures = 0;
    } catch {
      // The caller owns its error UI; we just stop hammering.
      failures += 1;
    } finally {
      running = false;
      schedule(controller.signal.aborted ? 0 : backoff(interval()));
    }
  }
  const changed = () => {
    clearTimeout(timer);
    if (!available()) controller?.abort();
    else if (!running) void run();
  };
  document.addEventListener("visibilitychange", changed);
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  if (initialDelay !== undefined) schedule(initialDelay);
  else schedule(interval());
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    document.removeEventListener("visibilitychange", changed);
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
}
