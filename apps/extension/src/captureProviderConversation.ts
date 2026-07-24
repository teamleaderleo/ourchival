import { captureChatGptConversation } from "./chatgptConversation";
import { captureClaudeConversation } from "./claudeConversation";
import { captureGeminiConversation } from "./geminiConversation";
import type { ProviderConversationArchive } from "./providerConversation";

export function captureProviderConversation(
  document: Document,
  pageUrl: string,
): ProviderConversationArchive | undefined {
  const chatGpt = captureChatGptConversation(document, pageUrl);
  if (chatGpt?.providerConversationId) {
    return {
      ...chatGpt,
      providerConversationId: chatGpt.providerConversationId,
    };
  }
  return (
    captureClaudeConversation(document, pageUrl) ??
    captureGeminiConversation(document, pageUrl)
  );
}
