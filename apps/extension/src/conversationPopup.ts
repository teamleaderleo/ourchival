const buttonId = "capture-provider-conversation";
const feedbackId = "conversation-capture-feedback";

function enhancePopup() {
  if (document.getElementById(buttonId)) return;
  const dumpPanel = document.querySelector<HTMLElement>(".dump-panel");
  const actionGrid = dumpPanel?.querySelector<HTMLElement>(".action-grid");
  if (!dumpPanel || !actionGrid) return;
  const disabled = actionGrid.querySelector("button")?.hasAttribute("disabled") ?? true;
  const section = document.createElement("div");
  section.className = "conversation-capture-action";
  section.innerHTML = `
    <button id="${buttonId}" type="button" class="primary full-width" ${disabled ? "disabled" : ""}>
      Save this conversation
    </button>
    <p id="${feedbackId}" class="hint">Supports visible ChatGPT, Claude, and Gemini conversations. Later captures become revisions.</p>
  `;
  actionGrid.insertAdjacentElement("afterend", section);
  section.querySelector<HTMLButtonElement>(`#${buttonId}`)?.addEventListener(
    "click",
    async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const feedback = document.getElementById(feedbackId);
      button.disabled = true;
      if (feedback) feedback.textContent = "Reading the visible conversation…";
      try {
        const response = (await chrome.runtime.sendMessage({
          type: "OURCHIVAL_CAPTURE_CONVERSATION",
        })) as { ok?: boolean; message?: string; error?: string } | undefined;
        if (!response?.ok) {
          throw new Error(response?.error || "Conversation capture failed.");
        }
        if (feedback) feedback.textContent = response.message || "Conversation saved.";
      } catch (error) {
        if (feedback) {
          feedback.textContent =
            error instanceof Error ? error.message : "Conversation capture failed.";
        }
      } finally {
        button.disabled = disabled;
      }
    },
  );
}

const observer = new MutationObserver(enhancePopup);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("DOMContentLoaded", enhancePopup);
enhancePopup();
