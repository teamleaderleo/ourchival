import type {
  CapturePayload,
  PageReadableTextCapture,
  PageScreenshotCapture,
} from "@ourchival/shared";

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
  | "x_post";

export type BatchCaptureItem = {
  url?: string;
  title?: string;
  tabId?: number;
  payload?: CapturePayload;
  pageScreenshot?: PageScreenshotCapture;
  readableText?: PageReadableTextCapture;
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

export type ExtensionSettings = {
  captureEndpoint?: string;
  deviceToken?: string;
  deviceName?: string;
};

export const SETTINGS_KEY = "ourchivalSettings";
export const LAST_CAPTURE_KEY = "lastCapture";
export const LAST_RESULT_KEY = "lastCaptureResult";
export const LAST_BATCH_KEY = "lastBatchCapture";

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

export async function getPopupState() {
  return await chrome.storage.local.get([
    SETTINGS_KEY,
    LAST_CAPTURE_KEY,
    LAST_RESULT_KEY,
    LAST_BATCH_KEY,
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
  return trimmed
    .replace(/\/(capture|clipper-exchange)\/?$/i, "")
    .replace(/\/$/, "");
}
