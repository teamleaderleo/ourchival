import {
  CREATIVE_CAPTURE_EVENT_KEY,
  CREATIVE_CAPTURE_QUEUE_KEY,
  INLINE_SAVED_KEYS,
  type CreativeCaptureEvent,
  type CreativeCaptureQueueItem,
} from "./storage";
import type {
  CreativeSiteAdapter,
  PreparedCreativeCapture,
} from "./creativeSiteAdapter";

type InlineQueueResponse = {
  ok?: boolean;
  queued?: boolean;
  queueId?: string;
  error?: string;
};

type InlineButtonState = "ready" | "queued" | "saving" | "saved" | "warning";

const inlineSavedKeys = new Set<string>();
const inlineQueuedSources = new Map<string, string | undefined>();
const inlineButtons = new WeakMap<HTMLElement, HTMLButtonElement>();
const pendingItems = new Set<HTMLElement>();
let scanScheduled = false;

export function startInlineCreativeCapture(adapters: CreativeSiteAdapter[]) {
  const adapter = adapters.find((candidate) => candidate.matchesLocation(window.location));
  if (!adapter) return;

  enqueueAllItems(adapter);
  void Promise.all([loadSavedKeys(), loadQueueState()]).finally(() =>
    enqueueAllItems(adapter),
  );

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target instanceof Element) {
        const item = adapter.closestItem(record.target);
        if (item) pendingItems.add(item);
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const direct = adapter.closestItem(node);
        if (direct && direct === node) pendingItems.add(direct);
        for (const item of adapter.listItems(node)) pendingItems.add(item);
      }
    }
    scheduleScan(adapter);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    const savedKeysChange = changes[INLINE_SAVED_KEYS];
    if (savedKeysChange) {
      replaceSavedKeys(savedKeysChange.newValue);
      enqueueAllItems(adapter);
    }

    const queueChange = changes[CREATIVE_CAPTURE_QUEUE_KEY];
    if (queueChange) {
      replaceQueueState(queueChange.newValue);
      enqueueAllItems(adapter);
    }

    const eventChange = changes[CREATIVE_CAPTURE_EVENT_KEY];
    if (eventChange) applyCreativeCaptureEvent(eventChange.newValue);
  });
}

function enqueueAllItems(adapter: CreativeSiteAdapter) {
  for (const item of adapter.listItems(document)) pendingItems.add(item);
  scheduleScan(adapter);
}

function scheduleScan(adapter: CreativeSiteAdapter) {
  if (scanScheduled || pendingItems.size === 0) return;
  scanScheduled = true;
  window.requestAnimationFrame(() => {
    scanScheduled = false;
    const items = Array.from(pendingItems);
    pendingItems.clear();
    for (const item of items) {
      if (item.isConnected) mountInlineButton(adapter, item);
    }
    if (pendingItems.size > 0) scheduleScan(adapter);
  });
}

function mountInlineButton(adapter: CreativeSiteAdapter, item: HTMLElement) {
  const identity = adapter.identify(item);
  if (!identity) return;
  const actionContainer = adapter.actionContainer(item);
  if (!actionContainer) return;

  const existingHost = actionContainer.querySelector<HTMLElement>(
    ':scope > [data-ourchival-inline-capture="true"]',
  );
  if (existingHost?.dataset.ourchivalSourceKey === identity.sourceKey) {
    const button = inlineButtons.get(existingHost);
    const persisted = persistedState(identity.sourceKey);
    if (button) {
      if (persisted && (button.dataset.state !== "saving" || persisted.state === "saved")) {
        setButtonState(button, persisted.state, persisted.detail);
      }
      return;
    }
  }
  existingHost?.remove();

  const host = document.createElement("span");
  host.dataset.ourchivalInlineCapture = "true";
  host.dataset.ourchivalSourceKey = identity.sourceKey;
  host.style.display = "inline-flex";
  host.style.alignItems = "center";
  host.style.justifyContent = "center";
  host.style.flex = "0 0 auto";

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = inlineButtonCss;

  const button = document.createElement("button");
  button.type = "button";
  button.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    void queueCapture(adapter, item, host, button);
  });
  const persisted = persistedState(identity.sourceKey);
  setButtonState(button, persisted?.state ?? "ready", persisted?.detail);

  inlineButtons.set(host, button);
  shadow.append(style, button);
  actionContainer.append(host);
}

async function queueCapture(
  adapter: CreativeSiteAdapter,
  item: HTMLElement,
  host: HTMLElement,
  button: HTMLButtonElement,
) {
  if (button.dataset.state === "queued" || button.dataset.state === "saving") return;

  const prepared = adapter.prepareCapture(item);
  if (!prepared) {
    setButtonState(button, "warning", "Could not identify this item.");
    return;
  }
  host.dataset.ourchivalSourceKey = prepared.sourceKey;
  if (inlineSavedKeys.has(prepared.sourceKey)) {
    setButtonState(button, "saved");
    return;
  }

  setButtonState(button, "queued");
  try {
    const response = (await chrome.runtime.sendMessage(queueMessage(prepared))) as
      | InlineQueueResponse
      | undefined;
    if (!response?.ok || !response.queued) {
      throw new Error(response?.error || "Could not queue this Ourchival capture.");
    }
  } catch (error) {
    setButtonState(
      button,
      "warning",
      error instanceof Error ? error.message : "Could not queue this Ourchival capture.",
    );
  }
}

function queueMessage(prepared: PreparedCreativeCapture) {
  return {
    type: "OURCHIVAL_QUEUE_CAPTURE_PAYLOADS",
    platform: prepared.platform,
    sourceKey: prepared.sourceKey,
    payloads: prepared.payloads,
  } as const;
}

function applyCreativeCaptureEvent(value: unknown) {
  if (!value || typeof value !== "object") return;
  const event = value as Partial<CreativeCaptureEvent>;
  if (!event.sourceKey || !event.state) return;
  const state: InlineButtonState =
    event.state === "saving"
      ? "saving"
      : event.state === "saved"
        ? "saved"
        : event.state === "warning"
          ? "warning"
          : "queued";
  updateButtonsForSource(event.sourceKey, state, event.error);
}

function updateButtonsForSource(
  sourceKey: string,
  state: InlineButtonState,
  detail?: string,
) {
  for (const host of document.querySelectorAll<HTMLElement>(
    '[data-ourchival-inline-capture="true"]',
  )) {
    if (host.dataset.ourchivalSourceKey !== sourceKey) continue;
    const button = inlineButtons.get(host);
    if (button) setButtonState(button, state, detail);
  }
}

function persistedState(sourceKey: string) {
  if (inlineSavedKeys.has(sourceKey)) return { state: "saved" as const };
  if (!inlineQueuedSources.has(sourceKey)) return undefined;
  const lastError = inlineQueuedSources.get(sourceKey);
  return lastError
    ? { state: "warning" as const, detail: lastError }
    : { state: "queued" as const };
}

function setButtonState(
  button: HTMLButtonElement,
  state: InlineButtonState,
  detail?: string,
) {
  button.dataset.state = state;
  button.disabled = state === "queued" || state === "saving";

  if (state === "queued") {
    button.textContent = "…";
    button.title = "Queued for Ourchival";
    button.setAttribute("aria-label", "Queued for Ourchival");
    return;
  }
  if (state === "saving") {
    button.textContent = "…";
    button.title = "Saving to Ourchival…";
    button.setAttribute("aria-label", "Saving to Ourchival");
    return;
  }
  if (state === "saved") {
    button.textContent = "✓";
    button.title = "Saved to Ourchival";
    button.setAttribute("aria-label", "Saved to Ourchival");
    return;
  }
  if (state === "warning") {
    button.textContent = "!";
    button.title = detail || "Ourchival capture needs attention. Click to retry.";
    button.setAttribute("aria-label", "Retry Ourchival capture");
    button.disabled = false;
    return;
  }

  button.textContent = "O";
  button.title = "Save this item to Ourchival";
  button.setAttribute("aria-label", "Save this item to Ourchival");
}

async function loadSavedKeys() {
  const stored = await chrome.storage.local.get(INLINE_SAVED_KEYS);
  replaceSavedKeys(stored[INLINE_SAVED_KEYS]);
}

async function loadQueueState() {
  const stored = await chrome.storage.local.get(CREATIVE_CAPTURE_QUEUE_KEY);
  replaceQueueState(stored[CREATIVE_CAPTURE_QUEUE_KEY]);
}

function replaceSavedKeys(value: unknown) {
  inlineSavedKeys.clear();
  if (!Array.isArray(value)) return;
  for (const key of value) {
    if (typeof key === "string" && key) inlineSavedKeys.add(key);
  }
}

function replaceQueueState(value: unknown) {
  inlineQueuedSources.clear();
  if (!Array.isArray(value)) return;
  for (const candidate of value as CreativeCaptureQueueItem[]) {
    if (!candidate?.sourceKey) continue;
    inlineQueuedSources.set(candidate.sourceKey, candidate.lastError);
  }
}

const inlineButtonCss = `
  button {
    all: initial;
    box-sizing: border-box;
    width: 30px;
    height: 30px;
    display: inline-grid;
    place-items: center;
    border-radius: 999px;
    cursor: pointer;
    color: rgb(113, 118, 123);
    font: 700 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    transition: background-color 120ms ease, color 120ms ease, transform 80ms ease;
  }
  button:hover {
    color: rgb(111, 91, 183);
    background: rgba(111, 91, 183, 0.12);
  }
  button:active { transform: scale(0.92); }
  button[data-state="queued"],
  button[data-state="saving"] { color: rgb(111, 91, 183); cursor: progress; }
  button[data-state="saved"] { color: rgb(61, 107, 61); }
  button[data-state="warning"] { color: rgb(138, 61, 61); }
  @media (prefers-color-scheme: dark) {
    button { color: rgb(113, 118, 123); }
    button:hover { color: rgb(186, 168, 255); }
    button[data-state="saved"] { color: rgb(112, 188, 112); }
    button[data-state="warning"] { color: rgb(224, 119, 119); }
  }
`;
