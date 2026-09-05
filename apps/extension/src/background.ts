import {
  parseXSnapshot,
  type ParsedXSource,
  type XDomSnapshot,
} from "@ourchival/parsers";
import type { CapturePayload, PageSnapshot } from "@ourchival/shared";
import { isCapturableUrl, type ImportedUrl } from "./imports";
import {
  detectSourceIntakeContext,
  sourceIntakePayload,
  type SourceIntakeChunk,
} from "./sourceIntake";
import {
  getBatchStates,
  getSourceIntakeState,
  getSourceIntakeStates,
  getSettings,
  getXLikesImportState,
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
  ok?: boolean;
  error?: string;
  code?: string;
  referenceId?: string;
  assetId?: string | null;
  storageStatus?: string;
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
  | { type: "OURCHIVAL_IMPORT_SOURCE" }
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
      void startSourceIntake()
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

async function startXLikesImport() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (typeof tab?.id !== "number" || !isXLikesUrl(tab.url)) {
    throw new Error("Open your X profile Likes page before importing.");
  }
  const connection = await getCaptureConnection();

  const profileUrl = canonicalLikesUrl(tab.url!);
  const previous = await getXLikesImportState();
  const resumable =
    previous && previous.profileUrl === profileUrl && !previous.exhausted;
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
        profileUrl,
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

  const response = (await chrome.tabs.sendMessage(tab.id, {
    type: "OURCHIVAL_START_X_LIKES",
    importId: state.importId,
    profileUrl,
    ...(state.lastSourceUrl
      ? { resumeAfterSourceUrl: state.lastSourceUrl }
      : {}),
    resumeFromCurrentPosition: Boolean(
      previous && previous.stopReason !== "known_boundary",
    ),
    stopAtKnownBoundary: Boolean(previous?.exhausted),
  })) as { ok?: boolean; error?: string } | undefined;
  if (!response?.ok) {
    state.running = false;
    state.stopReason = "error";
    state.message =
      response?.error || "Could not start the X Likes timeline reader.";
    state.updatedAt = new Date().toISOString();
    await saveXLikesImportState(state);
    throw new Error(state.message);
  }
  return state;
}

async function pauseXLikesImport() {
  const state = await getXLikesImportState();
  if (!state) throw new Error("No X Likes import is active.");
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find(
    (candidate) =>
      typeof candidate.id === "number" &&
      isXLikesUrl(candidate.url) &&
      canonicalLikesUrl(candidate.url!) === state.profileUrl,
  );
  if (typeof tab?.id === "number") {
    await chrome.tabs.sendMessage(tab.id, { type: "OURCHIVAL_STOP_X_LIKES" });
  }
  state.running = false;
  state.stopReason = "paused";
  state.updatedAt = new Date().toISOString();
  await saveXLikesImportState(state);
  await reportXLikesSession(state, "interrupted");
  return state;
}

async function startSourceIntake() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const context = detectSourceIntakeContext(tab?.url);
  if (!context) {
    throw new Error(
      "Open a Pixiv bookmarks page or one Pinterest board first.",
    );
  }
  const previous = (await getSourceIntakeStates()).find(
    (candidate) =>
      candidate.provider === context.provider &&
      candidate.sourceUrl === context.sourceUrl,
  );
  if (previous?.running) return previous;

  const now = new Date().toISOString();
  const resumable = Boolean(
    previous &&
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
      }
    : {
        importId: createSourceImportId(),
        provider: context.provider,
        label: context.label,
        sourceUrl: context.sourceUrl,
        currentUrl: context.currentUrl,
        cursor: context.cursor,
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
        unresolved: 0,
        seenProviderIds: [],
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
    url: resumable ? state.currentUrl : context.currentUrl,
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
  await saveSourceIntakeState(state);
  if (worker.status === "complete") void dispatchSourceIntake(worker.id);
  return state;
}

async function pauseSourceIntake(importId?: string) {
  const state = await getSourceIntakeState(importId);
  if (!state) throw new Error("No source import is active.");
  state.running = false;
  state.stopReason = "paused";
  state.message = "Paused after the last acknowledged chunk.";
  state.updatedAt = new Date().toISOString();
  await saveSourceIntakeState(state);
  if (typeof state.workerTabId === "number") {
    await chrome.tabs
      .sendMessage(state.workerTabId, {
        type: "OURCHIVAL_STOP_SOURCE_INTAKE",
      })
      .catch(() => undefined);
  }
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
    chunk.items.length > 120
  ) {
    throw new Error("The source chunk does not match this import.");
  }

  const seen = new Set(state.seenProviderIds);
  const fresh = chunk.items.filter((item) => {
    if (
      !item ||
      !/^\d+$/.test(item.providerId) ||
      !isCapturableUrl(item.sourceUrl) ||
      seen.has(item.providerId)
    ) {
      return false;
    }
    seen.add(item.providerId);
    return true;
  });
  const firstOrdinal = state.observed;
  const payloads = fresh.map((item, index) =>
    sourceIntakePayload(item, {
      provider: state.provider,
      importId: state.importId,
      ordinal: firstOrdinal + index,
      sensitiveDefault: state.sensitiveDefault,
    }),
  );
  const batch = payloads.length
    ? await runPayloadBatch(payloads, state.provider, state.importId)
    : undefined;
  const now = new Date().toISOString();
  state.seenProviderIds = Array.from(seen);
  state.currentUrl = chunk.nextUrl ?? chunk.currentUrl;
  state.cursor = chunk.cursor;
  state.updatedAt = now;
  state.chunks += 1;
  state.observed += fresh.length;
  state.captureAttempts += batch?.total ?? 0;
  state.saved += batch?.saved ?? 0;
  state.duplicates += batch?.duplicates ?? 0;
  state.failed += batch?.failed ?? 0;
  state.skipped += batch?.skipped ?? 0;
  if (typeof chunk.reportedCount === "number") {
    state.reportedCount = Math.max(
      state.reportedCount ?? 0,
      chunk.reportedCount,
    );
  }
  state.unresolved = state.reportedCount
    ? Math.max(0, state.reportedCount - state.observed)
    : 0;

  if (chunk.exhausted) {
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
    chunk.exhausted && state.unresolved === 0
      ? "completed"
      : state.running
        ? "running"
        : "interrupted",
  );

  if (chunk.exhausted && typeof state.workerTabId === "number") {
    const workerTabId = state.workerTabId;
    setTimeout(
      () => void chrome.tabs.remove(workerTabId).catch(() => undefined),
      250,
    );
  }
  return {
    ok: true,
    continue: state.running,
    ...(state.running && chunk.nextUrl ? { nextUrl: chunk.nextUrl } : {}),
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
    latest.running = false;
    latest.stopReason = "error";
    latest.message = errorMessage(error, "Could not start the source reader.");
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
  );
  const next: XLikesImportState = {
    ...latestCheckpoint,
    running: true,
    updatedAt: now,
    chunks: checkpoint.chunks + 1,
    discoveredPosts: checkpoint.discoveredPosts + parsedSources.length,
    captureAttempts: checkpoint.captureAttempts + state.total,
    saved: checkpoint.saved + state.saved,
    attachedMedia: (checkpoint.attachedMedia ?? 0) + (state.attached ?? 0),
    refreshedPosts: (checkpoint.refreshedPosts ?? 0) + (state.refreshed ?? 0),
    duplicates: checkpoint.duplicates + state.duplicates,
    failed: checkpoint.failed + state.failed,
    skipped: checkpoint.skipped + state.skipped,
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
  );
  const now = new Date().toISOString();
  const exhausted = message.stopReason === "known_boundary";
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

async function requireXLikesCheckpoint(importId: string, profileUrl: string) {
  const state = await getXLikesImportState();
  if (
    !state ||
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
  state.refreshedSourceUrls ??= [];
  await chrome.action.setBadgeText({ text: "…" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6f5bb7" });

  try {
    while (state.nextIndex < state.items.length) {
      const captureConcurrency = captureConcurrencyFor(connection);
      const windowItems = state.items.slice(
        state.nextIndex,
        state.nextIndex + captureConcurrency,
      );
      const outcomes = await Promise.all(
        windowItems.map((item) => captureBatchItem(connection, state, item)),
      );
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
  try {
    const result = await capturePayload(connection, payload);
    if (!result.ok) {
      throw new Error(
        result.error || `Capture failed with status ${result.status}`,
      );
    }
    return { item, sourceUrl, payload, result };
  } catch (error) {
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
  if (changeInfo.status === "complete") void dispatchSourceIntake(tabId);
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
void resumeSourceIntakes();

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
