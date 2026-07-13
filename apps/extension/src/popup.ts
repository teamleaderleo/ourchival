import type { CapturePayload } from "@ourchival/shared";
import { parseBookmarksHtml, parseUrlList } from "./imports";
import {
  getPopupState,
  LAST_BATCH_KEY,
  LAST_CAPTURE_KEY,
  LAST_RESULT_KEY,
  normalizeCaptureEndpoint,
  saveSettings,
  SETTINGS_KEY,
  type BatchCaptureSource,
  type BatchCaptureState,
  type CaptureResult,
  type ExtensionSettings,
} from "./storage";

type RuntimeResponse = {
  ok?: boolean;
  error?: string;
  closed?: number;
};

let transientMessage = "";

async function render() {
  const root = document.getElementById("root");
  if (!root) return;

  const state = await getPopupState();
  const settings = (state[SETTINGS_KEY] as ExtensionSettings | undefined) ?? {};
  const capture = state[LAST_CAPTURE_KEY] as CapturePayload | undefined;
  const result = state[LAST_RESULT_KEY] as CaptureResult | undefined;
  const batch = state[LAST_BATCH_KEY] as BatchCaptureState | undefined;
  const normalizedEndpoint = normalizeCaptureEndpoint(settings.captureEndpoint);
  const endpointReady = Boolean(normalizedEndpoint);
  const batchRunning = Boolean(batch?.running);
  const disabled = !endpointReady || batchRunning ? "disabled" : "";

  root.innerHTML = `
    <main>
      <header class="popup-header">
        <div class="brand-mark" aria-hidden="true">O</div>
        <div>
          <p class="eyebrow">Ourchival Clipper</p>
          <h1>Send it to Inbox</h1>
        </div>
      </header>

      <section class="dump-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Tab dump</p>
            <h2>Clear browser backlog</h2>
          </div>
          <span class="endpoint-state ${endpointReady ? "ready" : ""}">
            ${endpointReady ? "Connected" : "Setup needed"}
          </span>
        </div>
        <div class="action-grid">
          <button type="button" data-tab-mode="current" ${disabled}>Current tab</button>
          <button type="button" data-tab-mode="selected" ${disabled}>Selected tabs</button>
          <button type="button" data-tab-mode="window" ${disabled}>Entire window</button>
        </div>
        <p class="hint">Saved and previously captured tabs both qualify for the separate close action.</p>
      </section>

      <form id="url-import-form" class="import-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Paste import</p>
            <h2>URLs or OneTab export</h2>
          </div>
        </div>
        <label for="url-list">One URL per line, with optional titles</label>
        <textarea
          id="url-list"
          name="url-list"
          rows="5"
          placeholder="https://example.com/art | Gesture reference"
          ${disabled}
        ></textarea>
        <div class="import-actions">
          <button type="submit" class="primary" ${disabled}>Import pasted links</button>
          <label class="file-button ${disabled ? "disabled" : ""}">
            Import bookmarks HTML
            <input id="bookmarks-file" type="file" accept=".html,.htm,text/html" ${disabled} />
          </label>
        </div>
        <p id="import-feedback" class="hint">Duplicate lines and bookmark entries are removed before the job starts.</p>
      </form>

      ${renderBatch(batch)}

      <section class="status-panel ${result?.ok ? "ok" : result ? "error" : ""}">
        <div class="section-heading compact">
          <h2>${result?.alreadySaved ? "Already in Reliquary" : result?.ok ? "Last capture worked" : "Capture status"}</h2>
          ${result?.savedAt ? `<time>${escapeHtml(formatTime(result.savedAt))}</time>` : ""}
        </div>
        <p>${escapeHtml(transientMessage || result?.message || "Right-click an image or use a dump action above.")}</p>
      </section>

      <details class="settings-panel" ${endpointReady ? "" : "open"}>
        <summary>Clipper setup</summary>
        <form id="settings-form">
          <label for="endpoint">Convex site URL</label>
          <input
            id="endpoint"
            name="endpoint"
            placeholder="https://your-deployment.convex.site"
            value="${escapeHtml(settings.captureEndpoint ?? "")}"
          />
          <button type="submit">Save endpoint</button>
          <p class="hint">Using: ${escapeHtml(normalizedEndpoint ?? "missing endpoint")}</p>
        </form>
      </details>

      <details class="capture-details">
        <summary>Last capture payload</summary>
        <pre>${escapeHtml(JSON.stringify(capture ?? {}, null, 2))}</pre>
      </details>
    </main>
  `;

  document.querySelectorAll<HTMLButtonElement>("[data-tab-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.tabMode;
      if (mode !== "current" && mode !== "selected" && mode !== "window") return;
      transientMessage = "Starting tab capture…";
      void sendRuntimeMessage({ type: "OURCHIVAL_CAPTURE_TABS", mode });
    });
  });

  document.getElementById("url-import-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const entries = parseUrlList(String(new FormData(form).get("url-list") ?? ""));
    const feedback = document.getElementById("import-feedback");

    if (entries.length === 0) {
      if (feedback) feedback.textContent = "Paste at least one HTTP or HTTPS URL.";
      return;
    }

    transientMessage = `Starting import of ${entries.length} ${entries.length === 1 ? "link" : "links"}…`;
    void sendRuntimeMessage({ type: "OURCHIVAL_CAPTURE_URLS", source: "url_list", entries });
  });

  document.getElementById("bookmarks-file")?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const feedback = document.getElementById("import-feedback");
    if (!file) return;

    try {
      const entries = parseBookmarksHtml(await file.text());
      if (entries.length === 0) {
        if (feedback) feedback.textContent = "The file contained no HTTP or HTTPS bookmarks.";
        return;
      }

      transientMessage = `Starting bookmark import of ${entries.length} ${entries.length === 1 ? "link" : "links"}…`;
      void sendRuntimeMessage({ type: "OURCHIVAL_CAPTURE_URLS", source: "bookmarks", entries });
    } catch (error) {
      if (feedback) {
        feedback.textContent = error instanceof Error ? error.message : "Could not read that bookmarks file.";
      }
    }
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
    transientMessage = `Retrying ${batch.failures.length} failed ${batch.failures.length === 1 ? "link" : "links"}…`;
    void sendRuntimeMessage({
      type: "OURCHIVAL_CAPTURE_URLS",
      source: "retry",
      entries: batch.failures.map((failure) => ({
        url: failure.url,
        ...(failure.title ? { title: failure.title } : {}),
      })),
    });
  });

  document.getElementById("settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const captureEndpoint = String(new FormData(form).get("endpoint") ?? "");

    await saveSettings({ captureEndpoint });
    await chrome.action.setBadgeText({ text: "" });
    transientMessage = "Endpoint saved.";
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
      ? `<button id="retry-failures" type="button" class="secondary full-width">Retry ${batch.failures.length} failed ${batch.failures.length === 1 ? "link" : "links"}</button>`
      : "";
  const visibleFailures = batch.failures.slice(0, 25);
  const failures = batch.failures.length
    ? `<details class="failure-details"><summary>${batch.failed} failed</summary><ul>${visibleFailures
        .map(
          (failure) =>
            `<li><span>${escapeHtml(failure.url)}</span><small>${escapeHtml(failure.message)}</small></li>`,
        )
        .join("")}</ul>${batch.failures.length > visibleFailures.length ? `<p class="hint">Showing the first ${visibleFailures.length}; Retry includes all failures.</p>` : ""}</details>`
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

async function sendRuntimeMessage(message: unknown) {
  try {
    const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse | undefined;
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
    transientMessage = error instanceof Error ? error.message : "The bulk action failed.";
    await render();
  }
}

function batchSourceLabel(source: BatchCaptureSource) {
  if (source === "current_tab") return "Current tab";
  if (source === "selected_tabs") return "Selected tabs";
  if (source === "window") return "Entire window";
  if (source === "bookmarks") return "Bookmarks HTML";
  if (source === "retry") return "Failed-item retry";
  return "Pasted links";
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
