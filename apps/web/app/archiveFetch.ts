/** Read-only pages tolerate one transient failure; writes are never retried here. */
export async function fetchArchivePage(url: string, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      if (attempt === 1 || ![502, 503, 504].includes(response.status)) return response;
      await response.body?.cancel();
    } catch (error) {
      signal.throwIfAborted();
      if (attempt === 1 || !(error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError"))) throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 750);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}
