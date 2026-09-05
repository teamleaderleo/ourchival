export type ImportedUrl = {
  url: string;
  title?: string;
};

export function parseUrlList(
  value: string,
  preserveOccurrences = false,
): ImportedUrl[] {
  const seen = new Set<string>();
  const entries: ImportedUrl[] = [];

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/https?:\/\/[^\s|]+/i);
    if (!match || match.index === undefined) continue;

    const url = preserveOccurrences
      ? match[0]
      : trimTrailingPunctuation(match[0]);
    if (!isCapturableUrl(url) || (!preserveOccurrences && seen.has(url)))
      continue;

    const before = line
      .slice(0, match.index)
      .replace(/\|\s*$/, "")
      .trim();
    const after = line
      .slice(match.index + match[0].length)
      .replace(/^\s*\|\s*/, "")
      .trim();
    const title = after || before || undefined;

    seen.add(url);
    entries.push({ url, ...(title ? { title } : {}) });
  }

  return entries;
}

export function parseBookmarksHtml(
  value: string,
  preserveOccurrences = false,
): ImportedUrl[] {
  const seen = new Set<string>();
  const entries: ImportedUrl[] = [];
  const linkPattern = /<A\b[^>]*\bHREF=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/A>/gi;

  for (const match of value.matchAll(linkPattern)) {
    const url = decodeHtml(match[2] ?? "").trim();
    if (!isCapturableUrl(url) || (!preserveOccurrences && seen.has(url)))
      continue;

    const title = decodeHtml(stripTags(match[3] ?? "")).trim() || undefined;
    seen.add(url);
    entries.push({ url, ...(title ? { title } : {}) });
  }

  return entries;
}

export function isCapturableUrl(value: string | undefined): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function trimTrailingPunctuation(value: string) {
  return value.replace(/[),.;]+$/, "");
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function decodeHtml(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (_entity, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      }
      return namedEntities[code.toLowerCase()] ?? `&${code};`;
    },
  );
}

export async function savedLinkSessionKey(
  source: "url_list" | "bookmarks",
  entries: ImportedUrl[],
) {
  const manifest = JSON.stringify([
    1,
    source,
    entries.map((e) => [e.url, e.title ?? null]),
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(manifest),
  );
  return (
    "saved-links-v1:" +
    Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")
  );
}
