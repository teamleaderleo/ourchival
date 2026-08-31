import type { CapturePayload } from "@ourchival/shared";

export type CaptureResult = {
  ok: boolean;
  status?: number;
  message?: string;
  storageStatus?: string;
  referenceId?: string;
  assetId?: string | null;
  alreadySaved?: boolean;
  duplicateReason?: "asset_url" | "canonical_url" | "source_url";
  existingReference?: {
    title?: string;
    sourceUrl: string;
    capturedAt: number;
    favorite: boolean;
    boardCount: number;
  };
  savedAt: string;
};

export type BatchCaptureSource =
  | "current_tab"
  | "selected_tabs"
  | "window"
  | "url_list"
  | "bookmarks"
  | "retry"
  | "x_post"
  | "x_likes";

export type BatchCaptureItem = {
  url?: string;
  title?: string;
  tabId?: number;
  payload?: CapturePayload;
};

export type BatchCaptureFailure = {
  url: string;
  title?: string;
  message: string;
  payload?: CapturePayload;
};

export type BatchCaptureState = {
  jobId: string;
  source: BatchCaptureSource;
  running: boolean;
  startedAt: string;
  completedAt?: string;
  total: number;
  completed: number;
  nextIndex: number;
  saved: number;
  duplicates: number;
  failed: number;
  skipped: number;
  currentLabel?: string;
  items: BatchCaptureItem[];
  successfulTabIds: number[];
  failures: BatchCaptureFailure[];
};

export type XLikesImportStopReason =
  "paused" | "timeline_end" | "round_limit" | "cursor_not_found" | "error";

export type XLikesImportState = {
  importId: string;
  profileUrl: string;
  running: boolean;
  exhausted: boolean;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  chunks: number;
  discoveredPosts: number;
  captureAttempts: number;
  saved: number;
  duplicates: number;
  failed: number;
  skipped: number;
  lastSourceUrl?: string;
  lastPublishedAt?: string;
  stopReason?: XLikesImportStopReason;
  message?: string;
};

export type ExtensionSettings = {
  captureEndpoint?: string;
  deviceToken?: string;
  deviceName?: string;
};

export const SETTINGS_KEY = "ourchivalSettings";
export const LAST_CAPTURE_KEY = "lastCapture";
export const LAST_RESULT_KEY = "lastCaptureResult";
export const LAST_BATCH_KEY = "lastBatchCapture";
export const X_LIKES_IMPORT_KEY = "xLikesImport";
export const STREAM_IMPORT_KEY = "streamImportV1";

export type StreamImportState = {
  version: 1;
  sessionKey: string;
  source: "onetab" | "bookmarks" | "url_list";
  parserVersion: string;
  importDigest: string;
  filenameHint: string;
  expectedCount: number;
  checkpointOrdinal: number;
  savedCount: number;
  duplicateCount: number;
  skippedCount: number;
  failedCount: number;
  failedOrdinals: number[];
  failedEvidence?: Array<{ ordinal: number; errorClass: string }>;
  status: "ready" | "running" | "paused" | "completed" | "error";
  retryable?: boolean;
  updatedAt: string;
  message?: string;
};

export async function saveStreamImportState(state: StreamImportState) {
  await chrome.storage.local.set({ [STREAM_IMPORT_KEY]: state });
}

export async function getStreamImportState() {
  const values = await chrome.storage.local.get(STREAM_IMPORT_KEY);
  return values[STREAM_IMPORT_KEY] as StreamImportState | undefined;
}

export async function clearStreamImportState() {
  await chrome.storage.local.remove(STREAM_IMPORT_KEY);
}

export async function getSettings(): Promise<ExtensionSettings> {
  const values = await chrome.storage.local.get(SETTINGS_KEY);
  return (values[SETTINGS_KEY] as ExtensionSettings | undefined) ?? {};
}

export async function saveSettings(settings: ExtensionSettings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function saveLastCapture(capture: CapturePayload) {
  await chrome.storage.local.set({ [LAST_CAPTURE_KEY]: capture });
}

export async function saveLastResult(result: CaptureResult) {
  await chrome.storage.local.set({ [LAST_RESULT_KEY]: result });
}

export async function saveBatchState(state: BatchCaptureState) {
  await chrome.storage.local.set({ [LAST_BATCH_KEY]: state });
}

export async function saveXLikesImportState(state: XLikesImportState) {
  await chrome.storage.local.set({ [X_LIKES_IMPORT_KEY]: state });
}

export async function getXLikesImportState() {
  const values = await chrome.storage.local.get(X_LIKES_IMPORT_KEY);
  return values[X_LIKES_IMPORT_KEY] as XLikesImportState | undefined;
}

export async function getPopupState() {
  return await chrome.storage.local.get([
    SETTINGS_KEY,
    LAST_CAPTURE_KEY,
    LAST_RESULT_KEY,
    LAST_BATCH_KEY,
    X_LIKES_IMPORT_KEY,
  ]);
}

export function normalizeCaptureEndpoint(value: string | undefined) {
  const root = normalizeSiteRoot(value);
  return root ? `${root}/capture` : undefined;
}

export function normalizePairingEndpoint(value: string | undefined) {
  const root = normalizeSiteRoot(value);
  return root ? `${root}/clipper-exchange` : undefined;
}

export function normalizeSiteRoot(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed
    .replace(/\/(capture|clipper-exchange)\/?$/i, "")
    .replace(/\/$/, "");
  try {
    const url = new URL(normalized);
    const localHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !localHttp) return undefined;
    if (url.username || url.password || url.search || url.hash)
      return undefined;
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;
  } catch {
    return undefined;
  }
}
