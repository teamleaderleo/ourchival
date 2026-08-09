import {
  ARTIFACT_WARNINGS_KEY,
  clearArtifactWarnings,
  listArtifactWarnings,
  type ArtifactWarning,
} from "./artifactWarnings";

const panelId = "artifact-warning-panel";
let scheduled = false;

async function renderWarnings() {
  scheduled = false;
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return;
  const warnings = await listArtifactWarnings();
  const existing = document.getElementById(panelId);
  if (!warnings.length) {
    existing?.remove();
    return;
  }

  const section = existing ?? document.createElement("section");
  section.id = panelId;
  section.className = "artifact-warning-panel";
  section.innerHTML = `
    <div class="section-heading compact">
      <div>
        <p class="eyebrow">Saved with warnings</p>
        <h2>${warnings.length} preservation ${warnings.length === 1 ? "warning" : "warnings"}</h2>
      </div>
      <button id="clear-artifact-warnings" type="button">Dismiss all</button>
    </div>
    <p class="hint">The references were saved. These optional page artifacts need attention.</p>
    <ul>${warnings.slice(0, 8).map(renderWarning).join("")}</ul>
    ${warnings.length > 8 ? `<p class="hint">Showing the newest 8 of ${warnings.length} warnings.</p>` : ""}
  `;

  if (!existing) {
    const status = main.querySelector(".status-panel");
    if (status) status.insertAdjacentElement("beforebegin", section);
    else main.append(section);
  }

  section
    .querySelector<HTMLButtonElement>("#clear-artifact-warnings")
    ?.addEventListener("click", async () => {
      await clearArtifactWarnings();
      await renderWarnings();
    });
}

function renderWarning(warning: ArtifactWarning) {
  return `<li>
    <span><strong>${escapeHtml(artifactLabel(warning.kind))}</strong> · reference ${escapeHtml(shortReference(warning.referenceId))}</span>
    <small>${escapeHtml(warning.error)}</small>
    <time>${escapeHtml(formatTime(warning.updatedAt))}</time>
  </li>`;
}

function scheduleRender() {
  if (scheduled || document.getElementById(panelId)) return;
  scheduled = true;
  window.requestAnimationFrame(() => void renderWarnings());
}

function artifactLabel(kind: ArtifactWarning["kind"]) {
  if (kind === "page_screenshot") return "Screenshot";
  if (kind === "readable_text") return "Readable text";
  return "Reddit thread snapshot";
}

function shortReference(referenceId: string) {
  return referenceId.length > 12 ? `…${referenceId.slice(-10)}` : referenceId;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
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

function addStyles() {
  if (document.getElementById("artifact-warning-styles")) return;
  const style = document.createElement("style");
  style.id = "artifact-warning-styles";
  style.textContent = `
    .artifact-warning-panel { border-color: rgba(224, 176, 96, 0.45); }
    .artifact-warning-panel .section-heading button { min-height: 28px; padding: 5px 8px; font-size: 9px; }
    .artifact-warning-panel ul { display: grid; gap: 7px; max-height: 170px; overflow: auto; margin: 0; padding: 0; list-style: none; }
    .artifact-warning-panel li { display: grid; gap: 2px; border-top: 1px solid var(--line); padding-top: 7px; }
    .artifact-warning-panel li span { color: #d9c6a2; font-size: 9px; }
    .artifact-warning-panel li small { color: var(--danger); font-size: 9px; line-height: 1.35; }
    .artifact-warning-panel li time { color: var(--muted); font-size: 8px; }
  `;
  document.head.append(style);
}

const observer = new MutationObserver(scheduleRender);
observer.observe(document.documentElement, { childList: true, subtree: true });
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[ARTIFACT_WARNINGS_KEY]) {
    void renderWarnings();
  }
});
window.addEventListener("DOMContentLoaded", () => {
  addStyles();
  void renderWarnings();
});
addStyles();
void renderWarnings();
