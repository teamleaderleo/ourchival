import type { CapturePayload } from "@ourchival/shared";

async function render() {
  const root = document.getElementById("root");
  if (!root) return;

  const { lastCapture } = await chrome.storage.local.get("lastCapture");
  const capture = lastCapture as CapturePayload | undefined;

  root.innerHTML = `
    <main>
      <h1>Ourchival</h1>
      <p>Clipper is installed.</p>
      <pre>${escapeHtml(JSON.stringify(capture ?? {}, null, 2))}</pre>
    </main>
  `;
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
