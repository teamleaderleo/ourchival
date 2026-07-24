import { captureProviderConversation } from "./captureProviderConversation";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const isCapture = message?.type === "OURCHIVAL_GET_CONVERSATION_CAPTURE";
  const isDescription =
    message?.type === "OURCHIVAL_DESCRIBE_CONVERSATION_CAPTURE";
  if (!isCapture && !isDescription) return false;

  try {
    const archive = captureProviderConversation(document, location.href);
    if (!archive) {
      sendResponse({
        ok: false,
        error:
          "Open a saved ChatGPT, Claude, or Gemini conversation with visible messages before capturing.",
      });
      return false;
    }
    sendResponse(
      isDescription
        ? {
            ok: true,
            description: {
              provider: archive.provider,
              title: archive.title,
              messageCount: archive.messages.length,
              sourceUrl: archive.sourceUrl,
            },
          }
        : { ok: true, archive },
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
