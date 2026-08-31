import type { CapturePayload } from "@ourchival/shared";
import {
  getPopupState,
  LAST_BATCH_KEY,
  LAST_CAPTURE_KEY,
  LAST_RESULT_KEY,
  normalizeCaptureEndpoint,
  normalizePairingEndpoint,
  normalizeSiteRoot,
  saveSettings,
  SETTINGS_KEY,
  type BatchCaptureSource,
  type BatchCaptureState,
  type CaptureResult,
  type ExtensionSettings,
  type XLikesImportState,
  X_LIKES_IMPORT_KEY,
} from "./storage";

type RuntimeResponse = {
  ok?: boolean;
  error?: string;
  closed?: number;
};

type PairingResponse = {
  ok?: boolean;
  error?: string;
  token?: string;
  deviceId?: string;
  deviceName?: string;
};

let transientMessage = "";
const DEFAULT_OURCHIVAL_SITE_URL = "https://accurate-anteater-437.convex.site";

async function render() {
  const root = document.getElementById("root");
  if (!root) return;

  const state = await getPopupState();
  const settings = (state[SETTINGS_KEY] as ExtensionSettings | undefined) ?? {};
  const capture = state[LAST_CAPTURE_KEY] as CapturePayload | undefined;
  const result = state[LAST_RESULT_KEY] as CaptureResult | undefined;
  const batch = state[LAST_BATCH_KEY] as BatchCaptureState | undefined;
  const xLikesImport = state[X_LIKES_IMPORT_KEY] as
    XLikesImportState | undefined;
  const normalizedEndpoint = normalizeCaptureEndpoint(settings.captureEndpoint);
  const connected = Boolean(normalizedEndpoint && settings.deviceToken);

  if (!connected) {
    root.innerHTML = renderPairingState(settings);
    bindPairingForm();
    return;
  }

  const batchRunning = Boolean(batch?.running);
  const xLikesRunning = Boolean(xLikesImport?.running);
  const disabled = batchRunning || xLikesRunning ? "disabled" : "";
  const xLikesDisabled = batchRunning ? "disabled" : "";

  root.innerHTML = `
    <main>
      <header class="popup-header">
        <div class="brand-mark" aria-hidden="true">O</div>
        <div>
          <p class="eyebrow">Ourchival Clipper</p>
          <h1>Import from this browser</h1>
        </div>
      </header>

      <section class="x-likes-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">X Likes</p>
            <h2>Bring liked posts into Inbox</h2>
          </div>
        </div>
        <button id="import-x-likes" type="button" class="secondary full-width" ${xLikesDisabled}>
          ${xLikesImport && !xLikesImport.exhausted ? "Continue X Likes import" : "Start X Likes import"}
        </button>
        ${
          xLikesImport?.running
            ? '<button id="pause-x-likes" type="button" class="secondary full-width">Pause after this chunk</button>'
            : ""
        }
        ${renderXLikesProgress(xLikesImport)}
        <p class="hint">Keep your profile’s Likes tab open. Ourchival visibly advances the timeline, checkpoints every small chunk, preserves source and artist provenance, and stores every fetchable original from multi-image posts.</p>
      </section>

      ${renderBatch(batch)}

      <section class="status-panel ${result?.ok ? "ok" : result ? "error" : ""}">
        <div class="section-heading compact">
          <h2>${result?.alreadySaved ? "Already in Reliquary" : result?.ok ? "Last capture worked" : "Capture status"}</h2>
          ${result?.savedAt ? `<time>${escapeHtml(formatTime(result.savedAt))}</time>` : ""}
        </div>
        <p>${escapeHtml(transientMessage || result?.message || "Keep this popup open for bulk progress, or right-click an image for a quick save.")}</p>
      </section>

      <details class="import-tools">
        <summary>Other import tools</summary>
        <div class="details-stack">
          <section class="dump-panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Tab dump</p>
                <h2>Clear browser backlog</h2>
              </div>
            </div>
            <div class="action-grid">
              <button type="button" data-tab-mode="current" ${disabled}>Current tab</button>
              <button type="button" data-tab-mode="selected" ${disabled}>Selected tabs</button>
              <button type="button" data-tab-mode="window" ${disabled}>Entire window</button>
            </div>
            <p class="hint">Saved and previously captured tabs both qualify for the separate close action.</p>
          </section>

          <section class="import-panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Large imports</p>
                <h2>OneTab, bookmarks, or URL lists</h2>
              </div>
            </div>
            <button id="open-link-importer" type="button" class="primary full-width" ${disabled}>Open link importer</button>
            <p class="hint">The full-page importer streams large files in resumable batches and keeps every source occurrence.</p>
          </section>
        </div>
      </details>

      <details class="settings-panel">
        <summary>Clipper connection</summary>
          <div class="connected-device">
            <p><strong>${escapeHtml(settings.deviceName || "Ourchival Clipper")}</strong></p>
            <p class="hint">Captures are authorized with a revocable device credential.</p>
            <button id="disconnect-device" type="button">Disconnect this browser</button>
          </div>
      </details>

      <details class="capture-details">
        <summary>Last capture payload</summary>
        <pre>${escapeHtml(JSON.stringify(capture ?? {}, null, 2))}</pre>
      </details>
    </main>
  `;

  document
    .querySelectorAll<HTMLButtonElement>("[data-tab-mode]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.tabMode;
        if (mode !== "current" && mode !== "selected" && mode !== "window")
          return;
        transientMessage = "Starting tab capture…";
        void sendRuntimeMessage({ type: "OURCHIVAL_CAPTURE_TABS", mode });
      });
    });

  document.getElementById("import-x-likes")?.addEventListener("click", () => {
    transientMessage = "Starting the resumable X Likes import…";
    void sendRuntimeMessage({ type: "OURCHIVAL_IMPORT_X_LIKES" });
  });

  document.getElementById("pause-x-likes")?.addEventListener("click", () => {
    transientMessage = "Pausing after the current Likes chunk…";
    void sendRuntimeMessage({ type: "OURCHIVAL_PAUSE_X_LIKES" });
  });

  document
    .getElementById("open-link-importer")
    ?.addEventListener("click", () => {
      void chrome.tabs.create({ url: chrome.runtime.getURL("import.html") });
    });

  document.getElementById("close-saved-tabs")?.addEventListener("click", () => {
    if (!batch?.successfulTabIds.length) return;
    transientMessage = `Closing ${batch.successfulTabIds.length} saved ${batch.successfulTabIds.length === 1 ? "tab" : "tabs"}…`;
    void sendRuntimeMessage({
      type: "OURCHIVAL_CLOSE_SAVED_TABS",
      tabIds: batch.successfulTabIds,
    });
  });

  document.getElementById("retry-failures")?.addEventListener("click", () => {
    if (!batch?.failures.length) return;
    transientMessage = `Retrying ${batch.failures.length} failed ${batch.failures.length === 1 ? "capture" : "captures"}…`;
    const richPayloads = batch.failures
      .map((failure) => failure.payload)
      .filter((payload): payload is CapturePayload => Boolean(payload));
    if (richPayloads.length === batch.failures.length) {
      void sendRuntimeMessage({
        type: "OURCHIVAL_CAPTURE_PAYLOADS",
        source: "retry",
        payloads: richPayloads,
      });
      return;
    }
    void sendRuntimeMessage({
      type: "OURCHIVAL_CAPTURE_URLS",
      source: "retry",
      entries: batch.failures.map((failure) => ({
        url: failure.url,
        ...(failure.title ? { title: failure.title } : {}),
      })),
    });
  });

  document
    .getElementById("disconnect-device")
    ?.addEventListener("click", async () => {
      await saveSettings({
        captureEndpoint: normalizeSiteRoot(settings.captureEndpoint),
        deviceName: settings.deviceName,
      });
      await chrome.action.setBadgeText({ text: "" });
      transientMessage =
        "This browser is disconnected. Revoke it in Ourchival as well if it was lost.";
      await render();
    });
}

function renderPairingState(settings: ExtensionSettings) {
  const siteUrl =
    normalizeSiteRoot(settings.captureEndpoint) ?? DEFAULT_OURCHIVAL_SITE_URL;
  const message =
    transientMessage ||
    "In Ourchival, open Clipper access and create a one-time pairing code.";

  return `
    <main class="pairing-view">
      <header class="popup-header">
        <div class="brand-mark" aria-hidden="true">O</div>
        <div>
          <p class="eyebrow">Ourchival Clipper</p>
          <h1>Connect this browser</h1>
        </div>
      </header>

      <section class="pairing-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">One-time setup</p>
            <h2>Pair with your private vault</h2>
          </div>
        </div>
        <p class="pairing-intro">${escapeHtml(message)}</p>
        <form id="pairing-form">
          <label for="endpoint">Ourchival capture address</label>
          <input
            id="endpoint"
            name="endpoint"
            type="url"
            inputmode="url"
            required
            value="${escapeHtml(siteUrl)}"
          />
          <label for="device-name">This browser</label>
          <input
            id="device-name"
            name="device-name"
            required
            value="${escapeHtml(settings.deviceName ?? defaultDeviceName())}"
          />
          <label for="pairing-code">One-time code</label>
          <input
            id="pairing-code"
            name="pairing-code"
            placeholder="ABCDE-23456"
            autocomplete="one-time-code"
            autocapitalize="characters"
            spellcheck="false"
            required
            autofocus
          />
          <button type="submit" class="primary full-width">Pair this browser</button>
          <p class="hint">The code expires after ten minutes and works once.</p>
        </form>
      </section>
    </main>
  `;
}

function bindPairingForm() {
  document
    .getElementById("pairing-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const captureEndpoint = String(data.get("endpoint") ?? "");
      const pairingEndpoint = normalizePairingEndpoint(captureEndpoint);
      const code = String(data.get("pairing-code") ?? "").trim();
      const deviceName = String(data.get("device-name") ?? "").trim();
      if (!pairingEndpoint || !code) {
        transientMessage = "Enter your Ourchival address and pairing code.";
        await render();
        return;
      }

      transientMessage = "Pairing this browser…";
      try {
        const response = await fetch(pairingEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            deviceName,
            extensionVersion: chrome.runtime.getManifest().version,
          }),
        });
        const body = (await response
          .json()
          .catch(() => ({}))) as PairingResponse;
        if (!response.ok || body.ok === false || !body.token) {
          throw new Error(body.error || response.statusText);
        }
        await saveSettings({
          captureEndpoint: normalizeSiteRoot(captureEndpoint),
          deviceToken: body.token,
          deviceName: body.deviceName || deviceName || defaultDeviceName(),
        });
        await chrome.action.setBadgeText({ text: "" });
        transientMessage = "Clipper paired.";
      } catch (error) {
        transientMessage =
          error instanceof Error ? error.message : "Pairing failed.";
      }
      await render();
    });
}

function renderBatch(batch: BatchCaptureState | undefined) {
  if (!batch) return "";
  const progress = batch.total
    ? Math.round((batch.completed / batch.total) * 100)
    : batch.running
      ? 0
      : 100;
  const closeButton =
    !batch.running && batch.successfulTabIds.length > 0
      ? `<button id="close-saved-tabs" type="button" class="secondary full-width">Close ${batch.successfulTabIds.length} saved ${batch.successfulTabIds.length === 1 ? "tab" : "tabs"}</button>`
      : "";
  const retryButton =
    !batch.running && batch.failures.length > 0
      ? `<button id="retry-failures" type="button" class="secondary full-width">Retry ${batch.failures.length} failed ${batch.failures.length === 1 ? "capture" : "captures"}</button>`
      : "";
  const visibleFailures = batch.failures.slice(0, 25);
  const failures = batch.failures.length
    ? `<details class="failure-details"><summary>${batch.failed} failed</summary><ul>${visibleFailures
        .map(
          (failure) =>
            `<li><span>${escapeHtml(failure.url)}</span><small>${escapeHtml(failure.message)}</small></li>`,
        )
        .join(
          "",
        )}</ul>${batch.failures.length > visibleFailures.length ? `<p class="hint">Showing the first ${visibleFailures.length}; Retry includes all failures.</p>` : ""}</details>`
    : "";

  return `
    <section class="batch-panel ${batch.running ? "running" : "complete"}">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">${escapeHtml(batchSourceLabel(batch.source))}</p>
          <h2>${batch.running ? "Importing into Inbox" : "Import complete"}</h2>
        </div>
        <strong>${batch.completed}/${batch.total}</strong>
      </div>
      <div class="progress-track" aria-label="${progress}% complete">
        <span style="width: ${progress}%"></span>
      </div>
      ${batch.currentLabel ? `<p class="current-item">${escapeHtml(batch.currentLabel)}</p>` : ""}
      <div class="batch-counts">
        <span><strong>${batch.saved}</strong> saved</span>
        <span><strong>${batch.duplicates}</strong> existing</span>
        <span><strong>${batch.skipped}</strong> skipped</span>
        <span><strong>${batch.failed}</strong> failed</span>
      </div>
      <div class="batch-actions">${closeButton}${retryButton}</div>
      ${failures}
    </section>
  `;
}

function renderXLikesProgress(state: XLikesImportState | undefined) {
  if (!state) return "";
  const status = state.running
    ? "Importing"
    : state.exhausted
      ? "Timeline reached"
      : state.stopReason === "paused"
        ? "Paused"
        : "Ready to continue";
  const mediaNote =
    state.captureAttempts === state.discoveredPosts
      ? ""
      : ` · ${state.captureAttempts} media captures`;
  const message = state.message
    ? `<p class="hint">${escapeHtml(state.message)}</p>`
    : "";
  return `
    <div class="batch-counts x-likes-progress">
      <span><strong>${state.discoveredPosts}</strong> posts</span>
      <span><strong>${state.saved}</strong> new</span>
      <span><strong>${state.duplicates}</strong> existing</span>
      <span><strong>${state.failed}</strong> failed</span>
    </div>
    <p class="hint"><strong>${status}</strong> · ${state.chunks} checkpointed ${state.chunks === 1 ? "chunk" : "chunks"}${mediaNote}</p>
    ${message}
  `;
}

async function sendRuntimeMessage(message: unknown) {
  try {
    const response = (await chrome.runtime.sendMessage(message)) as
      RuntimeResponse | undefined;
    if (response?.ok === false) {
      transientMessage = response.error || "The bulk action failed.";
      await render();
      return;
    }
    if (typeof response?.closed === "number") {
      transientMessage = `Closed ${response.closed} saved ${response.closed === 1 ? "tab" : "tabs"}.`;
      await render();
    }
  } catch (error) {
    transientMessage =
      error instanceof Error ? error.message : "The bulk action failed.";
    await render();
  }
}

function batchSourceLabel(source: BatchCaptureSource) {
  if (source === "current_tab") return "Current tab";
  if (source === "selected_tabs") return "Selected tabs";
  if (source === "window") return "Entire window";
  if (source === "bookmarks") return "Bookmarks HTML";
  if (source === "x_post") return "X post images";
  if (source === "x_likes") return "X Likes";
  if (source === "retry") return "Failed-item retry";
  return "Pasted links";
}

function defaultDeviceName() {
  const platform = navigator.platform?.trim();
  return platform ? `Ourchival on ${platform}` : "Ourchival Clipper";
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char] ?? char;
  });
}

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === "local") {
    transientMessage = "";
    void render();
  }
});

void render();
