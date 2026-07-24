const buttonId = "capture-provider-conversation";
const feedbackId = "conversation-capture-feedback";

type ConversationDescription = {
  provider: "chatgpt" | "claude" | "gemini";
  title: string;
  messageCount: number;
  sourceUrl: string;
};

function enhancePopup() {
  if (document.getElementById(buttonId)) return;
  const dumpPanel = document.querySelector<HTMLElement>(".dump-panel");
  const actionGrid = dumpPanel?.querySelector<HTMLElement>(".action-grid");
  if (!dumpPanel || !actionGrid) return;
  const baseDisabled = actionGrid.querySelector("button")?.hasAttribute("disabled") ?? true;
  const section = document.createElement("div");
  section.className = "conversation-capture-action";
  section.innerHTML = `
    <button id="${buttonId}" type="button" class="primary full-width" disabled>
      Save this conversation
    </button>
    <p id="${feedbackId}" class="hint">Checking the active tab for a supported conversation…</p>
  `;
  actionGrid.insertAdjacentElement("afterend", section);
  const button = section.querySelector<HTMLButtonElement>(`#${buttonId}`);
  const feedback = section.querySelector<HTMLElement>(`#${feedbackId}`);
  if (!button || !feedback) return;

  button.addEventListener("click", async () => {
    button.disabled = true;
    feedback.textContent = "Reading and archiving the visible conversation…";
    try {
      const response = (await chrome.runtime.sendMessage({
        type: "OURCHIVAL_CAPTURE_CONVERSATION",
      })) as { ok?: boolean; message?: string; error?: string } | undefined;
      if (!response?.ok) {
        throw new Error(response?.error || "Conversation capture failed.");
      }
      feedback.textContent = response.message || "Conversation saved.";
    } catch (error) {
      feedback.textContent =
        error instanceof Error ? error.message : "Conversation capture failed.";
    } finally {
      button.disabled = baseDisabled || button.dataset.supported !== "true";
    }
  });

  void describeActiveConversation(button, feedback, baseDisabled);
}

async function describeActiveConversation(
  button: HTMLButtonElement,
  feedback: HTMLElement,
  baseDisabled: boolean,
) {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (typeof tab?.id !== "number") throw new Error("No active browser tab was found.");
    const response = (await chrome.tabs.sendMessage(tab.id, {
      type: "OURCHIVAL_DESCRIBE_CONVERSATION_CAPTURE",
    })) as {
      ok?: boolean;
      error?: string;
      description?: ConversationDescription;
    };
    if (!response?.ok || !response.description) {
      throw new Error(
        response?.error ||
          "Open a saved ChatGPT, Claude, or Gemini conversation to enable capture.",
      );
    }
    const description = response.description;
    const label = providerLabel(description.provider);
    const count = description.messageCount;
    button.dataset.supported = "true";
    button.textContent = `Save ${count} visible ${label} ${count === 1 ? "message" : "messages"}`;
    button.title = description.title;
    button.disabled = baseDisabled;
    feedback.textContent = baseDisabled
      ? `${label} conversation detected. Pair the Clipper or finish the current import to save it.`
      : `${description.title} · later saves become revisions.`;
  } catch (error) {
    button.dataset.supported = "false";
    button.disabled = true;
    button.textContent = "Save this conversation";
    feedback.textContent =
      error instanceof Error
        ? error.message
        : "Open a supported conversation to enable capture.";
  }
}

function providerLabel(provider: ConversationDescription["provider"]) {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "claude") return "Claude";
  return "Gemini";
}

const observer = new MutationObserver(enhancePopup);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("DOMContentLoaded", enhancePopup);
enhancePopup();
