/** Bounded, session-memory-only cache. No credentials or images are persisted. */
export function createPreviewCache(load: (url: string) => Promise<Blob>, maxBytes = 64 * 1024 * 1024, maxEntries = 48) {
  const entries = new Map<string, { promise: Promise<Blob>; size: number }>();
  function trim() {
    let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.size, 0);
    while (entries.size > maxEntries || bytes > maxBytes) {
      const key = entries.keys().next().value!;
      bytes -= entries.get(key)!.size;
      entries.delete(key);
    }
  }
  return {
    clear: () => entries.clear(),
    invalidate: (url: string) => entries.delete(url),
    get(url: string): Promise<Blob> {
      const cached = entries.get(url);
      if (cached) { entries.delete(url); entries.set(url, cached); return cached.promise; }
      const entry = { promise: Promise.resolve(new Blob()), size: 0 };
      entry.promise = load(url).then(blob => {
        if (entries.get(url) === entry) { entry.size = blob.size; trim(); }
        return blob;
      }).catch(error => { if (entries.get(url) === entry) entries.delete(url); throw error; });
      entries.set(url, entry);
      trim();
      return entry.promise;
    },
  };
}
