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
  receiptVersion?: number;
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
  referenceReceipts?: Array<{ sourceUrl: string; referenceId: string }>;
  assetReceipts?: Array<{
    assetId: string;
    referenceId: string;
    quality: string;
    provider: string;
    sourceUrl: string;
  }>;
  canonicalReferenceIds?: string[];
  degradedStored?: number;
  unknownStored?: number;
  originalsStored?: number;
  originalsLinked?: number;
  storedBytes?: number;
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
  receiptVersion?: number;
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
  originalsStored?: number;
  originalsLinked?: number;
  storedBytes?: number;
  lastSourceUrl?: string;
  lastPublishedAt?: string;
  stopReason?: XLikesImportStopReason;
  message?: string;
  audit?: XLikesAuditReceipt;
};

export type XLikesAuditReceipt = {
  status: "verified" | "gaps" | "partial";
  durable?: boolean;
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

export type XLikesObservation = {
  providerId: string;
  sourceUrl?: string;
  stage: "discovered" | "rendered" | "archived" | "failed";
};

export type XLikesObservationLedger = {
  importId: string;
  baselineDiscovered: number;
  baselineRendered: number;
  baselineArchived: number;
  discoveredIds: string[];
  renderedIds: string[];
  archivedIds: string[];
  failedIds: string[];
  sourceUrls: Record<string, string>;
  updatedAt: string;
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
  receiptVersion?: number;
  canonicalReferenceIds?: string[];
  assets?: Record<string, { quality: string; provider: string }>;
  expectedPages?: Record<string, number>;
  unknownPageCountArtworks?: number;
  gaps?: Record<string, string>;
  degradedStored?: number;
  unknownStored?: number;
  originalCandidates?: number;
  originalsStored?: number;
  originalsLinked?: number;
  storedBytes?: number;
  reportedCount?: number;
  unresolved: number;
  seenProviderIds: string[];
  pendingUrls?: string[];
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
export const BATCH_JOBS_KEY = "batchCaptureJobs";
export const X_LIKES_IMPORT_KEY = "xLikesImport";
export const X_LIKES_OBSERVATIONS_KEY = "xLikesObservations";
export const SOURCE_INTAKE_KEY = "sourceIntake";
export const SOURCE_INTAKES_KEY = "sourceIntakes";

let batchStateWrite = Promise.resolve();
let sourceStateWrite = Promise.resolve();
let observationWrite = Promise.resolve();

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
  batchStateWrite = batchStateWrite
    .catch(() => undefined)
    .then(async () => {
      const values = await chrome.storage.local.get(BATCH_JOBS_KEY);
      const jobs = {
        ...((values[BATCH_JOBS_KEY] as
          Record<string, BatchCaptureState> | undefined) ?? {}),
        [state.jobId]: state,
      };
      await chrome.storage.local.set({
        [LAST_BATCH_KEY]: state,
        [BATCH_JOBS_KEY]: jobs,
      });
    });
  await batchStateWrite;
}

export async function getBatchStates() {
  const values = await chrome.storage.local.get([
    BATCH_JOBS_KEY,
    LAST_BATCH_KEY,
  ]);
  const jobs =
    (values[BATCH_JOBS_KEY] as Record<string, BatchCaptureState> | undefined) ??
    {};
  const legacy = values[LAST_BATCH_KEY] as BatchCaptureState | undefined;
  if (legacy && !jobs[legacy.jobId]) jobs[legacy.jobId] = legacy;
  return Object.values(jobs);
}

export async function saveXLikesImportState(state: XLikesImportState) {
  await chrome.storage.local.set({ [X_LIKES_IMPORT_KEY]: state });
}

export async function recordXLikesObservationsLocally(
  importId: string,
  observations: XLikesObservation[],
  baseline?: XLikesAuditReceipt,
) {
  let receipt: XLikesAuditReceipt | undefined;
  observationWrite = observationWrite
    .catch(() => undefined)
    .then(async () => {
      const values = await chrome.storage.local.get(X_LIKES_OBSERVATIONS_KEY);
      const ledgers =
        (values[X_LIKES_OBSERVATIONS_KEY] as
          Record<string, XLikesObservationLedger> | undefined) ?? {};
      const previous = ledgers[importId];
      const discovered = new Set(previous?.discoveredIds ?? []);
      const rendered = new Set(previous?.renderedIds ?? []);
      const archived = new Set(previous?.archivedIds ?? []);
      const failed = new Set(previous?.failedIds ?? []);
      const sourceUrls = { ...(previous?.sourceUrls ?? {}) };
      for (const observation of observations) {
        discovered.add(observation.providerId);
        if (observation.sourceUrl) {
          sourceUrls[observation.providerId] = observation.sourceUrl;
        }
        if (observation.stage !== "discovered") {
          rendered.add(observation.providerId);
        }
        if (observation.stage === "archived") {
          archived.add(observation.providerId);
          failed.delete(observation.providerId);
        } else if (
          observation.stage === "failed" &&
          !archived.has(observation.providerId)
        ) {
          failed.add(observation.providerId);
        }
      }
      const ledger: XLikesObservationLedger = {
        importId,
        baselineDiscovered:
          previous?.baselineDiscovered ?? baseline?.networkPosts ?? 0,
        baselineRendered:
          previous?.baselineRendered ?? baseline?.observedPosts ?? 0,
        baselineArchived:
          previous?.baselineArchived ?? baseline?.vaultPosts ?? 0,
        discoveredIds: Array.from(discovered),
        renderedIds: Array.from(rendered),
        archivedIds: Array.from(archived),
        failedIds: Array.from(failed),
        sourceUrls,
        updatedAt: new Date().toISOString(),
      };
      ledgers[importId] = ledger;
      await chrome.storage.local.set({ [X_LIKES_OBSERVATIONS_KEY]: ledgers });
      receipt = observationLedgerReceipt(ledger);
    });
  await observationWrite;
  if (!receipt) throw new Error("Could not update the local X receipt.");
  return receipt;
}

export function observationLedgerReceipt(
  ledger: XLikesObservationLedger,
): XLikesAuditReceipt {
  const discovered = ledger.baselineDiscovered + ledger.discoveredIds.length;
  const rendered = ledger.baselineRendered + ledger.renderedIds.length;
  const archived = ledger.baselineArchived + ledger.archivedIds.length;
  const renderedSet = new Set(ledger.renderedIds);
  const archivedSet = new Set(ledger.archivedIds);
  const renderGaps = ledger.discoveredIds.filter(
    (providerId) => !renderedSet.has(providerId),
  );
  const archiveGaps = ledger.renderedIds.filter(
    (providerId) => !archivedSet.has(providerId),
  );
  const networkMissingInDom =
    Math.max(0, ledger.baselineDiscovered - ledger.baselineRendered) +
    renderGaps.length;
  const domMissingInVault =
    Math.max(0, ledger.baselineRendered - ledger.baselineArchived) +
    archiveGaps.length;
  return {
    status: networkMissingInDom || domMissingInVault ? "gaps" : "verified",
    durable: true,
    networkPages: 0,
    networkPosts: discovered,
    observedPosts: rendered,
    vaultPosts: archived,
    vaultChecked: true,
    unparseableArticles: 0,
    networkMissingInDom,
    domMissingInVault,
    networkGapSamples: renderGaps.slice(0, 25),
    vaultGapSamples: archiveGaps
      .map((providerId) => ledger.sourceUrls[providerId])
      .filter((value): value is string => Boolean(value))
      .slice(0, 25),
    reconciledAt: ledger.updatedAt,
  };
}

export async function saveSourceIntakeState(state: SourceIntakeState) {
  sourceStateWrite = sourceStateWrite
    .catch(() => undefined)
    .then(async () => {
      const values = await chrome.storage.local.get(SOURCE_INTAKES_KEY);
      const imports = {
        ...((values[SOURCE_INTAKES_KEY] as
          Record<string, SourceIntakeState> | undefined) ?? {}),
        [state.importId]: state,
      };
      await chrome.storage.local.set({
        [SOURCE_INTAKE_KEY]: state,
        [SOURCE_INTAKES_KEY]: imports,
      });
    });
  await sourceStateWrite;
}

export async function getSourceIntakeStates() {
  const values = await chrome.storage.local.get([
    SOURCE_INTAKES_KEY,
    SOURCE_INTAKE_KEY,
  ]);
  const imports =
    (values[SOURCE_INTAKES_KEY] as
      Record<string, SourceIntakeState> | undefined) ?? {};
  const legacy = values[SOURCE_INTAKE_KEY] as SourceIntakeState | undefined;
  if (legacy && !imports[legacy.importId]) imports[legacy.importId] = legacy;
  return Object.values(imports).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export async function getSourceIntakeState(importId?: string) {
  const states = await getSourceIntakeStates();
  return importId
    ? states.find((state) => state.importId === importId)
    : states[0];
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
    BATCH_JOBS_KEY,
    X_LIKES_IMPORT_KEY,
    SOURCE_INTAKE_KEY,
    SOURCE_INTAKES_KEY,
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
