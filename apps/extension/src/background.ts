import {
  recordFailure,
  resolveFailures,
  seedFailureHistory,
} from "./failureLog";
import {
  parseXSnapshot,
  type ParsedXSource,
  type XDomSnapshot,
} from "@ourchival/parsers";
import type { CapturePayload, PageSnapshot } from "@ourchival/shared";
import {
  AUTOMATION_KEY,
  AUTOMATION_ALARM,
  HEARTBEATS_KEY,
  retryPlan,
  readerIsStalled,
  syncInterval,
  repairInterval,
  type AutomationState,
  type ImportPurpose,
  type ReaderHeartbeat,
} from "./importAutomation";
import { isCapturableUrl, type ImportedUrl } from "./imports";
import {
  detectSourceIntakeContext,
  reconcilePinterestQueue,
  sourceIntakePayloads,
  sourceIntakeItemKey,
  sourceReaderCanCommit,
  originalDownloadFailure,
  type SourceIntakeChunk,
} from "./sourceIntake";
import {
  getBatchStates,
  getSourceIntakeState,
  getSourceIntakeStates,
  getSettings,
  getXLikesImportState,
  getXLikesImportStates,
  LAST_BATCH_KEY,
  normalizeCaptureEndpoint,
  recordXLikesObservationsLocally,
  saveBatchState,
  saveLastCapture,
  saveLastResult,
  saveSourceIntakeState,
  saveXLikesImportState,
  type BatchCaptureItem,
  type BatchCaptureSource,
  type BatchCaptureState,
  type CaptureResult,
  type SourceIntakeState,
  type XLikesAuditReceipt,
  type XLikesImportState,
  type XLikesImportStopReason,
} from "./storage";
import {
  buildXLikePayloads,
  classifyAssetStorage,
  classifyXLikeCapture,
  isXLikesUrl,
} from "./xLikes";

type TabCaptureMode = "current" | "selected" | "window";
type ImportSource = "url_list" | "bookmarks" | "retry";

type ContextCapture = {
  pageTitle: string;
  pageSnapshot?: PageSnapshot;
  selectedText?: string;
  clickedAssetUrl?: string;
  parsedSource?: ParsedXSource;
  rawMetadata?: string;
};

type CaptureResponse = {
  blocked?: boolean;
  ok?: boolean;
  error?: string;
  code?: string;
  referenceId?: string;
  assetId?: string | null;
  storageStatus?: string;
  storageProvider?: "google_drive" | "convex" | "linked";
  storedBytes?: number;
  newStoredBytes?: number;
  assetQuality?: string;
  alreadySaved?: boolean;
  duplicateReason?: "asset_url" | "canonical_url" | "source_url";
  existingReference?: CaptureResult["existingReference"];
};

type ReferenceStatusResponse = {
  ok?: boolean;
  error?: string;
  indexedSourceUrls?: string[];
};

type XLikesAuditInput = {
  networkPages?: number;
  networkPostIds?: string[];
  observedSourceUrls?: string[];
  unparseableArticles?: number;
  truncated?: boolean;
};

type CaptureObservationStage =
  "discovered" | "rendered" | "archived" | "failed";

type CaptureObservation = {
  providerId: string;
  sourceUrl?: string;
  stage: CaptureObservationStage;
  error?: string;
};

type ExtensionMessage =
  | { type: "OURCHIVAL_AUTOMATION"; enabled?: boolean; syncUrl?: string }
  | {
      type: "OURCHIVAL_READER_HEARTBEAT";
      importId: string;
      phase: "reading" | "saving";
    }
  | {
      type: "OURCHIVAL_SAVED_LINK_BATCH";
      batch: {
        sessionKey: string;
        source: "url_list" | "bookmarks";
        total: number;
        offset: number;
        entries: ImportedUrl[];
      };
      expectedEndpoint?: string;
    }
  | { type: "OURCHIVAL_CAPTURE_TABS"; mode: TabCaptureMode }
  | {
      type: "OURCHIVAL_CAPTURE_URLS";
      entries: ImportedUrl[];
      source?: ImportSource;
    }
  | {
      type: "OURCHIVAL_CAPTURE_PAYLOADS";
      payloads: CapturePayload[];
      source?: BatchCaptureSource;
    }
  | { type: "OURCHIVAL_CLOSE_SAVED_TABS"; tabIds: number[] }
  | { type: "OURCHIVAL_IMPORT_X_LIKES" }
  | { type: "OURCHIVAL_PAUSE_X_LIKES" }
  | { type: "OURCHIVAL_IMPORT_SOURCE"; restart?: boolean }
  | { type: "OURCHIVAL_PAUSE_SOURCE"; importId?: string }
  | {
      type: "OURCHIVAL_SOURCE_INTAKE_CHUNK";
      importId: string;
      chunk: SourceIntakeChunk;
    }
  | { type: "OURCHIVAL_REFERENCE_STATUS"; sourceUrls: string[] }
  | { type: "OURCHIVAL_CAPTURE_X_LIKE"; snapshot: XDomSnapshot }
  | {
      type: "OURCHIVAL_X_LIKES_CHUNK";
      importId: string;
      profileUrl: string;
      snapshots: XDomSnapshot[];
      lastSourceUrl?: string;
    }
  | {
      type: "OURCHIVAL_X_LIKES_OBSERVED";
      importId: string;
      profileUrl: string;
      observations: CaptureObservation[];
    }
  | {
      type: "OURCHIVAL_X_LIKES_FINISHED";
      importId: string;
      profileUrl: string;
      stopReason: XLikesImportStopReason;
      lastSourceUrl?: string;
      message?: string;
      audit?: XLikesAuditInput;
    };

type CaptureConnection = {
  endpoint: string;
  deviceToken: string;
};

const activeJobIds = new Set<string>();
const defaultCaptureConcurrency = 6;
const localCaptureConcurrency = 12;

type BatchItemOutcome = {
  item: BatchCaptureItem;
  sourceUrl: string;
  payload?: CapturePayload;
  result?: Awaited<ReturnType<typeof capturePayload>>;
  error?: unknown;
  skipped?: boolean;
};

void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-image-to-ourchival",
    title: "Save this image to Ourchival",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: "save-post-images-to-ourchival",
    title: "Save every image in this post",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: "save-post-to-ourchival",
    title: "Save this post to Ourchival",
    contexts: ["image", "page", "selection"],
  });
  chrome.contextMenus.create({
    id: "save-link-to-ourchival",
    title: "Save link to Ourchival",
    contexts: ["link"],
  });
  chrome.contextMenus.create({
    id: "save-page-to-ourchival",
    title: "Save page to Ourchival",
    contexts: ["page", "selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const context = await getContextCapture(tab?.id);

  if (
    info.menuItemId === "save-post-images-to-ourchival" &&
    context?.parsedSource?.platform === "x" &&
    context.parsedSource.mediaUrls.length > 0
  ) {
    const payloads = context.parsedSource.mediaUrls.map((assetUrl) =>
      buildXPayload(context, {
        kind: "image",
        assetUrl,
        altText: context.parsedSource?.altTexts?.[assetUrl],
      }),
    );
    await runPayloadBatch(payloads, "x_post");
    return;
  }

  const payload =
    info.menuItemId === "save-post-to-ourchival" &&
    context?.parsedSource?.platform === "x"
      ? buildXPayload(context, { kind: "post" })
      : buildCapturePayload(info, tab, context);

  await saveLastCapture(payload);

  try {
    const connection = await getCaptureConnection();
    const result = await capturePayload(connection, payload);
    await markResult(toCaptureResult(result));
  } catch (error) {
    await markResult({
      ok: false,
      message: errorMessage(error, "Capture request failed."),
      savedAt: new Date().toISOString(),
    });
  }
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    if (message?.type === "OURCHIVAL_SAVED_LINK_BATCH") {
      void captureSavedLinkBatch(message.batch, message.expectedEndpoint)
        .then(sendResponse)
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "Saved-link batch failed."),
          }),
        );
      return true;
    }
    if (message?.type === "OURCHIVAL_AUTOMATION") {
      void updateAutomation(message)
        .then(() => sendResponse({ ok: true }))
        .catch(() =>
          sendResponse({
            ok: false,
            error: "Could not save automatic import settings.",
          }),
        );
      return true;
    }
    if (message?.type === "OURCHIVAL_READER_HEARTBEAT") {
      void saveReaderHeartbeat(message, sender).then(() =>
        sendResponse({ ok: true }),
      );
      return true;
    }
    if (message?.type === "OURCHIVAL_CAPTURE_TABS") {
      void captureTabs(message.mode)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "Tab capture failed."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_CAPTURE_URLS") {
      void runBatch(
        message.source ?? "url_list",
        message.entries.map((entry) => ({
          url: entry.url,
          title: entry.title,
        })),
      )
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "URL import failed."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_CAPTURE_PAYLOADS") {
      void runPayloadBatch(message.payloads, message.source ?? "retry")
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "Capture retry failed."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_IMPORT_X_LIKES") {
      void startXLikesImport()
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "X Likes import failed."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_PAUSE_X_LIKES") {
      void pauseXLikesImport()
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "Could not pause the X Likes import."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_IMPORT_SOURCE") {
      void startSourceIntake(message.restart === true)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "Source import failed."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_PAUSE_SOURCE") {
      void pauseSourceIntake(message.importId)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "Could not pause the source import."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_X_LIKES_OBSERVED") {
      void recordXLikesObservations(message, sender)
        .then((receipt) => sendResponse({ ok: true, receipt }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "Could not checkpoint X discovery."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_SOURCE_INTAKE_CHUNK") {
      void acceptSourceIntakeChunk(message, sender)
        .then(sendResponse)
        .catch((error) =>
          sendResponse({
            ok: false,
            continue: false,
            error: errorMessage(error, "Could not save this source chunk."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_REFERENCE_STATUS") {
      void referenceStatus(message.sourceUrls)
        .then((indexedSourceUrls) =>
          sendResponse({ ok: true, indexedSourceUrls }),
        )
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "Could not check archive status."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_CAPTURE_X_LIKE") {
      void captureLiveXLike(message.snapshot)
        .then((sourceUrl) => sendResponse({ ok: true, sourceUrl }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "Could not archive this liked post."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_X_LIKES_CHUNK") {
      void captureXLikesChunk(message, sender)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "Could not save this X Likes chunk."),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_X_LIKES_FINISHED") {
      void finishXLikesImport(message, sender)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(
              error,
              "Could not checkpoint the X Likes import.",
            ),
          }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_CLOSE_SAVED_TABS") {
      void closeSavedTabs(message.tabIds)
        .then((closed) => sendResponse({ ok: true, closed }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: errorMessage(error, "Could not close saved tabs."),
          }),
        );
      return true;
    }

    return false;
  },
);

async function getContextCapture(tabId: number | undefined) {
  if (typeof tabId !== "number") return undefined;
  try {
    return (await chrome.tabs.sendMessage(tabId, {
      type: "OURCHIVAL_GET_CONTEXT_CAPTURE",
    })) as ContextCapture | undefined;
  } catch {
    return undefined;
  }
}

async function captureTabs(mode: TabCaptureMode) {
  const tabs = await queryTabs(mode);
  const source: BatchCaptureSource =
    mode === "current"
      ? "current_tab"
      : mode === "selected"
        ? "selected_tabs"
        : "window";
  return await runBatch(
    source,
    tabs.map((tab) => ({ url: tab.url, title: tab.title, tabId: tab.id })),
  );
}

async function startXLikesImport(requested?: {
  sourceUrl: string;
  importId?: string;
  purpose?: ImportPurpose;
}) {
  const [tab] = requested
    ? [{ url: requested.sourceUrl, id: undefined }]
    : await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
  if (!isXLikesUrl(tab?.url)) {
    throw new Error("Open your X profile Likes page before importing.");
  }
  const connection = await getCaptureConnection();

  const profileUrl = canonicalLikesUrl(tab.url!);
  const previous = requested?.importId
    ? (await getXLikesImportStates()).find(
        (s) => s.importId === requested.importId,
      )
    : await getXLikesImportState();
  if (previous?.running) return previous;
  if (!requested) await unpauseSource(profileUrl);
  const resumable =
    previous &&
    previous.profileUrl === profileUrl &&
    !previous.exhausted &&
    (!requested?.purpose ||
      requested.purpose === (previous.purpose ?? "history"));
  const now = new Date().toISOString();
  const state: XLikesImportState = resumable
    ? {
        ...previous,
        running: true,
        updatedAt: now,
        completedAt: undefined,
        stopReason: undefined,
        message: undefined,
      }
    : {
        importId: createImportId(),
        purpose: requested?.purpose ?? "history",
        profileUrl,
        receiptVersion: 2,
        running: true,
        exhausted: false,
        startedAt: now,
        updatedAt: now,
        chunks: 0,
        discoveredPosts: 0,
        captureAttempts: 0,
        saved: 0,
        attachedMedia: 0,
        refreshedPosts: 0,
        duplicates: 0,
        failed: 0,
        skipped: 0,
      };
  await saveXLikesImportState(state);
  await reportXLikesSession(state, "running", connection);

  const worker = await chrome.tabs.create({ url: profileUrl, active: false });
  state.workerTabId = worker.id;
  state.retryAt = undefined;
  state.needsAttention = false;
  await saveXLikesImportState(state);
  if (worker.id) {
    await chrome.tabs.update(worker.id, { autoDiscardable: false });
    if (worker.status === "complete") void dispatchXLikes(worker.id);
  }
  return state;
}

async function dispatchXLikes(tabId: number) {
  const state = await getXLikesImportState();
  if (!state?.running || state.workerTabId !== tabId) return;
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "OURCHIVAL_START_X_LIKES",
      importId: state.importId,
      profileUrl: state.profileUrl,
      resumeAfterSourceUrl:
        state.purpose === "sync" ? undefined : state.lastSourceUrl,
      resumeFromCurrentPosition: false,
      stopAtKnownBoundary: state.purpose === "sync",
    });
    if (!response?.ok) throw new Error(response?.error || "Reader unavailable");
  } catch {
    const latest = await getXLikesImportState();
    if (!latest?.running || latest.workerTabId !== tabId) return;
    latest.running = false;
    latest.stopReason = "error";
    latest.message =
      "X reader disconnected; automatic recovery will reopen its checkpoint.";
    latest.updatedAt = new Date().toISOString();
    await saveXLikesImportState(latest);
  }
}

async function pauseXLikesImport() {
  const state = await getXLikesImportState();
  if (!state) throw new Error("No X Likes import is active.");
  await pauseAutomaticSource(state.profileUrl);
  const tabId = state.workerTabId;
  state.workerTabId = undefined;
  state.running = false;
  state.stopReason = "paused";
  state.updatedAt = new Date().toISOString();
  await saveXLikesImportState(state);
  if (tabId) await chrome.tabs.remove(tabId).catch(() => undefined);
  await reportXLikesSession(state, "interrupted");
  return state;
}

async function startSourceIntake(
  restart = false,
  requested?: { sourceUrl: string; importId?: string; purpose?: ImportPurpose },
) {
  const [tab] = requested
    ? [{ url: requested.sourceUrl, id: undefined }]
    : await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
  const context = detectSourceIntakeContext(tab?.url);
  if (!context) {
    throw new Error(
      "Open a Pixiv bookmarks page, your Pinterest profile, or one Pinterest board first.",
    );
  }
  let profileDiscovery: SourceIntakeChunk | undefined;
  if (context.scope === "profile" && typeof tab?.id === "number") {
    const response = (await chrome.tabs
      .sendMessage(tab.id, { type: "OURCHIVAL_DISCOVER_PINTEREST_BOARDS" })
      .catch(() => undefined)) as
      { ok?: boolean; chunk?: SourceIntakeChunk } | undefined;
    if (response?.ok && response.chunk?.discoveredUrls?.length) {
      profileDiscovery = response.chunk;
    }
  }
  const sourceStates = await getSourceIntakeStates();
  const previous = sourceStates.find(
    (candidate) =>
      (!requested?.importId || candidate.importId === requested.importId) &&
      candidate.provider === context.provider &&
      candidate.sourceUrl === context.sourceUrl,
  );
  if (previous?.running) return previous;
  if (!requested) await unpauseSource(context.sourceUrl);
  if (previous && activeJobIds.has(previous.importId))
    throw new Error(
      "Finishing the current image request. Your checkpoint is safe; resume shortly.",
    );

  const now = new Date().toISOString();
  const resumable = Boolean(
    !restart &&
    previous &&
    previous.receiptVersion === 2 &&
    !previous.exhausted &&
    previous.provider === context.provider &&
    previous.sourceUrl === context.sourceUrl,
  );
  const state: SourceIntakeState = resumable
    ? {
        ...previous!,
        running: true,
        updatedAt: now,
        completedAt: undefined,
        stopReason: undefined,
        message: undefined,
        retryAt: undefined,
        needsAttention: false,
      }
    : {
        importId: createSourceImportId(),
        purpose: requested?.purpose ?? (restart ? "repair" : "history"),
        ...(requested?.purpose === "sync"
          ? {
              knownProviderIds: Array.from(
                new Set(
                  sourceStates
                    .filter((s) => s.sourceUrl === context.sourceUrl)
                    .flatMap((s) => [
                      ...(s.knownProviderIds ?? []),
                      ...s.seenProviderIds,
                    ]),
                ),
              ),
            }
          : {}),
        provider: context.provider,
        label: context.label,
        sourceUrl: context.sourceUrl,
        currentUrl:
          profileDiscovery?.discoveredUrls?.[0] ??
          (context.provider === "pixiv_bookmarks"
            ? context.sourceUrl
            : context.currentUrl),
        receiptVersion: 2,
        cursor:
          context.provider === "pixiv_bookmarks" ? "page:1" : context.cursor,
        sensitiveDefault: context.sensitiveDefault,
        running: true,
        exhausted: false,
        startedAt: now,
        updatedAt: now,
        chunks: 0,
        observed: 0,
        captureAttempts: 0,
        saved: 0,
        duplicates: 0,
        failed: 0,
        skipped: 0,
        originalCandidates: 0,
        originalsStored: 0,
        originalsLinked: 0,
        storedBytes: 0,
        ...(profileDiscovery?.reportedCount
          ? { reportedCount: profileDiscovery.reportedCount }
          : {}),
        unresolved: profileDiscovery?.reportedCount ?? 0,
        seenProviderIds: [],
        ...(profileDiscovery?.discoveredUrls
          ? { pendingUrls: profileDiscovery.discoveredUrls }
          : {}),
      };
  await saveSourceIntakeState(state);
  await reportSourceIntakeSession(state, "running");

  if (resumable && typeof state.workerTabId === "number") {
    const existingWorker = await chrome.tabs
      .get(state.workerTabId)
      .catch(() => undefined);
    if (existingWorker) {
      if (existingWorker.status === "complete") {
        void dispatchSourceIntake(existingWorker.id!);
      }
      return state;
    }
  }

  const worker = await chrome.tabs.create({
    url: state.currentUrl,
    active: false,
  });
  if (typeof worker.id !== "number") {
    state.running = false;
    state.stopReason = "error";
    state.message = "Could not open the background intake tab.";
    state.updatedAt = new Date().toISOString();
    await saveSourceIntakeState(state);
    throw new Error(state.message);
  }
  state.workerTabId = worker.id;
  await chrome.tabs.update(worker.id, { autoDiscardable: false });
  await saveSourceIntakeState(state);
  if (worker.status === "complete") void dispatchSourceIntake(worker.id);
  return state;
}

async function pauseSourceIntake(importId?: string) {
  const state = await getSourceIntakeState(importId);
  if (!state) throw new Error("No source import is active.");
  await pauseAutomaticSource(state.sourceUrl);
  state.running = false;
  state.stopReason = "paused";
  state.message =
    "Stopped. Resume replays the unfinished page and reuses originals already saved.";
  state.updatedAt = new Date().toISOString();
  const workerTabId = state.workerTabId;
  state.workerTabId = undefined;
  await saveSourceIntakeState(state);
  if (typeof workerTabId === "number")
    await chrome.tabs.remove(workerTabId).catch(() => undefined);
  await reportSourceIntakeSession(state, "interrupted");
  return state;
}

async function acceptSourceIntakeChunk(
  message: Extract<ExtensionMessage, { type: "OURCHIVAL_SOURCE_INTAKE_CHUNK" }>,
  sender: chrome.runtime.MessageSender,
) {
  const state = await getSourceIntakeState(message.importId);
  if (
    !state ||
    !state.running ||
    state.importId !== message.importId ||
    sender.tab?.id !== state.workerTabId
  ) {
    throw new Error("This source import is no longer active.");
  }
  const chunk = message.chunk;
  if (
    !chunk ||
    chunk.provider !== state.provider ||
    chunk.sourceUrl !== state.sourceUrl ||
    !Array.isArray(chunk.items) ||
    chunk.items.length > 120 ||
    (chunk.discoveredUrls && chunk.discoveredUrls.length > 500)
  ) {
    throw new Error("The source chunk does not match this import.");
  }

  const seen = new Set(state.seenProviderIds);
  const fresh = chunk.items.filter((item) => {
    const seenKey = item
      ? sourceIntakeItemKey(state.provider, item)
      : undefined;
    if (
      !item ||
      !/^\d+$/.test(item.providerId) ||
      !isCapturableUrl(item.sourceUrl) ||
      !seenKey ||
      seen.has(seenKey)
    ) {
      return false;
    }
    seen.add(seenKey);
    return true;
  });
  const firstOrdinal = state.observed;
  const payloads = fresh.flatMap((item, index) =>
    sourceIntakePayloads(item, {
      provider: state.provider,
      importId: state.importId,
      ordinal: firstOrdinal + index,
      sensitiveDefault: state.sensitiveDefault,
    }),
  );
  const batch = payloads.length
    ? await runPayloadBatch(payloads, state.provider, state.importId)
    : undefined;
  // A stopped reader must never overwrite a newer pause or resumed worker.
  const latest = await getSourceIntakeState(state.importId);
  if (!sourceReaderCanCommit(latest, sender.tab?.id))
    throw new Error("Stopped; unfinished page will be replayed on resume.");
  const now = new Date().toISOString();
  const queue = reconcilePinterestQueue({
    pendingUrls: state.pendingUrls,
    discoveredUrls: chunk.discoveredUrls,
    currentUrl: chunk.currentUrl,
    exhausted: chunk.exhausted,
  });
  const nextUrl = chunk.nextUrl ?? queue.nextUrl;
  state.seenProviderIds = Array.from(seen);
  state.pendingUrls = queue.pendingUrls;
  state.currentUrl = nextUrl ?? chunk.currentUrl;
  state.cursor = chunk.cursor;
  state.updatedAt = now;
  state.chunks += 1;
  state.automationAttempts = 0;
  state.retryAt = undefined;
  state.needsAttention = false;
  state.observed += fresh.length;
  state.captureAttempts += batch?.total ?? 0;
  state.saved += batch?.saved ?? 0;
  state.duplicates += batch?.duplicates ?? 0;
  state.failed += batch?.failed ?? 0;
  state.skipped += batch?.skipped ?? 0;
  state.receiptVersion = 2;
  state.canonicalReferenceIds = Array.from(
    new Set([
      ...(state.canonicalReferenceIds ?? []),
      ...(batch?.canonicalReferenceIds ?? []),
    ]),
  );
  state.assets ??= {};
  state.expectedPages ??= {};
  state.gaps ??= {};
  await resolveFailures({ sourceUrl: state.sourceUrl }, ["reader"]);
  for (const item of fresh) {
    const referenceKey =
      batch?.referenceReceipts?.find((r) => r.sourceUrl === item.sourceUrl)
        ?.referenceId ?? item.sourceUrl;
    if (item.pageCount || item.assetUrl)
      state.expectedPages[referenceKey] = Math.max(
        state.expectedPages[referenceKey] ?? 0,
        item.pageCount ?? 1,
      );
    else
      state.unknownPageCountArtworks =
        (state.unknownPageCountArtworks ?? 0) + 1;
    if (item.gap) {
      state.gaps[item.providerId] = item.gap;
      await recordFailure({
        provider: state.provider,
        importId: state.importId,
        sourceUrl: item.sourceUrl,
        stage: "metadata",
        message: item.gap,
      });
    } else {
      await resolveFailures({ sourceUrl: item.sourceUrl }, ["metadata"]);
    }
  }
  for (const gap of chunk.gaps ?? []) {
    state.gaps[gap.key] =
      gap.message + ` (ordinal ${gap.ordinal}; ${chunk.currentUrl})`;
    await recordFailure({
      provider: state.provider,
      importId: state.importId,
      sourceUrl: chunk.currentUrl,
      itemKey: gap.key,
      stage: "metadata",
      message: `Item ${gap.key}, ordinal ${gap.ordinal}: ${gap.message}`,
    });
  }
  for (const failure of batch?.failures ?? [])
    state.gaps[failure.url] = failure.message;
  for (const receipt of batch?.assetReceipts ?? []) {
    state.assets[receipt.assetId] = {
      quality: receipt.quality,
      provider: receipt.provider,
    };
    if (receipt.provider === "linked")
      state.gaps[receipt.sourceUrl] = "Image page is not durably stored";
  }
  const assets = Object.values(state.assets);
  state.originalCandidates = Object.values(state.expectedPages).reduce(
    (sum, count) => sum + count,
    0,
  );
  state.originalsStored = assets.filter(
    (a) => a.provider !== "linked" && a.quality === "original",
  ).length;
  state.degradedStored = assets.filter(
    (a) => a.provider !== "linked" && a.quality === "degraded",
  ).length;
  state.unknownStored = assets.filter(
    (a) => a.provider !== "linked" && a.quality === "unknown",
  ).length;
  state.originalsLinked = assets.filter((a) => a.provider === "linked").length;
  state.storedBytes = (state.storedBytes ?? 0) + (batch?.storedBytes ?? 0);
  if (state.purpose !== "sync" && typeof chunk.reportedCount === "number") {
    state.reportedCount = Math.max(
      state.reportedCount ?? 0,
      chunk.reportedCount,
    );
  }
  state.unresolved = state.reportedCount
    ? Math.max(0, state.reportedCount - state.observed)
    : 0;

  state.unresolved = Math.max(state.unresolved, Object.keys(state.gaps).length);
  const sourceExhausted = chunk.exhausted && !nextUrl;
  if (sourceExhausted) {
    state.running = false;
    state.exhausted = true;
    state.completedAt = now;
    state.stopReason = "exhausted";
    state.message = state.unresolved
      ? `Reached the source end with ${state.unresolved} unresolved.`
      : "Reached the source end with a complete receipt.";
  }
  await saveSourceIntakeState(state);
  await reportSourceIntakeSession(
    state,
    sourceExhausted && state.unresolved === 0
      ? "completed"
      : state.running
        ? "running"
        : "interrupted",
  );

  if (sourceExhausted && typeof state.workerTabId === "number") {
    const workerTabId = state.workerTabId;
    setTimeout(
      () => void chrome.tabs.remove(workerTabId).catch(() => undefined),
      250,
    );
  }
  return {
    ok: true,
    continue: state.running,
    ...(state.running && nextUrl ? { nextUrl } : {}),
  };
}

async function dispatchSourceIntake(tabId: number) {
  const state = (await getSourceIntakeStates()).find(
    (candidate) => candidate.workerTabId === tabId,
  );
  if (!state?.running || state.workerTabId !== tabId) return;
  const start = async () =>
    (await chrome.tabs.sendMessage(tabId, {
      type: "OURCHIVAL_START_SOURCE_INTAKE",
      importId: state.importId,
      provider: state.provider,
      sourceUrl: state.sourceUrl,
      purpose: state.purpose,
      knownProviderIds: state.knownProviderIds,
    })) as { ok?: boolean; error?: string } | undefined;
  try {
    let response = await start().catch(() => undefined);
    if (!response) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      response = await start();
    }
    if (!response?.ok)
      throw new Error(response?.error || "Reader did not start.");
  } catch (error) {
    const latest = await getSourceIntakeState(state.importId);
    if (!latest?.running || latest.workerTabId !== tabId) return;
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    const context = detectSourceIntakeContext(tab?.url);
    if (
      context?.sourceUrl === state.sourceUrl &&
      latest.readerRecoveryUrl !== tab?.url
    ) {
      latest.readerRecoveryUrl = tab?.url;
      latest.message =
        "Reader disconnected. Reloading its tab once; checkpoint retained.";
      await saveSourceIntakeState(latest);
      try {
        await chrome.tabs.reload(tabId);
        return;
      } catch {
        /* Persist the stopped state below if reloading is unavailable. */
      }
    }
    latest.running = false;
    latest.stopReason = "error";
    latest.message =
      "Reader did not reconnect after a reload. Stop and resume to open a fresh reader; completed pages and saved originals are retained.";
    latest.updatedAt = new Date().toISOString();
    await saveSourceIntakeState(latest);
    await reportSourceIntakeSession(latest, "interrupted").catch(
      () => undefined,
    );
  }
}

async function reportSourceIntakeSession(
  state: SourceIntakeState,
  status: "running" | "completed" | "interrupted",
) {
  const connection = await getCaptureConnection();
  const endpoint = new URL(connection.endpoint);
  endpoint.pathname = endpoint.pathname.replace(
    /\/capture\/?$/,
    "/capture-session",
  );
  const expected = state.reportedCount ?? state.observed;
  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connection.deviceToken}`,
    },
    body: JSON.stringify({
      sessionKey: state.importId,
      source: state.provider,
      label: state.label,
      sourceUrl: state.sourceUrl,
      receiptJson: JSON.stringify({
        version: state.receiptVersion ?? 1,
        observedArtworks: state.observed,
        uniqueReferences: state.canonicalReferenceIds?.length ?? null,
        imagePagesExpected: state.originalCandidates ?? 0,
        originalsStored:
          state.receiptVersion === 2 ? (state.originalsStored ?? 0) : null,
        degradedPreviews: state.degradedStored ?? 0,
        unprovenRenditions: state.unknownStored ?? 0,
        originalsLinked: state.originalsLinked ?? 0,
        failures: state.failed,
        unresolved: state.unresolved,
        newStoredBytes: state.storedBytes ?? 0,
        unknownPageCountArtworks: state.unknownPageCountArtworks ?? 0,
      }),
      expectedCount: expected,
      completedCount: state.observed,
      savedCount: state.saved,
      duplicateCount: state.duplicates,
      skippedCount: state.skipped,
      failedCount: state.failed,
      status,
      startedAt: state.startedAt,
      ...(status === "completed" && state.completedAt
        ? { completedAt: state.completedAt }
        : {}),
    }),
  });
  if (!response.ok) throw new Error("Could not report source-import progress.");
}

async function captureXLikesChunk(
  message: Extract<ExtensionMessage, { type: "OURCHIVAL_X_LIKES_CHUNK" }>,
  sender: chrome.runtime.MessageSender,
) {
  validateXLikesSender(sender, message.profileUrl);
  const checkpoint = await requireXLikesCheckpoint(
    message.importId,
    message.profileUrl,
    sender.tab?.id,
  );
  if (!Array.isArray(message.snapshots) || message.snapshots.length > 25) {
    throw new Error("X Likes chunks must contain at most 25 rendered posts.");
  }
  const parsedSources = message.snapshots
    .map((snapshot) => parseXSnapshot(snapshot))
    .filter((source): source is ParsedXSource & { postId: string } =>
      Boolean(source.postId),
    );
  let durableAudit = await postCaptureObservations(
    message.importId,
    parsedSources.map((source) => ({
      providerId: source.postId,
      sourceUrl: source.sourceUrl,
      stage: "rendered",
    })),
    checkpoint.audit,
  ).catch(() => checkpoint.audit);
  const payloads = buildXLikePayloads(message.snapshots ?? []);
  if (payloads.length === 0) return checkpoint;

  const state = await runPayloadBatch(payloads, "x_likes", message.importId);
  const indexed = await referenceStatusBatches(
    parsedSources.map((source) => source.sourceUrl),
  ).catch(() => new Set<string>());
  durableAudit = await postCaptureObservations(
    message.importId,
    parsedSources.map((source) => {
      const failure = state.failures.find(
        (candidate) => candidate.url === source.sourceUrl,
      );
      return {
        providerId: source.postId,
        sourceUrl: source.sourceUrl,
        stage: indexed.has(source.sourceUrl) ? "archived" : "failed",
        ...(failure ? { error: failure.message } : {}),
      };
    }),
    durableAudit,
  ).catch(() => durableAudit);
  const lastSource = parsedSources.at(-1);
  const now = new Date().toISOString();
  const latestCheckpoint = await requireXLikesCheckpoint(
    message.importId,
    message.profileUrl,
    sender.tab?.id,
  );
  const next: XLikesImportState = {
    ...latestCheckpoint,
    running: true,
    updatedAt: now,
    automationAttempts: 0,
    retryAt: undefined,
    needsAttention: false,
    chunks: checkpoint.chunks + 1,
    discoveredPosts: checkpoint.discoveredPosts + parsedSources.length,
    captureAttempts: checkpoint.captureAttempts + state.total,
    saved: checkpoint.saved + state.saved,
    attachedMedia: (checkpoint.attachedMedia ?? 0) + (state.attached ?? 0),
    refreshedPosts: (checkpoint.refreshedPosts ?? 0) + (state.refreshed ?? 0),
    duplicates: checkpoint.duplicates + state.duplicates,
    failed: checkpoint.failed + state.failed,
    skipped: checkpoint.skipped + state.skipped,
    originalsStored:
      (checkpoint.originalsStored ?? 0) + (state.originalsStored ?? 0),
    originalsLinked:
      (checkpoint.originalsLinked ?? 0) + (state.originalsLinked ?? 0),
    storedBytes: (checkpoint.storedBytes ?? 0) + (state.storedBytes ?? 0),
    ...(durableAudit
      ? {
          audit: mergeXLikesAuditReceipt(latestCheckpoint.audit, durableAudit),
        }
      : {}),
    lastSourceUrl:
      message.lastSourceUrl ??
      lastSource?.sourceUrl ??
      checkpoint.lastSourceUrl,
    lastPublishedAt: lastSource?.publishedAt ?? checkpoint.lastPublishedAt,
    stopReason: undefined,
    message: undefined,
  };
  await saveXLikesImportState(next);
  await resolveFailures({ sourceUrl: next.profileUrl }, ["reader"]);
  await reportXLikesSession(next, "running");
  return next;
}

async function recordXLikesObservations(
  message: Extract<ExtensionMessage, { type: "OURCHIVAL_X_LIKES_OBSERVED" }>,
  sender: chrome.runtime.MessageSender,
) {
  validateXLikesSender(sender, message.profileUrl);
  const state = await requireXLikesCheckpoint(
    message.importId,
    message.profileUrl,
    sender.tab?.id,
  );
  if (
    !Array.isArray(message.observations) ||
    message.observations.length === 0 ||
    message.observations.length > 200
  ) {
    throw new Error("X discovery batches must contain 1 to 200 posts.");
  }
  const observations = message.observations.map((observation) => {
    if (!/^\d+$/.test(observation.providerId)) {
      throw new Error("X discovery contained an invalid post ID.");
    }
    const sourceUrl = observation.sourceUrl
      ? normalizeAuditedXSourceUrl(observation.sourceUrl)
      : undefined;
    return {
      providerId: observation.providerId,
      ...(sourceUrl ? { sourceUrl } : {}),
      stage: observation.stage,
      ...(observation.error ? { error: observation.error } : {}),
    };
  });
  const audit = await postCaptureObservations(
    state.importId,
    observations,
    state.audit,
  );
  if (!audit) throw new Error("The X discovery receipt was empty.");
  const latest = await requireXLikesCheckpoint(
    state.importId,
    state.profileUrl,
  );
  await saveXLikesImportState({
    ...latest,
    audit: mergeXLikesAuditReceipt(latest.audit, audit),
    updatedAt: new Date().toISOString(),
  });
  return audit;
}

function mergeXLikesAuditReceipt(
  current: XLikesAuditReceipt | undefined,
  incoming: XLikesAuditReceipt,
) {
  if (!current?.durable) return incoming;
  if (!incoming.durable) return current;
  return incoming.networkPosts >= current.networkPosts &&
    incoming.observedPosts >= current.observedPosts &&
    incoming.vaultPosts >= current.vaultPosts
    ? incoming
    : current;
}

async function postCaptureObservations(
  importId: string,
  observations: CaptureObservation[],
  previous: XLikesAuditReceipt | undefined,
) {
  if (observations.length === 0) return previous;
  const localReceipt = await recordXLikesObservationsLocally(
    importId,
    observations,
    previous,
  );
  const connection = await getCaptureConnection();
  const endpoint = new URL(connection.endpoint);
  endpoint.pathname = endpoint.pathname.replace(
    /\/capture\/?$/,
    "/capture-observations",
  );
  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connection.deviceToken}`,
    },
    body: JSON.stringify({
      sessionKey: importId,
      source: "x_likes",
      observations: observations.map((observation) => ({
        ...observation,
        observedAt: new Date().toISOString(),
      })),
    }),
  }).catch(() => undefined);
  if (!response) return mergeXLikesAuditReceipt(previous, localReceipt);
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    receipt?: {
      status: "verified" | "gaps";
      networkPosts: number;
      observedPosts: number;
      vaultPosts: number;
      networkMissingInDom: number;
      domMissingInVault: number;
    };
  };
  if (!response.ok || !body.receipt) {
    return mergeXLikesAuditReceipt(previous, localReceipt);
  }
  const serverReceipt = {
    status: body.receipt.status,
    durable: true,
    networkPages: previous?.networkPages ?? 0,
    networkPosts: body.receipt.networkPosts,
    observedPosts: body.receipt.observedPosts,
    vaultPosts: body.receipt.vaultPosts,
    vaultChecked: true,
    unparseableArticles: previous?.unparseableArticles ?? 0,
    networkMissingInDom: body.receipt.networkMissingInDom,
    domMissingInVault: body.receipt.domMissingInVault,
    networkGapSamples: previous?.networkGapSamples ?? [],
    vaultGapSamples: previous?.vaultGapSamples ?? [],
    reconciledAt: new Date().toISOString(),
  } satisfies XLikesAuditReceipt;
  return mergeXLikesAuditReceipt(localReceipt, serverReceipt);
}

async function finishXLikesImport(
  message: Extract<ExtensionMessage, { type: "OURCHIVAL_X_LIKES_FINISHED" }>,
  sender: chrome.runtime.MessageSender,
) {
  validateXLikesSender(sender, message.profileUrl);
  const state = await requireXLikesCheckpoint(
    message.importId,
    message.profileUrl,
    sender.tab?.id,
  );
  const now = new Date().toISOString();
  const exhausted =
    message.stopReason === "known_boundary" ||
    message.stopReason === "timeline_end";
  const audit = state.audit?.durable
    ? {
        ...state.audit,
        networkPages: Math.max(
          state.audit.networkPages,
          Math.max(0, Math.floor(message.audit?.networkPages ?? 0)),
        ),
        unparseableArticles: Math.max(
          state.audit.unparseableArticles,
          Math.max(0, Math.floor(message.audit?.unparseableArticles ?? 0)),
        ),
        reconciledAt: new Date().toISOString(),
      }
    : await reconcileXLikesAudit(message.audit);
  const next: XLikesImportState = {
    ...state,
    running: false,
    exhausted,
    updatedAt: now,
    ...(exhausted ? { completedAt: now } : {}),
    ...(message.lastSourceUrl ? { lastSourceUrl: message.lastSourceUrl } : {}),
    stopReason: message.stopReason,
    audit,
    ...(message.message ? { message: message.message } : {}),
  };
  await saveXLikesImportState(next);
  await reportXLikesSession(next, exhausted ? "completed" : "interrupted");
  return next;
}

async function reconcileXLikesAudit(
  input: XLikesAuditInput | undefined,
): Promise<XLikesAuditReceipt> {
  const networkIds = new Set(
    (input?.networkPostIds ?? [])
      .filter(
        (value): value is string =>
          typeof value === "string" && /^\d+$/.test(value),
      )
      .slice(0, 20_000),
  );
  const observedUrls = Array.from(
    new Set(
      (input?.observedSourceUrls ?? [])
        .map(normalizeAuditedXSourceUrl)
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 20_000);
  const observedIds = new Set(
    observedUrls
      .map((sourceUrl) => sourceUrl.match(/\/status\/(\d+)$/)?.[1])
      .filter((value): value is string => Boolean(value)),
  );
  const networkGaps = Array.from(networkIds).filter(
    (postId) => !observedIds.has(postId),
  );

  let indexed = new Set<string>();
  let vaultChecked = true;
  try {
    indexed = await referenceStatusBatches(observedUrls);
  } catch {
    vaultChecked = false;
  }
  const vaultGaps = vaultChecked
    ? observedUrls.filter((sourceUrl) => !indexed.has(sourceUrl))
    : [];
  const unparseableArticles = Math.max(
    0,
    Math.floor(input?.unparseableArticles ?? 0),
  );
  const hasGaps =
    networkGaps.length > 0 || vaultGaps.length > 0 || unparseableArticles > 0;
  const partial =
    !vaultChecked ||
    Boolean(input?.truncated) ||
    (input?.networkPages ?? 0) === 0 ||
    networkIds.size < observedIds.size;

  return {
    status: hasGaps ? "gaps" : partial ? "partial" : "verified",
    networkPages: Math.max(0, Math.floor(input?.networkPages ?? 0)),
    networkPosts: networkIds.size,
    observedPosts: observedUrls.length,
    vaultPosts: vaultChecked ? indexed.size : 0,
    vaultChecked,
    unparseableArticles,
    networkMissingInDom: networkGaps.length,
    domMissingInVault: vaultGaps.length,
    networkGapSamples: networkGaps.slice(0, 25),
    vaultGapSamples: vaultGaps.slice(0, 25),
    reconciledAt: new Date().toISOString(),
  };
}

async function referenceStatusBatches(sourceUrls: string[]) {
  const indexed = new Set<string>();
  const batches: string[][] = [];
  for (let index = 0; index < sourceUrls.length; index += 80) {
    batches.push(sourceUrls.slice(index, index + 80));
  }
  for (let index = 0; index < batches.length; index += 6) {
    const results = await Promise.all(
      batches.slice(index, index + 6).map(referenceStatus),
    );
    for (const sourceUrl of results.flat()) indexed.add(sourceUrl);
  }
  return indexed;
}

function normalizeAuditedXSourceUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)$/i);
    if (!/(^|\.)x\.com$/i.test(url.hostname) || !match?.[1] || !match[2]) {
      return undefined;
    }
    return `https://x.com/${encodeURIComponent(decodeURIComponent(match[1]))}/status/${match[2]}`;
  } catch {
    return undefined;
  }
}

async function reportXLikesSession(
  state: XLikesImportState,
  status: "running" | "completed" | "interrupted",
  providedConnection?: CaptureConnection,
) {
  const connection = providedConnection ?? (await getCaptureConnection());
  const endpoint = new URL(connection.endpoint);
  endpoint.pathname = endpoint.pathname.replace(
    /\/capture\/?$/,
    "/capture-session",
  );
  const handle = state.profileUrl.match(/x\.com\/([^/]+)\/likes$/i)?.[1];
  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connection.deviceToken}`,
    },
    body: JSON.stringify({
      sessionKey: state.importId,
      source: "x_likes",
      label: handle ? `X Likes · @${handle}` : "X Likes",
      sourceUrl: state.profileUrl,
      expectedCount: state.captureAttempts,
      completedCount: state.captureAttempts,
      savedCount: state.saved + (state.attachedMedia ?? 0),
      duplicateCount: state.duplicates + (state.refreshedPosts ?? 0),
      skippedCount: state.skipped,
      failedCount: state.failed,
      status,
      startedAt: state.startedAt,
      ...(status === "completed" && state.completedAt
        ? { completedAt: state.completedAt }
        : {}),
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error || "Could not report capture-session progress.");
  }
}

async function requireXLikesCheckpoint(
  importId: string,
  profileUrl: string,
  senderTabId?: number,
) {
  const state = await getXLikesImportState();
  if (
    !state ||
    !state.running ||
    typeof senderTabId !== "number" ||
    state.workerTabId !== senderTabId ||
    state.importId !== importId ||
    state.profileUrl !== profileUrl
  ) {
    throw new Error("This X Likes import is no longer active.");
  }
  return state;
}

function validateXLikesSender(
  sender: chrome.runtime.MessageSender,
  profileUrl: string,
) {
  if (!isXLikesUrl(sender.tab?.url)) {
    throw new Error("X Likes chunks are accepted only from a Likes tab.");
  }
  if (canonicalLikesUrl(sender.tab!.url!) !== profileUrl) {
    throw new Error("The X Likes chunk came from a different profile.");
  }
}

async function queryTabs(mode: TabCaptureMode) {
  if (mode === "current") {
    return await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }
  if (mode === "selected") {
    return await chrome.tabs.query({
      highlighted: true,
      lastFocusedWindow: true,
    });
  }
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  return tabs.sort((left, right) => left.index - right.index);
}

async function runPayloadBatch(
  payloads: CapturePayload[],
  source: BatchCaptureSource,
  jobId?: string,
) {
  return await runBatch(
    source,
    payloads.map((payload) => ({
      url: payload.sourceUrl,
      title: payload.pageTitle,
      payload,
    })),
    jobId,
  );
}

async function runBatch(
  source: BatchCaptureSource,
  items: BatchCaptureItem[],
  jobId?: string,
) {
  const resolvedJobId = jobId ?? createJobId();
  if (activeJobIds.has(resolvedJobId)) {
    throw new Error("This import chunk is already running.");
  }
  const connection = await getCaptureConnection();

  const state: BatchCaptureState = {
    receiptVersion: 2,
    jobId: resolvedJobId,
    source,
    running: true,
    startedAt: new Date().toISOString(),
    total: items.length,
    completed: 0,
    nextIndex: 0,
    saved: 0,
    attached: 0,
    refreshed: 0,
    duplicates: 0,
    failed: 0,
    skipped: 0,
    originalsStored: 0,
    originalsLinked: 0,
    storedBytes: 0,
    refreshedSourceUrls: [],
    items,
    successfulTabIds: [],
    failures: [],
  };

  await saveBatchState(state);
  return await continueBatch(state, connection);
}

async function continueBatch(
  state: BatchCaptureState,
  providedConnection?: CaptureConnection,
) {
  if (activeJobIds.has(state.jobId)) return state;

  let connection: CaptureConnection;
  try {
    connection = providedConnection ?? (await getCaptureConnection());
  } catch (error) {
    state.running = false;
    state.currentLabel =
      "Pair the Clipper again, then retry the remaining captures.";
    await saveBatchState(state);
    throw error;
  }

  activeJobIds.add(state.jobId);
  state.running = true;
  state.attached ??= 0;
  state.refreshed ??= 0;
  state.originalsStored ??= 0;
  state.originalsLinked ??= 0;
  state.storedBytes ??= 0;
  state.refreshedSourceUrls ??= [];
  await chrome.action.setBadgeText({ text: "…" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6f5bb7" });

  try {
    while (state.nextIndex < state.items.length) {
      if (
        state.source === "pixiv_bookmarks" ||
        state.source === "pinterest_board"
      ) {
        const sourceState = await getSourceIntakeState(state.jobId);
        if (!sourceState?.running) {
          state.running = false;
          await saveBatchState({ ...state });
          throw new Error(
            "Stopped; saved images are retained. Resume the source import to replay this page.",
          );
        }
      }
      const captureConcurrency = captureConcurrencyFor(connection);
      const windowItems = state.items.slice(
        state.nextIndex,
        state.nextIndex + captureConcurrency,
      );
      const outcomes = await Promise.all(
        windowItems.map((item) => captureBatchItem(connection, state, item)),
      );
      const missingOriginal =
        outcomes
          .map((outcome) =>
            originalDownloadFailure(
              state.source,
              Boolean(outcome.payload?.assetUrl),
              outcome.result?.body,
            ),
          )
          .find(Boolean) ??
        (["pixiv_bookmarks", "pinterest_board", "x_likes"].includes(
          state.source,
        )
          ? outcomes.find((outcome) => outcome.error)?.error &&
            "Capture request failed; automatic retry will replay the unfinished chunk."
          : undefined);
      if (missingOriginal) {
        state.running = false;
        await saveBatchState({ ...state });
        const sourceState = await getSourceIntakeState(state.jobId);
        const reason = missingOriginal;
        if (sourceState?.running) {
          sourceState.running = false;
          sourceState.stopReason = "error";
          sourceState.message = `${reason} Stopped before advancing this page. Resume after fixing storage; saved originals will be reused.`;
          sourceState.updatedAt = new Date().toISOString();
          await saveSourceIntakeState(sourceState);
          await reportSourceIntakeSession(sourceState, "interrupted").catch(
            () => undefined,
          );
        }
        throw new Error("Original storage failed; page checkpoint retained.");
      }
      let latestSuccessful: BatchItemOutcome | undefined;
      for (const outcome of outcomes) {
        applyBatchItemOutcome(state, outcome);
        advanceCheckpoint(state);
        if (outcome.payload && outcome.result?.ok && !outcome.error) {
          latestSuccessful = outcome;
        }
      }
      if (latestSuccessful?.payload && latestSuccessful.result) {
        await Promise.all([
          saveLastCapture(latestSuccessful.payload),
          saveLastResult(toCaptureResult(latestSuccessful.result)),
        ]);
      }
      state.updatedAt = new Date().toISOString();
      await saveBatchState({ ...state });
    }

    state.running = false;
    state.completedAt = new Date().toISOString();
    state.currentLabel = undefined;
    await saveBatchState({ ...state });
    const successful =
      state.saved +
      state.duplicates +
      (state.attached ?? 0) +
      (state.refreshed ?? 0);
    await chrome.action.setBadgeText({
      text:
        successful > 99
          ? "99+"
          : successful > 0
            ? String(successful)
            : state.failed
              ? "!"
              : "✓",
    });
    await chrome.action.setBadgeBackgroundColor({
      color: state.failed ? "#8a5d3d" : "#3d6b3d",
    });
    return state;
  } finally {
    activeJobIds.delete(state.jobId);
  }
}

async function captureBatchItem(
  connection: CaptureConnection,
  state: BatchCaptureState,
  item: BatchCaptureItem,
): Promise<BatchItemOutcome> {
  const sourceUrl = item.payload?.sourceUrl ?? item.url ?? "";
  if (!isCapturableUrl(sourceUrl)) return { item, sourceUrl, skipped: true };
  const payload: CapturePayload = item.payload
    ? { ...item.payload, captureSessionId: state.jobId }
    : {
        kind: "page",
        sourceUrl,
        ...(item.title ? { pageTitle: item.title } : {}),
        captureSessionId: state.jobId,
        capturedAt: new Date().toISOString(),
      };
  const diagnostic = {
    provider: state.source,
    importId: state.jobId,
    sourceUrl,
    assetUrl: payload.assetOriginalUrl ?? payload.assetUrl,
    imagePage:
      payload.assetIndex === undefined ? undefined : payload.assetIndex + 1,
    imageCount: payload.assetCount,
  };
  try {
    let result = await capturePayload(connection, payload);
    for (
      let attempt = 0;
      !result.ok && result.status >= 500 && attempt < 2;
      attempt++
    ) {
      await recordFailure({
        ...diagnostic,
        stage: "request",
        httpStatus: result.status,
        message: result.error || "Capture request failed",
      });
      await new Promise((resolve) =>
        setTimeout(resolve, (attempt + 1) * 2_000),
      );
      result = await capturePayload(connection, payload);
    }
    if (!result.ok) {
      await recordFailure({
        ...diagnostic,
        stage: "request",
        httpStatus: result.status,
        message: result.error || "Capture request failed",
      });
      return {
        item,
        sourceUrl,
        payload,
        error: new Error(
          result.error || `Capture failed with status ${result.status}`,
        ),
      };
    }
    await resolveFailures(diagnostic, ["request"]);
    if (
      payload.assetUrl &&
      !result.body.blocked &&
      classifyAssetStorage(result.body) === "linked"
    ) {
      await recordFailure({
        ...diagnostic,
        stage: "storage",
        message:
          result.body.storageStatus ||
          "Image is link-only; no durable original was confirmed",
      });
    } else if (
      payload.assetUrl &&
      classifyAssetStorage(result.body) === "stored" &&
      result.body.assetQuality === "original"
    ) {
      await resolveFailures(diagnostic, ["storage"]);
    }
    return { item, sourceUrl, payload, result };
  } catch (error) {
    await recordFailure({
      ...diagnostic,
      stage: "request",
      message: errorMessage(error, "Capture request interrupted"),
    });
    return { item, sourceUrl, payload, error };
  }
}

function applyBatchItemOutcome(
  state: BatchCaptureState,
  outcome: BatchItemOutcome,
) {
  const { item, sourceUrl, payload, result } = outcome;
  state.currentLabel = item.title || sourceUrl || "Unsupported tab";
  if (outcome.skipped) {
    state.skipped += 1;
    return;
  }
  if (!payload || !result || outcome.error) {
    state.failed += 1;
    state.failures.push({
      url: sourceUrl,
      ...(item.title ? { title: item.title } : {}),
      ...(payload ? { payload } : {}),
      message: errorMessage(outcome.error, "Capture failed."),
    });
    return;
  }

  if (state.source === "x_likes") {
    const classification = classifyXLikeCapture(payload, result.body);
    if (classification === "attached")
      state.attached = (state.attached ?? 0) + 1;
    else if (classification === "duplicate") {
      state.refreshedSourceUrls ??= [];
      if (!state.refreshedSourceUrls.includes(payload.sourceUrl)) {
        state.refreshed = (state.refreshed ?? 0) + 1;
        state.refreshedSourceUrls.push(payload.sourceUrl);
      }
    } else state.saved += 1;
  } else if (result.body.alreadySaved) state.duplicates += 1;
  else state.saved += 1;
  state.canonicalReferenceIds ??= [];
  if (
    result.body.referenceId &&
    !state.canonicalReferenceIds.includes(result.body.referenceId)
  )
    state.canonicalReferenceIds.push(result.body.referenceId);
  state.referenceReceipts ??= [];
  if (result.body.referenceId)
    state.referenceReceipts.push({
      sourceUrl: payload.sourceUrl,
      referenceId: result.body.referenceId,
    });
  state.assetReceipts ??= [];
  if (result.body.assetId && result.body.referenceId)
    state.assetReceipts.push({
      assetId: result.body.assetId,
      referenceId: result.body.referenceId,
      quality: result.body.assetQuality ?? "unknown",
      provider: result.body.storageProvider ?? "linked",
      sourceUrl: payload.sourceUrl,
    });
  const storage = classifyAssetStorage(result.body);
  if (storage === "stored") {
    if (result.body.assetQuality === "original")
      state.originalsStored = (state.originalsStored ?? 0) + 1;
    else if (result.body.assetQuality === "degraded")
      state.degradedStored = (state.degradedStored ?? 0) + 1;
    else state.unknownStored = (state.unknownStored ?? 0) + 1;
    state.storedBytes =
      (state.storedBytes ?? 0) +
      (Number.isFinite(result.body.newStoredBytes)
        ? Math.max(0, result.body.newStoredBytes ?? 0)
        : 0);
  } else if (storage === "linked") {
    state.originalsLinked = (state.originalsLinked ?? 0) + 1;
  }
  if (typeof item.tabId === "number") state.successfulTabIds.push(item.tabId);
}

function captureConcurrencyFor(connection: CaptureConnection) {
  try {
    const hostname = new URL(connection.endpoint).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1"
      ? localCaptureConcurrency
      : defaultCaptureConcurrency;
  } catch {
    return defaultCaptureConcurrency;
  }
}

function advanceCheckpoint(state: BatchCaptureState) {
  state.nextIndex += 1;
  state.completed = state.nextIndex;
}

async function resumeInterruptedBatches() {
  const states = (await getBatchStates()).filter(
    (state) =>
      state.running &&
      !["pixiv_bookmarks", "pinterest_board", "x_likes"].includes(
        state.source,
      ) &&
      Array.isArray(state.items) &&
      typeof state.nextIndex === "number" &&
      state.nextIndex < state.items.length,
  );
  await Promise.allSettled(
    states.map(async (state) => {
      try {
        await continueBatch(state);
      } catch (error) {
        state.running = false;
        state.currentLabel = errorMessage(
          error,
          "The interrupted import could not resume.",
        );
        await saveBatchState(state);
      }
    }),
  );
}

async function closeSavedTabs(tabIds: number[]) {
  const uniqueIds = Array.from(
    new Set(tabIds.filter((tabId) => Number.isInteger(tabId) && tabId >= 0)),
  );
  let closed = 0;
  for (const tabId of uniqueIds) {
    try {
      await chrome.tabs.remove(tabId);
      closed += 1;
    } catch {
      // Continue through tabs that were already closed elsewhere.
    }
  }
  const stored = await chrome.storage.local.get(LAST_BATCH_KEY);
  const state = stored[LAST_BATCH_KEY] as BatchCaptureState | undefined;
  if (state) {
    state.successfulTabIds = state.successfulTabIds.filter(
      (tabId) => !uniqueIds.includes(tabId),
    );
    await saveBatchState(state);
  }
  return closed;
}

async function getCaptureConnection(): Promise<CaptureConnection> {
  const settings = await getSettings();
  const endpoint = normalizeCaptureEndpoint(settings.captureEndpoint);
  const deviceToken = settings.deviceToken?.trim();
  if (!endpoint || !deviceToken) {
    throw new Error(
      "Pair this browser from the Ourchival Clipper popup first.",
    );
  }
  return { endpoint, deviceToken };
}

async function referenceStatus(sourceUrls: string[]) {
  const connection = await getCaptureConnection();
  const endpoint = new URL(connection.endpoint);
  endpoint.pathname = endpoint.pathname.replace(
    /\/capture\/?$/,
    "/reference-status",
  );
  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connection.deviceToken}`,
    },
    body: JSON.stringify({ sourceUrls: sourceUrls.slice(0, 80) }),
  });
  const body = (await response
    .json()
    .catch(() => ({}))) as ReferenceStatusResponse;
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || response.statusText);
  }
  return body.indexedSourceUrls ?? [];
}

async function captureLiveXLike(snapshot: XDomSnapshot) {
  const connection = await getCaptureConnection();
  const payloads = buildXLikePayloads([snapshot]);
  if (payloads.length === 0) throw new Error("This X post could not be read.");
  const results = await Promise.all(
    payloads.map(async (payload) => ({
      payload,
      result: await capturePayload(connection, payload),
    })),
  );
  const failed = results.find(({ result }) => !result.ok);
  if (failed) {
    throw new Error(
      failed.result.error ||
        `Capture failed with status ${failed.result.status}`,
    );
  }
  const latest = results.at(-1)!;
  await saveLastCapture(latest.payload);
  await saveLastResult(toCaptureResult(latest.result));
  return payloads[0]!.sourceUrl;
}

async function capturePayload(
  connection: CaptureConnection,
  payload: CapturePayload,
) {
  const response = await fetch(connection.endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connection.deviceToken}`,
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as CaptureResponse;
  return {
    ok: response.ok && body.ok !== false,
    status: response.status,
    body,
    error: body.error ?? response.statusText,
  };
}

function toCaptureResult(
  result: Awaited<ReturnType<typeof capturePayload>>,
): CaptureResult {
  return {
    ok: result.ok,
    status: result.status,
    message: result.ok
      ? result.body.alreadySaved
        ? duplicateMessage(result.body.existingReference)
        : ["Saved to Ourchival.", result.body.storageStatus]
            .filter(Boolean)
            .join(" ")
      : result.error,
    storageStatus: result.body.storageStatus,
    referenceId: result.body.referenceId,
    assetId: result.body.assetId,
    alreadySaved: result.body.alreadySaved,
    duplicateReason: result.body.duplicateReason,
    existingReference: result.body.existingReference,
    savedAt: new Date().toISOString(),
  };
}

function buildCapturePayload(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  context: ContextCapture | undefined,
): CapturePayload {
  if (context?.parsedSource?.platform === "x") {
    const assetUrl = context.clickedAssetUrl ?? info.srcUrl;
    return buildXPayload(context, {
      kind: assetUrl ? "image" : "post",
      ...(assetUrl ? { assetUrl } : {}),
      altText: assetUrl ? context.parsedSource.altTexts?.[assetUrl] : undefined,
    });
  }

  const snapshotFields = pageSnapshotFields(context?.pageSnapshot);
  const selectedText = info.selectionText ?? context?.selectedText;

  if (info.srcUrl) {
    return {
      kind: "image",
      sourceUrl: info.pageUrl ?? tab?.url ?? info.srcUrl,
      assetUrl: info.srcUrl,
      ...snapshotFields,
      ...(!snapshotFields.pageTitle && tab?.title
        ? { pageTitle: tab.title }
        : {}),
      ...(selectedText ? { selectedText } : {}),
      capturedAt: new Date().toISOString(),
    };
  }
  if (info.linkUrl) {
    return {
      kind: "link",
      sourceUrl: info.linkUrl,
      ...(selectedText ? { selectedText } : {}),
      capturedAt: new Date().toISOString(),
    };
  }
  return {
    kind: "page",
    sourceUrl: info.pageUrl ?? tab?.url ?? "",
    ...snapshotFields,
    ...(!snapshotFields.pageTitle && tab?.title
      ? { pageTitle: tab.title }
      : {}),
    ...(selectedText ? { selectedText } : {}),
    capturedAt: new Date().toISOString(),
  };
}

function pageSnapshotFields(
  snapshot: PageSnapshot | undefined,
): Partial<CapturePayload> {
  if (!snapshot) return {};
  return {
    ...(snapshot.canonicalUrl ? { canonicalUrl: snapshot.canonicalUrl } : {}),
    ...(snapshot.title ? { pageTitle: snapshot.title } : {}),
    ...(snapshot.description ? { pageDescription: snapshot.description } : {}),
    ...(snapshot.siteName ? { siteName: snapshot.siteName } : {}),
    ...(snapshot.faviconUrl ? { faviconUrl: snapshot.faviconUrl } : {}),
    ...(snapshot.previewImageUrl
      ? { previewImageUrl: snapshot.previewImageUrl }
      : {}),
    ...(snapshot.author ? { pageAuthor: snapshot.author } : {}),
    ...(snapshot.contentType ? { contentType: snapshot.contentType } : {}),
  };
}

function buildXPayload(
  context: ContextCapture,
  args: { kind: "image" | "post"; assetUrl?: string; altText?: string },
): CapturePayload {
  const source = context.parsedSource!;
  return {
    kind: args.kind,
    sourceUrl: source.sourceUrl,
    ...(args.assetUrl ? { assetUrl: args.assetUrl } : {}),
    ...(source.title
      ? { pageTitle: source.title }
      : { pageTitle: context.pageTitle }),
    ...(context.selectedText ? { selectedText: context.selectedText } : {}),
    ...(source.authorName ? { authorName: source.authorName } : {}),
    ...(source.authorHandle ? { authorHandle: source.authorHandle } : {}),
    ...(source.authorUrl ? { authorUrl: source.authorUrl } : {}),
    ...(source.postId ? { postId: source.postId } : {}),
    ...(source.postText ? { postText: source.postText } : {}),
    ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
    ...(args.altText ? { altText: args.altText } : {}),
    ...(context.rawMetadata ? { rawMetadata: context.rawMetadata } : {}),
    capturedAt: new Date().toISOString(),
  };
}

function duplicateMessage(
  existingReference: CaptureResult["existingReference"],
) {
  const title = existingReference?.title?.trim();
  const savedDate = existingReference?.capturedAt
    ? new Date(existingReference.capturedAt).toLocaleDateString()
    : undefined;
  const boardNote = existingReference?.boardCount
    ? ` It is already in ${existingReference.boardCount} ${
        existingReference.boardCount === 1 ? "board" : "boards"
      }.`
    : "";
  return `Already saved${title ? ` as “${title}”` : ""}${
    savedDate ? ` on ${savedDate}` : ""
  }.${boardNote}`;
}

function createJobId() {
  return `capture-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function createImportId() {
  return `x-likes-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function createSourceImportId() {
  return `source-import-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function canonicalLikesUrl(value: string) {
  const url = new URL(value);
  return `https://x.com${url.pathname.replace(/\/$/, "")}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function markResult(result: CaptureResult) {
  await saveLastResult(result);
  await chrome.action.setBadgeText({
    text: result.alreadySaved ? "↺" : result.ok ? "✓" : "!",
  });
  await chrome.action.setBadgeBackgroundColor({
    color: result.alreadySaved ? "#6f5bb7" : result.ok ? "#3d6b3d" : "#8a3d3d",
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    void dispatchSourceIntake(tabId);
    void dispatchXLikes(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const states = (await getSourceIntakeStates()).filter(
      (state) => state.running && state.workerTabId === tabId,
    );
    await Promise.all(
      states.map(async (state) => {
        state.running = false;
        state.stopReason = "tab_closed";
        state.message = "The intake tab closed. Start again to resume safely.";
        state.updatedAt = new Date().toISOString();
        await saveSourceIntakeState(state);
        await reportSourceIntakeSession(state, "interrupted").catch(
          () => undefined,
        );
      }),
    );
  })();
});

async function resumeSourceIntakes() {
  const states = (await getSourceIntakeStates()).filter(
    (state) => state.running && typeof state.workerTabId === "number",
  );
  await Promise.all(
    states.map(async (state) => {
      const tab = await chrome.tabs
        .get(state.workerTabId!)
        .catch(() => undefined);
      if (!tab) {
        state.running = false;
        state.stopReason = "tab_closed";
        state.message = "The intake tab is gone. Start again to resume safely.";
        state.updatedAt = new Date().toISOString();
        await saveSourceIntakeState(state);
        return;
      }
      if (tab.status === "complete") void dispatchSourceIntake(tab.id!);
    }),
  );
}

void resumeInterruptedBatches();

let automationTickRunning = false;
let automationWrite = Promise.resolve();
function changeAutomation(change: (state: AutomationState) => void) {
  automationWrite = automationWrite
    .catch(() => undefined)
    .then(async () => {
      const values = await chrome.storage.local.get(AUTOMATION_KEY);
      const state: AutomationState = values[AUTOMATION_KEY] ?? {};
      change(state);
      await chrome.storage.local.set({ [AUTOMATION_KEY]: state });
    });
  return automationWrite;
}
async function pauseAutomaticSource(url: string) {
  await changeAutomation((state) => {
    state.pausedSources = Array.from(
      new Set([...(state.pausedSources ?? []), url]),
    );
  });
}
async function unpauseSource(url: string) {
  await changeAutomation((state) => {
    state.pausedSources = (state.pausedSources ?? []).filter(
      (value) => value !== url,
    );
  });
}
async function updateAutomation(message: {
  enabled?: boolean;
  syncUrl?: string;
}) {
  const sources = await getSourceIntakeStates();
  const x = await getXLikesImportStates();
  const knownUrls = new Set([
    ...sources.map((s) => s.sourceUrl),
    ...x.map((s) => s.profileUrl),
  ]);
  if (message.syncUrl && !knownUrls.has(message.syncUrl))
    throw new Error("Import this source first");
  await changeAutomation((state) => {
    if (typeof message.enabled === "boolean") {
      state.enabled = message.enabled;
      if (message.enabled) state.pausedSources = [];
    }
    if (message.syncUrl) {
      state.requestedSync = Array.from(
        new Set([...(state.requestedSync ?? []), message.syncUrl]),
      );
      state.pausedSources = (state.pausedSources ?? []).filter(
        (url) => url !== message.syncUrl,
      );
    }
  });
  if (message.enabled === false) {
    for (const state of sources.filter((s) => s.running))
      await pauseSourceIntake(state.importId);
    if ((await getXLikesImportState())?.running) await pauseXLikesImport();
  } else if (message.enabled === true) {
    // Explicitly re-enabling is the acknowledgment needed after an attention stop.
    for (const state of sources.filter((s) => !s.running && !s.exhausted)) {
      state.needsAttention = false;
      state.automationAttempts = 0;
      state.retryAt = Date.now();
      if (state.stopReason === "paused") state.stopReason = "error";
      await saveSourceIntakeState(state);
    }
    for (const state of x.filter((s) => !s.running && !s.exhausted)) {
      state.needsAttention = false;
      state.automationAttempts = 0;
      state.retryAt = Date.now();
      if (state.stopReason === "paused") state.stopReason = "error";
      await saveXLikesImportState(state);
    }
    void runAutomaticImports();
  }
  if (message.syncUrl) void runAutomaticImports();
}
async function saveReaderHeartbeat(
  message: { importId: string; phase: "reading" | "saving" },
  sender: chrome.runtime.MessageSender,
) {
  const source = await getSourceIntakeState(message.importId);
  const x = await getXLikesImportState();
  const owner =
    source?.importId === message.importId
      ? source
      : x?.importId === message.importId
        ? x
        : undefined;
  if (
    !owner?.running ||
    owner.workerTabId !== sender.tab?.id ||
    typeof sender.tab?.id !== "number"
  )
    return;
  if (message.phase !== "reading" && message.phase !== "saving") return;
  const values = await chrome.storage.local.get(HEARTBEATS_KEY);
  const beats: Record<string, ReaderHeartbeat> = values[HEARTBEATS_KEY] ?? {};
  beats[message.importId] = {
    at: Date.now(),
    phase: message.phase,
    tabId: sender.tab.id,
  };
  const recent = Object.entries(beats)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 32);
  await chrome.storage.local.set({
    [HEARTBEATS_KEY]: Object.fromEntries(recent),
  });
}
type AutomatedJob = {
  url: string;
  x: boolean;
  state: SourceIntakeState | XLikesImportState;
};
async function saveAutomatedJob(job: AutomatedJob) {
  if (job.x) await saveXLikesImportState(job.state as XLikesImportState);
  else await saveSourceIntakeState(job.state as SourceIntakeState);
}
async function launchAutomatedJob(job: AutomatedJob, purpose?: ImportPurpose) {
  const oldTabId = job.state.workerTabId;
  job.state.workerTabId = undefined;
  await saveAutomatedJob(job);
  if (typeof oldTabId === "number")
    await chrome.tabs.remove(oldTabId).catch(() => undefined);
  const request = {
    sourceUrl: job.url,
    ...(purpose ? { purpose } : { importId: job.state.importId }),
  };
  if (job.x) await startXLikesImport(request);
  else await startSourceIntake(Boolean(purpose), request);
}
async function runAutomaticImports() {
  if (automationTickRunning) return;
  automationTickRunning = true;
  try {
    const values = await chrome.storage.local.get([
      AUTOMATION_KEY,
      HEARTBEATS_KEY,
    ]);
    const automation: AutomationState = values[AUTOMATION_KEY] ?? {};
    if (automation.enabled === false) return;
    const raw: AutomatedJob[] = [
      ...(await getSourceIntakeStates()).map((state) => ({
        url: state.sourceUrl,
        x: false,
        state,
      })),
      ...(await getXLikesImportStates()).map((state) => ({
        url: state.profileUrl,
        x: true,
        state,
      })),
    ].sort((a, b) => b.state.updatedAt.localeCompare(a.state.updatedAt));
    // Earlier receipts remain evidence; only the latest job for each purpose is runnable.
    const unique = new Map<string, AutomatedJob>();
    for (const job of raw) {
      const key = `${job.url}:${job.state.purpose ?? "history"}`;
      if (!unique.has(key)) unique.set(key, job);
    }
    const jobs = [...unique.values()].filter((job) => {
      if (automation.pausedSources?.includes(job.url)) return false;
      // A fresh full repair supersedes an older interrupted pass, retaining its receipt.
      return !raw.some(
        (newer) =>
          newer.url === job.url &&
          newer.state.purpose === "repair" &&
          newer.state.importId !== job.state.importId &&
          newer.state.startedAt > job.state.startedAt &&
          job.state.purpose !== "sync",
      );
    });
    const now = Date.now();
    const batches = await getBatchStates();
    for (const job of jobs.filter((j) => j.state.running)) {
      const state = job.state;
      const tab =
        typeof state.workerTabId === "number"
          ? await chrome.tabs.get(state.workerTabId).catch(() => undefined)
          : undefined;
      if (
        tab &&
        !readerIsStalled({
          now,
          updatedAt: state.updatedAt,
          workerTabId: state.workerTabId,
          heartbeat: values[HEARTBEATS_KEY]?.[state.importId],
          batchUpdatedAt: batches.find((b) => b.jobId === state.importId)
            ?.updatedAt,
          activeBatch: activeJobIds.has(state.importId),
        })
      )
        return;
      if (activeJobIds.has(state.importId)) return;
      state.running = false;
      state.stopReason = "error";
      state.message =
        "Reader stopped making progress; checkpoint retained for automatic recovery.";
      state.retryAt = undefined;
      await saveAutomatedJob(job);
      await recordFailure({
        provider: job.x ? "x_likes" : (state as SourceIntakeState).provider,
        importId: state.importId,
        sourceUrl: job.url,
        stage: "reader",
        message: state.message,
      });
    }
    if (activeJobIds.size || jobs.some((job) => job.state.running)) return;
    for (const job of jobs) {
      const state = job.state;
      if (
        state.exhausted ||
        state.stopReason === "paused" ||
        state.needsAttention
      )
        continue;
      if (!state.retryAt) {
        const plan = retryPlan(
          state.message,
          state.automationAttempts ?? 0,
          now,
        );
        state.needsAttention = plan.attention;
        state.retryAt = plan.retryAt;
        await saveAutomatedJob(job);
      }
      if (state.needsAttention || !state.retryAt || state.retryAt > now)
        continue;
      state.automationAttempts = (state.automationAttempts ?? 0) + 1;
      state.retryAt = undefined;
      await saveAutomatedJob(job);
      await launchAutomatedJob(job);
      return;
    }
    const latestBySource = new Map<string, AutomatedJob>();
    for (const job of jobs)
      if (!latestBySource.has(job.url)) latestBySource.set(job.url, job);
    for (const job of latestBySource.values()) {
      const requested = automation.requestedSync?.includes(job.url);
      if (
        (!requested && job.state.stopReason === "paused") ||
        job.state.needsAttention
      )
        continue;
      const audit =
        jobs.find(
          (candidate) =>
            candidate.url === job.url && candidate.state.purpose !== "sync",
        ) ?? job;
      const gapCount = audit.x
        ? audit.state.failed +
          ((audit.state as XLikesImportState).originalsLinked ?? 0) +
          ((audit.state as XLikesImportState).audit?.networkMissingInDom ?? 0) +
          ((audit.state as XLikesImportState).audit?.domMissingInVault ?? 0)
        : Math.max(
            (audit.state as SourceIntakeState).unresolved,
            audit.state.failed,
          );
      const repair =
        job.state.exhausted &&
        gapCount > 0 &&
        (automation.repairAfter?.[job.url] ?? 0) <= now;
      const sync =
        requested ||
        (job.state.exhausted && (automation.syncAfter?.[job.url] ?? 0) <= now);
      if (!repair && !sync) continue;
      const purpose: ImportPurpose = requested
        ? "sync"
        : repair
          ? "repair"
          : "sync";
      await changeAutomation((state) => {
        state.requestedSync = (state.requestedSync ?? []).filter(
          (url) => url !== job.url,
        );
        state.syncAfter = { ...state.syncAfter, [job.url]: now + syncInterval };
        if (purpose === "repair")
          state.repairAfter = {
            ...state.repairAfter,
            [job.url]: now + repairInterval,
          };
      });
      await launchAutomatedJob(job, purpose);
      return;
    }
  } catch {
    // The alarm remains installed; avoid leaking URLs or credentials in diagnostics.
    await changeAutomation((state) => {
      state.message =
        "Automatic import could not start. Check the vault connection; checkpoints are retained.";
    });
  } finally {
    automationTickRunning = false;
  }
}
async function initializeImportAutomation() {
  await chrome.alarms.create(AUTOMATION_ALARM, { periodInMinutes: 1 });
  const migration = await chrome.storage.local.get("failureHistorySeededV1");
  if (!migration.failureHistorySeededV1) {
    const batches = await getBatchStates();
    await seedFailureHistory(
      batches.flatMap((batch) =>
        batch.failures.map((failure) => ({
          input: {
            provider: batch.source,
            importId: batch.jobId,
            sourceUrl: failure.url,
            assetUrl:
              failure.payload?.assetOriginalUrl ?? failure.payload?.assetUrl,
            imagePage:
              failure.payload?.assetIndex === undefined
                ? undefined
                : failure.payload.assetIndex + 1,
            imageCount: failure.payload?.assetCount,
            stage: "request" as const,
            message: failure.message,
          },
          at: batch.updatedAt ?? batch.completedAt ?? batch.startedAt,
        })),
      ),
    );
    await chrome.storage.local.set({ failureHistorySeededV1: true });
  }
  void runAutomaticImports();
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTOMATION_ALARM) void runAutomaticImports();
});
chrome.runtime.onStartup.addListener(() => {
  void initializeImportAutomation();
});
void initializeImportAutomation();

async function captureSavedLinkBatch(
  batch: {
    sessionKey: string;
    source: "url_list" | "bookmarks";
    total: number;
    offset: number;
    entries: ImportedUrl[];
  },
  expectedEndpoint?: string,
) {
  if (batch.entries.length > 50)
    throw new Error("Import batches are limited to 50 links.");
  const connection = await getCaptureConnection();
  if (expectedEndpoint && connection.endpoint !== expectedEndpoint) {
    throw new Error(
      "Ourchival address changed. Submit the same list again to resume at that address.",
    );
  }
  const endpoint = new URL(connection.endpoint);
  endpoint.pathname = endpoint.pathname.replace(
    /\/capture\/?$/,
    "/capture-links",
  );
  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connection.deviceToken}`,
    },
    body: JSON.stringify(batch),
  });
  const receipt = await response.json();
  if (!response.ok || !receipt.ok)
    throw new Error(receipt.error || "Saved-link batch failed.");
  return { ...receipt, endpoint: connection.endpoint };
}
