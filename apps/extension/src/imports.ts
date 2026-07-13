export type ImportedUrl = {
  url: string;
  title?: string;
};

export function parseUrlList(value: string): ImportedUrl[] {
  const seen = new Set<string>();
  const entries: ImportedUrl[] = [];

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/https?:\/\/[^\s|]+/i);
    if (!match || match.index === undefined) continue;

    const url = trimTrailingPunctuation(match[0]);
    if (!isCapturableUrl(url) || seen.has(url)) continue;

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
