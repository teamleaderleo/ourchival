import { captureChatGptConversation } from "./chatgptConversation";
import { captureClaudeConversation } from "./claudeConversation";
import { captureGeminiConversation } from "./geminiConversation";
import {
  assertRecognizedProviderRoles,
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
  const messages = normalizeProviderMessages(archive.messages);
  assertRecognizedProviderRoles(messages, providerLabel(archive.provider));
  return validateProviderArchive({
    ...archive,
    messages,
  });
}

function providerLabel(provider: ProviderConversationArchive["provider"]) {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "claude") return "Claude";
  return "Gemini";
}
