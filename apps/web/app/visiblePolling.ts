/** One request at a time; hidden/offline pages do not keep polling. */
export function startVisiblePolling(
  task: (signal: AbortSignal) => Promise<unknown>,
  interval: () => number,
  initialDelay?: number,
) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const available = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!stopped && available()) timer = setTimeout(() => void run(), delay);
  };
  async function run() {
    if (stopped || running || !available()) return;
    running = true;
    controller = new AbortController();
    try { await task(controller.signal); } catch { /* The caller owns its error UI. */ }
    finally { running = false; schedule(controller.signal.aborted ? 0 : interval()); }
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
