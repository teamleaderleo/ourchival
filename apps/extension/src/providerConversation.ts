export type ProviderConversationProvider = "chatgpt" | "claude" | "gemini";

export type ProviderConversationRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "other";

export type ProviderConversationMessage = {
  id: string;
  role: ProviderConversationRole;
  author?: string;
  text: string;
  createdAt?: string;
};

export type ProviderConversationArchive = {
  schemaVersion: 1;
  title: string;
  provider: ProviderConversationProvider;
  providerConversationId: string;
  sourceUrl: string;
  capturedAt: string;
  messages: ProviderConversationMessage[];
};

export const providerConversationLimits = {
  maxMessages: 5_000,
  maxMessageLength: 200_000,
  maxArchiveCharacters: 4_500_000,
} as const;

export function normalizeProviderMessageText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0 ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateProviderArchive<T extends ProviderConversationArchive>(
  archive: T | undefined,
) {
  if (!archive?.messages.length) return undefined;
  const serialized = JSON.stringify(archive);
  if (serialized.length > providerConversationLimits.maxArchiveCharacters) {
    throw new Error("This visible conversation is too large to capture.");
  }
  return archive;
}

export function cleanProviderConversationTitle(
  documentTitle: string,
  messages: ProviderConversationMessage[],
  providerLabel: string,
) {
  const escaped = providerLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cleaned = documentTitle
    .replace(new RegExp(`\\s*[–—-]\\s*${escaped}\\s*$`, "i"), "")
    .replace(new RegExp(`^${escaped}\\s*[–—-]\\s*`, "i"), "")
    .trim();
  if (cleaned && cleaned.toLowerCase() !== providerLabel.toLowerCase()) {
    return cleaned.slice(0, 240);
  }
  const firstUser = messages.find((message) => message.role === "user");
  return (
    firstUser?.text.replace(/\s+/g, " ").slice(0, 90) ||
    `${providerLabel} conversation`
  );
}
