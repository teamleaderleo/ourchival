import {
  parseXSnapshot,
  type ParsedXSource,
  type XDomSnapshot,
} from "@ourchival/parsers";
import type { CapturePayload, PageSnapshot } from "@ourchival/shared";
import { isCapturableUrl, type ImportedUrl } from "./imports";
import {
  getSettings,
  getXLikesImportState,
  LAST_BATCH_KEY,
  normalizeCaptureEndpoint,
  saveBatchState,
  saveLastCapture,
  saveLastResult,
  saveXLikesImportState,
  type BatchCaptureItem,
  type BatchCaptureSource,
  type BatchCaptureState,
  type CaptureResult,
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

type ExtensionMessage =
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
      type: "OURCHIVAL_X_LIKES_FINISHED";
      importId: string;
      profileUrl: string;
      stopReason: XLikesImportStopReason;
      lastSourceUrl?: string;
      message?: string;
    };

type CaptureConnection = {
  endpoint: string;
  deviceToken: string;
};

let activeJobId: string | undefined;
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
    resumeFromCurrentPosition: previous?.stopReason === "stalled",
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
  const payloads = buildXLikePayloads(message.snapshots ?? []);
  if (payloads.length === 0) return checkpoint;

  const state = await runPayloadBatch(payloads, "x_likes", message.importId);
  const parsedSources = message.snapshots
    .map((snapshot) => parseXSnapshot(snapshot))
    .filter((source) => source.postId);
  const lastSource = parsedSources.at(-1);
  const now = new Date().toISOString();
  const next: XLikesImportState = {
    ...checkpoint,
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
  const next: XLikesImportState = {
    ...state,
    running: false,
    exhausted,
    updatedAt: now,
    ...(exhausted ? { completedAt: now } : {}),
    ...(message.lastSourceUrl ? { lastSourceUrl: message.lastSourceUrl } : {}),
    stopReason: message.stopReason,
    ...(message.message ? { message: message.message } : {}),
  };
  await saveXLikesImportState(next);
  await reportXLikesSession(next, exhausted ? "completed" : "interrupted");
  return next;
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
  if (activeJobId) throw new Error("A bulk capture is already running.");
  const connection = await getCaptureConnection();

  const state: BatchCaptureState = {
    jobId: jobId ?? createJobId(),
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
  if (activeJobId && activeJobId !== state.jobId) {
    throw new Error("Another bulk capture is already running.");
  }

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

  activeJobId = state.jobId;
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
    if (activeJobId === state.jobId) activeJobId = undefined;
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

async function resumeInterruptedBatch() {
  const stored = await chrome.storage.local.get(LAST_BATCH_KEY);
  const state = stored[LAST_BATCH_KEY] as BatchCaptureState | undefined;
  if (
    !state?.running ||
    !Array.isArray(state.items) ||
    typeof state.nextIndex !== "number" ||
    state.nextIndex >= state.items.length
  ) {
    return;
  }
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

void resumeInterruptedBatch();
