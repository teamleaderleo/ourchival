import type { CapturedConversationArchive } from "./chatgptConversation";
import { uploadChatGptConversation } from "./conversationCaptureClient";
import { getSettings, normalizeCaptureEndpoint } from "./storage";

type CaptureConversationResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  conversationId?: string;
  referenceId?: string;
  duplicate?: boolean;
  addedCount?: number;
  removedCount?: number;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OURCHIVAL_CAPTURE_CONVERSATION") return false;
  void captureCurrentConversation()
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not capture the current conversation.",
      } satisfies CaptureConversationResponse),
    );
  return true;
});

async function captureCurrentConversation(): Promise<CaptureConversationResponse> {
  const settings = await getSettings();
  const endpoint = normalizeCaptureEndpoint(settings.captureEndpoint);
  const deviceToken = settings.deviceToken?.trim();
  if (!endpoint || !deviceToken) {
    throw new Error("Pair this browser with Ourchival before capturing conversations.");
  }
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (typeof tab?.id !== "number") {
    throw new Error("Open a ChatGPT conversation in the active tab.");
  }

  await chrome.action.setBadgeText({ text: "…" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6f5bb7" });
  try {
    const captured = (await chrome.tabs.sendMessage(tab.id, {
      type: "OURCHIVAL_GET_CONVERSATION_CAPTURE",
    })) as {
      ok?: boolean;
      error?: string;
      archive?: CapturedConversationArchive;
    };
    if (!captured?.ok || !captured.archive) {
      throw new Error(
        captured?.error || "The active tab does not contain a capturable ChatGPT conversation.",
      );
    }
    const result = await uploadChatGptConversation(
      { endpoint, deviceToken },
      captured.archive,
    );
    await chrome.action.setBadgeText({ text: result.duplicate ? "↺" : "✓" });
    await chrome.action.setBadgeBackgroundColor({
      color: result.duplicate ? "#6f5bb7" : "#3d6b3d",
    });
    const revision = result.duplicate
      ? "That exact conversation snapshot is already archived."
      : result.addedCount || result.removedCount
        ? `Saved revision: ${result.addedCount} added, ${result.removedCount} removed.`
        : "Conversation saved to Inbox.";
    return {
      ok: true,
      message: revision,
      conversationId: result.conversationId,
      referenceId: result.referenceId,
      duplicate: result.duplicate,
      addedCount: result.addedCount,
      removedCount: result.removedCount,
    };
  } catch (error) {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#8a3d3d" });
    throw error;
  }
}
