import type {
  CapturePayload,
  PageReadableTextCapture,
  PageScreenshotCapture,
  PageStructuredSnapshotCapture,
  SourcePlatform,
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
  | "x_post"
  | "creative_item";

export type BatchCaptureItem = {
  url?: string;
  title?: string;
  tabId?: number;
  payload?: CapturePayload;
  pageScreenshot?: PageScreenshotCapture;
  readableText?: PageReadableTextCapture;
  structuredSnapshot?: PageStructuredSnapshotCapture;
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

export type CreativeCaptureQueueItem = {
  id: string;
  sourceKey?: string;
  platform: SourcePlatform;
  payloads: CapturePayload[];
  queuedAt: string;
  attempts: number;
  lastError?: string;
  /** Legacy #67 field retained only while reading older persisted queue entries. */
  source?: BatchCaptureSource;
};

export type CreativeCaptureEvent = {
  queueId: string;
  sourceKey?: string;
  state: "queued" | "saving" | "saved" | "warning";
  updatedAt: string;
  error?: string;
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
export const CREATIVE_CAPTURE_QUEUE_KEY = "ourchival:creative-capture-queue:v1";
export const CREATIVE_CAPTURE_EVENT_KEY = "ourchival:creative-capture-event:v1";
export const INLINE_SAVED_KEYS = "ourchival:inline-saved-source-keys:v1";

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

export async function getCreativeCaptureQueue(): Promise<CreativeCaptureQueueItem[]> {
  const stored = await chrome.storage.local.get(CREATIVE_CAPTURE_QUEUE_KEY);
  const value = stored[CREATIVE_CAPTURE_QUEUE_KEY];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map(normalizeCreativeQueueItem)
    .filter((item): item is CreativeCaptureQueueItem => Boolean(item));
}

export async function saveCreativeCaptureQueue(queue: CreativeCaptureQueueItem[]) {
  await chrome.storage.local.set({ [CREATIVE_CAPTURE_QUEUE_KEY]: queue });
}

export async function saveCreativeCaptureCompletion(
  queue: CreativeCaptureQueueItem[],
  savedSourceKeys: string[],
) {
  await chrome.storage.local.set({
    [CREATIVE_CAPTURE_QUEUE_KEY]: queue,
    [INLINE_SAVED_KEYS]: savedSourceKeys,
  });
}

export async function saveCreativeCaptureEvent(event: CreativeCaptureEvent) {
  await chrome.storage.local.set({ [CREATIVE_CAPTURE_EVENT_KEY]: event });
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

function normalizeCreativeQueueItem(
  value: Record<string, unknown>,
): CreativeCaptureQueueItem | undefined {
  if (
    typeof value.id !== "string" ||
    !value.id ||
    !Array.isArray(value.payloads) ||
    typeof value.queuedAt !== "string"
  ) {
    return undefined;
  }
  const legacySource = isBatchCaptureSource(value.source) ? value.source : undefined;
  const platform = isSourcePlatform(value.platform)
    ? value.platform
    : legacySource === "x_post"
      ? "x"
      : "generic";

  return {
    id: value.id,
    ...(typeof value.sourceKey === "string" && value.sourceKey
      ? { sourceKey: value.sourceKey }
      : {}),
    platform,
    payloads: value.payloads as CapturePayload[],
    queuedAt: value.queuedAt,
    attempts:
      typeof value.attempts === "number" && Number.isFinite(value.attempts)
        ? value.attempts
        : 0,
    ...(typeof value.lastError === "string" ? { lastError: value.lastError } : {}),
    ...(legacySource ? { source: legacySource } : {}),
  };
}

function isSourcePlatform(value: unknown): value is SourcePlatform {
  return (
    value === "x" ||
    value === "pinterest" ||
    value === "pixiv" ||
    value === "danbooru" ||
    value === "discord" ||
    value === "manual" ||
    value === "generic"
  );
}

function isBatchCaptureSource(value: unknown): value is BatchCaptureSource {
  return (
    value === "current_tab" ||
    value === "selected_tabs" ||
    value === "window" ||
    value === "url_list" ||
    value === "bookmarks" ||
    value === "retry" ||
    value === "x_post" ||
    value === "creative_item"
  );
}
