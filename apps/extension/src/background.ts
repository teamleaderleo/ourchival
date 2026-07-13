import type { CapturePayload } from "@ourchival/shared";
import { isCapturableUrl, type ImportedUrl } from "./imports";
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

type CaptureResponse = {
  ok?: boolean;
  error?: string;
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
  | { type: "OURCHIVAL_CLOSE_SAVED_TABS"; tabIds: number[] };

let activeJobId: string | undefined;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-image-to-ourchival",
    title: "Save image to Ourchival",
    contexts: ["image"],
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
  const payload = buildCapturePayload(info, tab);
  await saveLastCapture(payload);

  const settings = await getSettings();
  const endpoint = normalizeCaptureEndpoint(settings.captureEndpoint);

  if (!endpoint) {
    await markResult({
      ok: false,
      message: "Add your Convex site URL in the Ourchival popup.",
      savedAt: new Date().toISOString(),
    });
    return;
  }

  try {
    const result = await capturePayload(endpoint, payload);
    await markResult(toCaptureResult(result));
  } catch (error) {
    await markResult({
      ok: false,
      message: error instanceof Error ? error.message : "Capture request failed.",
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
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Tab capture failed.",
          }),
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
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "URL import failed.",
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
            error: error instanceof Error ? error.message : "Could not close saved tabs.",
          }),
        );
      return true;
    }

    return false;
  },
);

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
    tabs.map((tab) => ({
      url: tab.url,
      title: tab.title,
      tabId: tab.id,
    })),
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

async function runBatch(source: BatchCaptureSource, items: BatchCaptureItem[]) {
  if (activeJobId) {
    throw new Error("A bulk capture is already running.");
  }

  const settings = await getSettings();
  const endpoint = normalizeCaptureEndpoint(settings.captureEndpoint);
  if (!endpoint) {
    throw new Error("Add your Convex site URL before starting a bulk capture.");
  }

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
  return await continueBatch(state, endpoint);
}

async function continueBatch(state: BatchCaptureState, endpoint?: string) {
  if (activeJobId && activeJobId !== state.jobId) {
    throw new Error("Another bulk capture is already running.");
  }

  const resolvedEndpoint =
    endpoint ?? normalizeCaptureEndpoint((await getSettings()).captureEndpoint);
  if (!resolvedEndpoint) {
    state.running = false;
    state.currentLabel = "Reconnect the clipper endpoint, then retry the remaining links.";
    await saveBatchState(state);
    return state;
  }

  activeJobId = state.jobId;
  state.running = true;
  await chrome.action.setBadgeText({ text: "…" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6f5bb7" });

  try {
    while (state.nextIndex < state.items.length) {
      const item = state.items[state.nextIndex]!;
      state.currentLabel = item.title || item.url || "Unsupported tab";

      if (!isCapturableUrl(item.url)) {
        state.skipped += 1;
        advanceCheckpoint(state);
        await saveBatchState({ ...state });
        continue;
      }

      const payload: CapturePayload = {
        kind: "page",
        sourceUrl: item.url,
        ...(item.title ? { pageTitle: item.title } : {}),
        captureSessionId: state.jobId,
        capturedAt: new Date().toISOString(),
      };

      try {
        const result = await capturePayload(resolvedEndpoint, payload);
        if (!result.ok) {
          throw new Error(result.error || `Capture failed with status ${result.status}`);
        }

        if (result.body.alreadySaved) {
          state.duplicates += 1;
        } else {
          state.saved += 1;
        }

        if (typeof item.tabId === "number") {
          state.successfulTabIds.push(item.tabId);
        }

        await saveLastCapture(payload);
        await saveLastResult(toCaptureResult(result));
      } catch (error) {
        state.failed += 1;
        state.failures.push({
          url: item.url,
          ...(item.title ? { title: item.title } : {}),
          message: error instanceof Error ? error.message : "Capture failed.",
        });
      }

      advanceCheckpoint(state);
      await saveBatchState({ ...state });
    }

    state.running = false;
    state.completedAt = new Date().toISOString();
    state.currentLabel = undefined;
    await saveBatchState({ ...state });

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
  } finally {
    if (activeJobId === state.jobId) {
      activeJobId = undefined;
    }
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
    state.currentLabel =
      error instanceof Error ? error.message : "The interrupted import could not resume.";
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
      // The tab may already be gone. Continue through the remaining explicit close list.
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

async function capturePayload(endpoint: string, payload: CapturePayload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as CaptureResponse;

  return {
    ok: response.ok && body.ok !== false,
    status: response.status,
    statusText: response.statusText,
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
  tab?: chrome.tabs.Tab,
): CapturePayload {
  if (info.srcUrl) {
    return {
      kind: "image",
      sourceUrl: info.pageUrl ?? tab?.url ?? info.srcUrl,
      assetUrl: info.srcUrl,
      pageTitle: tab?.title,
      selectedText: info.selectionText,
      capturedAt: new Date().toISOString(),
    };
  }

  if (info.linkUrl) {
    return {
      kind: "link",
      sourceUrl: info.linkUrl,
      pageTitle: tab?.title,
      selectedText: info.selectionText,
      capturedAt: new Date().toISOString(),
    };
  }

  return {
    kind: "page",
    sourceUrl: info.pageUrl ?? tab?.url ?? "",
    pageTitle: tab?.title,
    selectedText: info.selectionText,
    capturedAt: new Date().toISOString(),
  };
}

function duplicateMessage(existingReference: CaptureResult["existingReference"]) {
  const title = existingReference?.title?.trim();
  const savedDate = existingReference?.capturedAt
    ? new Date(existingReference.capturedAt).toLocaleDateString()
    : undefined;
  const boardNote = existingReference?.boardCount
    ? ` It is already in ${existingReference.boardCount} ${existingReference.boardCount === 1 ? "board" : "boards"}.`
    : "";

  return `Already saved${title ? ` as “${title}”` : ""}${savedDate ? ` on ${savedDate}` : ""}.${boardNote}`;
}

function createJobId() {
  return `capture-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
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
