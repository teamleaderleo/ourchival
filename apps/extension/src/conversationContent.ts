import { captureProviderConversation } from "./captureProviderConversation";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OURCHIVAL_GET_CONVERSATION_CAPTURE") return false;
  try {
    const archive = captureProviderConversation(document, location.href);
    sendResponse(
      archive
        ? { ok: true, archive }
        : {
            ok: false,
            error:
              "Open a saved ChatGPT, Claude, or Gemini conversation with visible messages before capturing.",
          },
    );
  } catch (error) {
    sendResponse({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not read the visible conversation.",
    });
  }
  return false;
});
