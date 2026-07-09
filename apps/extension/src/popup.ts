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

      <section class="status ${result?.ok ? "ok" : ""}">
        <strong>${result?.ok ? "Last save worked" : "Ready"}</strong>
        <p>${escapeHtml(result?.message ?? "Right-click an image or page to save it.")}</p>
      </section>

      <section>
        <h2>Last capture</h2>
        <pre>${escapeHtml(JSON.stringify(capture ?? {}, null, 2))}</pre>
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

render();
