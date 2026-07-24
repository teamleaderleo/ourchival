import { captureChatGptConversation } from "./chatgptConversation";
import { captureClaudeConversation } from "./claudeConversation";
import { captureGeminiConversation } from "./geminiConversation";
import {
  normalizeProviderMessages,
  validateProviderArchive,
  type ProviderConversationArchive,
} from "./providerConversation";

export function captureProviderConversation(
  document: Document,
  pageUrl: string,
): ProviderConversationArchive | undefined {
  const chatGpt = captureChatGptConversation(document, pageUrl);
  const archive: ProviderConversationArchive | undefined = chatGpt?.providerConversationId
    ? {
        ...chatGpt,
        providerConversationId: chatGpt.providerConversationId,
      }
    : captureClaudeConversation(document, pageUrl) ??
      captureGeminiConversation(document, pageUrl);
  if (!archive) return undefined;
  return validateProviderArchive({
    ...archive,
    messages: normalizeProviderMessages(archive.messages),
  });
}
