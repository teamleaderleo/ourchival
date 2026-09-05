export type LinkBatch = {
  sessionKey: string;
  source: "url_list" | "bookmarks";
  total: number;
  offset: number;
  entries: { url: string; title?: string }[];
};

export function validateLinkBatch(value: unknown): LinkBatch {
  const b = value as LinkBatch;
  if (
    !b ||
    !/^saved-links-v1:[a-f0-9]{64}$/.test(b.sessionKey) ||
    !["url_list", "bookmarks"].includes(b.source) ||
    !Number.isSafeInteger(b.total) ||
    b.total < 1 ||
    b.total > 100_000 ||
    !Number.isSafeInteger(b.offset) ||
    b.offset < 0 ||
    !Array.isArray(b.entries) ||
    b.entries.length > 50 ||
    b.offset + b.entries.length > b.total
  )
    throw new Error("Invalid saved-link batch.");
  for (const entry of b.entries) {
    if (
      !entry ||
      typeof entry.url !== "string" ||
      entry.url.length > 2048 ||
      (entry.title !== undefined &&
        (typeof entry.title !== "string" || entry.title.length > 1000))
    ) {
      throw new Error("Link URL or title exceeds the import limit.");
    }
    const url = new URL(entry.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "Import links must be HTTP(S) URLs without embedded credentials.",
      );
    }
  }
  return b;
}

export function linkBatchReceipt(
  session: {
    sessionKey: string;
    completedCount: number;
    expectedCount: number;
    savedCount: number;
    duplicateCount: number;
  },
  replayed: boolean,
) {
  return {
    ok: true as const,
    sessionKey: session.sessionKey,
    nextOffset: session.completedCount,
    total: session.expectedCount,
    saved: session.savedCount,
    duplicates: session.duplicateCount,
    replayed,
    complete: session.completedCount === session.expectedCount,
  };
}

export async function readLinkBatch(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing import body.");
  const decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 750_000) throw new Error("Import batch exceeds byte limit.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel();
  }
}
