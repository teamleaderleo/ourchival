import type { CapturePayload } from "@ourchival/shared";
import type { SourceIntakeProvider } from "./sourceIntake";

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
  | "x_likes"
  | "pixiv_bookmarks"
  | "pinterest_board";

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
  attached?: number;
  refreshed?: number;
  duplicates: number;
  failed: number;
  skipped: number;
  currentLabel?: string;
  refreshedSourceUrls?: string[];
  items: BatchCaptureItem[];
  successfulTabIds: number[];
  failures: BatchCaptureFailure[];
};

export type XLikesImportStopReason =
  | "paused"
  | "known_boundary"
  | "stalled"
  | "timeline_end"
  | "round_limit"
  | "cursor_not_found"
  | "error";

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
  attachedMedia?: number;
  refreshedPosts?: number;
  duplicates: number;
  failed: number;
  skipped: number;
  lastSourceUrl?: string;
  lastPublishedAt?: string;
  stopReason?: XLikesImportStopReason;
  message?: string;
  audit?: XLikesAuditReceipt;
};

export type XLikesAuditReceipt = {
  status: "verified" | "gaps" | "partial";
  networkPages: number;
  networkPosts: number;
  observedPosts: number;
  vaultPosts: number;
  vaultChecked: boolean;
  unparseableArticles: number;
  networkMissingInDom: number;
  domMissingInVault: number;
  networkGapSamples: string[];
  vaultGapSamples: string[];
  reconciledAt: string;
};

export type SourceIntakeState = {
  importId: string;
  provider: SourceIntakeProvider;
  label: string;
  sourceUrl: string;
  currentUrl: string;
  cursor: string;
  sensitiveDefault: boolean;
  workerTabId?: number;
  running: boolean;
  exhausted: boolean;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  chunks: number;
  observed: number;
  captureAttempts: number;
  saved: number;
  duplicates: number;
  failed: number;
  skipped: number;
  reportedCount?: number;
  unresolved: number;
  seenProviderIds: string[];
  stopReason?: "paused" | "exhausted" | "tab_closed" | "error";
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
export const SOURCE_INTAKE_KEY = "sourceIntake";

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

export async function saveSourceIntakeState(state: SourceIntakeState) {
  await chrome.storage.local.set({ [SOURCE_INTAKE_KEY]: state });
}

export async function getSourceIntakeState() {
  const values = await chrome.storage.local.get(SOURCE_INTAKE_KEY);
  return values[SOURCE_INTAKE_KEY] as SourceIntakeState | undefined;
}

export async function getXLikesImportState() {
  const values = await chrome.storage.local.get(X_LIKES_IMPORT_KEY);
  return normalizeXLikesImportState(
    values[X_LIKES_IMPORT_KEY] as XLikesImportState | undefined,
  );
}

export async function getPopupState() {
  const values = await chrome.storage.local.get([
    SETTINGS_KEY,
    LAST_CAPTURE_KEY,
    LAST_RESULT_KEY,
    LAST_BATCH_KEY,
    X_LIKES_IMPORT_KEY,
    SOURCE_INTAKE_KEY,
  ]);
  values[X_LIKES_IMPORT_KEY] = normalizeXLikesImportState(
    values[X_LIKES_IMPORT_KEY] as XLikesImportState | undefined,
  );
  return values;
}

export function normalizeXLikesImportState(
  state: XLikesImportState | undefined,
) {
  if (!state) return state;
  const normalized =
    typeof state.attachedMedia === "number"
      ? state
      : (() => {
          const extraMedia = Math.min(
            state.duplicates,
            Math.max(0, state.captureAttempts - state.discoveredPosts),
          );
          return {
            ...state,
            attachedMedia: extraMedia,
            duplicates: Math.max(0, state.duplicates - extraMedia),
          };
        })();

  // Older builds treated a temporarily stable virtualized X timeline as a
  // genuine end. Keep that checkpoint resumable: X can expose more rows after
  // another scroll pulse or a manual nudge.
  if (normalized.stopReason === "timeline_end") {
    return {
      ...normalized,
      exhausted: false,
      completedAt: undefined,
      stopReason: "stalled" as const,
      message:
        normalized.message ??
        "X paused loading more Likes. Your checkpoint is safe; continue to probe for older posts.",
    };
  }

  return normalized;
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
