export const FAILURE_LOG_KEY = "captureFailureLog";
export type FailureRecord = {
  id: string;
  provider: string;
  sourceUrl: string;
  assetUrl?: string;
  itemKey?: string;
  imagePage?: number;
  imageCount?: number;
  importId: string;
  stage: "request" | "storage" | "metadata" | "reader";
  message: string;
  httpStatus?: number;
  firstAt: string;
  lastAt: string;
  attempts: number;
  resolvedAt?: string;
  lastRecoveredAt?: string;
  recoveries?: number;
  importedFromCheckpoint?: boolean;
};
export type FailureInput = Omit<
  FailureRecord,
  | "id"
  | "firstAt"
  | "lastAt"
  | "attempts"
  | "resolvedAt"
  | "lastRecoveredAt"
  | "recoveries"
>;
export function safeFailureUrl(value: string) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return "";
    url.username = "";
    url.password = "";
    const bookmarkPage =
      url.hostname === "www.pixiv.net" &&
      url.pathname.includes("/bookmarks/artworks");
    const parameters = bookmarkPage
      ? Array.from(url.searchParams).filter(
          ([key, value]) =>
            (key === "p" && /^\d{1,6}$/.test(value)) ||
            (key === "rest" && /^(show|hide)$/.test(value)) ||
            (key === "mode" && /^(all|illust|manga)$/.test(value)),
        )
      : [];
    url.search = "";
    for (const [key, value] of parameters) url.searchParams.set(key, value);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}
export function safeFailureMessage(value: string) {
  return value
    .replace(/https?:\/\/[^\s<>]+/g, (url) => safeFailureUrl(url))
    .replace(/bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /((?:token|password|cookie|authorization|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[redacted]",
    )
    .slice(0, 1000);
}
export function failureKey(
  input: Pick<
    FailureInput,
    "sourceUrl" | "assetUrl" | "imagePage" | "stage" | "itemKey"
  >,
) {
  return JSON.stringify([
    safeFailureUrl(input.sourceUrl),
    input.imagePage ?? input.itemKey ?? safeFailureUrl(input.assetUrl ?? ""),
    input.stage,
  ]);
}
export function recordFailureIn(
  log: Record<string, FailureRecord>,
  input: FailureInput,
  at = new Date().toISOString(),
) {
  const id = failureKey(input),
    previous = log[id];
  log[id] = {
    ...input,
    id,
    sourceUrl: safeFailureUrl(input.sourceUrl),
    assetUrl: input.assetUrl ? safeFailureUrl(input.assetUrl) : undefined,
    message: safeFailureMessage(input.message),
    firstAt: previous?.firstAt ?? at,
    lastAt: at,
    attempts: (previous?.attempts ?? 0) + 1,
    importedFromCheckpoint:
      previous?.importedFromCheckpoint ?? input.importedFromCheckpoint,
    lastRecoveredAt: previous?.lastRecoveredAt,
    recoveries: previous?.recoveries,
  };
  return log[id]!;
}
let writes = Promise.resolve();
async function changeLog(change: (log: Record<string, FailureRecord>) => void) {
  writes = writes
    .catch(() => undefined)
    .then(async () => {
      const values = await chrome.storage.local.get(FAILURE_LOG_KEY);
      const log = (values[FAILURE_LOG_KEY] ?? {}) as Record<
        string,
        FailureRecord
      >;
      const before = JSON.stringify(log);
      change(log);
      if (JSON.stringify(log) === before) return;
      await chrome.storage.local.set({ [FAILURE_LOG_KEY]: log });
    });
  await writes;
}
export function recordFailure(input: FailureInput) {
  return changeLog((log) => {
    recordFailureIn(log, input);
  });
}
export function seedFailureHistory(
  inputs: Array<{ input: FailureInput; at: string }>,
) {
  return changeLog((log) => {
    for (const { input, at } of inputs) {
      if (!log[failureKey(input)])
        recordFailureIn(log, { ...input, importedFromCheckpoint: true }, at);
    }
  });
}
export function resolveFailures(
  input: Pick<FailureInput, "sourceUrl" | "assetUrl" | "imagePage">,
  stages: FailureRecord["stage"][],
) {
  return changeLog((log) => {
    for (const stage of stages) {
      const record = log[failureKey({ ...input, stage })];
      if (record && !record.resolvedAt) {
        record.resolvedAt = new Date().toISOString();
        record.lastRecoveredAt = record.resolvedAt;
        record.recoveries = (record.recoveries ?? 0) + 1;
      }
    }
  });
}
