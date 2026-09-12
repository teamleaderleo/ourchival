// First-paint sequencing: the gallery feed goes first, alone, against the
// single local backend. Secondary surfaces (directory, sessions) wait for it
// so four heavy queries never dogpile one process into timeouts. Falls back
// to a timeout so a failing feed cannot wedge the rest of the UI.
let ready = false;
const waiters = new Set<() => void>();

export function markFeedReady() {
  if (ready) return;
  ready = true;
  waiters.forEach(done => done());
  waiters.clear();
}

export function whenFeedReady(timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (ready || signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      waiters.delete(done);
      signal?.removeEventListener("abort", done);
      resolve();
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      waiters.delete(done);
      resolve();
    };
    signal?.addEventListener("abort", done, { once: true });
    waiters.add(done);
  });
}
