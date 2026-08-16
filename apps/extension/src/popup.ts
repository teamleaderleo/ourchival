import type { CapturePayload } from "@ourchival/shared";
import {
  getPopupState,
  LAST_CAPTURE_KEY,
  LAST_RESULT_KEY,
  normalizeCaptureEndpoint,
  saveSettings,
  SETTINGS_KEY,
  type CaptureResult,
  type ExtensionSettings,
} from "./storage";

async function render() {
  const root = document.getElementById("root");
  if (!root) return;

  const state = await getPopupState();
  const settings = (state[SETTINGS_KEY] as ExtensionSettings | undefined) ?? {};
  const capture = state[LAST_CAPTURE_KEY] as CapturePayload | undefined;
  const result = state[LAST_RESULT_KEY] as CaptureResult | undefined;
  const normalizedEndpoint = normalizeCaptureEndpoint(settings.captureEndpoint);
  const captureTitle = capture?.pageTitle?.trim() || hostForUrl(capture?.sourceUrl) || capture?.sourceUrl;
  const captureMeta = capture
    ? [hostForUrl(capture.sourceUrl), formatCapturedAt(capture.capturedAt)].filter(Boolean).join(" · ")
    : "";

  root.innerHTML = `
    <main>
      <header>
        <p class="eyebrow">Ourchival Clipper</p>
        <h1>Save to Reliquary</h1>
      </header>

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

      <section class="status ${result?.alreadySaved ? "duplicate" : result?.ok ? "ok" : ""}">
        <strong>${result?.alreadySaved ? "Already in Reliquary" : result?.ok ? "Last save worked" : result ? "Last save needs attention" : "Ready"}</strong>
        <p>${escapeHtml(result?.message ?? "Right-click an image or page to save it.")}</p>
      </section>

      <section>
        <h2>Last capture</h2>
        ${capture
          ? `<div class="receipt">
              <span class="receipt-kind">${escapeHtml(captureKindLabel(capture.kind))}</span>
              <div>
                <strong>${escapeHtml(captureTitle ?? "Untitled capture")}</strong>
                <p>${escapeHtml(captureMeta)}</p>
              </div>
            </div>
            <details>
              <summary>Debug details</summary>
              <pre>${escapeHtml(JSON.stringify(capture, null, 2))}</pre>
            </details>`
          : `<p class="hint">Nothing captured yet. The next right-click save will leave a receipt here.</p>`}
      </section>
    </main>
  `;

  document.getElementById("settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const captureEndpoint = String(formData.get("endpoint") ?? "");

    await saveSettings({ captureEndpoint });
    await chrome.action.setBadgeText({ text: "" });
    await render();
  });
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

function captureKindLabel(kind: CapturePayload["kind"]) {
  if (kind === "image") return "Image";
  if (kind === "link") return "Link";
  if (kind === "page") return "Page";
  if (kind === "post") return "Post";
  return "Save";
}

function hostForUrl(value: string | undefined) {
  if (!value) return "";

  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatCapturedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

render();
