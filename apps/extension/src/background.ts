import type { ParsedXSource } from "@ourchival/parsers";
import type {
  CapturePayload,
  PageReadableTextCapture,
  PageSnapshot,
  PageStructuredSnapshotCapture,
} from "@ourchival/shared";
import { isCapturableUrl, type ImportedUrl } from "./imports";
import {
  captureVisiblePageScreenshot,
  uploadPageScreenshot,
} from "./pageScreenshot";
import { uploadStructuredPageSnapshot } from "./pageStructuredSnapshot";
import { uploadReadablePageText } from "./pageText";
import { reportCaptureSession } from "./sessionReporting";
import {
  getSettings,
  LAST_BATCH_KEY,
  normalizeCaptureEndpoint,
  saveBatchState,
  saveLastCapture,
  saveLastResult,
  type BatchCaptureItem,
  type BatchCaptureSource,
  type BatchCaptureState,
  type CaptureResult,
} from "./storage";

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

type ExtensionMessage =
  | { type: "OURCHIVAL_CAPTURE_TABS"; mode: TabCaptureMode }
  | { type: "OURCHIVAL_CAPTURE_URLS"; entries: ImportedUrl[]; source?: ImportSource }
  | {
      type: "OURCHIVAL_CAPTURE_PAYLOADS";
      payloads: CapturePayload[];
      source?: BatchCaptureSource;
    }
  | { type: "OURCHIVAL_CLOSE_SAVED_TABS"; tabIds: number[] };

type CaptureConnection = {
  endpoint: string;
  deviceToken: string;
};

let activeJobId: string | undefined;

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

  const saveWholePage = info.menuItemId === "save-page-to-ourchival";
  const pageScreenshot = saveWholePage
    ? await captureVisiblePageScreenshot(tab)
    : undefined;
  const readableText = saveWholePage
    ? readableTextCapture(context?.pageSnapshot)
    : undefined;
  const structuredSnapshot = saveWholePage
    ? structuredSnapshotCapture(context?.pageSnapshot)
    : undefined;
  const payload =
    info.menuItemId === "save-post-to-ourchival" &&
    context?.parsedSource?.platform === "x"
      ? buildXPayload(context, { kind: "post" })
      : buildCapturePayload(info, tab, context);

  await saveLastCapture(payload);

  try {
    const connection = await getCaptureConnection();
    const result = await capturePayload(connection, payload);
    if (result.ok) {
      await uploadPageArtifacts(connection, result.body.referenceId, {
        pageScreenshot,
        readableText,
        structuredSnapshot,
      });
    }
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
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message?.type === "OURCHIVAL_CAPTURE_TABS") {
      void captureTabs(message.mode)
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({ ok: false, error: errorMessage(error, "Tab capture failed.") }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_CAPTURE_URLS") {
      void runBatch(
        message.source ?? "url_list",
        message.entries.map((entry) => ({ url: entry.url, title: entry.title })),
      )
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({ ok: false, error: errorMessage(error, "URL import failed.") }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_CAPTURE_PAYLOADS") {
      void runPayloadBatch(message.payloads, message.source ?? "retry")
        .then((state) => sendResponse({ ok: true, state }))
        .catch((error) =>
          sendResponse({ ok: false, error: errorMessage(error, "Capture retry failed.") }),
        );
      return true;
    }

    if (message?.type === "OURCHIVAL_CLOSE_SAVED_TABS") {
      void closeSavedTabs(message.tabIds)
        .then((closed) => sendResponse({ ok: true, closed }))
        .catch((error) =>
          sendResponse({ ok: false, error: errorMessage(error, "Could not close saved tabs.") }),
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

async function getPageSnapshot(tabId: number | undefined) {
  if (typeof tabId !== "number") return undefined;
  try {
    return (await chrome.tabs.sendMessage(tabId, {
      type: "OURCHIVAL_SNAPSHOT_PAGE",
    })) as PageSnapshot | undefined;
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
  const currentSnapshot = mode === "current"
    ? await getPageSnapshot(tabs[0]?.id)
    : undefined;
  const pageScreenshot = mode === "current"
    ? await captureVisiblePageScreenshot(tabs[0])
    : undefined;
  const readableText = readableTextCapture(currentSnapshot);
  const structuredSnapshot = structuredSnapshotCapture(currentSnapshot);

  return await runBatch(
    source,
    tabs.map((tab, index) => {
      const currentPayload =
        index === 0 && currentSnapshot && tab.url
          ? {
              kind: "page" as const,
              sourceUrl: tab.url,
              ...pageSnapshotFields(currentSnapshot),
              ...(!currentSnapshot.title && tab.title
                ? { pageTitle: tab.title }
                : {}),
              capturedAt: new Date().toISOString(),
            }
          : undefined;
      return {
        url: tab.url,
        title: tab.title,
        tabId: tab.id,
        ...(currentPayload ? { payload: currentPayload } : {}),
        ...(index === 0 && pageScreenshot ? { pageScreenshot } : {}),
        ...(index === 0 && readableText ? { readableText } : {}),
        ...(index === 0 && structuredSnapshot ? { structuredSnapshot } : {}),
      };
    }),
  );
}

async function queryTabs(mode: TabCaptureMode) {
  if (mode === "current") {
    return await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }
  if (mode === "selected") {
    return await chrome.tabs.query({ highlighted: true, lastFocusedWindow: true });
  }
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  return tabs.sort((left, right) => left.index - right.index);
}

async function runPayloadBatch(payloads: CapturePayload[], source: BatchCaptureSource) {
  return await runBatch(
    source,
    payloads.map((payload) => ({
      url: payload.sourceUrl,
      title: payload.pageTitle,
      payload,
    })),
  );
}

async function runBatch(source: BatchCaptureSource, items: BatchCaptureItem[]) {
  if (activeJobId) throw new Error("A bulk capture is already running.");
  const connection = await getCaptureConnection();

  const state: BatchCaptureState = {
    jobId: createJobId(),
    source,
    running: true,
    startedAt: new Date().toISOString(),
    total: items.length,
    completed: 0,
    nextIndex: 0,
    saved: 0,
    duplicates: 0,
    failed: 0,
    skipped: 0,
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
    state.currentLabel = "Pair the Clipper again, then retry the remaining captures.";
    await saveBatchState(state);
    throw error;
  }

  activeJobId = state.jobId;
  state.running = true;
  await reportCaptureSession(connection, state, { force: true });
  await chrome.action.setBadgeText({ text: "…" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6f5bb7" });

  try {
    while (state.nextIndex < state.items.length) {
      const item = state.items[state.nextIndex]!;
      const sourceUrl = item.payload?.sourceUrl ?? item.url;
      state.currentLabel = item.title || sourceUrl || "Unsupported tab";

      if (!isCapturableUrl(sourceUrl)) {
        state.skipped += 1;
        clearPageArtifacts(item);
        advanceCheckpoint(state);
        await saveBatchState({ ...state });
        await reportCaptureSession(connection, state);
        continue;
      }

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
          throw new Error(result.error || `Capture failed with status ${result.status}`);
        }
        if (result.body.alreadySaved) state.duplicates += 1;
        else state.saved += 1;
        if (typeof item.tabId === "number") state.successfulTabIds.push(item.tabId);
        await uploadPageArtifacts(connection, result.body.referenceId, item);
        await saveLastCapture(payload);
        await saveLastResult(toCaptureResult(result));
      } catch (error) {
        state.failed += 1;
        state.failures.push({
          url: sourceUrl,
          ...(item.title ? { title: item.title } : {}),
          ...(item.payload ? { payload: item.payload } : {}),
          message: errorMessage(error, "Capture failed."),
        });
      } finally {
        clearPageArtifacts(item);
      }

      advanceCheckpoint(state);
      await saveBatchState({ ...state });
      await reportCaptureSession(connection, state);
    }

    state.running = false;
    state.completedAt = new Date().toISOString();
    state.currentLabel = undefined;
    await saveBatchState({ ...state });
    await reportCaptureSession(connection, state, { force: true });
    const successful = state.saved + state.duplicates;
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
  } catch (error) {
    state.running = false;
    state.currentLabel = errorMessage(error, "The bulk capture was interrupted.");
    await saveBatchState({ ...state });
    await reportCaptureSession(connection, state, { force: true });
    throw error;
  } finally {
    if (activeJobId === state.jobId) activeJobId = undefined;
  }
}

async function uploadPageArtifacts(
  connection: CaptureConnection,
  referenceId: string | undefined,
  artifacts: Pick<
    BatchCaptureItem,
    "pageScreenshot" | "readableText" | "structuredSnapshot"
  >,
) {
  await Promise.all([
    uploadPageScreenshot(connection, referenceId, artifacts.pageScreenshot),
    uploadReadablePageText(connection, referenceId, artifacts.readableText),
    uploadStructuredPageSnapshot(
      connection,
      referenceId,
      artifacts.structuredSnapshot,
    ),
  ]);
}

function clearPageArtifacts(item: BatchCaptureItem) {
  item.pageScreenshot = undefined;
  item.readableText = undefined;
  item.structuredSnapshot = undefined;
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
    throw new Error("Pair this browser from the Ourchival Clipper popup first.");
  }
  return { endpoint, deviceToken };
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
      altText: assetUrl
        ? context.parsedSource.altTexts?.[assetUrl]
        : undefined,
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
    ...(snapshot.description
      ? { pageDescription: snapshot.description }
      : {}),
    ...(snapshot.siteName ? { siteName: snapshot.siteName } : {}),
    ...(snapshot.faviconUrl ? { faviconUrl: snapshot.faviconUrl } : {}),
    ...(snapshot.previewImageUrl
      ? { previewImageUrl: snapshot.previewImageUrl }
      : {}),
    ...(snapshot.author ? { pageAuthor: snapshot.author } : {}),
    ...(snapshot.contentType ? { contentType: snapshot.contentType } : {}),
  };
}

function readableTextCapture(
  snapshot: PageSnapshot | undefined,
): PageReadableTextCapture | undefined {
  if (!snapshot?.readableText || !snapshot.readableTextSource) return undefined;
  return {
    text: snapshot.readableText,
    source: snapshot.readableTextSource,
    capturedAt: new Date().toISOString(),
  };
}

function structuredSnapshotCapture(
  snapshot: PageSnapshot | undefined,
): PageStructuredSnapshotCapture | undefined {
  return snapshot?.structuredSnapshot;
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

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function markResult(result: CaptureResult) {
  await saveLastResult(result);
  await chrome.action.setBadgeText({
    text: result.alreadySaved ? "↺" : result.ok ? "✓" : "!",
  });
  await chrome.action.setBadgeBackgroundColor({
    color: result.alreadySaved
      ? "#6f5bb7"
      : result.ok
        ? "#3d6b3d"
        : "#8a3d3d",
  });
}

void resumeInterruptedBatch();
